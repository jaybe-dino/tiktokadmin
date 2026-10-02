// 세미나 모집 허브 — 순수 로직(DB 접근 없음).
//   공개 폼·관리자 화면("use client")이 pg 를 끌고 오지 않도록 값과 계산을 여기에 모은다.
//
//   일부러 하지 않는 것
//     · 자동 마감·자동 확정 판정을 하지 않는다. 상태는 관리자가 바꾼다.
//       정원 검사는 "더 받지 않는다"까지만 하고 행사 상태를 바꾸지 않는다.
//     · 보관기간을 새로 정하지 않는다 — 기존 안내 문장 형태를 그대로 쓴다.

// ── 행사 상태 ────────────────────────────────────────────────
export const EVENT_STATUSES = ["draft", "upcoming", "open", "closed", "done", "cancelled"] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];
export const EVENT_STATUS_LABEL: Record<EventStatus, string> = {
  draft: "초안", upcoming: "예정", open: "모집중", closed: "마감", done: "종료", cancelled: "취소",
};
/** 칩 색. 공개 화면과 관리자 화면이 같은 색을 쓰도록 한곳에 둔다. */
export const EVENT_STATUS_TONE: Record<EventStatus, "gray" | "blue" | "green" | "orange" | "red"> = {
  draft: "gray", upcoming: "blue", open: "green", closed: "orange", done: "gray", cancelled: "red",
};
/** 종료·취소도 지우지 않고 목록 아래쪽 "지난 행사"로 남긴다. */
export const PAST_STATUSES: readonly EventStatus[] = ["done", "cancelled"];
export function isEventStatus(v: unknown): v is EventStatus {
  return typeof v === "string" && (EVENT_STATUSES as readonly string[]).includes(v);
}

export const EVENT_MODES = ["online", "offline", "hybrid"] as const;
export type EventMode = (typeof EVENT_MODES)[number];
export const MODE_LABEL: Record<EventMode, string> = {
  online: "온라인", offline: "오프라인", hybrid: "온·오프라인",
};
export function isEventMode(v: unknown): v is EventMode {
  return typeof v === "string" && (EVENT_MODES as readonly string[]).includes(v);
}

// ── 신청자 상태 ──────────────────────────────────────────────
//   신청 접수(applied)와 참석 확정(confirmed)은 다른 값이다 — 접수만으로 확정되지 않는다.
export const REG_STATUSES = ["applied", "waitlist", "confirmed", "attended", "noshow", "cancelled"] as const;
export type RegStatus = (typeof REG_STATUSES)[number];
export const REG_STATUS_LABEL: Record<RegStatus, string> = {
  applied: "신청 접수", waitlist: "대기", confirmed: "참석 확정",
  attended: "참석", noshow: "불참", cancelled: "취소",
};
/** 정원에 드는 상태 — 취소·불참·대기는 세지 않는다. */
export const REG_OCCUPYING: readonly RegStatus[] = ["applied", "confirmed", "attended"];
export function isRegStatus(v: unknown): v is RegStatus {
  return typeof v === "string" && (REG_STATUSES as readonly string[]).includes(v);
}

// ── 입력 정리 ────────────────────────────────────────────────
export const EMAIL_RE = /^[^\s@]+@[^\s@.]+\.[^\s@]{2,}$/;

export function cleanText(v: unknown, max = 200): string {
  return String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}
export function normEmail(v: unknown): string {
  return cleanText(v, 160).toLowerCase().replace(/\s/g, "");
}
/** 숫자만 남긴다 — 010-1234-5678 과 01012345678 을 같은 사람으로 본다. */
export function normPhone(v: unknown): string {
  return String(v ?? "").replace(/\D/g, "").slice(0, 20);
}
/** 사이트 주소는 선택 항목이다. 비우면 통과, 적었으면 호스트 형태인지만 본다. */
export function normSite(v: unknown): { ok: boolean; value: string } {
  const raw = cleanText(v, 300).replace(/\s/g, "");
  if (!raw) return { ok: true, value: "" };
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const u = new URL(withScheme);
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(u.hostname)) return { ok: false, value: "" };
    return { ok: true, value: u.toString() };
  } catch {
    return { ok: false, value: "" };
  }
}
/** 같은 행사 안에서 같은 사람인지 판단하는 값. 행사가 다르면 같은 사람도 따로 신청된다. */
export function regDedupeKey(email: unknown, phone: unknown): string {
  return `${normEmail(email)}|${normPhone(phone)}`;
}

