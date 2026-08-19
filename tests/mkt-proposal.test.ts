import { describe, it, expect } from "vitest";
import { computeBudgetPlan, wonMan, COUNTRY_CALENDAR, PHASE_RATIO } from "../lib/mkt-proposal-engine";

const MAN = 10_000;

describe("mkt-proposal budget engine", () => {
  it("첫 달은 100% 무가 시딩", () => {
    const p = computeBudgetPlan({ monthlyBudget: 500 * MAN, country: "US", startMonth: 9 });
    expect(p.months[0].organic).toBe(500 * MAN);
    expect(p.months[0].paid).toBe(0);
    expect(p.months[0].monthTotal).toBe(500 * MAN);
  });

  it("각 월 무가+유가 = 월 예산(정확히)", () => {
    const p = computeBudgetPlan({ monthlyBudget: 300 * MAN, country: "TH", startMonth: 1 });
    for (const m of p.months) expect(m.organic + m.paid).toBe(300 * MAN);
  });

  it("페이즈 비율 반영 (첫 달 제외)", () => {
    // US 시작 3월(GROWTH 8:2) → 2번째 달은 4월(GROWTH 8:2)
    const p = computeBudgetPlan({ monthlyBudget: 500 * MAN, country: "US", startMonth: 3, firstMonthSeedingOnly: false });
    // 3월 GROWTH 8:2 → 무가 400, 유가 100
    expect(p.months[0].organic).toBe(400 * MAN);
    expect(p.months[0].paid).toBe(100 * MAN);
    expect(p.months[0].ratioLabel).toBe("8:2");
  });

  it("MEGA 달은 6:4", () => {
    // US 11월 = MEGA
    const p = computeBudgetPlan({ monthlyBudget: 500 * MAN, country: "US", startMonth: 11, firstMonthSeedingOnly: false });
    expect(p.months[0].phase).toBe("MEGA");
    expect(p.months[0].organic).toBe(300 * MAN);
    expect(p.months[0].paid).toBe(200 * MAN);
    expect(p.months[0].event).toBe("BLACK FRIDAY");
  });

  it("6개월 합계 = 월 예산 * 개월", () => {
    const p = computeBudgetPlan({ monthlyBudget: 500 * MAN, country: "US", startMonth: 9 });
    expect(p.totalCampaign).toBe(500 * MAN * 6);
    expect(p.months).toHaveLength(6);
  });

  it("운영대행비 합 = 월 * 개월", () => {
    const p = computeBudgetPlan({ monthlyBudget: 300 * MAN, country: "VN", startMonth: 1, operationFee: 150 * MAN });
    expect(p.totalOperationFee).toBe(150 * MAN * 6);
  });

  it("grandMax = 캠페인 합 + GMV 최대", () => {
    const p = computeBudgetPlan({ monthlyBudget: 500 * MAN, country: "US", startMonth: 9, gmvReserveMax: 300 * MAN });
    expect(p.grandMin).toBe(500 * MAN * 6);
    expect(p.grandMax).toBe(500 * MAN * 6 + 300 * MAN);
  });

  it("연말 넘어가는 캘린더 wrap (11월 시작 → 12,1,2…)", () => {
    const p = computeBudgetPlan({ monthlyBudget: 500 * MAN, country: "US", startMonth: 11 });
    expect(p.months.map((m) => m.calendarMonth)).toEqual([11, 12, 1, 2, 3, 4]);
  });

  it("캘린더 12개월 완비 (US/TH/VN)", () => {
    for (const c of ["US", "TH", "VN"] as const) {
      for (let m = 1; m <= 12; m++) expect(COUNTRY_CALENDAR[c][m]).toBeTruthy();
    }
  });

  it("wonMan 억 단위 표기", () => {
    expect(wonMan(3300 * MAN)).toBe("3,300만원");
    expect(wonMan(13500 * MAN)).toBe("1억 3,500만원");
    expect(wonMan(10000 * MAN)).toBe("1억원");
  });

  it("페이즈 비율표 합 10", () => {
    for (const k of Object.keys(PHASE_RATIO) as (keyof typeof PHASE_RATIO)[]) {
      expect(PHASE_RATIO[k].organic + PHASE_RATIO[k].paid).toBe(10);
    }
  });
});
