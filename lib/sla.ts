import { query, queryOne, queryRo } from "./db";
import { resolveAlert, upsertAlert } from "./repo/alerts";
import { businessDaysBetween } from "./time";
import type { Brand, State } from "./types";

// SLA 타이머 + 에스컬레이션 (03-GATES-SLA §4·§5).

export type SlaPolicies = Record<string, number>; // state → max_days

export async function loadSlaPolicies(): Promise<SlaPolicies> {
  const rows = await query<{ state: string; max_days: number }>(
    "SELECT state, max_days FROM sla_policies",
  );
  const out: SlaPolicies = {};
  for (const r of rows) out[r.state] = r.max_days;
  return out;
}

/** 초과 영업일(daysOver) → tier. gate_violation 은 즉시 2(별도 처리). */
export function tierFromDaysOver(daysOver: number): number {
  if (daysOver >= 5) return 3;
  if (daysOver >= 2) return 2;
  if (daysOver >= 1) return 1;
  return 0;
}

/** live_* 는 접촉 공백(last_contact_at) 기준, 그 외는 stage_entered_at 기준. */
export function slaAnchor(brand: Brand): Date {
  if (brand.state === "live_mall" || brand.state === "live_onboarding") {
    return new Date(brand.last_contact_at ?? brand.stage_entered_at);
  }
  return new Date(brand.stage_entered_at);
}

export interface SlaBreach {
  brand: Brand;
  elapsed: number;
  maxDays: number;
  daysOver: number;
  tier: number;
}

/** 순수: 브랜드 + 정책 → 위반 여부/티어. */
export function checkSlaBreach(
  brand: Brand,
  policies: SlaPolicies,
  now: Date = new Date(),
): SlaBreach | null {
  const maxDays = policies[brand.state];
  if (maxDays == null) return null;
  const elapsed = businessDaysBetween(slaAnchor(brand), now);
  if (elapsed <= maxDays) return null;
  const daysOver = elapsed - maxDays;
  return { brand, elapsed, maxDays, daysOver, tier: tierFromDaysOver(daysOver) };
}

// ─────────────────────────────────────────────────────────────
// 보류(hold) 자동 처리 (BUG-29)
//   보류 SLA 7영업일 → 재컨택 알림 → 다시 7영업일(누적 14) 경과 시 자동 드랍.
//   대상은 '재컨택' 라인만 — '이관클로징(handoff)' 은 플로우링크 이관 대기라 자동 드랍하지 않는다.
//   자동 드랍 건은 stage_history 사유로 식별해 CSV 로 전달한다(/api/export/hold-dropped).
// ─────────────────────────────────────────────────────────────
export const HOLD_SLA_DAYS = 7;              // 1차: 재컨택 알림
export const HOLD_AUTO_DROP_DAYS = 14;       // 2차: 자동 드랍(1차로부터 다시 7영업일)
export const HOLD_DROP_REASON = "장기 보류로 인한 드랍";

/** 보류 라인 — 값이 없으면(레거시·0092 미적용) 재컨택으로 간주. */
export function holdKindOf(b: Brand & { hold_kind?: string | null }): "recontact" | "handoff" {
  return (b.hold_kind ?? "") === "handoff" ? "handoff" : "recontact";
}

/** 순수 판정: 보류 경과 영업일 → 아무것도 안 함 | 재컨택 알림 | 자동 드랍. */
export function holdAction(
  b: Brand & { hold_kind?: string | null },
  now: Date = new Date(),
): { kind: "none" | "recontact" | "drop"; elapsed: number } {
  const elapsed = businessDaysBetween(new Date(b.stage_entered_at), now);
  if (b.state !== "hold") return { kind: "none", elapsed };
  if (holdKindOf(b) === "handoff") return { kind: "none", elapsed }; // 이관 대기 — 자동 드랍 제외
  if (elapsed >= HOLD_AUTO_DROP_DAYS) return { kind: "drop", elapsed };
  if (elapsed >= HOLD_SLA_DAYS) return { kind: "recontact", elapsed };
  return { kind: "none", elapsed };
}

