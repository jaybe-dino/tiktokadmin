import { describe, expect, it } from "vitest";
import { computeQuote, multiCountryDiscount, termDiscount, exceedsDiscountCap } from "../lib/quote";

// 견적 규칙(10-C): 트랙료×국가수, 2국10%/3~4국15%/5국20%, 6개월약정 20%.
describe("computeQuote", () => {
  it("1국 월간 — 할인 없음", () => {
    const q = computeQuote({ plan: "live_focus_490k", countries: ["미국"], term: "monthly" });
    expect(q.total).toBe(490_000);
    expect(q.multiRate).toBe(0);
  });
  it("2국 10% 할인 (프로토타입 그린바이트 케이스)", () => {
    const q = computeQuote({ plan: "live_focus_490k", countries: ["미국", "베트남"], term: "monthly" });
    // 490,000 × 2 = 980,000 → -10% = 882,000
    expect(q.base).toBe(980_000);
    expect(q.total).toBe(882_000);
  });
  it("3국 15% 할인", () => {
    const q = computeQuote({ plan: "live_focus_490k", countries: ["미국", "베트남", "태국"], term: "monthly" });
    expect(q.total).toBe(Math.floor(490_000 * 3 * 0.85)); // 1,249,500
  });
  it("5국 20% + 6개월약정 20% 복합", () => {
    const q = computeQuote({
      plan: "live_focus_490k",
      countries: ["미국", "베트남", "태국", "싱가포르", "필리핀"],
      term: "6month",
    });
    const base = 490_000 * 5;                 // 2,450,000
    const afterMulti = base - Math.floor(base * 0.2); // -20% = 1,960,000
    const total = afterMulti - Math.floor(afterMulti * 0.2); // -20% = 1,568,000
    expect(q.total).toBe(total);
  });
  it("guarantee 트랙 단가 100만", () => {
    const q = computeQuote({ plan: "guarantee_1m", countries: ["미국"], term: "monthly" });
    expect(q.total).toBe(1_000_000);
  });
  it("온보딩 일회 — 티어가, 다국가/약정 할인 미적용", () => {
    const q = computeQuote({ plan: "onboarding_onetime", countries: ["미국", "베트남"], onboardingTier: "5month" });
    expect(q.total).toBe(50_000_000);
    expect(q.recurring).toBe(false);
  });
});

describe("discount rate ladders", () => {
  it("multiCountryDiscount", () => {
    expect(multiCountryDiscount(1)).toBe(0);
    expect(multiCountryDiscount(2)).toBe(0.1);
    expect(multiCountryDiscount(3)).toBe(0.15);
    expect(multiCountryDiscount(4)).toBe(0.15);
    expect(multiCountryDiscount(5)).toBe(0.2);
    expect(multiCountryDiscount(9)).toBe(0.2);
  });
  it("termDiscount", () => {
    expect(termDiscount("monthly")).toBe(0);
    expect(termDiscount("6month")).toBe(0.2);
  });
});

describe("exceedsDiscountCap (할인 상한 20%)", () => {
  it("20% 이하 통과", () => {
    const q = computeQuote({ plan: "live_focus_490k", countries: ["미국"], term: "monthly" });
    expect(exceedsDiscountCap(q, 392_000)).toBe(false); // 정확히 20% 할인
  });
  it("20% 초과 잠금", () => {
    const q = computeQuote({ plan: "live_focus_490k", countries: ["미국"], term: "monthly" });
    expect(exceedsDiscountCap(q, 300_000)).toBe(true); // ~39% 할인
  });
});
