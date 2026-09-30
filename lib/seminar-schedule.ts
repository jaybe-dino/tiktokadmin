// 주간 세미나 안내 — 회차·모집 구간·문구 치환의 순수 계산(DB·네트워크 의존 없음).
//   시간은 모두 KST(UTC+9, 서머타임 없음) 벽시계로 정하고 UTC 인스턴트로 돌려준다.
//
//   모집 구간(주간 경계)은 아직 확정 전이라 두 방식을 모두 구현해 설정으로 고른다.
//     A session_to_session : 지난 회차 시작 직전 ~ 이번 회차 시작 직전
//     B calendar_week      : 지난 주 월 00:00 ~ 일 23:59:59.999 (KST)
//   두 방식 모두 회차끼리 구간이 맞닿아 있어 빠지는 신청도, 두 회차에 겹치는 신청도 없다.

export const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export type WeekMode = "session_to_session" | "calendar_week";
export type LatePolicy = "send_now" | "next_week" | "skip";
export type DedupeScope = "contact" | "brand";
export type SeminarStage = "notice" | "followup";
export type SeminarChannel = "email" | "sms";

export interface SeminarScheduleConfig {
  weekMode: WeekMode;
  sessionWeekday: number;   // 0=일 … 1=월
  sessionHour: number; sessionMinute: number;
  followupHour: number; followupMinute: number;
  noticeLeadDays: number; noticeHour: number; noticeMinute: number;
  cutoffMinutes: number;
}

export interface SeminarSession {
  /** KST 기준 회차 날짜 YYYY-MM-DD */
  sessionDate: string;
  startsAt: Date;
  followupAt: Date;
  noticeDueAt: Date;
  windowFrom: Date;
  windowTo: Date;
}

// ── KST 벽시계 ↔ UTC ────────────────────────────────────────
/** KST 벽시계 값을 읽기 위한 Date(그 뒤 getUTC* 로 읽는다). */
function kst(d: Date): Date {
  return new Date(d.getTime() + KST_OFFSET_MS);
}
/** KST 벽시계(연·월·일·시·분) → UTC 인스턴트. */
export function fromKst(y: number, month1: number, day: number, hour = 0, minute = 0): Date {
  return new Date(Date.UTC(y, month1 - 1, day, hour, minute, 0, 0) - KST_OFFSET_MS);
}
const pad = (n: number) => String(n).padStart(2, "0");
/** UTC 인스턴트 → KST 기준 YYYY-MM-DD */
export function kstDay(d: Date): string {
  const k = kst(d);
  return `${k.getUTCFullYear()}-${pad(k.getUTCMonth() + 1)}-${pad(k.getUTCDate())}`;
}
/** "YYYY-MM-DD" + KST 시:분 → UTC 인스턴트 */
export function atKst(day: string, hour: number, minute: number): Date {
  const [y, m, d] = day.split("-").map(Number);
  return fromKst(y, m, d, hour, minute);
}
/** KST 기준으로 날짜를 n일 옮긴 YYYY-MM-DD */
export function shiftDay(day: string, days: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d) + days * 86400_000);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/**
 * now 이후(같은 시각 포함) 처음 오는 회차 시작 시각의 KST 날짜.
 *   월요일 10:30 설정에서 월요일 10:29 에 물으면 그날, 10:31 에 물으면 다음 주 월요일.
 */
export function nextSessionDate(now: Date, cfg: SeminarScheduleConfig): string {
  const k = kst(now);
  const delta = (cfg.sessionWeekday - k.getUTCDay() + 7) % 7;
  let day = shiftDay(kstDay(now), delta);
  if (atKst(day, cfg.sessionHour, cfg.sessionMinute).getTime() < now.getTime()) {
    day = shiftDay(day, 7);
  }
  return day;
}

/** 회차 날짜(KST) → 시각·모집 구간 전체. */
export function buildSession(sessionDate: string, cfg: SeminarScheduleConfig): SeminarSession {
  const startsAt = atKst(sessionDate, cfg.sessionHour, cfg.sessionMinute);
  const followupAt = atKst(sessionDate, cfg.followupHour, cfg.followupMinute);
  const noticeDueAt = atKst(shiftDay(sessionDate, -cfg.noticeLeadDays), cfg.noticeHour, cfg.noticeMinute);

  let windowFrom: Date;
  let windowTo: Date;
  if (cfg.weekMode === "calendar_week") {
    // 지난 주 같은 요일 00:00 ~ 이번 회차 날짜 00:00 직전(= 월 00:00 ~ 일 23:59:59.999)
    windowTo = atKst(sessionDate, 0, 0);
    windowFrom = atKst(shiftDay(sessionDate, -7), 0, 0);
  } else {
    // 지난 회차 시작 직전 ~ 이번 회차 시작 직전. cutoff 만큼 앞당겨 접수를 닫는다.
    const cut = cfg.cutoffMinutes * 60_000;
    windowTo = new Date(startsAt.getTime() - cut);
    windowFrom = new Date(windowTo.getTime() - 7 * 86400_000);
  }
  return { sessionDate, startsAt, followupAt, noticeDueAt, windowFrom, windowTo };
}

/** 신청 시각이 이 회차의 모집 구간 안인가(끝은 열린 구간). */
export function inWindow(appliedAt: Date, s: SeminarSession): boolean {
  const t = appliedAt.getTime();
  return t >= s.windowFrom.getTime() && t < s.windowTo.getTime();
}

