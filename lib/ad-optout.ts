// 광고(marketing) 수신거부 — 수신자 단위.
//   · 광고 목적 발송에만 적용한다. 계약·일정·거래 등 service 목적은 이 모듈을 거치지 않는다.
//     (광고를 service 로 우회시키지 않기 위해, 광고 경로에서만 명시적으로 호출한다)
//   · 기존 전체 수신거부(brands.msg_opt_out)는 그대로 살아 있고, 둘 중 하나라도 켜져 있으면 광고는 나가지 않는다.
//   · 주소는 평문으로 저장하지 않는다 — 서버 비밀키 기반 해시 + 마스킹만 저장한다.
//   · 링크 토큰은 주소에서 결정되는 HMAC 이라 연속 ID 추측이 불가능하고, 위조하려면 서버 비밀키가 필요하다.
import { createHmac, timingSafeEqual } from "node:crypto";
import { query, queryOne } from "./db";
import { env } from "./env";

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

// ── 토큰 ─────────────────────────────────────────────────────
const HASH_LEN = 24;   // 96비트 — 이 규모에서 충돌 걱정 없음
const SIG_LEN = 10;

function hmacHex(subject: string, value: string): string {
  return createHmac("sha256", env.sessionSecret).update(`${subject}:${value}`).digest("hex");
}

/** 주소 → 저장·조회용 해시(평문 아님). 빈 주소는 빈 문자열. */
export function addrHash(kind: AddrKind, raw: string): string {
  const v = normalizeAddr(kind, raw);
  return v ? hmacHex("adopt", `${kind}:${v}`).slice(0, HASH_LEN) : "";
}

const kindChar = (k: AddrKind) => (k === "email" ? "e" : "p");
const charKind = (c: string): AddrKind | null => (c === "e" ? "email" : c === "p" ? "phone" : null);

/** 수신거부 토큰 — 주소가 드러나지 않고, 서버 비밀키 없이는 만들 수 없다. */
export function mintToken(kind: AddrKind, raw: string): string {
  const h = addrHash(kind, raw);
  if (!h) return "";
  const k = kindChar(kind);
  return `${k}${h}${hmacHex("adoptsig", `${k}${h}`).slice(0, SIG_LEN)}`;
}

/** 토큰 검증 — 형식·서명이 맞을 때만 대상을 돌려준다. 변조·오타는 null. */
export function verifyToken(token: string): { kind: AddrKind; hash: string } | null {
  const t = (token ?? "").trim();
  if (t.length !== 1 + HASH_LEN + SIG_LEN) return null;
  const kind = charKind(t[0]);
  if (!kind) return null;
  const h = t.slice(1, 1 + HASH_LEN);
  if (!/^[0-9a-f]+$/.test(h)) return null;
  const sig = t.slice(1 + HASH_LEN);
  const want = hmacHex("adoptsig", `${t[0]}${h}`).slice(0, SIG_LEN);
  const a = Buffer.from(sig), b = Buffer.from(want);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return { kind, hash: h };
}

/** 고정 origin 의 수신거부 URL. */
export function optoutUrl(kind: AddrKind, raw: string): string {
  const t = mintToken(kind, raw);
  if (!t) return "";
  const base = (env.adminUrl || "https://admin.glovek.space").replace(/\/$/, "");
  return `${base}${OPTOUT_PATH}${t}`;
}

// ── 본문에 수신거부 안내 붙이기 ───────────────────────────────
export const SMS_OPTOUT_PREFIX = "무료수신거부 ";
export const MAIL_OPTOUT_LEAD = "광고 문자·메일 수신을 원하지 않으시면";

/** 이미 수신거부 안내가 들어 있는지 — 중복 부착 방지. */
export function hasOptoutNotice(body: string): boolean {
  const b = body ?? "";
  return b.includes(OPTOUT_PATH) || b.includes(SMS_OPTOUT_PREFIX) || b.includes(MAIL_OPTOUT_LEAD);
}

/** 문자 본문 + 무료수신거부 한 줄. 본문은 그대로 두고 끝에만 붙인다. */
export function withSmsOptout(body: string, url: string): string {
  if (!url || hasOptoutNotice(body)) return body;
  return `${body.replace(/\s+$/, "")}\n${SMS_OPTOUT_PREFIX}${url}`;
}