// ── 고정 URL ─────────────────────────────────────────────────
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;
/** /events/<slug>/apply 등 하위 경로와 겹치면 안 되는 값. */
export const RESERVED_SLUGS: readonly string[] = ["apply", "api", "new", "roster", "events"];
export function normSlug(v: unknown): string {
  return cleanText(v, 64).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
}
export function isSlug(v: unknown): boolean {
  return typeof v === "string" && SLUG_RE.test(v) && !RESERVED_SLUGS.includes(v);
}
export function eventPath(slug: string): string { return `/events/${slug}`; }
/** 행사별 고정 신청 URL — 한 번 안내한 뒤에는 바뀌지 않는다. */
export function applyPath(slug: string): string { return `/events/${slug}/apply`; }
export function rosterPath(token: string): string { return `/roster/${token}`; }
export function posterSrc(fileId: string): string { return `/api/events/poster/${fileId}`; }

// ── 포스터 이미지 검증 ───────────────────────────────────────
export const POSTER_MAX_BYTES = 8 * 1024 * 1024;
export const POSTER_MIMES: readonly string[] = ["image/png", "image/jpeg", "image/webp"];
export const POSTER_EXT_RE = /\.(png|jpe?g|webp)$/i;

/** 파일 앞부분(매직바이트)으로 실제 이미지 형식을 본다. 브라우저가 알려준 MIME 은 믿지 않는다. */
export function sniffImageMime(head: Uint8Array): string | null {
  const b = head;
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  return null;
}
/** 통과하면 null, 막아야 하면 사람이 읽는 이유를 돌려준다. */
export function posterError(filename: string, size: number, head: Uint8Array): string | null {
  if (size <= 0) return "빈 파일입니다.";
  if (size > POSTER_MAX_BYTES) {
    return `포스터는 ${Math.round(POSTER_MAX_BYTES / (1024 * 1024))}MB 이하만 올릴 수 있습니다.`;
  }
  if (!POSTER_EXT_RE.test(filename || "")) return "PNG · JPG · WEBP 이미지만 올릴 수 있습니다.";
  const sniffed = sniffImageMime(head);
  if (!sniffed) return "이미지 파일이 아닙니다 — 파일 내용을 확인해주세요.";
  return null;
}

// ── 일시 표시(KST) ───────────────────────────────────────────
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DOW = ["일", "월", "화", "수", "목", "금", "토"];

