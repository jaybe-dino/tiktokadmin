// 견적 생성기 — glovek computeQuote 규칙 이식 (문서 10-C).
//   트랙료 × 국가수, 다국가 할인(2국10% / 3~4국15% / 5국+20%), 6개월 약정 20%.
//   ⚠️ 결정론 영역 — AI 개입 금지, 수기 금액 수정 금지(단일 원천).
import type { Plan } from "./types";

/** 정기 트랙 월 단가(원) — 국가당. onboarding 은 별도(일회·프로젝트성). */
export const TRACK_MONTHLY: Record<string, number> = {
  live_focus_490k: 490_000,
  guarantee_1m: 1_000_000,
  pro_89k: 89_000,
};

/** 온보딩 일회 기본가(원) — 기간 티어별. (glovek 확정가 입력 지점) */
export const ONBOARDING_BASE: Record<string, number> = {
  "3month": 30_000_000,
  "5month": 50_000_000,
  "12month": 100_000_000,
};

export type QuoteTerm = "monthly" | "6month";

/** 다국가 할인율: 1국 0 · 2국 10% · 3~4국 15% · 5국+ 20% */
export function multiCountryDiscount(n: number): number {
  if (n >= 5) return 0.2;
  if (n >= 3) return 0.15;
  if (n >= 2) return 0.1;
  return 0;
}

/** 약정 할인율: 6개월 20% · 월간 0 */
export function termDiscount(term: QuoteTerm): number {
  return term === "6month" ? 0.2 : 0;
}

export interface QuoteInput {
  plan: Plan | string;
  countries: string[];
  term?: QuoteTerm;
  /** onboarding_onetime 기간 티어 (3month|5month|12month) */
  onboardingTier?: keyof typeof ONBOARDING_BASE;
}

export interface QuoteResult {
  base: number;            // 트랙료 × 국가수(정기) 또는 티어가(온보딩)
  countryCount: number;
  multiRate: number;
  multiDiscount: number;   // 다국가 할인 금액(음수 아님, 차감액)
  termRate: number;
  termDiscount: number;
  total: number;           // 할인 반영 최종(원, VAT 별도)
  recurring: boolean;      // true=월 정기, false=일회
  breakdown: string;       // 사람이 읽는 요약
}

/** 견적 산출 — 단일 원천. 반올림은 1원 단위 내림(할인 후). */
export function computeQuote(input: QuoteInput): QuoteResult {
  const term: QuoteTerm = input.term ?? "monthly";
  const n = input.countries.length || 1;

  if (input.plan === "onboarding_onetime") {
    const tier = input.onboardingTier ?? "5month";
    const base = ONBOARDING_BASE[tier] ?? ONBOARDING_BASE["5month"];
    // 온보딩은 일회·프로젝트성 — 다국가/약정 할인 미적용(기본 티어가).
    return {
      base, countryCount: n, multiRate: 0, multiDiscount: 0,
      termRate: 0, termDiscount: 0, total: base, recurring: false,
      breakdown: `온보딩 ${tier} 기본가 ${won(base)}`,
    };
  }

  const trackFee = TRACK_MONTHLY[input.plan as string];
  if (!trackFee) {
    throw new Error(`unknown plan for quote: ${input.plan}`);
  }
  const base = trackFee * n;
  const multiRate = multiCountryDiscount(n);
  const multiDiscount = Math.floor(base * multiRate);
  const afterMulti = base - multiDiscount;
  const termRate = termDiscount(term);
  const termDiscountAmt = Math.floor(afterMulti * termRate);
  const total = afterMulti - termDiscountAmt;

  const parts = [`${won(trackFee)} × ${n}국 = ${won(base)}`];
  if (multiRate > 0) parts.push(`다국가 -${Math.round(multiRate * 100)}% (${won(multiDiscount)})`);
  if (termRate > 0) parts.push(`6개월약정 -${Math.round(termRate * 100)}% (${won(termDiscountAmt)})`);

  return {
    base, countryCount: n, multiRate, multiDiscount,
    termRate, termDiscount: termDiscountAmt, total, recurring: true,
    breakdown: parts.join(" · ") + ` → 월 ${won(total)} (VAT 별도)`,
  };
}

function won(n: number): string {
  return n.toLocaleString("ko-KR") + "원";
}

/** 할인 상한(20%) 초과 여부 — 초과 시 발송 잠금·결재 생성(20-UI f-prop) */
export function exceedsDiscountCap(quote: QuoteResult, manualAmount: number): boolean {
  if (manualAmount >= quote.total) return false;
  const discountFromQuote = (quote.total - manualAmount) / quote.total;
  return discountFromQuote > 0.2;
}