/** 메일 본문 + 수신거부 안내. 광고 중단과 서비스 안내가 다름을 함께 적는다. */
export function withMailOptout(body: string, url: string): string {
  if (!url || hasOptoutNotice(body)) return body;
  return [
    body.replace(/\s+$/, ""),
    "",
    "──────────",
    `${MAIL_OPTOUT_LEAD}: ${url}`,
    "수신거부는 광고에만 적용되며, 계약·일정 등 서비스 안내는 계속 보내드립니다.",
  ].join("\n");
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
 * 광고 발송 가능 여부. 조회가 실패하면 "차단"으로 처리한다(fail closed) —
 * 수신거부 여부를 모르는 채로 광고를 내보내지 않기 위해서다.
 */
export async function adGate(input: { phone?: string | null; email?: string | null; brandOptOut?: boolean }): Promise<AdGate> {
  if (input.brandOptOut) {
    return { smsAllowed: false, emailAllowed: false, reason: "전체 수신거부(브랜드)" };
  }
  const ph = addrHash("phone", input.phone ?? "");
  const em = addrHash("email", input.email ?? "");
  const hashes = [ph, em].filter(Boolean);
  if (hashes.length === 0) return { smsAllowed: Boolean(input.phone), emailAllowed: Boolean(input.email) };

  try {
    const rows = await query<{ kind: string; addr_hash: string }>(
      `SELECT kind, addr_hash FROM ad_optouts
        WHERE purpose=$1 AND addr_hash = ANY($2::text[])`, [AD_PURPOSE, hashes]);
    const blocked = new Set(rows.map((r) => `${r.kind}:${r.addr_hash}`));
    const smsBlocked = Boolean(ph) && blocked.has(`phone:${ph}`);
    const mailBlocked = Boolean(em) && blocked.has(`email:${em}`);
    return {
      smsAllowed: Boolean(input.phone) && !smsBlocked,
      emailAllowed: Boolean(input.email) && !mailBlocked,
      reason: smsBlocked || mailBlocked ? "광고 수신거부" : undefined,
    };
  } catch (e) {
    // 비밀·주소는 남기지 않는다 — 원인 문구만.
    return { smsAllowed: false, emailAllowed: false, error: `수신거부 확인 실패 — ${(e as Error).message}` };
  }
}

// ── 수신거부 확정 ────────────────────────────────────────────
export interface OptOutResult {
  ok: boolean;
  already?: boolean;
  error?: string;
  /** 같은 고객의 다른 수단까지 함께 막았는지(문자로 거부 → 메일도 중단). */
  channels?: AddrKind[];
  canceled?: number;   // 중단된 남은 광고 예약 수
}

/**
 * 토큰으로 광고 수신거부를 확정한다(POST 전용 경로에서만 호출).
 *   · 같은 고객으로 확인되면 문자·메일 양쪽을 함께 막는다.
 *   · 브랜드의 다른 연락처나 다른 브랜드는 건드리지 않는다.
 *   · 재클릭은 멱등 — 상태는 그대로 두고 확인 횟수만 올린다.
 */
export async function confirmOptOut(token: string, opts: { source?: "link" | "admin" | "qa" } = {}): Promise<OptOutResult> {
  const v = verifyToken(token);
  if (!v) return { ok: false, error: "유효하지 않은 링크입니다." };

  try {
    // 같은 고객의 다른 수단을 찾기 위해 광고를 받은 적 있는 브랜드에서만 대조한다(전수 조회 회피).
    const who = await resolveRecipient(v.kind, v.hash);
    const targets: { kind: AddrKind; hash: string; masked: string }[] = [
      { kind: v.kind, hash: v.hash, masked: who?.[v.kind === "email" ? "emailMasked" : "phoneMasked"] ?? "" },
    ];
    if (who) {
      // 한 채널에서 거부하면 그 고객의 문자·메일 광고를 모두 중단한다.
      if (who.emailHash && who.emailHash !== v.hash) targets.push({ kind: "email", hash: who.emailHash, masked: who.emailMasked });
      if (who.phoneHash && who.phoneHash !== v.hash) targets.push({ kind: "phone", hash: who.phoneHash, masked: who.phoneMasked });
    }

    let inserted = 0;
    for (const t of targets) {
      const r = await queryOne<{ id: string }>(
        `INSERT INTO ad_optouts (purpose, kind, addr_hash, addr_masked, brand_id, source)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (purpose, kind, addr_hash) DO UPDATE
           SET confirm_count = ad_optouts.confirm_count + 1, last_confirm_at = now(),
               addr_masked = COALESCE(NULLIF(EXCLUDED.addr_masked,''), ad_optouts.addr_masked),
               brand_id = COALESCE(ad_optouts.brand_id, EXCLUDED.brand_id)
         RETURNING (xmax = 0) AS id`,   // xmax=0 이면 새로 들어간 행
        [AD_PURPOSE, t.kind, t.hash, t.masked, who?.brandId ?? null, opts.source ?? "link"]);
      if (r) inserted++;
    }

    // 남은 광고 예약 중단 — 이 고객 것만.
    let canceled = 0;
    if (who?.brandId) {
      const rows = await query<{ id: string }>(
        `UPDATE lead_sequence_sends SET status='canceled', note='광고 수신거부'
          WHERE brand_id=$1 AND status='queued' RETURNING id`, [who.brandId]).catch(() => []);
      canceled = rows.length;
    }

    const already = await queryOne<{ n: string }>(
      `SELECT count(*)::text AS n FROM ad_optouts
        WHERE purpose=$1 AND kind=$2 AND addr_hash=$3 AND confirm_count > 1`,
      [AD_PURPOSE, v.kind, v.hash]);

    return {
      ok: true,
      already: Number(already?.n ?? 0) > 0,
      channels: [...new Set(targets.map((t) => t.kind))],
      canceled,
    };
  } catch (e) {
    return { ok: false, error: `처리 중 오류가 발생했습니다 — ${(e as Error).message}` };
  }
}

interface Recipient {
  brandId: string;
  emailHash: string; emailMasked: string;
  phoneHash: string; phoneMasked: string;
}

/**
 * 해시로 수신자를 찾는다 — 해시는 되돌릴 수 없으므로,
 * 광고를 받은 적 있는(=예약이 잡힌) 브랜드의 연락처만 대조한다.
 * 못 찾아도 수신거부 자체는 해시 기준으로 저장되므로 차단은 정상 동작한다.
 */
export async function resolveRecipient(kind: AddrKind, hash: string): Promise<Recipient | null> {
  const rows = await query<{ id: string; email: string | null; phone: string | null }>(
    `SELECT DISTINCT b.id, b.email, b.phone
       FROM brands b
      WHERE (b.email IS NOT NULL AND b.email <> '') OR (b.phone IS NOT NULL AND b.phone <> '')
      LIMIT 20000`).catch(() => []);
  for (const b of rows) {
    const eh = addrHash("email", b.email ?? "");
    const phh = addrHash("phone", b.phone ?? "");
    if ((kind === "email" && eh && eh === hash) || (kind === "phone" && phh && phh === hash)) {
      return {
        brandId: b.id,
        emailHash: eh, emailMasked: maskAddr("email", b.email ?? ""),
        phoneHash: phh, phoneMasked: maskAddr("phone", b.phone ?? ""),
      };
    }
  }
  return null;
}

// ── 화면 표시 ────────────────────────────────────────────────
export interface AdOptOutRow {
  kind: AddrKind; addr_masked: string; opted_out_at: string; source: string; confirm_count: number;
}
/** 브랜드의 광고 수신거부 상태(수단별). 조회 실패는 예외로 올린다. */
export async function brandAdOptOuts(brand: { id: string; email?: string | null; phone?: string | null }): Promise<AdOptOutRow[]> {
  const hashes = [addrHash("email", brand.email ?? ""), addrHash("phone", brand.phone ?? "")].filter(Boolean);
  if (hashes.length === 0) return [];
  return query<AdOptOutRow>(
    `SELECT kind, addr_masked, opted_out_at::text AS opted_out_at, source, confirm_count
       FROM ad_optouts WHERE purpose=$1 AND addr_hash = ANY($2::text[])
      ORDER BY opted_out_at DESC`, [AD_PURPOSE, hashes]);
}
