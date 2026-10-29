// 원장 한 건 → 시트 한 행. 순수 변환(DB·네트워크 없음).
//
//   지키는 것
//     · 빈값과 0 을 구분한다. 모르는 값은 빈칸이 아니라 "미확인" 으로 적는다
//       (빈칸이면 "0 원"인지 "안 물어봤다"인지 시트에서 구분되지 않는다).
//     · 전화번호는 문자열이다. 앞의 0 이 사라지면 다른 번호가 된다.
//     · 수식 주입을 막는다. RAW 로 쓰므로 Sheets 안에서는 수식이 되지 않지만,
//       이 시트를 CSV 로 내려받아 다른 프로그램에서 열면 거기서 수식이 된다.
//     · 매출은 "얼마"보다 "무엇을 근거로"가 먼저다. 고객이 신고한 구간과
//       AI 추정을 절대 같은 칸에 섞지 않는다.

import { revenueView, type RevenueEstimate } from "./brand-revenue-view";

/** 시트에 들어가는 한 칸. 숫자는 숫자로, 나머지는 문자열로 쓴다. */
export type Cell = string | number;

/** 값이 아직 확인되지 않았음을 뜻하는 표기. 빈칸(=아직 안 씀)과 구분된다. */
export const UNKNOWN = "미확인";

// ── 수식 주입 방지 ───────────────────────────────────────────
//   = + - @ 와 탭/캐리지리턴으로 시작하는 문자열은 스프레드시트·CSV 리더가
//   수식으로 해석한다. 앞에 작은따옴표를 붙여 글자로 고정한다.
const RISKY_HEAD = /^[=+\-@\t\r]/;
export function safeText(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  if (!s) return "";
  // 줄바꿈은 살리되 셀을 깨뜨리는 제어문자는 공백으로 바꾼다.
  const clean = s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, " ");
  return RISKY_HEAD.test(clean) ? `'${clean}` : clean;
}

/** 전화번호 — 반드시 문자열. 숫자로 쓰면 앞의 0 이 날아간다. */
export function phoneText(v: unknown): string {
  const digits = String(v ?? "").replace(/\D/g, "");
  return digits ? safeText(digits) : "";
}

// ── 날짜 ─────────────────────────────────────────────────────
//   기존 시트(960행)의 날짜 칸 서식을 이 환경에서 읽을 수 없어, 글자 형식을
//   그대로 유지한다. 시리얼 숫자로 바꾸면 서식이 다른 기존 행과 섞여
//   표시가 깨질 수 있다. 시트 날짜 서식을 확정한 뒤 아래 상수만 바꾸면 된다.
export const DATE_AS_SERIAL = false;

