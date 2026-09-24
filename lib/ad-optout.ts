// 광고(marketing) 수신거부 — 수신자 단위.
//   · 광고 목적 발송에만 적용한다. 계약·일정·거래 등 service 목적은 이 모듈을 거치지 않는다.
//   · 기존 전체 수신거부(brands.msg_opt_out)는 그대로 살아 있고, 둘 중 하나라도 켜져 있으면 광고는 나가지 않는다.
//   · 링크 토큰은 DB 에 저장한 난수다(ad_recipients.token).
//     로그인 세션 비밀키와 무관하므로 인증 키를 바꿔도 고객의 수신거부 의사가 사라지지 않는다.
//   · 토큰 → 수신자(이메일·전화 쌍)를 정확히 찾는다. 전수 조회·첫 매치 추정을 하지 않는다.
import { randomBytes } from "node:crypto";
import { query, queryOne, tx } from "./db";
import { env } from "./env";   // adminUrl(고정 origin)만 사용 — 서명 비밀키에 의존하지 않는다

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

/** 고정 origin(admin.glovek.space) 의 수신거부 링크 접두 — 우리 링크만 정확히 알아보기 위해. */
export function optoutBase(): string {
  const base = (env.adminUrl || "https://admin.glovek.space").replace(/\/$/, "");
  return `${base}${OPTOUT_PATH}`;
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

/** 문자 본문 + 무료수신거부 한 줄. 본문은 그대로 두고 끝에만 붙인다. */
export function withSmsOptout(body: string, url: string): string {
  return ensureLink(body, url, (b) => `${b.replace(/\s+$/, "")}\n${SMS_OPTOUT_PREFIX}${url}`);
}

/** 메일 본문 + 수신거부 안내. 광고 중단과 서비스 안내가 다름을 함께 적는다. */
export function withMailOptout(body: string, url: string): string {
  return ensureLink(body, url, (b) => [
    b.replace(/\s+$/, ""),
    "",
    "──────────",
    `${MAIL_OPTOUT_LEAD}: ${url}`,
    "수신거부는 광고에만 적용되며, 계약·일정 등 서비스 안내는 계속 보내드립니다.",
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
 * 광고 발송 가능 여부. 문자·메일 주소를 함께 조회해 한쪽 거부로 다른 쪽이 우회되지 않게 한다.
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
    return {
      smsAllowed: Boolean(phone) && !smsBlocked,
      emailAllowed: Boolean(email) && !mailBlocked,
      reason: smsBlocked || mailBlocked ? "광고 수신거부" : undefined,
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

/** 전화번호 뒷자리로 후보를 좁힌 뒤 정규화해 정확히 대조한다(표기 차이 흡수). */
async function brandIdsFor(email: string, phone: string): Promise<string[]> {
  const tail = phone ? phone.slice(-8) : "";
  const rows = await query<{ id: string; email: string | null; phone: string | null }>(
    `SELECT id, email, phone FROM brands
      WHERE (NULLIF($1,'') IS NOT NULL AND lower(email)=$1)
         OR (NULLIF($2,'') IS NOT NULL AND phone LIKE '%' || $2 || '%')`,
    [email, tail]);
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
        `SELECT id, email, phone FROM brands
          WHERE (NULLIF($1,'') IS NOT NULL AND lower(email)=$1)
             OR (NULLIF($2,'') IS NOT NULL AND phone LIKE '%' || $2 || '%')`,
        [who!.email, who!.phone ? who!.phone.slice(-8) : ""]);
      const ids = cand.rows
        .filter((b) => (who!.email && normalizeAddr("email", b.email ?? "") === who!.email)
                    || (who!.phone && normalizeAddr("phone", b.phone ?? "") === who!.phone))
        .map((b) => b.id);
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