// ─────────────────────────────────────────────────────────────
// /api/cron/sla-check — 매시 정각. 아이들럼포턴트.
// ─────────────────────────────────────────────────────────────
export async function runSlaCheck(now: Date = new Date()): Promise<{
  scanned: number;
  breaches: number;
  docMissing: number;
  payOverdue: number;
  stale: number;
  holdRecontact: number;
  holdDropped: number;
}> {
  const policies = await loadSlaPolicies();
  const brands = await query<Brand>(
    "SELECT * FROM brands WHERE state NOT IN ('dropped','churned')",
  );

  let breaches = 0;
  let docMissing = 0;
  let stale = 0;
  let holdRecontact = 0;
  let holdDropped = 0;

  for (const b of brands) {
    // 0) 보류 자동 처리(BUG-29) — 재컨택 알림 / 장기 보류 자동 드랍.
    //    드랍된 건은 이후 로직(SLA·서류 등)을 탈 필요가 없으므로 바로 다음 브랜드로.
    if (b.state === "hold") {
      const h = holdAction(b as Brand & { hold_kind?: string | null }, now);
      if (h.kind === "drop") {
        const { transitionBrand } = await import("./transition");
        const r = await transitionBrand({
          brandId: b.id, to: "dropped", actor: "system:sla",
          reason: `${HOLD_DROP_REASON} (보류 ${h.elapsed}영업일)`,
        }).catch(() => ({ ok: false }));
        if (r.ok) { holdDropped++; continue; }
      } else if (h.kind === "recontact") {
        holdRecontact++;
        const alert = await upsertAlert(
          b.id, "hold_recontact", 2,
          `${b.brand_name} · 보류 ${h.elapsed}영업일 — 재컨택 필요(${HOLD_AUTO_DROP_DAYS}영업일 경과 시 자동 드랍)`,
        );
        if (!alert.slack_ts) {
          const { notifySlaBreach } = await import("./lead-notify");
          const ts = await notifySlaBreach(b, {
            elapsed: h.elapsed, maxDays: HOLD_SLA_DAYS,
            daysOver: h.elapsed - HOLD_SLA_DAYS, tier: 2,
          }).catch(() => null);
          if (ts) await query("UPDATE alerts SET slack_ts=$2 WHERE id=$1", [alert.id, ts]).catch(() => {});
        }
      } else {
        await resolveAlert(b.id, "hold_recontact");
      }
    }

    // 1) SLA breach
    const breach = checkSlaBreach(b, policies, now);
    if (breach) {
      breaches++;
      const alert = await upsertAlert(
        b.id,
        "sla_breach",
        breach.tier,
        `${b.brand_name} · ${b.state} ${breach.elapsed}영업일 경과(SLA ${breach.maxDays}일)`,
      );
      // 미발송(신규·재발) 알림만 Slack 에 1회 포스트 — 담당자 @태그 후 단계별 채널로.
      if (!alert.slack_ts) {
        const { notifySlaBreach } = await import("./lead-notify");
        const ts = await notifySlaBreach(b, breach).catch(() => null);
        if (ts) await query("UPDATE alerts SET slack_ts=$2 WHERE id=$1", [alert.id, ts]).catch(() => {});
      }
    } else {
      await resolveAlert(b.id, "sla_breach");
    }

    // 3) 서류 미완 (docs 상태 & 1일 이상 경과)
    if (b.state === "docs") {
      const stat = await queryOne<{ total: string; done: string }>(
        `SELECT count(*)::text total, count(*) FILTER (WHERE done)::text done
           FROM doc_items WHERE brand_id=$1`,
        [b.id],
      );
      const total = Number(stat?.total ?? 0);
      const done = Number(stat?.done ?? 0);
      const elapsed = businessDaysBetween(new Date(b.stage_entered_at), now);
      if (total > 0 && done < total && elapsed >= 1) {
        docMissing++;
        await upsertAlert(
          b.id,
          "doc_missing",
          tierFromDaysOver(elapsed - 1),
          `${b.brand_name} · 서류 ${done}/${total} · ${elapsed}영업일 경과`,
        );
      } else if (total > 0 && done === total) {
        await resolveAlert(b.id, "doc_missing");
      }
    }

    // 4) 방치 (진행 상태에서 접촉 7일 초과)
    if (b.last_contact_at) {
      const gap = businessDaysBetween(new Date(b.last_contact_at), now);
      if (gap > 7) {
        stale++;
        await upsertAlert(b.id, "stale", tierFromDaysOver(gap - 7), `${b.brand_name} · 접촉 공백 ${gap}영업일`);
      } else {
        await resolveAlert(b.id, "stale");
      }
    }
  }

  // 2) 결제: glovek mall_subscriptions past_due (읽기전용 참조). 실패해도 전체는 진행.
  let payOverdue = 0;
  try {
    payOverdue = await scanPayOverdue();
  } catch (err) {
    console.warn("[sla] pay_overdue 스캔 스킵:", (err as Error).message);
  }

  return { scanned: brands.length, breaches, docMissing, payOverdue, stale , holdRecontact, holdDropped };
}

/**
 * glovek mall_subscriptions 에서 past_due 를 찾아 pay_overdue 알림.
 * glovek 테이블 스키마가 없으면(로컬) 조용히 0 반환.
 */
async function scanPayOverdue(): Promise<number> {
  let subs: { glovek_user_id: string }[] = [];
  try {
    subs = await queryRo<{ glovek_user_id: string }>(
      `SELECT user_id::text AS glovek_user_id FROM mall_subscriptions WHERE status='past_due'`,
    );
  } catch {
    return 0; // glovek 테이블 미존재(로컬/미연동)
  }
  let n = 0;
  for (const s of subs) {
    const b = await queryOne<Brand>("SELECT * FROM brands WHERE glovek_user_id=$1", [s.glovek_user_id]);
    if (!b) continue;
    await query("UPDATE brands SET pay_status='past_due' WHERE id=$1 AND pay_status<>'past_due'", [b.id]);
    await upsertAlert(b.id, "pay_overdue", 1, `${b.brand_name} · 정기결제 past_due`);
    n++;
  }
  return n;
}

/** 게이트 위반 발생 시 즉시 tier2 알림 (transition 실패 기록 후 호출). */
export async function raiseGateViolation(brand: Brand, label: string): Promise<void> {
  await upsertAlert(brand.id, "gate_violation", 2, `${brand.brand_name} · 게이트 위반: ${label}`);
}

export const ESCALATION = {
  channelForTier(tier: number): "owner_dm" | "leads" | "exec" {
    if (tier >= 3) return "exec";
    if (tier >= 2) return "leads";
    return "owner_dm";
  },
} as const;

/** 전이 성공 시 해제할 알림 종류 (state 관련). */
export function alertsResolvedByTransition(_to: State) {
  return ["sla_breach", "gate_violation", "stale"] as const;
}