/** timestamptz → "YYYY-MM-DD HH:mm" (KST). 값이 없으면 빈 문자열. */
export function kstText(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const k = new Date(d.getTime() + 9 * 3600_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${k.getUTCFullYear()}-${p(k.getUTCMonth() + 1)}-${p(k.getUTCDate())} `
    + `${p(k.getUTCHours())}:${p(k.getUTCMinutes())}`;
}

/** Sheets 날짜 시리얼(1899-12-30 기준). DATE_AS_SERIAL 을 켤 때 쓴다. */
export function kstSerial(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const kst = d.getTime() + 9 * 3600_000;
  return (kst - Date.UTC(1899, 11, 30)) / 86_400_000;
}

export function dateCell(iso: string | null | undefined): Cell {
  if (!iso) return "";
  if (!DATE_AS_SERIAL) return kstText(iso);
  const s = kstSerial(iso);
  return s === null ? "" : s;
}

// ── 매출 ─────────────────────────────────────────────────────
//   세 가지를 절대 섞지 않는다:
//     ① 고객이 직접 신고한 매출 구간(신청서) — 사람이 적은 값
//     ② AI 추정(brands.revenue_estimate)     — 확정 실적이 아니다
//     ③ 우리 회사가 받은 돈(결제·구독)       — 브랜드 연매출과 무관하다. 여기 넣지 않는다.
export interface RevenueInput {
  /** 신청서에서 고객이 고른 구간 키(있으면 이게 우선). */
  reportedBand?: string | null;
  /** 그 구간의 사람이 읽는 이름. */
  reportedBandLabel?: string | null;
  /** 그 신고가 어디서 왔는지(weekly 신청서 등). */
  reportedSource?: string | null;
  /** 신고 시점(연도 판단용). */
  reportedAt?: string | null;
  /** brands.revenue_estimate 원본 jsonb. */
  estimateRaw?: unknown;
}

/** 시트 T~X 에 들어갈 다섯 칸. */
export interface RevenueCells {
  /** T 매출액·구간 */
  amount: Cell;
  /** U 매출기준·확인상태 */
  basis: string;
  /** V 매출출처 */
  source: string;
  /** W 매출기준연도 */
  year: Cell;
  /** X 매출통화 */
  currency: string;
}

function estimateRange(e: RevenueEstimate): string {
  const n = (v: number) => v.toLocaleString("en-US");
  return e.lower === e.upper ? n(e.lower) : `${n(e.lower)}~${n(e.upper)}`;
}

export function revenueCells(i: RevenueInput): RevenueCells {
  // ① 고객 신고 구간이 있으면 그것이 기준이다.
  const band = (i.reportedBandLabel ?? "").trim() || (i.reportedBand ?? "").trim();
  if (band) {
    const year = i.reportedAt ? new Date(i.reportedAt).getUTCFullYear() : null;
    return {
      amount: safeText(band),
      basis: "고객 신고 구간",
      source: safeText((i.reportedSource ?? "").trim() || "신청서"),
      // 신고 시점의 연도. 신청서가 "최근 12개월" 기준이라 신고 연도를 적는다.
      year: Number.isFinite(year) && year ? year : UNKNOWN,
      currency: "KRW",
    };
  }

  // ② AI 추정 — 확정 실적이 아님을 칸 안에서 분명히 한다.
  const view = revenueView(i.estimateRaw);
  if (view.estimate) {
    const e = view.estimate;
    return {
      amount: safeText(estimateRange(e)),
      basis: `AI 추정 · 미확정 (신뢰도 ${e.confidence})`,
      source: safeText(e.sources.map((s) => s.title).slice(0, 3).join(" / ") || "AI 추정"),
      year: e.year,
      currency: e.currency,
    };
  }

  // ③ 아무 근거도 없다 — 빈칸으로 두지 않고 상태를 적는다.
  return {
    amount: UNKNOWN,
    basis: view.label || UNKNOWN,   // "추정 전" · "추정 대기" · "확인 필요" 등
    source: UNKNOWN,
    year: UNKNOWN,
    currency: UNKNOWN,
  };
}

// ── 커뮤니케이션 ─────────────────────────────────────────────
export interface CommsInput {
  /** 가장 최근 발신(우리→고객). */
  lastOutAt?: string | null;
  lastOutSubject?: string | null;
  /** 가장 최근 수신(고객→우리). */
  lastInAt?: string | null;
  lastInSubject?: string | null;
  /** 수기 접촉 기록 시각. */
  lastManualAt?: string | null;
  /** 집계에 쓴 메일 건수(근거). */
  totalMessages?: number;
}

export interface CommsCells {
  /** E 커뮤확인 — 진행 상태 한 줄. */
  status: string;
  /** G 최근메일시각(KST) */
  lastMailAt: Cell;
  /** H 최근메일제목 */
  lastMailSubject: string;
  /** K 최근접촉표시 */
  lastTouch: string;
}

/**
 * 커뮤니케이션 상태.
 *   "고객이 답을 했다"는 수신 기록이 있을 때만 말한다. 자동 안내가 나갔다고
 *   회신으로 치지 않는다 — 그러면 응답 없는 고객이 응답한 것처럼 보인다.
 */
export function commsCells(c: CommsInput): CommsCells {
  const out = c.lastOutAt ?? null;
  const inc = c.lastInAt ?? null;
  const manual = c.lastManualAt ?? null;

  const times = [out, inc, manual].filter(Boolean) as string[];
  if (times.length === 0) {
    return { status: "기록 없음", lastMailAt: "", lastMailSubject: "", lastTouch: UNKNOWN };
  }

  const latest = times.reduce((a, b) => (new Date(a) > new Date(b) ? a : b));
  const latestIsIn = inc !== null && latest === inc;
  const latestIsManual = manual !== null && latest === manual;

  const status = latestIsIn
    ? "고객 회신 있음"
    : latestIsManual
      ? "담당자 직접 접촉"
      : inc
        ? "발신 후 대기(이전 회신 있음)"
        : "발신만 · 회신 없음";

  // 메일 칸은 메일 기록만 쓴다. 수기 접촉은 K열에 따로 적는다.
  const mailAt = out && inc ? (new Date(out) > new Date(inc) ? out : inc) : (out ?? inc);
  const mailSubject = mailAt === inc ? (c.lastInSubject ?? "") : (c.lastOutSubject ?? "");

  const n = c.totalMessages ?? 0;
  const touch = `${kstText(latest)} · ${latestIsManual ? "수기" : latestIsIn ? "수신" : "발신"}`
    + (n > 0 ? ` (메일 ${n}건)` : "");

  return {
    status,
    lastMailAt: dateCell(mailAt),
    lastMailSubject: safeText(mailSubject),
    lastTouch: safeText(touch),
  };
}

// ── 한 행 ────────────────────────────────────────────────────
/** 시트 열 이름 → 값. 관리하지 않는 열(I 메모 등)은 여기 담지 않는다. */
export type RowValues = Record<string, Cell>;

export interface LedgerBrand {
  id: string;
  brand_name: string | null;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  category: string | null;
  brand_url: string | null;
  state: string | null;
  source: string | null;
  plan: string | null;
  pay_status: string | null;
  owner_label: string | null;
  created_at: string | null;
  updated_at: string | null;
  msg_opt_out?: boolean | null;
  archived?: boolean | null;
  hold_kind?: string | null;
  revenue_estimate?: unknown;
  reported_band?: string | null;
  reported_band_label?: string | null;
  reported_source?: string | null;
  reported_at?: string | null;
  comms: CommsInput;
}

/** 원장 링크(어드민 내부) — 외부 브랜드 링크와 절대 같은 칸에 넣지 않는다. */
export function ledgerLink(adminUrl: string, brandId: string): string {
  const base = (adminUrl || "").replace(/\/+$/, "");
  return base ? `${base}/brand/${brandId}` : `/brand/${brandId}`;
}

/** 발송 가능 여부와 무관하게 원장 전체를 싣되, 상태는 표시한다. */
export function ledgerFlags(b: LedgerBrand): string {
  const f: string[] = [];
  if (b.msg_opt_out) f.push("수신거부");
  if (b.archived) f.push("보관");
  if ((b.hold_kind ?? "").trim()) f.push(`보류(${b.hold_kind})`);
  return f.join(" · ");
}

export interface BuildRowOpts {
  adminUrl: string;
  collectedAt: string;
  stateLabel: (s: string | null) => string;
  sourceLabel: (s: string | null) => string;
  planLabel: (p: string | null, pay: string | null) => string;
}

/** 한 브랜드 → 열 이름별 값. 헤더 이름으로 쓰므로 열 위치가 바뀌어도 안전하다. */
export function buildRow(b: LedgerBrand, o: BuildRowOpts): RowValues {
  const rev = revenueCells({
    reportedBand: b.reported_band,
    reportedBandLabel: b.reported_band_label,
    reportedSource: b.reported_source,
    reportedAt: b.reported_at,
    estimateRaw: b.revenue_estimate,
  });
  const comms = commsCells(b.comms);
  const flags = ledgerFlags(b);

  return {
    "유입일시(KST)": dateCell(b.created_at),
    "업체명": safeText(b.brand_name) || UNKNOWN,
    "유입출처": safeText(o.sourceLabel(b.source)),
    "진행단계": safeText(o.stateLabel(b.state)),
    "커뮤확인": safeText(comms.status),
    "담당자": safeText(b.owner_label) || UNKNOWN,
    "최근메일시각(KST)": comms.lastMailAt,
    "최근메일제목": comms.lastMailSubject,
    // "메모(직접입력)" 은 사람이 쓰는 칸이다 — 여기서 만들지 않는다.
    "최근업데이트(KST)": dateCell(b.updated_at),
    "최근접촉표시": comms.lastTouch,
    "플랜/결제": safeText(o.planLabel(b.plan, b.pay_status)) || UNKNOWN,
    "원장링크": safeText(ledgerLink(o.adminUrl, b.id)),
    "브랜드ID": safeText(b.id),
    "수집시각(KST)": dateCell(o.collectedAt),

    // 이번에 추가하는 열
    "카테고리": safeText(b.category) || UNKNOWN,
    "전화번호": phoneText(b.phone) || UNKNOWN,
    "이메일": safeText(b.email) || UNKNOWN,
    "브랜드링크": safeText(b.brand_url) || UNKNOWN,
    "매출액·구간": rev.amount,
    "매출기준·확인상태": safeText(rev.basis),
    "매출출처": safeText(rev.source),
    "매출기준연도": rev.year,
    "매출통화": safeText(rev.currency),
    "상태표시": safeText(flags),
  };
}

/** 사람이 직접 쓰는 칸 — 어떤 경우에도 덮어쓰지 않는다. */
export const PROTECTED_HEADERS = new Set(["메모(직접입력)"]);

/** 이 동기화가 관리하는 열. 여기 없는 열은 건드리지 않는다. */
export const MANAGED_HEADERS = [
  "유입일시(KST)", "업체명", "유입출처", "진행단계", "커뮤확인", "담당자",
  "최근메일시각(KST)", "최근메일제목", "최근업데이트(KST)", "최근접촉표시",
  "플랜/결제", "원장링크", "브랜드ID", "수집시각(KST)",
  "카테고리", "전화번호", "이메일", "브랜드링크",
  "매출액·구간", "매출기준·확인상태", "매출출처", "매출기준연도", "매출통화", "상태표시",
] as const;

/** 브랜드 ID 가 들어가는 열 이름 — 이 값으로 기존 행을 찾아 갱신한다. */
export const ID_HEADER = "브랜드ID";