/** 안내 예정 시각을 지나 들어온 신청인가(늦은 신청). */
export function isLate(appliedAt: Date, s: SeminarSession): boolean {
  return appliedAt.getTime() > s.noticeDueAt.getTime();
}

/**
 * 늦은 신청을 어떻게 다룰지. 정책과 회차 시작까지 남은 시간으로 정한다.
 *   send_now 라도 회차가 이미 시작했으면 보내지 않는다(지난 안내를 보내지 않기).
 */
export function latePlan(policy: LatePolicy, now: Date, s: SeminarSession):
  { action: "send_now" | "defer" | "skip"; reason: string } {
  if (policy === "skip") return { action: "skip", reason: "늦은 신청 — 정책상 자동 안내 제외(수동 처리)" };
  if (policy === "next_week") return { action: "defer", reason: "늦은 신청 — 다음 회차로 이월" };
  if (now.getTime() >= s.startsAt.getTime()) {
    return { action: "defer", reason: "회차 시작 이후 확인된 신청 — 다음 회차로 이월" };
  }
  return { action: "send_now", reason: "늦은 신청 — 확인 즉시 1회 안내" };
}

// ── 연락처 정규화(중복 판정) ────────────────────────────────
export function normEmail(v: string | null | undefined): string {
  return (v ?? "").trim().toLowerCase();
}
/** 숫자만 남기고 국제표기(+82·82·0082)를 국내 0 접두로 맞춘다. */
export function normPhone(v: string | null | undefined): string {
  let d = (v ?? "").replace(/\D/g, "");
  if (!d) return "";
  if (d.startsWith("0082")) d = d.slice(4);
  else if (d.startsWith("82") && !d.startsWith("820")) d = d.slice(2);
  else return d;
  return d.startsWith("0") ? d : "0" + d;
}

/**
 * 같은 회차 안에서 수신자를 묶는 키.
 *   contact : 연락처 단위 — 같은 팀이라도 참석자가 다르면 각자 받는다.
 *   brand   : 팀 단위 — 한 팀에 1건만 나간다.
 * 연락처 기준일 때 이메일과 전화가 각각 있으면 둘 다 키가 되어, 어느 쪽이 겹쳐도 중복으로 본다.
 */
export function dedupeKeys(scope: DedupeScope, t: { brandId: string; email: string; phone: string }): string[] {
  if (scope === "brand") return [`b:${t.brandId}`];
  const keys: string[] = [];
  const e = normEmail(t.email);
  const p = normPhone(t.phone);
  if (e) keys.push(`e:${e}`);
  if (p) keys.push(`p:${p}`);
  return keys;
}

// ── 문구 ────────────────────────────────────────────────────
const WEEKDAY_KO = ["일", "월", "화", "수", "목", "금", "토"];

/** "2026년 10월 5일(월) 오전 10:30" — KST 표기. */
export function sessionLabel(at: Date): string {
  const k = kst(at);
  const h = k.getUTCHours();
  const ampm = h < 12 ? "오전" : "오후";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${k.getUTCFullYear()}년 ${k.getUTCMonth() + 1}월 ${k.getUTCDate()}일(${WEEKDAY_KO[k.getUTCDay()]}) ${ampm} ${h12}:${pad(k.getUTCMinutes())}`;
}

export interface TemplateVars {
  브랜드명: string; 담당자명: string; 일시: string; 줌링크: string; 세미나명: string;
}
/** {{키}} 치환. 값이 없는 키는 빈 문자열로 지운다(치환 안 된 {{…}} 를 남기지 않는다). */
export function renderTemplate(body: string, vars: TemplateVars): string {
  return (body ?? "").replace(/\{\{\s*([^}\s]+)\s*\}\}/g, (_, k: string) =>
    String((vars as unknown as Record<string, string>)[k] ?? ""));
}

export interface BlockerInput {
  enabled: boolean;
  zoomUrl: string;
  masterChannel: boolean;       // seminar_config 의 해당 채널 토글
  template: { enabled: boolean; body: string; subject?: string; channelOn: boolean };
  stage: SeminarStage;
  channel: SeminarChannel;
}

/**
 * 발송을 막는 이유 전부. 하나라도 있으면 보내지 않는다.
 *   Zoom 링크가 없으면 어떤 경우에도 보내지 않는다 — 없는 링크를 지어내지 않기 위해서다.
 */
export function sendBlockers(i: BlockerInput): string[] {
  const out: string[] = [];
  if (!i.enabled) out.push("자동발송 마스터 스위치가 꺼져 있습니다");
  if (!isHttpUrl(i.zoomUrl)) out.push("고정 Zoom 링크가 설정되지 않았습니다");
  if (!i.template.enabled) out.push(`${i.stage === "notice" ? "안내" : "후속"} 문구가 아직 초안(비활성)입니다`);
  if (!i.masterChannel || !i.template.channelOn) out.push(`${i.channel === "email" ? "메일" : "문자"} 채널이 꺼져 있습니다`);
  if (!(i.template.body ?? "").trim()) out.push("문구 본문이 비어 있습니다");
  if (i.channel === "email" && !(i.template.subject ?? "").trim()) out.push("메일 제목이 비어 있습니다");
  return out;
}

export function isHttpUrl(v: string | null | undefined): boolean {
  const s = (v ?? "").trim();
  if (!/^https?:\/\//i.test(s)) return false;
  try { new URL(s); return true; } catch { return false; }
}
