// 마케팅 제안서 자동 예산 엔진 (운영 제안서와 별개).
//   · BUILD→GROWTH→PEAK→MEGA 페이즈 모델 → 무가:유가 비율.
//   · 국가별 월-시즌 캘린더(US·TH·VN) → 각 월의 페이즈 결정.
//   · RFP 월 마케팅 예산(무가+유가) → 월별 무가/유가 배분 + 6개월 합계.
//   · 첫 달은 100% 무가 시딩(USP·히어로 콘텐츠 발굴). GMV 광고는 별도 예비비(작성자 지정).
//   순수 계산 — DB 의존 없음(단위테스트 가능).

export type Phase = "BUILD" | "GROWTH" | "PEAK" | "MEGA";
export type MktCountry = "US" | "TH" | "VN";

// 페이즈 → 무가:유가 (합 10). BUILD 9:1 … MEGA 6:4.
export const PHASE_RATIO: Record<Phase, { organic: number; paid: number }> = {
  BUILD: { organic: 9, paid: 1 },
  GROWTH: { organic: 8, paid: 2 },
  PEAK: { organic: 7, paid: 3 },
  MEGA: { organic: 6, paid: 4 },
};

export const PHASE_MEANING: Record<Phase, string> = {
  BUILD: "콘텐츠 자산·크리에이터 풀 확보",
  GROWTH: "콘텐츠 확대 + 성과 콘텐츠 증폭",
  PEAK: "시즌 집중 공략",
  MEGA: "최대 매출 시즌 · Paid 집중",
};

interface MonthSeason { phase: Phase; season: string; event?: string }

// 국가별 12개월 시즌·페이즈 캘린더(기획 문서 기준). index 1..12 = 달.
export const COUNTRY_CALENDAR: Record<MktCountry, Record<number, MonthSeason>> = {
  US: {
    1: { phase: "BUILD", season: "New Year / Winter Reset" },
    2: { phase: "PEAK", season: "Valentine's Day" },
    3: { phase: "GROWTH", season: "Spring" },
    4: { phase: "GROWTH", season: "Spring / Easter" },
    5: { phase: "PEAK", season: "Mother's Day" },
    6: { phase: "GROWTH", season: "Summer / Father's Day" },
    7: { phase: "PEAK", season: "Summer Sale" },
    8: { phase: "PEAK", season: "Back to School" },
    9: { phase: "GROWTH", season: "Fall" },
    10: { phase: "PEAK", season: "Halloween" },
    11: { phase: "MEGA", season: "Black Friday / Cyber Monday", event: "BLACK FRIDAY" },
    12: { phase: "MEGA", season: "Holiday / Christmas", event: "HOLIDAY" },
  },
  TH: {
    1: { phase: "BUILD", season: "1.1 / New Year", event: "NEW YEAR" },
    2: { phase: "PEAK", season: "2.2 / Valentine's" },
    3: { phase: "GROWTH", season: "3.3" },
    4: { phase: "MEGA", season: "4.4 / Songkran", event: "SONGKRAN" },
    5: { phase: "GROWTH", season: "5.5" },
    6: { phase: "GROWTH", season: "6.6" },
    7: { phase: "PEAK", season: "7.7" },
    8: { phase: "GROWTH", season: "8.8" },
    9: { phase: "PEAK", season: "9.9" },
    10: { phase: "PEAK", season: "10.10" },
    11: { phase: "MEGA", season: "11.11", event: "11.11" },
    12: { phase: "MEGA", season: "12.12 / Year End", event: "12.12" },
  },
  VN: {
    1: { phase: "PEAK", season: "Tết Pre-season" },
    2: { phase: "MEGA", season: "Tết / 2.2", event: "TẾT" },
    3: { phase: "PEAK", season: "3.3 / Women's Day" },
    4: { phase: "GROWTH", season: "4.4" },
    5: { phase: "GROWTH", season: "5.5" },
    6: { phase: "GROWTH", season: "6.6" },
    7: { phase: "PEAK", season: "7.7" },
    8: { phase: "GROWTH", season: "8.8" },
    9: { phase: "PEAK", season: "9.9" },
    10: { phase: "PEAK", season: "10.10" },
    11: { phase: "MEGA", season: "11.11", event: "11.11" },
    12: { phase: "MEGA", season: "12.12 / Year End", event: "12.12" },
  },
};

export const COUNTRY_LABEL: Record<MktCountry, string> = { US: "🇺🇸 미국", TH: "🇹🇭 태국", VN: "🇻🇳 베트남" };

export type PhaseRatios = Record<Phase, { organic: number; paid: number }>;

/** 월별 수동 오버라이드 — 지정 시 자동계산을 덮어씀(그때그때 조정). index 기준. */
export interface MonthOverride { organic?: number; paid?: number; event?: string; note?: string }

export interface MktBudgetInput {
  monthlyBudget: number;      // RFP 월 캠페인 예산(무가+유가), 원
  country: MktCountry;
  startMonth: number;         // 1..12 (캠페인 시작 달)
  months?: number;            // 기본 6
  operationFee?: number;      // 월 운영대행비, 원 (기본 150만)
  gmvReserveMin?: number;     // GMV 광고 예비비 최소, 원 (기본 100만)
  gmvReserveMax?: number;     // GMV 광고 예비비 최대, 원 (기본 300만)
  firstMonthSeedingOnly?: boolean; // 첫 달 100% 무가 시딩 (기본 true)
  phaseRatios?: PhaseRatios;  // 페이즈별 무가:유가 오버라이드(기본 PHASE_RATIO)
  overrides?: (MonthOverride | null)[]; // 월별 수동 오버라이드(index 정렬)
}

