// 광고(marketing) 수신거부 — 수신자 단위.
//   · 광고 목적 발송에만 적용한다. 계약·일정·거래 등 service 목적은 이 모듈을 거치지 않는다.
//   · 기존 전체 수신거부(brands.msg_opt_out)는 그대로 살아 있고, 둘 중 하나라도 켜져 있으면 광고는 나가지 않는다.
//   · 링크 토큰은 DB 에 저장한 난수다(ad_recipients.token).
//     로그인 세션 비밀키와 무관하므로 인증 키를 바꿔도 고객의 수신거부 의사가 사라지지 않는다.
//   · 토큰 → 수신자(이메일·전화 쌍)를 정확히 찾는다. 전수 조회·첫 매치 추정을 하지 않는다.
import { randomBytes, createHash } from "node:crypto";
import { query, queryOne, tx } from "./db";
import { adScopeNotice, adSeqSmsLabel } from "./ad-optout-copy";

export type AddrKind = "email" | "phone";
export const AD_PURPOSE = "marketing";
/** 수신거부 공개 페이지 경로(고정 origin + 이 경로). */
export const OPTOUT_PATH = "/u/";

// ── 주소 정규화 ───────────────────────────────────────────────
/** 같은 사람을 같은 값으로 — 이메일은 소문자, 전화는 숫자만(국제표기 82→0). */
export function normalizeAddr(kind: AddrKind, raw: string): string {
  const v = (raw ?? "").trim();
  if (!v) return "";
  if (kind === "email") return v.toLowerCase();
  let d = v.replace(/[^\d]/g, "");
  if (d.startsWith("0082")) d = d.slice(4);
  else if (d.startsWith("82")) d = d.slice(2);
  if (d && !d.startsWith("0")) d = `0${d}`;
  return d;
}

/** 화면 표시용 마스킹 — 원문을 알아볼 수 없게. */
export function maskAddr(kind: AddrKind, raw: string): string {
  const v = normalizeAddr(kind, raw);
  if (!v) return "";
  if (kind === "email") {
    const [id, dom = ""] = v.split("@");
    const head = id.slice(0, 2);
    return `${head}${"*".repeat(Math.max(1, id.length - 2))}@${dom}`;
  }
  return v.length > 6 ? `${v.slice(0, 3)}****${v.slice(-2)}` : "*".repeat(v.length);
}

/**
 * 수신거부 링크의 origin — 고객 문자·메일에 나가는 주소라 환경변수에 맡기지 않는다.
 *   ADMIN_URL 은 로컬에서 localhost, 배포에 따라 *.vercel.app 일 수 있어
 *   그대로 쓰면 고객에게 열리지 않는 링크가 나간다.
 *   바꿔야 할 때만 AD_OPTOUT_ORIGIN 으로 지정하되, 아래 허용 목록에 있는 https 주소만 받는다.
 */
export const AD_OPTOUT_ORIGIN = "https://admin.glovek.space";
const ALLOWED_ORIGINS = new Set([AD_OPTOUT_ORIGIN]);

export function optoutOrigin(): string {
  const v = (process.env.AD_OPTOUT_ORIGIN ?? "").trim().replace(/\/$/, "");
  return v && v.startsWith("https://") && ALLOWED_ORIGINS.has(v) ? v : AD_OPTOUT_ORIGIN;
}

/** 고정 origin 의 수신거부 링크 접두 — 우리 링크만 정확히 알아보기 위해. */
export function optoutBase(): string {
  return `${optoutOrigin()}${OPTOUT_PATH}`;
}
export function optoutUrlFor(token: string): string {
  return token ? `${optoutBase()}${token}` : "";
}

// ── 수신자·토큰 ──────────────────────────────────────────────
export interface Recipient { id: string; token: string; email: string; phone: string; brand_id: string | null; kind: string }

/** 256비트 난수 토큰 — 서명이 필요 없을 만큼 충분히 크고, 비밀키에 의존하지 않는다. */
function newToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * 이 수신자(이메일·전화 쌍)의 토큰을 가져온다. 없으면 만든다.
 *   같은 쌍이면 항상 같은 토큰이라 회차가 달라도 링크가 바뀌지 않는다.
 */