/** "2026-10-06 13:00:00+09" 와 ISO 문자열을 모두 받는다. 못 읽으면 null. */
export function parseTs(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  let s = String(v).trim();
  if (!s) return null;
  s = s.replace(" ", "T");
  // "+09" 처럼 분이 없는 오프셋은 Date 가 못 읽는 환경이 있다 — 분을 채운다.
  s = s.replace(/([+-]\d{2})$/, "$1:00");
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

interface KstParts { y: number; m: number; d: number; hh: number; mm: number; dow: string }
export function kstParts(v: unknown): KstParts | null {
  const d = parseTs(v);
  if (!d) return null;
  const t = new Date(d.getTime() + KST_OFFSET_MS);
  return {
    y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(),
    hh: t.getUTCHours(), mm: t.getUTCMinutes(), dow: DOW[t.getUTCDay()],
  };
}
const p2 = (n: number) => String(n).padStart(2, "0");
export function fmtKstDate(v: unknown): string {
  const k = kstParts(v);
  return k ? `${k.y}년 ${k.m}월 ${k.d}일(${k.dow})` : "";
}
export function fmtKstTime(v: unknown): string {
  const k = kstParts(v);
  return k ? `${p2(k.hh)}:${p2(k.mm)}` : "";
}
export function fmtKstDateTime(v: unknown): string {
  const k = kstParts(v);
  return k ? `${k.y}-${p2(k.m)}-${p2(k.d)} ${p2(k.hh)}:${p2(k.mm)}` : "";
}

export interface WhenInput {
  starts_at?: string | null; ends_at?: string | null;
  time_tbd?: boolean; recurring_note?: string | null;
}
/**
 * 공개 화면에 쓰는 일시 한 줄. 확정되지 않은 것을 확정된 것처럼 적지 않는다.
 *   · 시간 미정이면 날짜만 쓰고 "시간 미정"을 붙인다.
 *   · 날짜조차 없으면 반복 안내문이나 "일정 미정"을 쓴다.
 */
export function fmtWhen(e: WhenInput): string {
  const rec = cleanText(e.recurring_note, 120);
  const s = kstParts(e.starts_at);
  if (!s) return rec || "일정 미정";
  const date = `${s.y}년 ${s.m}월 ${s.d}일(${s.dow})`;
  if (e.time_tbd) return rec ? `${rec} · ${date} · 시간 미정` : `${date} · 시간 미정`;
  let t = `${p2(s.hh)}:${p2(s.mm)}`;
  const en = kstParts(e.ends_at);
  if (en && (en.y !== s.y || en.m !== s.m || en.d !== s.d)) {
    t += ` ~ ${en.y}년 ${en.m}월 ${en.d}일(${en.dow}) ${p2(en.hh)}:${p2(en.mm)}`;
  } else if (en) {
    t += `~${p2(en.hh)}:${p2(en.mm)}`;
  }
  return rec ? `${rec} · 다음 회차 ${date} ${t}` : `${date} ${t} (KST)`;
}

/** 장소 한 줄. 확정 전이면 사정(venue_note)을 그대로 보여준다. */
export function fmtWhere(e: { mode?: string | null; venue?: string | null; address?: string | null; venue_note?: string | null }): string {
  const mode = isEventMode(e.mode) ? MODE_LABEL[e.mode] : "";
  const parts = [cleanText(e.venue, 120), cleanText(e.address, 160)].filter(Boolean);
  const note = cleanText(e.venue_note, 160);
  const place = parts.join(" · ") || note || (e.mode === "online" ? "온라인" : "장소 미정");
  return mode ? `${mode} · ${place}` : place;
}

// ── 신청 가능 여부(서버 검증) ────────────────────────────────
export interface ApplyGate {
  status: string; publish: boolean; apply_open: boolean;
  capacity: number | null; taken: number;
}
/**
 * 신청을 막아야 하는 이유 목록. 비어 있으면 받아도 된다.
 *   정원이 찼다고 행사 상태를 바꾸지는 않는다 — 더 받지 않는 것까지만 한다.
 */
export function applyBlockers(g: ApplyGate): string[] {
  const out: string[] = [];
  if (!g.publish || g.status === "draft") out.push("아직 공개되지 않은 일정입니다.");
  if (g.status === "closed") out.push("모집이 마감되었습니다.");
  if (g.status === "done") out.push("종료된 행사입니다.");
  if (g.status === "cancelled") out.push("취소된 행사입니다.");
  if (!g.apply_open && !out.length) out.push("현재 신청을 받지 않습니다.");
  if (g.capacity != null && g.taken >= g.capacity && !out.length) out.push("정원이 모두 찼습니다.");
  return out;
}
/** 남은 자리. 정원 미설정이면 null — 화면에 잔여석을 꾸며 쓰지 않기 위해 구분한다. */
export function seatsLeft(capacity: number | null, taken: number): number | null {
  if (capacity == null) return null;
  return Math.max(0, capacity - taken);
}

// ── 외부 공유: 노출 항목 ─────────────────────────────────────
export interface ShareField { key: string; label: string; masked?: boolean }
/**
 * 외부 열람 페이지에 내보낼 수 있는 항목의 전체 목록.
 *   연락처·이메일은 마스킹된 형태만 있다 — 원문을 내보내는 선택지는 두지 않는다.
 *   내부 메모(admin_note)·담당자는 목록에 없다(어떤 설정으로도 나가지 않는다).
 */
export const SHARE_FIELDS: readonly ShareField[] = [
  { key: "company", label: "회사명" },
  { key: "brand", label: "브랜드명" },
  { key: "status", label: "신청·참석 상태" },
  { key: "contact_name", label: "담당자명" },
  { key: "contact_title", label: "직함" },
  { key: "phone_masked", label: "연락처(마스킹)", masked: true },
  { key: "email_masked", label: "이메일(마스킹)", masked: true },
  { key: "site", label: "회사 사이트" },
  { key: "countries", label: "관심 국가" },
  { key: "applied_at", label: "신청 일시" },
];
export const SHARE_FIELD_KEYS: readonly string[] = SHARE_FIELDS.map((f) => f.key);
/** 기본 노출: 회사 · 브랜드 · 신청/참석 상태. 연락처는 기본으로 넣지 않는다. */
export const DEFAULT_SHARE_FIELDS: readonly string[] = ["company", "brand", "status"];
/** 어떤 설정으로도 외부로 나가지 않는 것 — 고를 수 있는 목록에 아예 없다. */
export const SHARE_NEVER_FIELDS: readonly string[] = [
  "admin_note", "owner_admin_id", "phone", "email", "note", "id", "is_test",
];
/** 화면에서 온 값을 그대로 쓰지 않고 허용 목록으로 걸러낸다. 비면 기본값으로 돌린다. */
export function sanitizeShareFields(v: unknown): string[] {
  const want = new Set((Array.isArray(v) ? v : []).map((x) => String(x)));
  const out = SHARE_FIELD_KEYS.filter((k) => want.has(k));
  return out.length ? out : [...DEFAULT_SHARE_FIELDS];
}

/** 010-1234-5678 → 010-****-5678. 가운데를 지운다(복원 불가). */
export function maskPhone(v: unknown): string {
  const d = normPhone(v);
  if (!d) return "";
  if (d.length <= 4) return "*".repeat(d.length);
  const head = d.slice(0, Math.min(3, d.length - 4));
  const tail = d.slice(-4);
  return `${head}-${"*".repeat(Math.max(2, d.length - head.length - 4))}-${tail}`;
}
/** jay@dino.kr → j***@dino.kr. 아이디를 지우고 도메인만 남긴다. */
export function maskEmail(v: unknown): string {
  const e = normEmail(v);
  const at = e.indexOf("@");
  if (at <= 0) return e ? "***" : "";
  const id = e.slice(0, at);
  const dom = e.slice(at + 1);
  return `${id.slice(0, 1)}${"*".repeat(Math.max(3, id.length - 1))}@${dom}`;
}

// ── 외부 인증: 시도 횟수 제한 ────────────────────────────────
/** 한 공유 링크에서 이 창(분) 안에 이만큼 틀리면 잠시 막는다. */
export const SHARE_ATTEMPT_WINDOW_MIN = 10;
export const SHARE_ATTEMPT_MAX = 7;
export const SHARE_SESSION_HOURS = 8;
export const SHARE_TOKEN_BYTES = 24;
export const SHARE_PW_MIN = 8;
export function sharePwError(pw: string): string | null {
  const v = String(pw ?? "");
  if (v.length < SHARE_PW_MIN) return `비밀번호는 ${SHARE_PW_MIN}자 이상이어야 합니다.`;
  if (/^\s|\s$/.test(v)) return "비밀번호 앞뒤의 공백을 지워주세요.";
  if (/^[0-9]+$/.test(v)) return "숫자만으로는 설정할 수 없습니다.";
  return null;
}
/** 공유를 켜도 되는지 — 비밀번호가 없으면 켜지 않는다. */
export function shareEnableBlockers(s: { password_hash?: string | null; fields?: string[] | null; revoked_at?: string | null }): string[] {
  const out: string[] = [];
  if (!s.password_hash) out.push("비밀번호가 설정되지 않았습니다.");
  if (s.revoked_at) out.push("이미 철회된 링크입니다 — 새로 발급하세요.");
  if (!(s.fields ?? []).length) out.push("외부에 보여줄 항목을 하나 이상 고르세요.");
  return out;
}
/** 지금 외부 열람이 가능한 상태인지. 이유는 외부 화면에 그대로 노출하지 않는다. */
export function shareLive(s: { enabled: boolean; password_hash?: string | null; revoked_at?: string | null; expires_at?: string | null }, now = new Date()): boolean {
  if (!s.enabled || !s.password_hash || s.revoked_at) return false;
  const exp = parseTs(s.expires_at);
  if (exp && exp.getTime() <= now.getTime()) return false;
  return true;
}

// ── CSV ──────────────────────────────────────────────────────
export function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
/** 엑셀에서 한글이 깨지지 않게 BOM 을 앞에 붙인다. */
export function csvDoc(header: string[], rows: unknown[][]): string {
  return "﻿" + [header.map(csvCell).join(","), ...rows.map((r) => r.map(csvCell).join(","))].join("\r\n");
}

// ── 안내 문구 ────────────────────────────────────────────────
//   기존 신청 폼과 같은 형태를 쓴다 — 새 보관기간을 만들지 않는다.
export const PRIVACY_NOTICE =
  "제출하신 정보는 신청하신 세미나 안내 목적으로만 사용되며, 안내 종료 후 관련 법령에 따라 처리됩니다.";
export const PRIVACY_CONSENT_LABEL = "위 안내에 따른 개인정보 수집·이용에 동의합니다. (필수)";
export const MARKETING_CONSENT_LABEL =
  "이후 세미나·프로그램 소식을 받아보는 데 동의합니다. (선택 — 동의하지 않아도 신청할 수 있습니다)";
/** 동의 시점의 안내문을 식별하는 값. 문구를 고치면 이 값도 함께 올린다. */
export const CONSENT_VERSION = "sev-2026-10";
export const APPLY_DONE_NOTICE = "신청이 접수되었습니다. 담당자 확인 후 안내드립니다.";
/** 접수 ≠ 확정. 공개 화면에서 이 구분을 흐리지 않는다. */
export const APPLY_NOT_CONFIRMED_NOTICE = "접수는 참석 확정이 아닙니다 — 확정 여부는 담당자가 별도로 안내합니다.";

// ── 관리자 입력(datetime-local) ↔ 저장값 ─────────────────────
//   화면의 datetime-local 값("2026-10-06T13:00")은 KST 로 적은 것으로 본다.
//   서버 타임존에 따라 뜻이 달라지지 않게 +09:00 을 명시해 변환한다.
export function kstLocalToIso(v: unknown): string | null {
  const s = cleanText(v, 32).replace(" ", "T");
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(s);
  if (!m) return null;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00+09:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
/** 저장값 → datetime-local 입력값(KST). 없으면 빈 문자열. */
export function isoToKstLocal(v: unknown): string {
  const k = kstParts(v);
  return k ? `${k.y}-${p2(k.m)}-${p2(k.d)}T${p2(k.hh)}:${p2(k.mm)}` : "";
}
