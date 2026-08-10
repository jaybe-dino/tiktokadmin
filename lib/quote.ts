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

// ══════════════════════════════════════════════════════════════
// 운영견적(재설계) — 트랙 3종 · 약정/매월 · 수기 월금액 · 추가할인 티어.
//   금액은 담당이 수기로 넣고(월 정기결제), 약정이면 개월수만큼 일시불 합계를 낸다.
// ══════════════════════════════════════════════════════════════

/** 운영견적 트랙 3종 — 온보딩(대행) / 라이브 포커스 / 게런티. */
export const OPS_TRACKS: { key: string; label: string; plan: string; contractType: string }[] = [
  { key: "onboarding", label: "온보딩(대행)", plan: "onboarding_onetime", contractType: "onboarding" },
  { key: "live_focus", label: "라이브 포커스", plan: "live_focus_490k", contractType: "mall" },
  { key: "guarantee", label: "게런티", plan: "guarantee_1m", contractType: "mall" },
];

/** 약정 개월 선택지 · 추가할인 티어 · 파트장 결재 임계(30%). */
export const COMMIT_MONTHS = [3, 6, 12] as const;
export const ADDL_DISCOUNTS = [0, 5, 10, 20, 30, 40, 50, 60] as const;
export const OPS_APPROVAL_THRESHOLD = 30; // 합산 할인이 이 값 이상(≥30%)이면 파트장 결재 필요

/** 운영견적 대상 국가(중복선택). */
export const OPS_COUNTRIES: { code: string; label: string }[] = [
  { code: "US", label: "미국" }, { code: "TH", label: "태국" }, { code: "PH", label: "필리핀" },
  { code: "MY", label: "말레이시아" }, { code: "SG", label: "싱가폴" }, { code: "JP", label: "일본" },
];

export type OpsPaymentMode = "commitment" | "monthly";

export interface OpsQuoteInput {
  monthlyAmount: number;          // 월 정기 결제 금액(수기, 원) — 국가당 월비용
  paymentMode: OpsPaymentMode;    // 약정할인 | 매월결제
  commitmentMonths?: number;      // 약정 시 3|6|12
  addlDiscountPct: number;        // 추가할인 %
  countryDiscountPct?: number;    // 국가 추가할인 %
  countries?: string[];
}

export interface OpsQuoteResult {
  monthlyNet: number;   // 할인 반영 월 합계(국가수 반영)
  total: number;        // 표시 합계(약정=일시불 합계 / 매월=월 합계)
  months: number;       // 약정 개월(매월=1)
  recurring: boolean;   // true=월 정기 / false=약정 일시불
  totalDiscountPct: number;  // 합산 할인(추가+국가)
  countryCount: number; // 청구 대상 국가 수(최소 1)
  perCountryMonthly: number; // 국가당 월비용(수기)
  grossMonthly: number; // 할인 전 월 합계 = 국가당 월비용 × 국가수
  label: string;        // 합계 라벨
  breakdown: string;
}

/** 운영견적 산출 — 월비용은 국가당이며 국가수만큼 합산한다.
 *   약정: 월합계×개월(일시불 합계) / 매월: 월합계. 할인 0%는 표기하지 않는다. */
export function computeOpsQuote(i: OpsQuoteInput): OpsQuoteResult {
  const addl = Math.min(100, Math.max(0, Number(i.addlDiscountPct) || 0));
  const country = Math.min(100, Math.max(0, Number(i.countryDiscountPct) || 0));
  const totalDiscountPct = Math.min(95, addl + country); // 합산 할인(상한 95%)
  const perCountryMonthly = Math.max(0, Math.round(Number(i.monthlyAmount) || 0));
  // 국가당 월비용 × 선택 국가수(미선택 시 1국 기준).
  const countryCount = Math.max(1, (i.countries ?? []).length);
  const grossMonthly = perCountryMonthly * countryCount;
  const monthlyNet = Math.round(grossMonthly * (1 - totalDiscountPct / 100));
  // 할인 표기 — 0%는 넣지 않고, 값이 있을 때만.
  const discBits = [addl > 0 ? `추가 -${addl}%` : "", country > 0 ? `국가 -${country}%` : ""].filter(Boolean).join(" · ");
  const discSuffix = discBits ? ` (${discBits})` : "";
  // 국가당 × 국가수 표기(1국이면 생략).
  const perCountryBit = countryCount > 1 ? `월 ${won(perCountryMonthly)} × ${countryCount}국 = ${won(grossMonthly)}` : `월 ${won(grossMonthly)}`;

  if (i.paymentMode === "commitment") {
    const months = COMMIT_MONTHS.includes((i.commitmentMonths ?? 0) as 3 | 6 | 12) ? (i.commitmentMonths as number) : 3;
    const total = monthlyNet * months;
    return {
      monthlyNet, total, months, recurring: false, totalDiscountPct, countryCount, perCountryMonthly, grossMonthly,
      label: `약정 ${months}개월 일시불`,
      breakdown: `${perCountryBit}${discSuffix} × ${months}개월 = ${won(total)} (VAT 별도)`,
    };
  }
  return {
    monthlyNet, total: monthlyNet, months: 1, recurring: true, totalDiscountPct, countryCount, perCountryMonthly, grossMonthly,
    label: "월 정기결제",
    breakdown: `${perCountryBit}${discSuffix} → 월 ${won(monthlyNet)} (VAT 별도)`,
  };
}
