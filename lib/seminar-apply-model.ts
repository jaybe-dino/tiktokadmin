// 「브랜드 해외매출 실행전략 세미나」 공개 신청 — 순수 로직(DB·외부 모듈 없음).
//   공개 폼("use client")이 그대로 가져다 쓸 수 있어야 하므로 이 파일은 DB 를 import 하지 않는다.
//   접수(submitted)와 선정(selected)을 끝까지 분리한다 — 선착순 자동선정은 만들지 않는다.

export const PROGRAM_TITLE = "브랜드 해외매출 실행전략 세미나";
export const PROGRAM_TAGLINE = "회차별 30명 선정 · 무료 온라인 세미나";
/** 공개 신청 경로. 한 번 공개한 뒤에는 바꾸지 않는 것을 전제로 한다. */
export const APPLY_PATH = "/seminar-apply";
export const ADMIN_PATH = "/seminar-apply-admin";
export const SAP_MIGRATION = "0113_seminar_apply_2026.sql";
/** 동의 시점의 안내문을 식별하는 값. 문구를 고치면 이 값도 함께 올린다. */
export const CONSENT_VERSION = "sap-2026-10";
export const SELECT_CAP_DEFAULT = 30;

// ── 회차 ─────────────────────────────────────────────────────
//   확정된 4회. 같은 핵심 프로그램을 네 번 운영하고 신청자는 1개를 고른다.
export interface SessionSpec { no: number; date: string; label: string }
export const SESSION_SPECS: SessionSpec[] = [
  { no: 1, date: "2026-10-13", label: "2026년 10월 13일(화) 11:00~12:00" },
  { no: 2, date: "2026-10-16", label: "2026년 10월 16일(금) 11:00~12:00" },
  { no: 3, date: "2026-10-20", label: "2026년 10월 20일(화) 11:00~12:00" },
  { no: 4, date: "2026-10-23", label: "2026년 10월 23일(금) 11:00~12:00" },
];
export const SESSION_TIME_NOTE = "매 회차 11:00~12:00 (한국 시간, Asia/Seoul) · Zoom 온라인";
/** 4개 회차는 서로 다른 세미나가 아니라 같은 세미나를 네 번 운영하는 것이다. */
export const SAME_PROGRAM_NOTE =
  "네 번 모두 같은 내용의 세미나입니다. 참석하실 수 있는 날짜 1개만 선택해 주세요.";

const KST_DAY = ["일", "월", "화", "수", "목", "금", "토"];

