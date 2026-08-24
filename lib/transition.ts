import { buildGateContext, evaluateGate, failedLabels } from "./gates";
import { checkStageRequirements } from "./requirements";
import { getBrand, recordStageHistory } from "./repo/brands";
import { resolveAlertsForBrand, resolveAllAlertsForBrand } from "./repo/alerts";
import { ensureDocTemplate } from "./docs";
import { query } from "./db";
import { isTransitionAllowed } from "./states";
import { raiseGateViolation } from "./sla";
import { syncServiceTags } from "./service-tags";
import type { Brand, OwnerField, Role, State } from "./types";

// 게이트 검증 전이 — 모든 상태 쓰기의 단일 경로 (03-GATES-SLA §3).
// 대시보드·Slack·MCP 가 전부 이 함수를 호출한다.

export interface TransitionInput {
  brandId: string;
  to: State;
  actor: string; // admin:{id}|slack:{user}|mcp:{agent}
  actorRole?: Role;
  reason?: string;
  force?: boolean; // 파트장/대표 강제 이동 — 게이트 미충족 건너뜀(감사 기록 남김)
}

export interface TransitionResult {
  ok: boolean;
  brand?: Brand;
  error?: string;
  needReason?: boolean;
  pending?: boolean; // 결재선 경유(즉시 반영 안 됨). #2 드랍 결재.
  failed?: { rule: string; label: string }[];
}