export async function ensureRecipient(input: { email?: string | null; phone?: string | null; brandId?: string | null; kind?: "lead" | "qa" }): Promise<Recipient | null> {
  const email = normalizeAddr("email", input.email ?? "");
  const phone = normalizeAddr("phone", input.phone ?? "");
  if (!email && !phone) return null;
  const row = await queryOne<Recipient>(
    `INSERT INTO ad_recipients (token, email, phone, brand_id, kind)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT ON CONSTRAINT ad_recipients_pair_uniq DO UPDATE
       SET last_used_at = now(), brand_id = COALESCE(ad_recipients.brand_id, EXCLUDED.brand_id)
     RETURNING id, token, email, phone, brand_id, kind`,
    [newToken(), email, phone, input.brandId ?? null, input.kind ?? "lead"]);
  return row;
}

/** 토큰 → 수신자. 없거나 형식이 아니면 null(변조·오타는 여기서 걸러진다). */
export async function recipientByToken(token: string): Promise<Recipient | null> {
  const t = (token ?? "").trim();
  if (!t || t.length < 20 || t.length > 100 || !/^[A-Za-z0-9_-]+$/.test(t)) return null;
  return queryOne<Recipient>(
    "SELECT id, token, email, phone, brand_id, kind FROM ad_recipients WHERE token=$1", [t]);
}

// ── 본문에 수신거부 붙이기 ───────────────────────────────────
export const SMS_OPTOUT_PREFIX = "무료수신거부 ";
export const MAIL_OPTOUT_LEAD = "광고 문자·메일 수신을 원하지 않으시면";

/** 본문에 들어 있는 "우리" 수신거부 링크들(다른 사이트 URL 은 건드리지 않는다). */
export function findOptoutLinks(body: string): string[] {
  const base = optoutBase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...(body ?? "").matchAll(new RegExp(`${base}[A-Za-z0-9_-]+`, "g"))].map((m) => m[0]);
}

/**
 * 본문에 그 수신자의 현재 링크가 정확히 들어가게 한다.
 *   · 같은 링크가 이미 있으면 그대로(중복 부착 방지).
 *   · 예전 링크가 남아 있으면 현재 링크로 바꾼다(수신자별 링크 보장).
 *   · 우리 링크가 아니면 손대지 않는다 — 본문 속 자료·상담 URL 은 그대로.
 */
function ensureLink(body: string, url: string, append: (b: string) => string): string {
  if (!url) return body;
  const mine = findOptoutLinks(body);
  if (mine.includes(url)) return body;
  if (mine.length > 0) {
    let out = body;
    for (const old of mine) out = out.split(old).join(url);
    return out;
  }
  return append(body);
}

/**
 * 부착 옵션 — rounds 를 주면 "총 N회 연속 안내" 범위로 적는다(연속 안내 경로).
 *   주지 않으면 범위를 특정하지 않는 일반 광고 문구를 쓴다(대량발송 등).
 */
export interface OptoutNoticeOpts { rounds?: number }

/** 문자 본문 + 수신거부 한 줄. 본문은 그대로 두고 끝에만 붙인다. */
export function withSmsOptout(body: string, url: string, opts: OptoutNoticeOpts = {}): string {
  const label = opts.rounds ? adSeqSmsLabel(opts.rounds) : SMS_OPTOUT_PREFIX;
  return ensureLink(body, url, (b) => `${b.replace(/\s+$/, "")}\n${label}${url}`);
}

/** 메일 본문 + 수신거부 안내. 광고 중단과 서비스 안내가 다름을 함께 적는다. */
export function withMailOptout(body: string, url: string, opts: OptoutNoticeOpts = {}): string {
  return ensureLink(body, url, (b) => [
    b.replace(/\s+$/, ""),
    "",
    "──────────",
    `${MAIL_OPTOUT_LEAD}: ${url}`,
    opts.rounds
      ? adScopeNotice(opts.rounds)
      : "수신거부는 광고에만 적용되며, 계약·일정 등 서비스 안내는 계속 보내드립니다.",
  ].join("\n"));
}

// ── 차단 검사 ────────────────────────────────────────────────
export interface AdGate {
  smsAllowed: boolean;
  emailAllowed: boolean;
  /** 조회 실패 — 이때는 광고를 보내지 않는다(fail closed). */
  error?: string;
  reason?: string;
}