/** 저장된 timestamptz 를 KST 기준 사람 문장으로. 서버 타임존에 의존하지 않는다. */
export function fmtSessionWhen(startsAt: string | null | undefined, endsAt?: string | null): string {
  if (!startsAt) return "일시 미정";
  const s = new Date(startsAt);
  if (Number.isNaN(s.getTime())) return "일시 미정";
  const k = new Date(s.getTime() + 9 * 3600_000);
  const hm = (d: Date) => `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
  const head = `${k.getUTCFullYear()}년 ${k.getUTCMonth() + 1}월 ${k.getUTCDate()}일(${KST_DAY[k.getUTCDay()]}) ${hm(k)}`;
  if (!endsAt) return head;
  const e = new Date(endsAt);
  if (Number.isNaN(e.getTime())) return head;
  return `${head}~${hm(new Date(e.getTime() + 9 * 3600_000))}`;
}

/** 날짜 카드에 쓰는 짧은 표기(예: "10/13 (화)"). */
export function fmtSessionShort(startsAt: string | null | undefined): string {
  if (!startsAt) return "미정";
  const s = new Date(startsAt);
  if (Number.isNaN(s.getTime())) return "미정";
  const k = new Date(s.getTime() + 9 * 3600_000);
  return `${k.getUTCMonth() + 1}/${k.getUTCDate()} (${KST_DAY[k.getUTCDay()]})`;
}

// ── 선택지 ───────────────────────────────────────────────────
export const JOB_ROLES = ["대표", "해외영업", "마케팅", "기타"] as const;

export const PRODUCT_CATEGORIES = [
  "뷰티·화장품", "식품·건강기능식품", "패션·잡화", "생활·주방", "유아·키즈",
  "반려동물", "가전·디지털", "스포츠·레저", "문구·취미", "기타",
] as const;

export const OVERSEAS_STAGES = [
  "아직 준비 전(검토만)",
  "준비 중(상품·인증 점검)",
  "첫 수출 준비(바이어·채널 탐색)",
  "일부 국가 판매 중",
  "다국가 판매 중(확대 단계)",
] as const;

export const TARGET_COUNTRIES = [
  "아직 미정", "일본", "미국", "동남아(싱가포르·말레이시아 등)", "베트남", "태국",
  "중국", "대만", "유럽", "중동", "기타",
] as const;

/** 매출 구간 — 미공개를 명시적으로 고를 수 있게 둔다(빈값 = 미기입과 구분). */
export const REVENUE_BANDS: { key: string; label: string }[] = [
  { key: "pre", label: "매출 발생 전" },
  { key: "b_1", label: "1억원 미만" },
  { key: "b1_10", label: "1억원 이상 ~ 10억원 미만" },
  { key: "b10_50", label: "10억원 이상 ~ 50억원 미만" },
  { key: "b50_200", label: "50억원 이상 ~ 200억원 미만" },
  { key: "b200_", label: "200억원 이상" },
  { key: "undisclosed", label: "미공개" },
];
// ── 상태 ─────────────────────────────────────────────────────
export const STATUSES = ["submitted", "selected", "waitlisted", "not_selected", "cancelled"] as const;
export type SapStatus = (typeof STATUSES)[number];
export const STATUS_KO: Record<SapStatus, string> = {
  submitted: "접수",
  selected: "선정",
  waitlisted: "대기",
  not_selected: "미선정",
  cancelled: "취소",
};
/** 선정 상한을 차지하는 상태 — 선정뿐이다. 접수·대기는 상한과 무관하다. */
//   접수(submitted)·대기(waitlisted)는 자리를 차지하지 않는다 — 전체 신청은 제한 없이 받는다.
//   기존 세미나 모집 허브의 REG_OCCUPYING(applied 포함)과는 별개의 정책이며, 그쪽은 그대로 둔다.
export const CAP_STATUSES: SapStatus[] = ["selected"];
export function isSapStatus(v: unknown): v is SapStatus {
  return typeof v === "string" && (STATUSES as readonly string[]).includes(v);
}

// ── 정규화·검증 ──────────────────────────────────────────────
export function normalizeEmail(raw: unknown): string {
  return String(raw ?? "").trim().toLowerCase();
}
export function isEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
}
/** 전화는 숫자만 남긴다(선택 항목이라 비어 있어도 된다). */
export function normalizePhone(raw: unknown): string {
  let d = String(raw ?? "").replace(/[^\d]/g, "");
  if (d.startsWith("0082")) d = d.slice(4);
  else if (d.startsWith("82")) d = d.slice(2);
  if (d && !d.startsWith("0")) d = `0${d}`;
  return d;
}
export function clean(raw: unknown, max: number): string {
  return String(raw ?? "").trim().replace(/\s+/g, " ").slice(0, max);
}
/** 여러 줄 입력(질문·과제)은 줄바꿈을 살린다. */
export function cleanMulti(raw: unknown, max: number): string {
  return String(raw ?? "").trim().replace(/\r\n/g, "\n").slice(0, max);
}

export interface SapFormInput {
  sessionNo?: number | string;
  companyName?: string; brandName?: string; noBrand?: boolean;
  contactName?: string; jobRole?: string; jobRoleEtc?: string;
  email?: string; productCategory?: string; overseasStage?: string;
  targetCountries?: string[] | string; question?: string;
  /** 연락처는 필수다(선정 결과를 메일과 함께 전화로도 안내한다). */
  phone?: string;
  siteUrl?: string; revenueBand?: string;
  wantsConsult?: boolean;
  consentRequired?: boolean; consentOptional?: boolean; consentAds?: boolean;
  /** 사람이 채우지 않는 미끼 입력. 값이 있으면 봇으로 본다. */
  trap?: string;
}

const list = (v: string[] | string | undefined): string[] =>
  Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean)
    : String(v ?? "").split(",").map((x) => x.trim()).filter(Boolean);

/**
 * 서버에서 다시 거르는 검증. 화면 검증을 믿지 않는다.
 *   필수는 목적(회차 배정·선정 심사·안내)에 필요한 항목만 둔다.
 */
export function formBlockers(i: SapFormInput): string[] {
  const out: string[] = [];
  const no = Number(i.sessionNo);
  if (!Number.isInteger(no) || no < 1) out.push("희망 회차를 1개 선택해 주세요.");

  if (!clean(i.companyName, 120)) out.push("회사명을 입력해 주세요.");
  if (!i.noBrand && !clean(i.brandName, 120)) out.push("브랜드명을 입력하거나 ‘브랜드 미보유’를 선택해 주세요.");
  if (!clean(i.contactName, 60)) out.push("담당자명을 입력해 주세요.");

  const role = clean(i.jobRole, 40);
  if (!(JOB_ROLES as readonly string[]).includes(role)) out.push("직무를 선택해 주세요.");

  const email = normalizeEmail(i.email);
  if (!email) out.push("업무 이메일을 입력해 주세요.");
  else if (!isEmail(email)) out.push("이메일 형식을 확인해 주세요.");

  if (!(PRODUCT_CATEGORIES as readonly string[]).includes(clean(i.productCategory, 60))) {
    out.push("상품 카테고리를 선택해 주세요.");
  }
  if (!(OVERSEAS_STAGES as readonly string[]).includes(clean(i.overseasStage, 80))) {
    out.push("현재 해외진출 단계를 선택해 주세요.");
  }
  const countries = list(i.targetCountries);
  if (countries.length === 0) out.push("희망 국가를 선택해 주세요(아직 미정도 선택할 수 있습니다).");
  else if (countries.some((c) => !(TARGET_COUNTRIES as readonly string[]).includes(c))) {
    out.push("희망 국가 선택값을 확인해 주세요.");
  }
  if (!cleanMulti(i.question, 2000)) out.push("세미나에서 듣고 싶은 질문 또는 해결하고 싶은 과제를 적어 주세요.");

  const phone = normalizePhone(i.phone);
  if (!phone) out.push("연락처를 입력해 주세요.");
  else if (phone.length < 9) out.push("연락처를 확인해 주세요.");

  // 선택 항목도 목록에 없는 값은 받지 않는다(저장값이 섞이지 않게).
  const revenue = clean(i.revenueBand, 20);
  if (revenue && !REVENUE_BANDS.some((b) => b.key === revenue)) out.push("매출 구간 선택값을 확인해 주세요.");

  // 필수 동의가 없으면 저장하지 않는다. 광고 동의는 신청·선정 조건이 아니다.
  if (!i.consentRequired) out.push("개인정보 수집·이용(필수)에 동의해 주세요.");
  return out;
}

/** 저장 직전 값으로 정리. 선택지 밖의 값은 버린다(검증을 통과한 입력을 전제로 한다). */
export interface SapRow {
  sessionNo: number;
  companyName: string; brandName: string; noBrand: boolean;
  contactName: string; jobRole: string; jobRoleEtc: string;
  email: string; emailNorm: string;
  productCategory: string; overseasStage: string; targetCountries: string; question: string;
  phone: string; siteUrl: string; revenueBand: string; wantsConsult: boolean;
  consentRequired: boolean; consentOptional: boolean; consentAds: boolean;
}
export function toRow(i: SapFormInput): SapRow {
  const keep = (v: string[] | string | undefined, allowed: readonly string[]) =>
    list(v).filter((x) => allowed.includes(x)).join(", ");
  const email = normalizeEmail(i.email);
  return {
    sessionNo: Number(i.sessionNo),
    companyName: clean(i.companyName, 120),
    brandName: i.noBrand ? "" : clean(i.brandName, 120),
    noBrand: Boolean(i.noBrand),
    contactName: clean(i.contactName, 60),
    jobRole: clean(i.jobRole, 40),
    jobRoleEtc: clean(i.jobRole, 40) === "기타" ? clean(i.jobRoleEtc, 80) : "",
    email, emailNorm: email,
    productCategory: clean(i.productCategory, 60),
    overseasStage: clean(i.overseasStage, 80),
    targetCountries: keep(i.targetCountries, TARGET_COUNTRIES),
    question: cleanMulti(i.question, 2000),
    phone: normalizePhone(i.phone),
    siteUrl: normalizeUrl(i.siteUrl),
    revenueBand: clean(i.revenueBand, 20),
    wantsConsult: Boolean(i.wantsConsult),
    consentRequired: Boolean(i.consentRequired),
    consentOptional: Boolean(i.consentOptional),
    consentAds: Boolean(i.consentAds),
  };
}

/** 공식 URL — 스킴이 없으면 https 를 붙이고, http(s) 가 아니면 버린다. */
export function normalizeUrl(raw: unknown): string {
  const v = String(raw ?? "").trim();
  if (!v) return "";
  const withScheme = /^https?:\/\//i.test(v) ? v : `https://${v}`;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    return u.toString().slice(0, 300);
  } catch { return ""; }
}