export async function transitionBrand(input: TransitionInput): Promise<TransitionResult> {
  const brand = await getBrand(input.brandId);
  if (!brand) return { ok: false, error: "브랜드를 찾을 수 없음" };

  const from = brand.state;
  const to = input.to;

  // #13 RBAC 스코프: 상태 전이는 대상 브랜드 담당(owner_*)이거나 lead/exec 만 가능.
  //  - actorRole 미지정(하위호환) 시엔 스코프 검사를 생략한다.
  //  - 담당 매칭은 admin 세션 액터(admin:{id})에 한해 확실히 판정 가능.
  //    (slack/mcp 는 actor 문자열이 owner_* 식별자와 형식이 달라 오탐 방지 위해 스킵)
  if (
    input.actorRole &&
    input.actorRole !== "lead" &&
    input.actorRole !== "exec" &&
    input.actor.startsWith("admin:")
  ) {
    const actorId = input.actor.slice("admin:".length);
    const owners = [brand.owner_intake, brand.owner_sales, brand.owner_onboard, brand.owner_ads, brand.owner_contract];
    const isOwner = owners.some((o) => !!o && o === actorId);
    if (!isOwner) {
      return { ok: false, error: "권한 없음: 담당 브랜드가 아니거나 결재 권한이 없습니다." };
    }
  }

  const canForce = input.actorRole === "lead" || input.actorRole === "exec";
  const allow = isTransitionAllowed(from, to, input.actorRole);
  if (!allow.allowed) {
    // 파트장/대표는 강제 이동(사유 필수)으로 정의되지 않은 전이도 임의 이동 가능.
    if (input.force && canForce) {
      if (!input.reason?.trim()) return { ok: false, needReason: true, error: "강제 이동은 사유가 필요합니다." };
      await recordStageHistory(brand.id, from, to, input.actor, true, `force_override(${input.reason.trim()}) · 비허용 전이`);
      await query("UPDATE brands SET state=$2, stage_entered_at=now() WHERE id=$1", [brand.id, to]);
      if (to === "contract_done" && brand.contract_type) await ensureDocTemplate(brand.id, brand.contract_type);
      await resolveAlertsForBrand(brand.id, ["sla_breach", "gate_violation", "stale"]);
      await syncServiceTags(brand.id);
      const updated = await getBrand(brand.id);
      return { ok: true, brand: updated ?? undefined };
    }
    return { ok: false, error: allow.reason ?? "허용되지 않는 전이" };
  }
  if (allow.requiresReason && !input.reason?.trim()) {
    return { ok: false, needReason: true, error: "사유가 필요합니다." };
  }

  // 종료 전이(dropped/churned)는 게이트 없이 사유만 필수.
  const terminal = to === "dropped" || to === "churned";
  // 보류(hold) 진입/해제는 파킹 단계 — 게이트·필수항목을 검사하지 않는다(언제든 이동).
  const skipGates = terminal || to === "hold" || from === "hold";
  if (!skipGates) {
    // 1) 코드 게이트(핵심 무결성 규칙)
    const ctx = await buildGateContext(brand);
    const gate = evaluateGate(from, to, ctx);
    // 2) 관리자 설정 필수항목(현 단계에서 무조건 체크·입력) — from 단계 기준
    const reqUnmet = await checkStageRequirements(brand);
    const failed = [...gate.failed, ...reqUnmet];
    if (failed.length > 0) {
      const labels = failed.map((f) => f.label).join(" · ");
      // 파트장/대표 강제 이동 — 사유 필수. 게이트를 건너뛰되 강제 기록을 남긴다.
      if (input.force && canForce) {
        if (!input.reason?.trim()) return { ok: false, needReason: true, error: "강제 이동은 사유가 필요합니다." };
        await recordStageHistory(brand.id, from, to, input.actor, true, `force_override(${input.reason.trim()}) · 미충족: ${labels}`);
        await query("UPDATE brands SET state=$2, stage_entered_at=now() WHERE id=$1", [brand.id, to]);
        if (to === "contract_done" && brand.contract_type) await ensureDocTemplate(brand.id, brand.contract_type);
        await resolveAlertsForBrand(brand.id, ["sla_breach", "gate_violation", "stale"]);
        await syncServiceTags(brand.id);
        const updated = await getBrand(brand.id);
        return { ok: true, brand: updated ?? undefined };
      }
      await recordStageHistory(brand.id, from, to, input.actor, false, `gate_fail: ${labels}`);
      await raiseGateViolation(brand, labels);
      return { ok: false, failed, error: `이동 불가: ${labels}` };
    }
  }

  // 적용
  await query("UPDATE brands SET state=$2, stage_entered_at=now() WHERE id=$1", [brand.id, to]);
  await recordStageHistory(brand.id, from, to, input.actor, true, input.reason ?? "");

  // 부수효과: contract_done 도달 → 서류 템플릿 자동 생성
  if (to === "contract_done" && brand.contract_type) {
    await ensureDocTemplate(brand.id, brand.contract_type);
  }

  // 관련 알림 해제 — 종료 전이(드랍/해지)는 모든 활성 알림 해제(잔여 Slack 에스컬레이션 방지),
  //   그 외 전이는 단계 무결성 관련 알림만 해제.
  if (terminal) {
    await resolveAllAlertsForBrand(brand.id);
  } else {
    await resolveAlertsForBrand(brand.id, ["sla_breach", "gate_violation", "stale"]);
  }

  await syncServiceTags(brand.id);
  const updated = await getBrand(brand.id);
  return { ok: true, brand: updated ?? undefined };
}

/** 담당 배정 (owner_* 필드). */
export async function assignOwner(
  brandId: string,
  role: OwnerField,
  adminUserId: string,
): Promise<{ ok: boolean; error?: string }> {
  const valid = ["owner_intake", "owner_sales", "owner_onboard", "owner_ads", "owner_contract"];
  if (!valid.includes(role)) return { ok: false, error: "잘못된 역할 필드" };
  try {
    await query(`UPDATE brands SET ${role}=$2 WHERE id=$1`, [brandId, adminUserId]);
  } catch (e) {
    // 컬럼 미존재(예: owner_contract 마이그레이션 0054 미적용) 등 — 500 대신 명확한 메시지.
    const msg = (e as Error).message ?? "";
    if (/owner_contract/.test(msg) || /column .* does not exist/i.test(msg)) {
      return { ok: false, error: "계약담당 컬럼이 없습니다 — 마이그레이션(0054) 적용이 필요합니다(관리자)." };
    }
    return { ok: false, error: "담당 배정 저장 실패" };
  }
  return { ok: true };
}
