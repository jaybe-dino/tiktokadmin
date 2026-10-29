// 원장 한 건 → 시트 한 행. 순수 변환(DB·네트워크 없음).
//
//   지키는 것
//     · 빈값과 0 을 구분한다. 모르는 값은 빈칸이 아니라 "미기록" 으로 적는다
//       (빈칸이면 "0 원"인지 "안 물어봤다"인지 시트에서 구분되지 않는다).
//     · 사람이 이미 적어 둔 값을 "미기록"으로 덮어쓰지 않는다 (keepExisting).
//     · 전화번호는 원문 그대로다. 숫자만 남기면 +82 와 내선이 사라져 다른 번호가 된다.
//     · 날짜는 숫자(시리얼)로 쓴다. 시트의 날짜 칸이 이미 시리얼이라 글자를 넣으면
//       한 열에 두 종류가 섞인다.
//     · 매출은 "얼마"보다 "무엇을 근거로"가 먼저다. 고객이 신고한 구간과
//       AI 추정을 절대 같은 칸에 섞지 않는다.
//     · 수신 기록을 "고객이 답했다"로 단정하지 않는다.
//     · 열은 이름으로 찾는다. 사람이 쓴 헤더는 띄어쓰기가 흔들리므로 정규화한다.

import { revenueView, type RevenueEstimate } from "./brand-revenue-view";

/** 시트에 들어가는 한 칸. 숫자는 숫자로, 나머지는 문자열로 쓴다. */
export type Cell = string | number;

/**
 * 값이 아직 확인되지 않았음을 뜻하는 표기. 빈칸(=아직 안 씀)과 구분된다.
 *   운영 시트가 이미 이 표기를 쓰고 있어 같은 말로 맞춘다 — 같은 뜻을 두 가지
 *   말로 적으면 시트에서 세기(count)가 갈린다.
 */
export const UNKNOWN = "미기록";

/** 시트에서 "아직 값이 없다"는 뜻으로 쓰이는 표기들. 셈과 보호 판정에 쓴다. */
export const UNKNOWN_MARKERS: ReadonlySet<string> = new Set([UNKNOWN, "미확인"]);

/** 빈칸이거나 미기록 표기인가. 0 과 "0" 은 값이므로 false 다. */
export function isUnknownCell(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  const s = String(v).trim();
  if (!s) return true;
  return UNKNOWN_MARKERS.has(s);
}

/**
 * 시트에 이미 있는 값을 지킬지 판단한다.
 *   우리가 모르는 값(미기록·빈칸)으로 사람이 채워 둔 칸을 덮어쓰지 않는다.
 *   실제 값을 계산했으면 그것으로 갱신한다 — 원장이 최신이다.
 */
export function keepExisting(next: Cell | undefined, existing: unknown): boolean {
  if (next === undefined) return true;          // 계산하지 않은 열은 건드리지 않는다
  if (!isUnknownCell(next)) return false;       // 실제 값 → 갱신
  return !isUnknownCell(existing);              // 모르는 값인데 시트에 값이 있으면 지킨다
}

// ── 헤더 이름 맞추기 ─────────────────────────────────────────
//   시트 헤더는 사람이 쓴 글자다. "브랜드 ID" / "브랜드ID", "플랜 / 결제" /
//   "플랜/결제" 처럼 띄어쓰기가 흔들린다. 공백을 모두 지워 비교하고,
//   글자 자체가 다른 것(담당자 ↔ 담당자 (원장))은 별칭으로 명시한다.
/** 비교용 정규화 — 전각·호환문자를 펴고 모든 공백을 지운다. */
export function normHeader(h: unknown): string {
  return String(h ?? "").normalize("NFKC").replace(/\s+/g, "");
}

/**
 * 우리 이름(canonical) → 시트에 실제로 쓰여 있을 수 있는 다른 이름들.
 *   공백만 다른 변형은 normHeader 가 흡수하므로 여기 적지 않는다.
 */
export const HEADER_ALIASES: Readonly<Record<string, readonly string[]>> = {
  "담당자": ["담당자 (원장)"],
  "최근접촉표시": ["최근접촉 (원문표시)"],
  "매출액·구간": ["매출액 · 구간"],
};

// ── 수식 주입 방지 ───────────────────────────────────────────
//   쓰기는 전부 RAW 다. RAW 는 보낸 값을 해석하지 않으므로 "=..." 로 시작하는
//   글자도 시트에서 수식이 되지 않는다.
//   앞에 작은따옴표를 붙이지 않는다 — RAW 에서는 그 따옴표가 값의 일부로
//   저장되어, "+82 10-..." 이 "'+82 10-..." 이 되어 버린다(값 손상).
export function safeText(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  if (!s) return "";
  // 줄바꿈은 살리되 셀을 깨뜨리는 제어문자는 공백으로 바꾼다.
  return s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, " ");
}