// ── 마스킹(관리 목록·이력) ───────────────────────────────────
export function maskEmail(raw: string): string {
  const v = normalizeEmail(raw);
  if (!v.includes("@")) return v ? "***" : "";
  const [id, dom] = v.split("@");
  return `${id.slice(0, 2)}${"*".repeat(Math.max(1, id.length - 2))}@${dom}`;
}
export function maskPhone(raw: string): string {
  const v = normalizePhone(raw);
  return v.length > 6 ? `${v.slice(0, 3)}****${v.slice(-2)}` : v ? "*".repeat(v.length) : "";
}

// ── 공개 문구 ────────────────────────────────────────────────
export const APPLY_DONE_NOTICE =
  "신청이 접수되었습니다. 참석은 아직 확정되지 않았으며, 선정 결과와 Zoom 접속 링크는 별도로 안내드립니다.";
/** 회차별 선정 인원이 서로 다를 수 있으므로 숫자를 문장에 박아 두지 않는다. */
export const NOT_CONFIRMED_NOTICE =
  "접수는 참석 확정이 아닙니다 — 회차별로 정해진 인원을 선정한 뒤, 선정되신 분께만 Zoom 접속 링크를 안내합니다.";
/** 공개 화면 소개 문단. 틱톡샵 온보딩에서 시작해 운영·마케팅까지 다룬다. */
export const INTRO_PARAGRAPH =
  "틱톡샵 온보딩부터 상품 등록과 운영, 콘텐츠·크리에이터를 활용한 마케팅까지 — 브랜드가 실제로 주문을 받기까지 무엇을 어떤 순서로 해야 하는지 한 시간에 정리해 드립니다.";

