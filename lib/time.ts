// 시간 유틸. DB 저장은 UTC(timestamptz), 표시·SLA 계산은 KST(UTC+9).

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** UTC Date → KST 기준 Date 컴포넌트 (getUTC* 로 읽으면 KST 벽시계) */
export function toKst(d: Date): Date {
  return new Date(d.getTime() + KST_OFFSET_MS);
}

/** KST 벽시계 기준 YYYY-MM-DD */
export function kstDateString(d: Date): string {
  const k = toKst(d);
  return `${k.getUTCFullYear()}-${pad(k.getUTCMonth() + 1)}-${pad(k.getUTCDate())}`;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** 주말(토·일) 여부 — KST 기준 */
export function isWeekendKst(d: Date): boolean {
  const day = toKst(d).getUTCDay(); // 0=일, 6=토
  return day === 0 || day === 6;
}

/**
 * KST 영업일 경과 계산 (주말 제외). from → to 사이의 "완전히 지난 영업일" 수.
 * 예) 금요일 저장 → 다음 화요일이면 월·화 2영업일 경과.
 */
export function businessDaysBetween(from: Date, to: Date): number {
  if (to <= from) return 0;
  let count = 0;
  // 자정 단위로 하루씩 전진 (KST 자정 기준)
  const cursor = new Date(from.getTime());
  cursor.setUTCHours(0, 0, 0, 0);
  const end = new Date(to.getTime());
  while (cursor < end) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    if (cursor <= end && !isWeekendKst(cursor)) count++;
  }
  return count;
}

/** ms → "N일 M시간" 등 사람이 읽는 경과 (KST 무관, 절대시간) */
export function humanElapsed(fromIso: string, now: Date = new Date()): string {
  const from = new Date(fromIso);
  const ms = Math.max(0, now.getTime() - from.getTime());
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  if (days > 0) return `${days}일 ${hours}시간`;
  const mins = Math.floor((ms % 3_600_000) / 60_000);
  return hours > 0 ? `${hours}시간 ${mins}분` : `${mins}분`;
}

/** 이번 주 월요일 (KST) 의 YYYY-MM-DD */
export function mondayOfWeekKst(d: Date = new Date()): string {
  const k = toKst(d);
  const day = k.getUTCDay(); // 0=일
  const diff = day === 0 ? -6 : 1 - day; // 월요일로 이동
  const monday = new Date(k.getTime());
  monday.setUTCDate(k.getUTCDate() + diff);
  return `${monday.getUTCFullYear()}-${pad(monday.getUTCMonth() + 1)}-${pad(monday.getUTCDate())}`;
}