export interface MktMonthPlan {
  index: number;              // 0-based 순번
  calendarMonth: number;      // 1..12
  phase: Phase;
  ratioLabel: string;         // "8:2"
  season: string;
  event?: string;
  organic: number;            // 무가 콘텐츠 발행, 원
  paid: number;               // 유가 콘텐츠, 원
  monthTotal: number;         // organic+paid (= 월 캠페인 예산)
  gmvNote: string;            // "소재 발굴 시 집행"
  note: string;               // 카드 하단 요약 문구
}

export interface ResolvedBudgetInput {
  monthlyBudget: number; country: MktCountry; startMonth: number; months: number;
  operationFee: number; gmvReserveMin: number; gmvReserveMax: number; firstMonthSeedingOnly: boolean;
  phaseRatios: PhaseRatios;
}

export interface MktBudgetPlan {
  input: ResolvedBudgetInput;
  months: MktMonthPlan[];
  totalOrganic: number;
  totalPaid: number;
  totalCampaign: number;      // organic+paid 합
  totalOperationFee: number;  // 운영대행비 합
  gmvReserveMin: number;
  gmvReserveMax: number;
  grandMin: number;           // 캠페인 합 (GMV 미포함)
  grandMax: number;           // 캠페인 합 + GMV 최대
}

const MAN = 10_000; // 만원 단위
const roundMan = (won: number) => Math.round(won / MAN) * MAN; // 만원 단위 반올림

const MONTH_KR = (m: number) => `${m}월`;

/** RFP 월 예산 → 월별 무가/유가 배분 + 6개월 합계. 순수 함수.
 *   · phaseRatios: 페이즈별 무가:유가를 제안서마다 조정 가능(기본 9:1~6:4).
 *   · overrides[i]: 특정 월의 무가/유가/이벤트/문구를 수동으로 덮어씀(그때그때 다르게). */
export function computeBudgetPlan(inputRaw: MktBudgetInput): MktBudgetPlan {
  const input: ResolvedBudgetInput = {
    monthlyBudget: inputRaw.monthlyBudget,
    country: inputRaw.country,
    startMonth: inputRaw.startMonth,
    months: inputRaw.months ?? 6,
    operationFee: inputRaw.operationFee ?? 150 * MAN,
    gmvReserveMin: inputRaw.gmvReserveMin ?? 100 * MAN,
    gmvReserveMax: inputRaw.gmvReserveMax ?? 300 * MAN,
    firstMonthSeedingOnly: inputRaw.firstMonthSeedingOnly ?? true,
    phaseRatios: inputRaw.phaseRatios ?? PHASE_RATIO,
  };
  const overrides = inputRaw.overrides ?? [];
  const cal = COUNTRY_CALENDAR[input.country];
  const months: MktMonthPlan[] = [];

  for (let i = 0; i < input.months; i++) {
    const calendarMonth = ((input.startMonth - 1 + i) % 12) + 1;
    const ms = cal[calendarMonth];
    const ratio = input.phaseRatios[ms.phase] ?? PHASE_RATIO[ms.phase];
    const denom = (ratio.organic + ratio.paid) || 1;
    const ov = overrides[i] ?? null;

    let organic: number, paid: number;
    if (i === 0 && input.firstMonthSeedingOnly && ov?.organic == null && ov?.paid == null) {
      organic = input.monthlyBudget; // 첫 달 100% 무가 시딩(오버라이드 없을 때)
      paid = 0;
    } else {
      organic = roundMan((input.monthlyBudget * ratio.organic) / denom);
      paid = input.monthlyBudget - organic; // 합이 정확히 월 예산이 되도록 나머지를 유가로
      if (paid < 0) { paid = 0; organic = input.monthlyBudget; }
    }
    // 월별 수동 오버라이드(있으면 우선).
    if (ov?.organic != null) organic = ov.organic;
    if (ov?.paid != null) paid = ov.paid;

    const autoNote =
      i === 0 && input.firstMonthSeedingOnly
        ? "온보딩 · 시딩 시작 · 무가 시딩 집중"
        : ms.phase === "MEGA"
          ? "검증된 소재를 중심으로 Mega 시즌에 맞춰 유가 비중을 확대합니다."
          : `${MONTH_KR(calendarMonth)} ${ms.season}`;

    months.push({
      index: i,
      calendarMonth,
      phase: ms.phase,
      ratioLabel: `${ratio.organic}:${ratio.paid}`,
      season: ms.season,
      event: ov?.event ?? ms.event,
      organic,
      paid,
      monthTotal: organic + paid,
      gmvNote: "소재 발굴 시 집행",
      note: ov?.note?.trim() ? ov.note : autoNote,
    });
  }

  const totalOrganic = months.reduce((s, m) => s + m.organic, 0);
  const totalPaid = months.reduce((s, m) => s + m.paid, 0);
  const totalCampaign = totalOrganic + totalPaid;
  const totalOperationFee = input.operationFee * input.months;

  return {
    input,
    months,
    totalOrganic,
    totalPaid,
    totalCampaign,
    totalOperationFee,
    gmvReserveMin: input.gmvReserveMin,
    gmvReserveMax: input.gmvReserveMax,
    grandMin: totalCampaign,
    grandMax: totalCampaign + input.gmvReserveMax,
  };
}

// 원 → "3,300만원" / "1억 3,500만원"
export function wonMan(won: number): string {
  const man = Math.round(won / MAN);
  if (man === 0) return "0원";
  const eok = Math.floor(man / 10_000);
  const rest = man % 10_000;
  if (eok > 0) return rest > 0 ? `${eok}억 ${rest.toLocaleString("ko-KR")}만원` : `${eok}억원`;
  return `${man.toLocaleString("ko-KR")}만원`;
}