/** 한정 참석 표기 — 실제 선정 인원에 근거한 문장만 쓴다. */
export const LIMITED_SEATS_NOTE =
  "한정 참석 — 회차별로 정해진 인원만 선정합니다.";

export const SELECTION_CRITERIA =
  "적어 주신 질문·해결과제가 세미나 주제와 얼마나 맞는지, 현재 해외진출 단계, 그리고 회차별 참여 구성을 함께 보고 선정합니다. 광고성 정보 수신 동의 여부는 선정에 쓰지 않습니다.";

export const CONSENT_REQUIRED_LABEL = "개인정보 수집·이용에 동의합니다. (필수)";
export const CONSENT_OPTIONAL_LABEL = "선택 정보 수집·이용에 동의합니다. (선택)";
export const CONSENT_ADS_LABEL =
  "세미나·프로그램 등 광고성 정보를 이메일로 받는 데 동의합니다. (선택 — 동의하지 않아도 신청과 선정에 전혀 불이익이 없습니다)";
export const CONSULT_LABEL =
  "세미나와 별도로 1:1 상담을 받고 싶습니다. (선택 — 상담을 요청하시면 담당자가 따로 연락드립니다)";

/** 수집 항목 안내 — 필수/선택을 나눠 적는다. */
export const COLLECT_REQUIRED =
  "희망 회차, 회사명, 브랜드명(미보유 여부), 담당자명, 직무, 업무 이메일, 연락처, 상품 카테고리, 현재 해외진출 단계, 희망 국가, 세미나 질문·해결과제";
export const COLLECT_OPTIONAL = "공식 URL, 매출 구간, 1:1 상담 희망";
export const PURPOSE_REQUIRED = "세미나 회차 배정, 선정 심사, 선정 결과·접속 링크 안내";
export const PURPOSE_OPTIONAL = "세미나 내용 구성과 상담 준비를 위한 참고";
export const PURPOSE_ADS = "이후 세미나·프로그램 등 광고성 정보 이메일 발송";
export const REFUSAL_NOTICE =
  "동의를 거부하실 수 있습니다. 필수 항목에 동의하지 않으시면 회차 배정과 선정 안내가 불가능해 신청을 받을 수 없습니다. 선택 항목과 광고성 정보 수신에 동의하지 않아도 신청과 선정에 불이익이 없습니다.";