/**
 * 전화번호 — 원문을 문자열로 보존한다.
 *   숫자만 남기면 국가번호(+82)와 내선(,1234 / ext.2)이 사라진다.
 *   RAW 쓰기라 "0105663..." 도 숫자로 해석되지 않고 글자로 들어간다.
 */
export function phoneText(v: unknown): string {
  return safeText(v).replace(/\s+/g, " ").trim();
}

// ── 날짜 ─────────────────────────────────────────────────────
//   시트의 날짜 칸(A 유입일시, J 최근업데이트)은 이미 숫자 시리얼이고
//   표시 서식이 yyyy-mm-dd hh:mm 이다. 글자를 넣으면 한 열에 숫자와 글자가
//   섞여 정렬·필터가 깨진다. 그래서 시리얼로 쓴다.
//   우리가 새로 채우는 G(최근메일시각)·O(수집시각)는 시트에서 같은 서식을
//   한 번 지정해 줘야 숫자가 날짜로 보인다 — 운영 절차 문서에 남겼다.
export const DATE_AS_SERIAL = true;

/** 날짜가 들어가는 열(우리 이름). 시트 서식 안내와 검증에 쓴다. */
export const DATE_HEADERS: readonly string[] = [
  "유입일시(KST)", "최근메일시각(KST)", "최근업데이트(KST)", "수집시각(KST)",
];

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

/**
 * Sheets 날짜 시리얼(1899-12-30 기준, KST 벽시계).
 *   분 단위로 끊는다 — 표시 서식이 분까지라, 초가 남으면 같은 값을 다시 쓸 때
 *   미세하게 달라져 readback 비교가 흔들린다.
 */
export function kstSerial(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const kstMinutes = Math.floor((d.getTime() + 9 * 3600_000) / 60_000);
  const epochMinutes = Date.UTC(1899, 11, 30) / 60_000;
  return (kstMinutes - epochMinutes) / 1440;
}

export function dateCell(iso: string | null | undefined): Cell {
  if (!iso) return "";
  if (!DATE_AS_SERIAL) return kstText(iso);
  const s = kstSerial(iso);
  return s === null ? "" : s;
}

// ── 매출 ─────────────────────────────────────────────────────
//   세 가지를 절대 섞지 않는다:
//     ① 고객이 직접 신고한 매출 구간(신청서) — 사람이 적은 값, 최근 12개월 기준
//     ② AI 추정(brands.revenue_estimate)     — 확정 실적이 아니다
//     ③ 우리 회사가 받은 돈(결제·구독)       — 브랜드 연매출과 무관하다. 여기 넣지 않는다.
export interface RevenueInput {
  /** 신청서에서 고객이 고른 구간 키(있으면 이게 우선). */
  reportedBand?: string | null;
  /** 그 구간의 사람이 읽는 이름. */
  reportedBandLabel?: string | null;
  /** 그 신고가 어디서 왔는지(weekly 신청서 등). */
  reportedSource?: string | null;
  /** 신고 시점. */
  reportedAt?: string | null;
  /** brands.revenue_estimate 원본 jsonb. */
  estimateRaw?: unknown;
}

/** 시트 T~X 에 들어갈 다섯 칸. */
export interface RevenueCells {
  /** T 매출액·구간 */
  amount: Cell;
  /** U 매출 기준·확인상태 — 무엇을 근거로 한 숫자인지. 범위(scope)·대상까지 적는다. */
  basis: string;
  /** V 매출 출처 — 사람이 다시 확인할 수 있는 근거(URL 포함). */
  source: string;
  /** W 매출 기준연도 */
  year: Cell;
  /** X 매출 통화 */
  currency: string;
}

function estimateRange(e: RevenueEstimate): string {
  const n = (v: number) => v.toLocaleString("en-US");
  return e.lower === e.upper ? n(e.lower) : `${n(e.lower)}~${n(e.upper)}`;
}

/** 추정 범위가 브랜드 하나인지, 법인 전체인지 — 숫자의 뜻이 달라진다. */
const SCOPE_LABELS: Record<RevenueEstimate["scope"], string> = {
  brand: "브랜드 단위",
  company_separate: "법인 별도",
  company_consolidated: "법인 연결",
};

