import { describe, expect, it } from "vitest";
import { workItemsForPlan, computeSettlement, monthFirst } from "../lib/operations";

describe("workItemsForPlan (15 §2)", () => {
  it("Live Focus = 시딩20·라이브4·리포트1", () => {
    const w = workItemsForPlan("live_focus_490k");
    expect(w).toEqual([
      { kind: "seeding", qty_target: 20 },
      { kind: "live", qty_target: 4 },
      { kind: "report", qty_target: 1 },
    ]);
  });
  it("Guarantee = 시딩30·라이브6", () => {
    const w = workItemsForPlan("guarantee_1m");
    expect(w.find((x) => x.kind === "seeding")!.qty_target).toBe(30);
    expect(w.find((x) => x.kind === "live")!.qty_target).toBe(6);
  });
  it("Onboarding = 계약 terms 우선", () => {
    const w = workItemsForPlan("onboarding_onetime", { seeding: 15, live: 3 });
    expect(w.find((x) => x.kind === "seeding")!.qty_target).toBe(15);
    expect(w.find((x) => x.kind === "live")!.qty_target).toBe(3);
  });
});

describe("computeSettlement (15 §4)", () => {
  it("fee_pct × gmv + 구독분", () => {
    const c = computeSettlement({ gmv: 10_000_000, feePct: 10, subAmount: 490_000 });
    expect(c.feeAmount).toBe(1_000_000);
    expect(c.total).toBe(1_490_000);
    expect(c.anomaly).toBe(false);
  });
  it("est_gmv ±30% 이탈 → anomaly", () => {
    const c = computeSettlement({ gmv: 10_000_000, feePct: 10, subAmount: 0, estGmv: 5_000_000 });
    expect(c.anomaly).toBe(true);
  });
  it("±30% 이내는 정상", () => {
    const c = computeSettlement({ gmv: 10_000_000, feePct: 10, subAmount: 0, estGmv: 9_000_000 });
    expect(c.anomaly).toBe(false);
  });
});

describe("monthFirst", () => {
  it("해당 월 1일 반환", () => {
    expect(monthFirst(new Date("2026-07-31T10:00:00Z"))).toBe("2026-07-01");
  });
});
