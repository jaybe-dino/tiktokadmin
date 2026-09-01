// 제안서 기간 선택 — "전체 월"을 펼쳐 놓고 체크로 고르는 방식(회의 요청).
//   예산 엔진은 시작 연월 + 연속 N개월을 전제로 페이즈(BUILD→MEGA)를 계산하므로,
//   중간 월을 건너뛸 수는 없다. 체크가 떨어져 있으면 처음~마지막 사이를 자동으로 메운다.
//   (예: 9월 해제 + 10월~3월 체크 → 10월 시작 6개월)

export interface YM { year: number; month: number } // month: 1~12

export function ymKey(v: YM): string {
  return `${v.year}-${String(v.month).padStart(2, "0")}`;
}

/** n개월 뒤(음수면 이전) 연월. */
export function addMonths(v: YM, n: number): YM {
  const zero = v.year * 12 + (v.month - 1) + n;
  return { year: Math.floor(zero / 12), month: (zero % 12) + 1 };
}

/** 오늘(또는 기준일) 기준 연월 — offset 0=이번 달, 1=다음 달. */
export function currentYM(base: Date = new Date(), offset = 0): YM {
  return addMonths({ year: base.getFullYear(), month: base.getMonth() + 1 }, offset);
}

/** 기준 연월부터 count 개월의 연속 창(체크박스로 펼쳐 보여줄 전체 월). */
export function monthWindow(from: YM, count = 12): YM[] {
  return Array.from({ length: Math.max(1, count) }, (_, i) => addMonths(from, i));
}

/** 선택된 연월들 → 시작 연월 + 개월수. 흩어진 선택은 처음~마지막 구간으로 메운다. */
export function rangeFromSelection(selected: YM[]): { start: YM; months: number } | null {
  if (selected.length === 0) return null;
  const zeros = selected.map((v) => v.year * 12 + (v.month - 1));
  const min = Math.min(...zeros);
  const max = Math.max(...zeros);
  return { start: { year: Math.floor(min / 12), month: (min % 12) + 1 }, months: max - min + 1 };
}

/** 시작 연월 + 개월수 → 포함된 연월 목록(월별 배분표 라벨용). */
export function rangeToMonths(start: YM, months: number): YM[] {
  return monthWindow(start, Math.max(1, months));
}

/** 선택 여부 판정 — 시작 연월부터 months 개월 구간에 속하는가. */
export function inRange(v: YM, start: YM, months: number): boolean {
  const z = v.year * 12 + (v.month - 1);
  const s = start.year * 12 + (start.month - 1);
  return z >= s && z < s + Math.max(1, months);
}
