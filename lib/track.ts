// 트랙(계약형태) 매핑 단일 출처 — 제안서 플랜·계약 종류를 brand.contract_type 로 정규화.
//   contract_type 값: 'mall' | 'onboarding' | 'marketing' (게이트·라이브 전이 기준).
//   기존 문제: 제안서/계약 생성이 brand.contract_type 를 세팅하지 않아
//   contact→contract_review 게이트("계약형태 미정")가 정상 딜에서도 영구 차단됐음.

/** 제안서 플랜(PLANS) → 계약형태. 알 수 없으면 null. */
export function contractTypeFromPlan(plan?: string | null): string | null {
  if (!plan) return null;
  if (plan === "onboarding_onetime") return "onboarding";
  if (plan === "pro_89k") return "marketing";
  if (plan === "live_focus_490k" || plan === "guarantee_1m") return "mall";
  return null;
}

/** 계약 종류(kind) → 계약형태. mall/guarantee=mall · onboarding=onboarding · marketing*=marketing. */
export function contractTypeFromKind(kind?: string | null): string | null {
  if (!kind) return null;
  if (kind === "onboarding") return "onboarding";
  if (kind === "marketing" || kind === "marketing_retainer") return "marketing";
  if (kind === "mall" || kind === "guarantee") return "mall";
  return null;
}

/** contract_type → 트랙 한글 라벨(배지). */
export const TRACK_LABEL: Record<string, string> = {
  mall: "멀티몰",
  onboarding: "온보딩",
  marketing: "마케팅",
};