// ── 보유기간 ─────────────────────────────────────────────────
//   기존 처리방침(glovek.space/privacy)에는 세미나 전용 보유기간이 없다.
//   그래서 이 행사 동의문에만 쓰는 구체 기간을 명시하고, 만료 시점을 저장해 둔다.
//   저장만 한다 — 이 값으로 자동 삭제하지 않는다(현재 자동 파기 작업이 없다).
export interface RetentionPolicy {
  /** 마지막 회차 종료일(YYYY-MM-DD). */
  baseDate: string;
  requiredMonths: number;
  adsMonths: number;
}
export const RETENTION_DEFAULT: RetentionPolicy = {
  baseDate: "2026-10-23", requiredMonths: 3, adsMonths: 12,
};

function addMonthsIso(isoDate: string, months: number): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  // KST 자정(= 전날 15:00 UTC)을 기준으로 둔다.
  const base = Date.UTC(y, mo - 1 + months, d, 15, 0, 0);
  const out = new Date(base);
  if (Number.isNaN(out.getTime())) return null;
  return out.toISOString();
}

/**
 * 필수정보 만료 시각 = 마지막 회차 종료일 + N개월이 되는 날의 끝(KST 24:00).
 *   "그날까지 보유"를 뜻하므로 저장값은 그날이 끝나는 순간이다.
 */
export function requiredExpiryIso(p: RetentionPolicy = RETENTION_DEFAULT): string | null {
  return addMonthsIso(p.baseDate, p.requiredMonths);
}

/** 만료 시각 → 마지막으로 보유하는 날(KST, 그날 포함). 하루 밀려 보이지 않게 한다. */
export function retainedUntilKst(expiryIso: string): string {
  const d = new Date(expiryIso);
  if (Number.isNaN(d.getTime())) return "";
  return ymdKst(new Date(d.getTime() - 1).toISOString());
}
/** 광고 동의 만료 = 동의일 + N개월. 철회가 먼저면 철회 시점이 끝이다. */
export function adsExpiryIso(agreedAt: Date, p: RetentionPolicy = RETENTION_DEFAULT): string {
  const d = new Date(agreedAt.getTime());
  d.setUTCMonth(d.getUTCMonth() + p.adsMonths);
  return d.toISOString();
}

/** 동의문에 그대로 넣는 보유기간 문장. */
export function retentionSentence(p: RetentionPolicy = RETENTION_DEFAULT): { required: string; ads: string } {
  const req = requiredExpiryIso(p);
  const until = req ? retainedUntilKst(req) : "";
  return {
    required: `마지막 회차(${p.baseDate}) 종료 후 ${p.requiredMonths}개월${until ? ` — ${until}까지` : ""}`,
    ads: `동의일로부터 최대 ${p.adsMonths}개월(1년) 또는 수신 철회 시까지 중 먼저 도달하는 시점까지`,
  };
}

/** ISO → KST 기준 YYYY-MM-DD. */
export function ymdKst(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const k = new Date(d.getTime() + 9 * 3600_000);
  return `${k.getUTCFullYear()}-${String(k.getUTCMonth() + 1).padStart(2, "0")}-${String(k.getUTCDate()).padStart(2, "0")}`;
}

// ── 개인정보 안내에 표시할 운영자·문의처 ─────────────────────
//   glovek.space/privacy 에 공개된 실제 값. 지어내지 않고, 바뀌면 설정에서 고친다.
export interface OrgIdentity {
  legalName: string; repName: string; address: string;
  contactEmail: string; contactPhone: string; bizNo: string;
}
export const ORG_DEFAULT: OrgIdentity = {
  legalName: "디노스튜디오",
  repName: "대표 허정발 (개인정보 보호책임자)",
  address: "서울특별시 서초구 사임당로26 8층 802호",
  contactEmail: "chief@dinostudio.kr",
  contactPhone: "010-5663-1273",
  bizNo: "",   // 확인된 값이 없어 비워 둔다 — 비어 있으면 화면에서 그 줄을 빼 둔다.
};
