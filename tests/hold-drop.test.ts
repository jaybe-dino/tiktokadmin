import { describe, it, expect } from "vitest";
import { isTransitionAllowed } from "../lib/states";
import { holdAction, holdKindOf, HOLD_SLA_DAYS, HOLD_AUTO_DROP_DAYS } from "../lib/sla";
import type { Brand } from "../lib/types";

// BUG-28 — 드랍된 건이 다시 연락·미팅으로 이어지면 파이프라인으로 되돌릴 수 있어야 한다.
describe("드랍 복귀(BUG-28)", () => {
  it("드랍 → 파이프라인 단계로 복귀 가능(사유 필수)", () => {
    for (const to of ["lead_new", "seminar", "meeting", "contact", "contract_review", "contract_done", "live_mall", "settling"] as const) {
      const r = isTransitionAllowed("dropped", to);
      expect(r.allowed, `dropped→${to}`).toBe(true);
      expect(r.requiresReason).toBe(true);
    }
  });

  it("일반 담당자도 복귀 가능(파트장 전용 아님)", () => {
    expect(isTransitionAllowed("dropped", "meeting", "sales").allowed).toBe(true);
  });

  it("드랍 → 이탈·보류·폐지 단계로는 복귀하지 않는다", () => {
    expect(isTransitionAllowed("dropped", "churned").allowed).toBe(false);
    expect(isTransitionAllowed("dropped", "hold").allowed).toBe(false);
    expect(isTransitionAllowed("dropped", "docs").allowed).toBe(false);
    expect(isTransitionAllowed("dropped", "dropped").allowed).toBe(false);
  });
});

// BUG-29 — 보류 7영업일 → 재컨택 알림, 14영업일 → 자동 드랍. 이관클로징은 자동 드랍 제외.
const hold = (daysAgoBusiness: number, kind?: string): Brand & { hold_kind?: string | null } => {
  // 영업일 기준이므로 넉넉히 과거로 잡되, 주말 영향을 피하려 실제 경과는 holdAction 이 계산.
  const d = new Date();
  d.setDate(d.getDate() - Math.ceil(daysAgoBusiness * 1.5));
  return { state: "hold", stage_entered_at: d.toISOString(), hold_kind: kind ?? null } as unknown as Brand & { hold_kind?: string | null };
};

describe("보류 자동 처리(BUG-29)", () => {
  it("라인 기본값은 재컨택(레거시·미지정 보류 건)", () => {
    expect(holdKindOf(hold(1))).toBe("recontact");
    expect(holdKindOf(hold(1, "handoff"))).toBe("handoff");
    expect(holdKindOf(hold(1, "recontact"))).toBe("recontact");
  });

  it("SLA 이전에는 아무 동작 없음", () => {
    expect(holdAction(hold(0)).kind).toBe("none");
  });

  it("7영업일 경과 → 재컨택 알림, 14영업일 경과 → 자동 드랍", () => {
    const a = holdAction(hold(HOLD_SLA_DAYS + 1));
    expect(a.kind).toBe("recontact");
    expect(a.elapsed).toBeGreaterThanOrEqual(HOLD_SLA_DAYS);

    const b = holdAction(hold(HOLD_AUTO_DROP_DAYS + 2));
    expect(b.kind).toBe("drop");
    expect(b.elapsed).toBeGreaterThanOrEqual(HOLD_AUTO_DROP_DAYS);
  });

  it("이관클로징 라인은 아무리 오래돼도 자동 드랍하지 않는다", () => {
    expect(holdAction(hold(HOLD_AUTO_DROP_DAYS + 10, "handoff")).kind).toBe("none");
  });

  it("보류가 아닌 상태는 대상 아님", () => {
    const b = { state: "contact", stage_entered_at: new Date(2020, 0, 1).toISOString() } as unknown as Brand;
    expect(holdAction(b).kind).toBe("none");
  });
});
