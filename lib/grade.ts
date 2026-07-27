import type { Grade, RecTrack } from "./types";

// glovek 의 gradeFromChecks 로직을 그대로 사용 (임의 재정의 금지).
// 셀프진단 5문항 yes 개수 → 등급.
//   5 → S · 4 → A · 2~3 → B · 0~1 → C
// 추천 트랙: S/A → onboarding · B/C → live

export interface SelfChecks {
  q1: boolean; // 해외 플랫폼 월매출 1천만↑
  q2: boolean; // 수출인증/현지물류 보유
  q3: boolean; // 직수출 6개월↑
  q4: boolean; // 해외 팝업/전시 이력
  q5: boolean; // 인플루언서 시딩 10회↑
}

export function countChecks(checks: Partial<SelfChecks>): number {
  return (["q1", "q2", "q3", "q4", "q5"] as const).reduce(
    (n, k) => n + (checks[k] ? 1 : 0),
    0,
  );
}

export function gradeFromChecks(checks: Partial<SelfChecks>): Grade {
  const yes = countChecks(checks);
  if (yes >= 5) return "S";
  if (yes === 4) return "A";
  if (yes >= 2) return "B";
  return "C";
}

/** yes 개수(0~5)에서 직접 등급 산출 */
export function gradeFromCount(yes: number): Grade {
  if (yes >= 5) return "S";
  if (yes === 4) return "A";
  if (yes >= 2) return "B";
  return "C";
}

export function recommendedTrack(grade: Grade): RecTrack {
  return grade === "S" || grade === "A" ? "onboarding" : "live";
}

// 국가 인증문항 (셀프진단 국가별)
export const COUNTRY_CERTS: Record<string, string> = {
  US: "US FDA",
  VN: "VN 보건부",
  TH: "TH FDA",
  MY: "MY 할랄",
  SG: "SG HSA",
};