/**
 * 광고 발송 가능 여부 — 판정 단위는 "수신자(이메일·전화 쌍)"다.
 *   넘어온 쌍 중 한쪽이라도 광고 수신거부면 문자·메일을 모두 막는다.
 *   같은 사람이 전화는 그대로 두고 새 이메일로 다시 등록해도 우회되지 않게 하기 위함이다.
 *   (다른 사람의 연락처 쌍은 이 판정에 들어오지 않으므로 영향받지 않는다)
 * 조회가 실패하면 "차단"으로 처리한다(fail closed).
 */
export async function adGate(input: { phone?: string | null; email?: string | null; brandOptOut?: boolean }): Promise<AdGate> {
  if (input.brandOptOut) {
    return { smsAllowed: false, emailAllowed: false, reason: "전체 수신거부(브랜드)" };
  }
  const phone = normalizeAddr("phone", input.phone ?? "");
  const email = normalizeAddr("email", input.email ?? "");
  if (!phone && !email) return { smsAllowed: false, emailAllowed: false, reason: "연락처 없음" };

  try {
    const rows = await query<{ kind: string; addr: string }>(
      `SELECT kind, addr FROM ad_optouts
        WHERE purpose=$1 AND ((kind='phone' AND addr=$2) OR (kind='email' AND addr=$3))`,
      [AD_PURPOSE, phone, email]);
    const smsBlocked = Boolean(phone) && rows.some((r) => r.kind === "phone" && r.addr === phone);
    const mailBlocked = Boolean(email) && rows.some((r) => r.kind === "email" && r.addr === email);
    // 쌍 중 하나라도 거부면 이 수신자에게는 문자·메일 모두 보내지 않는다.
    const blocked = smsBlocked || mailBlocked;
    return {
      smsAllowed: Boolean(phone) && !blocked,
      emailAllowed: Boolean(email) && !blocked,
      reason: blocked
        ? `광고 수신거부(${smsBlocked ? "문자" : ""}${smsBlocked && mailBlocked ? "·" : ""}${mailBlocked ? "메일" : ""})`
        : undefined,
    };
  } catch (e) {
    // 주소·비밀은 남기지 않는다 — 원인 문구만.
    return { smsAllowed: false, emailAllowed: false, error: `수신거부 확인 실패 — ${(e as Error).message}` };
  }
}

// ── 수신거부 확정 ────────────────────────────────────────────
export interface OptOutResult {
  ok: boolean;
  already?: boolean;
  /** 공개 화면에 보여줄 문구(DB 원문·주소를 담지 않는다). */
  error?: string;
  channels?: AddrKind[];
  canceled?: number;
}

/**
 * 같은 연락처를 쓰는 브랜드 후보 — 저장 표기가 제각각이므로 SQL 에서 먼저 정규화해 좁힌다.
 *   · 이메일: 앞뒤 공백 제거 + 소문자
 *   · 전화: 숫자만 남긴 뒤 끝 8자리로 비교(하이픈·국제표기 +82 를 모두 흡수)
 *   그 다음 JS 에서 완전 정규화 값으로 정확히 대조한다.
 */
const BRAND_CANDIDATE_SQL = `
  SELECT id, email, phone FROM brands
   WHERE (NULLIF($1,'') IS NOT NULL AND lower(trim(coalesce(email,''))) = $1)
      OR (NULLIF($2,'') IS NOT NULL
          AND regexp_replace(coalesce(phone,''), '[^0-9]', '', 'g') LIKE '%' || $2 || '%')`;

/** 전화 비교용 꼬리 — 정규화된 번호의 끝 8자리(국가번호 표기에 무관). */
export function phoneTail(phone: string): string {
  const v = normalizeAddr("phone", phone);
  return v.length >= 8 ? v.slice(-8) : v;
}

/** 후보 중 정규화 값이 정확히 일치하는 브랜드만 고른다. */
function exactMatches(rows: { id: string; email: string | null; phone: string | null }[], email: string, phone: string): string[] {
  return rows
    .filter((b) => (email && normalizeAddr("email", b.email ?? "") === email)
                || (phone && normalizeAddr("phone", b.phone ?? "") === phone))
    .map((b) => b.id);
}

/**
 * 토큰으로 광고 수신거부를 확정한다(POST 경로에서만 호출).
 *   · 수신자의 문자·메일을 한 트랜잭션에서 함께 막고, 같은 연락처를 쓰는 모든 브랜드의
 *     남은 광고 예약을 함께 중단한다. 중간에 실패하면 전부 되돌린다(부분 성공 없음).
 *   · 재클릭은 멱등 — 상태는 그대로 두고 확인 횟수만 올린다.
 */
