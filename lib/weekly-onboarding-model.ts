// 주간 온보딩 신청 — 순수 값·계산(DB 의존 없음, 클라이언트에서도 import 가능).
//   화면(use client)이 상태 라벨 같은 값을 쓰려면 pg 를 끌고 오는 모듈에서 가져오면 안 된다.
//   저장·조회는 lib/weekly-onboarding.ts 에 있다.

// 모집 수량(몇 개 브랜드)은 쓰지 않는다 — 세어서 막는 로직이 없어 숫자를 말하지 않는다.
export const WEEKLY_SOURCE = "weekly_onboarding";

export const WEEKLY_STATUSES = ["new", "contacted", "scheduled", "done", "dropped"] as const;
export type WeeklyStatus = (typeof WEEKLY_STATUSES)[number];
export const WEEKLY_STATUS_LABEL: Record<WeeklyStatus, string> = {
  new: "신규", contacted: "연락함", scheduled: "상담 예정", done: "상담 완료", dropped: "제외",
};

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const cleanText = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
export const normEmail = (v: unknown) => cleanText(v, 160).toLowerCase();
export const normPhone = (v: unknown) => String(v ?? "").replace(/\D/g, "").slice(0, 20);

/** 사이트 주소 — 사람이 "example.com" 처럼 적어도 받아들이되, 형식이 아니면 거절한다. */
export function normSite(v: unknown): { ok: boolean; value: string } {
  const raw = cleanText(v, 300);
  if (!raw) return { ok: true, value: "" };          // 선택 입력
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const u = new URL(withScheme);
    if (!u.hostname.includes(".")) return { ok: false, value: "" };
    return { ok: true, value: u.toString() };
  } catch {
    return { ok: false, value: "" };
  }
}

/** KST 기준 그 주 월요일(YYYY-MM-DD) — 주간 모집 단위. */
export function weekKey(now = new Date()): string {
  const k = new Date(now.getTime() + 9 * 3600_000);
  const dow = k.getUTCDay();                          // 0=일
  const back = dow === 0 ? 6 : dow - 1;
  const mon = new Date(k.getTime() - back * 86400_000);
  return mon.toISOString().slice(0, 10);
}

// ── 자가 기입 매출 구간 ─────────────────────────────────────
//   신청자가 직접 고른 값이다. 브랜드 원장의 매출과 다른 값이며 섞어 쓰지 않는다.
export const REVENUE_HELP = "최근 12개월 브랜드 전체 매출 기준 · 원화(KRW)";
export const REVENUE_LABEL_TEXT = "현재 브랜드 매출액을 기입해 주세요";

export const REVENUE_BANDS = [
  { key: "pre", label: "매출 발생 전" },
  { key: "lt1", label: "1억원 미만" },
  { key: "b1_5", label: "1억원 이상~5억원 미만" },
  { key: "b5_10", label: "5억원 이상~10억원 미만" },
  { key: "b10_30", label: "10억원 이상~30억원 미만" },
  { key: "b30_100", label: "30억원 이상~100억원 미만" },
  { key: "gte100", label: "100억원 이상" },
  { key: "unknown", label: "확인 필요" },
] as const;

export type RevenueBand = (typeof REVENUE_BANDS)[number]["key"];
export const REVENUE_KEYS = REVENUE_BANDS.map((b) => b.key) as readonly RevenueBand[];

export function isRevenueBand(v: unknown): v is RevenueBand {
  return (REVENUE_KEYS as readonly string[]).includes(String(v ?? ""));
}

/** 저장값 → 표시 문구. 미기입(기존 신청)은 null 이므로 그대로 "미기입"으로 적는다. */
export function revenueLabel(v: unknown): string {
  const hit = REVENUE_BANDS.find((b) => b.key === String(v ?? ""));
  return hit ? hit.label : "미기입";
}