export function revenueCells(i: RevenueInput): RevenueCells {
  // ① 고객 신고 구간이 있으면 그것이 기준이다.
  const band = (i.reportedBandLabel ?? "").trim() || (i.reportedBand ?? "").trim();
  if (band) {
    // 신청서 문항은 "최근 12개월"이다. 확정 회계연도 매출이 아니므로
    // 연도 칸에 연도 숫자만 적지 않는다 — 그러면 결산 매출로 읽힌다.
    const at = kstText(i.reportedAt);
    return {
      amount: safeText(band),
      basis: "고객 신고 구간 · 최근 12개월 자기신고(확정 회계연도 아님)",
      source: safeText((i.reportedSource ?? "").trim() || "신청서"),
      year: at ? `최근 12개월 (신고 ${at.slice(0, 7)})` : "최근 12개월 (신고시점 미기록)",
      currency: "KRW",
    };
  }

  // ② AI 추정 — 확정 실적이 아님을, 무엇에 대한 추정인지까지 칸 안에서 밝힌다.
  const view = revenueView(i.estimateRaw);
  if (view.estimate) {
    const e = view.estimate;
    return {
      amount: safeText(estimateRange(e)),
      basis: `AI 추정 · 미확정 (신뢰도 ${e.confidence} · 범위 ${SCOPE_LABELS[e.scope]} · 대상 ${e.entity})`,
      // 제목만 적으면 다시 확인할 수 없다. URL 을 함께 남긴다.
      source: safeText(e.sources.slice(0, 3).map((s) => `${s.title} (${s.url})`).join(" / ")
        || "AI 추정"),
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
  /** 가장 최근 발신(우리→고객) 시각. */
  lastOutAt?: string | null;
  /** 가장 최근 수신(고객→우리) 시각. */
  lastInAt?: string | null;
  /**
   * 방향과 무관하게 가장 최근 기록. 제목·출처는 반드시 이 기록의 것이다 —
   * 수기 기록의 시각에 Gmail 제목을 붙이면 없는 메일을 만들어 낸다.
   */
  lastAnyAt?: string | null;
  lastAnySubject?: string | null;
  /** 'gmail'(수집) | 'manual'(brand_emails 기록) */
  lastAnySource?: string | null;
  /** 'in' | 'out' | 'unknown' */
  lastAnyDirection?: string | null;
  /** 집계에 쓴 기록 건수(근거). */
  totalMessages?: number;
}

export interface CommsCells {
  /** E 커뮤확인 — 진행 상태 한 줄. */
  status: string;
  /** G 최근메일시각(KST) */
  lastMailAt: Cell;
  /** H 최근메일 제목 */
  lastMailSubject: string;
  /** K 최근접촉 (원문표시) */
  lastTouch: string;
}

const SRC_LABELS: Record<string, string> = { gmail: "메일수집", manual: "기록" };
const DIR_LABELS: Record<string, string> = { in: "수신", out: "발신", unknown: "방향미확인" };

/**
 * 커뮤니케이션 상태.
 *   수신 기록이 있다고 "고객이 회신했다"고 적지 않는다. TikTok 자동 안내처럼
 *   사람이 쓰지 않은 메일도 브랜드에 매칭되어 수신으로 쌓인다. 자동메일을
 *   가려낼 근거(발신주소 규칙 등)가 아직 없으므로 "수신 기록 확인"까지만 말한다.
 */
export function commsCells(c: CommsInput): CommsCells {
  const at = c.lastAnyAt ?? null;
  if (!at) {
    return { status: "기록 없음", lastMailAt: "", lastMailSubject: "", lastTouch: UNKNOWN };
  }

  const dir = (c.lastAnyDirection ?? "unknown").trim() || "unknown";
  const status = dir === "in"
    ? "수신 기록 확인"
    : dir === "out"
      ? (c.lastInAt ? "발신 후 대기(수신 기록 있음)" : "발신만 · 수신 없음")
      : "기록 있음 · 방향 미확인";

  const n = c.totalMessages ?? 0;
  const src = SRC_LABELS[(c.lastAnySource ?? "").trim()] ?? "출처미확인";
  const touch = `${kstText(at)} · ${DIR_LABELS[dir] ?? DIR_LABELS.unknown} · ${src}`
    + (n > 0 ? ` (기록 ${n}건)` : "");

  return {
    status,
    lastMailAt: dateCell(at),
    lastMailSubject: safeText(c.lastAnySubject ?? ""),
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

/**
 * 이 열이 시트에 없으면 쓰기 전에 멈춘다.
 *   사용자가 요구한 필수 항목(유입일·업체명·전화·이메일·카테고리·브랜드링크·
 *   매출과 그 기준·단계·담당자·커뮤 상태)이 하나라도 갈 곳이 없으면,
 *   반쪽짜리 기록을 남기는 대신 실패로 알린다.
 */
export const REQUIRED_HEADERS = [
  "브랜드ID", "유입일시(KST)", "업체명", "진행단계", "커뮤확인", "담당자",
  "카테고리", "전화번호", "이메일", "브랜드링크",
  "매출액·구간", "매출기준·확인상태", "수집시각(KST)",
] as const;

/** 브랜드 ID 가 들어가는 열 이름 — 이 값으로 기존 행을 찾아 갱신한다. */
export const ID_HEADER = "브랜드ID";

/**
 * 갱신기록 탭의 실제 헤더(A:H). 시트에 이미 있는 순서를 그대로 따른다.
 *   순서를 틀리면 "추가"와 "변경" 숫자가 맞바뀌어 기록이 거짓말을 한다.
 */
export const LOG_HEADERS = [
  "기록시각(KST)", "원장건수", "추가건수", "변경건수",
  "메일확인 업체", "실행상태", "기록 기준", "원본",
] as const;