export async function confirmOptOut(token: string, opts: { source?: "link" | "admin" | "qa" } = {}): Promise<OptOutResult> {
  let who: Recipient | null;
  try { who = await recipientByToken(token); }
  catch { return { ok: false, error: "지금은 처리할 수 없습니다. 잠시 후 다시 시도해 주세요." }; }
  if (!who) return { ok: false, error: "유효하지 않은 링크입니다." };

  const source = opts.source ?? (who.kind === "qa" ? "qa" : "link");
  const targets: { kind: AddrKind; addr: string }[] = [];
  if (who.email) targets.push({ kind: "email", addr: who.email });
  if (who.phone) targets.push({ kind: "phone", addr: who.phone });

  try {
    return await tx(async (c) => {
      let repeat = 0;
      for (const t of targets) {
        const r = await c.query<{ confirm_count: number }>(
          `INSERT INTO ad_optouts (purpose, kind, addr, addr_masked, brand_id, recipient_id, source)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT ON CONSTRAINT ad_optouts_addr_uniq DO UPDATE
             SET confirm_count = ad_optouts.confirm_count + 1, last_confirm_at = now(),
                 brand_id = COALESCE(ad_optouts.brand_id, EXCLUDED.brand_id),
                 recipient_id = COALESCE(ad_optouts.recipient_id, EXCLUDED.recipient_id)
           RETURNING confirm_count`,
          [AD_PURPOSE, t.kind, t.addr, maskAddr(t.kind, t.addr), who!.brand_id, who!.id, source]);
        if ((r.rows[0]?.confirm_count ?? 1) > 1) repeat++;
      }

      // 같은 연락처를 쓰는 모든 브랜드의 남은 광고 예약 중단(중복 유입 대응).
      const cand = await c.query<{ id: string; email: string | null; phone: string | null }>(
        BRAND_CANDIDATE_SQL, [who!.email, phoneTail(who!.phone)]);
      const ids = exactMatches(cand.rows, who!.email, who!.phone);
      let canceled = 0;
      if (ids.length > 0) {
        const up = await c.query<{ id: string }>(
          `UPDATE lead_sequence_sends SET status='canceled', note='광고 수신거부'
            WHERE status='queued' AND brand_id = ANY($1::uuid[]) RETURNING id`, [ids]);
        canceled = up.rowCount ?? up.rows.length;
      }

      return {
        ok: true,
        already: repeat === targets.length && targets.length > 0,
        channels: targets.map((t) => t.kind),
        canceled,
      };
    });
  } catch (e) {
    // 공개 화면에는 DB 원문을 돌려주지 않는다. 원인은 서버 로그에만.
    console.error("[ad-optout] confirm failed:", (e as Error).message);
    return { ok: false, error: "지금은 처리할 수 없습니다. 잠시 후 다시 시도해 주세요." };
  }
}

// ── 화면 표시 ────────────────────────────────────────────────
export interface AdOptOutRow {
  kind: AddrKind; addr_masked: string; opted_out_at: string; source: string; confirm_count: number;
}
/** 브랜드의 광고 수신거부 상태(수단별). 조회 실패는 예외로 올린다. */
export async function brandAdOptOuts(brand: { id: string; email?: string | null; phone?: string | null }): Promise<AdOptOutRow[]> {
  const email = normalizeAddr("email", brand.email ?? "");
  const phone = normalizeAddr("phone", brand.phone ?? "");
  if (!email && !phone) return [];
  return query<AdOptOutRow>(
    `SELECT kind, addr_masked, opted_out_at::text AS opted_out_at, source, confirm_count
       FROM ad_optouts
      WHERE purpose=$1 AND ((kind='email' AND addr=$2) OR (kind='phone' AND addr=$3))
      ORDER BY opted_out_at DESC`, [AD_PURPOSE, email, phone]);
}

