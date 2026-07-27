import { buildGateContext, evaluateGate, failedLabels } from "./gates";
import { getBrand, recordStageHistory } from "./repo/brands";
import { resolveAlertsForBrand } from "./repo/alerts";
import { ensureDocTemplate } from "./docs";
import { query } from "./db";
import { isTransitionAllowed } from "./states";
import { raiseGateViolation } from "./sla";
import type { Brand, Role, State } from "./types";

// 게이트 검증 전이 — 모든 상태 쓰기의 단일 경로 (03-GATES-SLA §3).
// 대시보드·Slack·MCP 가 전부 이 함수를 호출한다.

export interface TransitionInput {
  brandId: string;
  to: State;
  actor: string; // admin:{id}|slack:{user}|mcp:{agent}
  actorRole?: Role;
  reason?: string;
}

export interface TransitionResult {
  ok: boolean;
  brand?: Brand;
  error?: string;
  needReason?: boolean;
  failed?: { rule: string; label: string }[];
}

export async function transitionBrand(input: TransitionInput): Promise<TransitionResult> {
  const brand = await getBrand(input.brandId);
  if (!brand) return { ok: false, error: "브랜드를 찾을 수 없음" };

  const from = brand.state;
  const to = input.to;

  const allow = isTransitionAllowed(from, to, input.actorRole);
  if (!allow.allowed) return { ok: false, error: allow.reason ?? "허용되지 않는 전이" };
  if (allow.requiresReason && !input.reason?.trim()) {
    return { ok: false, needReason: true, error: "사유가 필요합니다." };
  }

  // 종료 전이(dropped/churned)는 게이트 없이 사유만 필수.
  const terminal = to === "dropped" || to === "churned";
  if (!terminal) {
    const ctx = await buildGateContext(brand);
    const gate = evaluateGate(from, to, ctx);
    if (!gate.passed) {
      await recordStageHistory(brand.id, from, to, input.actor, false, `gate_fail: ${failedLabels(gate)}`);
      await raiseGateViolation(brand, failedLabels(gate));
      return { ok: false, failed: gate.failed, error: `이동 불가: ${failedLabels(gate)}` };
    }
  }

  // 적용
  await query("UPDATE brands SET state=$2, stage_entered_at=now() WHERE id=$1", [brand.id, to]);
  await recordStageHistory(brand.id, from, to, input.actor, true, input.reason ?? "");

  // 부수효과: contract_done 도달 → 서류 템플릿 자동 생성
  if (to === "contract_done" && brand.contract_type) {
    await ensureDocTemplate(brand.id, brand.contract_type);
  }

  // 관련 알림 해제
  await resolveAlertsForBrand(brand.id, ["sla_breach", "gate_violation", "stale"]);

  const updated = await getBrand(brand.id);
  return { ok: true, brand: updated ?? undefined };
}

/** 담당 배정 (owner_* 필드). */
export async function assignOwner(
  brandId: string,
  role: "owner_intake" | "owner_sales" | "owner_onboard" | "owner_ads",
  adminUserId: string,
): Promise<{ ok: boolean; error?: string }> {
  const valid = ["owner_intake", "owner_sales", "owner_onboard", "owner_ads"];
  if (!valid.includes(role)) return { ok: false, error: "잘못된 역할 필드" };
  await query(`UPDATE brands SET ${role}=$2 WHERE id=$1`, [brandId, adminUserId]);
  return { ok: true };
}