/** 여러 대상의 수신거부 여부를 한 번에(목록 화면용). 실패 시 빈 맵(표시만 생략). */
export async function adOptOutMap(pairs: { key: string; email?: string | null; phone?: string | null }[]):
  Promise<Map<string, { kind: string; at: string }[]>> {
  const out = new Map<string, { kind: string; at: string }[]>();
  const emails = [...new Set(pairs.map((p) => normalizeAddr("email", p.email ?? "")).filter(Boolean))];
  const phones = [...new Set(pairs.map((p) => normalizeAddr("phone", p.phone ?? "")).filter(Boolean))];
  if (emails.length === 0 && phones.length === 0) return out;
  const rows = await query<{ kind: string; addr: string; opted_out_at: string }>(
    `SELECT kind, addr, opted_out_at::text AS opted_out_at FROM ad_optouts
      WHERE purpose=$1 AND ((kind='email' AND addr = ANY($2::text[])) OR (kind='phone' AND addr = ANY($3::text[])))`,
    [AD_PURPOSE, emails, phones]).catch(() => []);
  for (const p of pairs) {
    const e = normalizeAddr("email", p.email ?? ""), ph = normalizeAddr("phone", p.phone ?? "");
    const hit = rows.filter((r) => (r.kind === "email" && r.addr === e) || (r.kind === "phone" && r.addr === ph));
    if (hit.length) out.set(p.key, hit.map((h) => ({ kind: h.kind, at: h.opted_out_at })));
  }
  return out;
}

// ── 명단 관리(관리자) ────────────────────────────────────────
//   담당자가 전화·메일로 받은 거부 요청을 직접 넣고, 잘못 넣은 건을 되돌릴 수 있게 한다.
//   고객이 링크로 누른 기록과 섞이지 않게 source 로 구분하고, 바꾼 사람·사유를 이력에 남긴다.
export const OPTOUT_ADMIN_MIGRATION = "0112_ad_optout_admin.sql";

/** 이력에 남길 대조용 지문. 원문 주소를 다시 적지 않으면서 같은 주소인지 볼 수 있게 한다. */
export function addrFingerprint(kind: AddrKind, addr: string): string {
  const norm = normalizeAddr(kind, addr);
  if (!norm) return "";
  return createHash("sha256").update(`${kind}:${norm}`).digest("hex").slice(0, 32);
}

async function logOptOutEvent(
  action: "add" | "remove", kind: AddrKind, addr: string, reason: string, actor: string,
): Promise<void> {
  await query(
    `INSERT INTO ad_optout_events (action, kind, addr_masked, addr_fingerprint, reason, actor)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [action, kind, maskAddr(kind, addr), addrFingerprint(kind, addr),
      reason.slice(0, 300), actor.slice(0, 120)]).catch(() => {});
}

export interface OptOutListRow {
  id: string; kind: string; addr_masked: string; source: string; note: string;
  brand_id: string | null; brand_name: string | null;
  opted_out_at: string; last_confirm_at: string; confirm_count: number;
}
export interface OptOutList { rows: OptOutListRow[]; total: number; page: number; pageSize: number; pages: number }

/**
 * 거부 명단 조회(관리자). 원문 주소는 돌려주지 않는다 — 화면에는 마스킹 값만 쓴다.
 *   검색은 원문 주소를 정규화해 정확히 일치하는 건만 찾는다(부분 검색으로 명단을 훑을 수 없게).
 */
export async function listOptOuts(
  opts: { q?: string; kind?: string; page?: number; pageSize?: number } = {},
): Promise<OptOutList> {
  const pageSize = Math.min(200, Math.max(10, opts.pageSize ?? 50));
  const page = Math.max(1, Math.floor(opts.page ?? 1));
  const where: string[] = ["o.purpose = $1"];
  const vals: unknown[] = [AD_PURPOSE];

  if (opts.kind === "email" || opts.kind === "phone") {
    where.push(`o.kind = $${vals.length + 1}`); vals.push(opts.kind);
  }
  const q = (opts.q ?? "").trim();
  if (q) {
    // 입력을 이메일·전화 양쪽으로 정규화해 "정확히 같은 주소"만 찾는다.
    //   정규화 결과가 빈 쪽은 조건에서 빼고, 양쪽이 다 비면 아무것도 찾지 않는다.
    //   (빈 문자열·NUL 같은 대체값을 넣으면 Postgres 가 거부하거나 엉뚱한 행이 걸린다)
    const parts: string[] = [];
    for (const [kind, addr] of [
      ["email", normalizeAddr("email", q)],
      ["phone", normalizeAddr("phone", q)],
    ] as const) {
      if (!addr) continue;
      vals.push(addr);
      parts.push(`(o.kind='${kind}' AND o.addr = $${vals.length})`);
    }
    where.push(parts.length ? `(${parts.join(" OR ")})` : "FALSE");
  }
  const cond = `WHERE ${where.join(" AND ")}`;
  const cnt = await queryOne<{ n: string }>(`SELECT count(*)::text AS n FROM ad_optouts o ${cond}`, vals);
  const total = Number(cnt?.n ?? "0");
  const rows = await query<OptOutListRow>(
    `SELECT o.id::text AS id, o.kind, o.addr_masked, o.source, o.note,
            o.brand_id::text AS brand_id, b.brand_name,
            o.opted_out_at::text AS opted_out_at, o.last_confirm_at::text AS last_confirm_at,
            o.confirm_count
       FROM ad_optouts o
       LEFT JOIN brands b ON b.id = o.brand_id
       ${cond}
      ORDER BY o.last_confirm_at DESC
      LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`, vals);
  return { rows, total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)) };
}

export interface OptOutCounts { total: number; email: number; phone: number; bySource: Record<string, number> }
export async function optOutCounts(): Promise<OptOutCounts> {
  const rows = await query<{ kind: string; source: string; n: string }>(
    `SELECT kind, source, count(*)::text AS n FROM ad_optouts
      WHERE purpose=$1 GROUP BY kind, source`, [AD_PURPOSE]);
  const out: OptOutCounts = { total: 0, email: 0, phone: 0, bySource: {} };
  for (const r of rows) {
    const n = Number(r.n);
    out.total += n;
    if (r.kind === "email") out.email += n; else out.phone += n;
    out.bySource[r.source] = (out.bySource[r.source] ?? 0) + n;
  }
  return out;
}

export interface OptOutAdminResult { ok: boolean; error?: string; note?: string; added?: number }

/**
 * 수동 등록 — 담당자가 전화·메일로 받은 거부 요청을 명단에 넣는다.
 *   이미 있으면 새로 만들지 않고 "이미 등록됨"으로 알린다(상태는 그대로).
 */
export async function addOptOutManual(
  input: { value: string; reason?: string }, actor: string,
): Promise<OptOutAdminResult> {
  const raw = (input.value ?? "").trim();
  if (!raw) return { ok: false, error: "이메일 또는 휴대폰 번호를 입력하세요." };

  // 입력 하나를 이메일인지 전화인지 판별한다. 둘 다 아니면 거절.
  const looksEmail = raw.includes("@");
  const kind: AddrKind = looksEmail ? "email" : "phone";
  const addr = normalizeAddr(kind, raw);
  if (!addr) return { ok: false, error: "형식을 확인하세요(이메일 또는 숫자 9자리 이상 휴대폰)." };
  if (kind === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(addr)) {
    return { ok: false, error: "이메일 형식을 확인하세요." };
  }
  if (kind === "phone" && addr.length < 9) return { ok: false, error: "휴대폰 번호를 확인하세요." };

  const reason = (input.reason ?? "").trim();
  try {
    const r = await queryOne<{ inserted: boolean }>(
      `INSERT INTO ad_optouts (purpose, kind, addr, addr_masked, source, note)
       VALUES ($1,$2,$3,$4,'admin',$5)
       ON CONFLICT ON CONSTRAINT ad_optouts_addr_uniq DO UPDATE
         SET last_confirm_at = now(),
             confirm_count = ad_optouts.confirm_count + 1,
             note = CASE WHEN EXCLUDED.note <> '' THEN EXCLUDED.note ELSE ad_optouts.note END
       RETURNING (xmax = 0) AS inserted`,
      [AD_PURPOSE, kind, addr, maskAddr(kind, addr), reason.slice(0, 300)]);
    if (!r) return { ok: false, error: "등록하지 못했습니다." };
    await logOptOutEvent("add", kind, addr, reason || "관리자 수동 등록", actor);
    return r.inserted
      ? { ok: true, added: 1, note: `${maskAddr(kind, addr)} 를 거부 명단에 넣었습니다.` }
      : { ok: true, added: 0, note: `${maskAddr(kind, addr)} 는 이미 거부 명단에 있습니다.` };
  } catch (e) {
    return { ok: false, error: `등록 실패 — ${(e as Error).message.slice(0, 160)}` };
  }
}

/**
 * 해제 — 잘못 넣은 건을 되돌린다.
 *   고객이 직접 누른 기록(source='link')은 해제하지 않는다. 사람의 의사표시를 관리자가 뒤집지 않는다.
 *   지우기 전에 이력을 남긴다.
 */
export async function removeOptOut(id: string, reason: string, actor: string): Promise<OptOutAdminResult> {
  if (!reason.trim()) return { ok: false, error: "해제 사유를 적어주세요." };
  try {
    const row = await queryOne<{ kind: string; addr: string; source: string }>(
      "SELECT kind, addr, source FROM ad_optouts WHERE id=$1::uuid", [id]);
    if (!row) return { ok: false, error: "명단에서 찾지 못했습니다." };
    if (row.source === "link") {
      return { ok: false, error: "고객이 직접 수신거부한 건은 해제할 수 없습니다." };
    }
    await logOptOutEvent("remove", row.kind as AddrKind, row.addr, reason, actor);
    await query("DELETE FROM ad_optouts WHERE id=$1::uuid", [id]);
    return { ok: true, note: `${maskAddr(row.kind as AddrKind, row.addr)} 를 거부 명단에서 뺐습니다.` };
  } catch (e) {
    return { ok: false, error: `해제 실패 — ${(e as Error).message.slice(0, 160)}` };
  }
}

export interface OptOutEventRow {
  id: string; action: string; kind: string; addr_masked: string;
  reason: string; actor: string; at: string;
}
export async function listOptOutEvents(limit = 50): Promise<OptOutEventRow[]> {
  return query<OptOutEventRow>(
    `SELECT id::text AS id, action, kind, addr_masked, reason, actor, at::text AS at
       FROM ad_optout_events ORDER BY at DESC LIMIT $1`, [Math.min(200, Math.max(1, limit))]);
}

// ── 표 존재 확인 ─────────────────────────────────────────────
//   마이그레이션이 아직 안 들어갔으면 화면에 빈 명단을 보여주지 않고 그대로 알린다.
//   (명단이 비었다고 오해하면 보내지 말아야 할 사람에게 보내게 된다)
export interface OptOutSchemaState { ready: boolean; missing: string[]; error?: string }
export async function optOutSchemaState(): Promise<OptOutSchemaState> {
  const need = ["ad_optouts", "ad_recipients", "ad_optout_events"];
  try {
    const rows = await query<{ t: string; ok: boolean }>(
      `SELECT t, to_regclass('public.' || t) IS NOT NULL AS ok
         FROM unnest($1::text[]) AS t`, [need]);
    const missing = need.filter((t) => !rows.find((r) => r.t === t && r.ok));
    return { ready: missing.length === 0, missing };
  } catch (e) {
    return { ready: false, missing: need, error: (e as Error).message.slice(0, 160) };
  }
}

// ── 수동 일괄 등록 ───────────────────────────────────────────
/** 한 줄에 하나씩(또는 쉼표로) 적은 주소를 차례로 넣는다. 한 건이 실패해도 나머지는 계속한다. */
export interface BulkOptOutResult {
  ok: boolean;
  added: number; already: number;
  failed: { input: string; error: string }[];
  note: string;
}
export async function addOptOutsBulk(
  raw: string, reason: string, actor: string,
): Promise<BulkOptOutResult> {
  const items = [...new Set(
    (raw ?? "").split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean),
  )].slice(0, 200);
  if (items.length === 0) {
    return { ok: false, added: 0, already: 0, failed: [], note: "", };
  }
  let added = 0, already = 0;
  const failed: { input: string; error: string }[] = [];
  for (const it of items) {
    const r = await addOptOutManual({ value: it, reason }, actor);
    if (!r.ok) {
      // 입력 원문을 그대로 되돌려주지 않는다 — 어디가 틀렸는지만 보이게 가린다.
      const looksEmail = it.includes("@");
      failed.push({ input: maskAddr(looksEmail ? "email" : "phone", it) || "(형식 불명)", error: r.error ?? "실패" });
    } else if (r.added) added += 1;
    else already += 1;
  }
  return {
    ok: failed.length < items.length,
    added, already, failed,
    note: `새로 등록 ${added}건 · 이미 있음 ${already}건 · 실패 ${failed.length}건`,
  };
}
