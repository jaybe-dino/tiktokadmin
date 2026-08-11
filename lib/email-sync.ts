// Gmail 수집 매칭·부수효과 (09-A). 공용 메일함 전체 수집 — 매칭분은 브랜드 연결, 미매칭은 brand_id NULL 로 저장.
import { query, queryOne } from "./db";
import { normalizeEmail, urlHost } from "./dedup";

/** 이메일 주소에서 도메인 추출(소문자). */
export function emailDomain(addr: string): string | null {
  const e = normalizeEmail(addr);
  const at = e?.lastIndexOf("@") ?? -1;
  return at >= 0 ? e!.slice(at + 1) : null;
}

/**
 * 참여 주소(from+to+cc) → brand_id. 매칭 순서(09 A-3):
 *   1) brand_email_aliases  2) brands.email  3) 도메인==brand_url 호스트 도메인
 * 실패 시 null → 저장 안 함(폐기).
 */
export async function matchBrandByAddresses(addrs: string[]): Promise<{ brandId: string; via: "alias" | "email" | "domain" } | null> {
  const emails = addrs.map((a) => normalizeEmail(a)).filter(Boolean) as string[];
  if (emails.length === 0) return null;

  // 1) 별칭
  const alias = await queryOne<{ brand_id: string }>(
    "SELECT brand_id FROM brand_email_aliases WHERE lower(email)=ANY($1) LIMIT 1", [emails]);
  if (alias) return { brandId: alias.brand_id, via: "alias" };

  // 2) brands.email
  const byEmail = await queryOne<{ id: string }>(
    "SELECT id FROM brands WHERE lower(email)=ANY($1) LIMIT 1", [emails]);
  if (byEmail) return { brandId: byEmail.id, via: "email" };

  // 3) 도메인 보조 (개인 도메인 gmail/naver 등 제외)
  const domains = new Set(
    (emails.map(emailDomain).filter(Boolean) as string[]).filter((d) => !GENERIC_DOMAINS.has(d)));
  if (domains.size > 0) {
    const rows = await query<{ id: string; brand_url: string }>(
      "SELECT id, brand_url FROM brands WHERE brand_url<>'' AND brand_url IS NOT NULL");
    for (const r of rows) {
      const host = urlHost(r.brand_url);
      if (!host) continue;
      for (const d of domains) {
        if (host === d || host.endsWith("." + d) || d.endsWith("." + host)) {
          return { brandId: r.id, via: "domain" };
        }
      }
    }
  }
  return null;
}

const GENERIC_DOMAINS = new Set([
  "gmail.com", "naver.com", "daum.net", "hanmail.net", "kakao.com", "nate.com",
  "outlook.com", "hotmail.com", "yahoo.com", "icloud.com",
]);

export interface IncomingEmail {
  gmailMsgId: string; threadId: string; direction: "in" | "out";
  ownerEmail: string; fromAddr: string; toAddrs: string[];
  subject: string; snippet: string; bodyText?: string;
  hasAttachment: boolean; sentAt: string;
}

/**
 * 메일 저장 + 브랜드 매칭분에 한해 부수효과(contact_logged·last_contact_at·무응답 해제). 멱등.
 *   brandId=null(미매칭)이면 메시지만 저장하고 부수효과는 건너뛴다(메일함에서 수동 연결 대상).
 */
export async function ingestEmailMessage(brandId: string | null, m: IncomingEmail): Promise<boolean> {
  const dup = await queryOne<{ id: string }>("SELECT id FROM email_messages WHERE gmail_msg_id=$1", [m.gmailMsgId]);
  if (dup) return false;

  await query(
    `INSERT INTO email_messages (brand_id, gmail_msg_id, thread_id, direction, owner_email,
       from_addr, to_addrs, subject, snippet, body_text, has_attachment, sent_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [brandId, m.gmailMsgId, m.threadId, m.direction, m.ownerEmail, m.fromAddr, m.toAddrs,
     m.subject, m.snippet, m.bodyText ?? null, m.hasAttachment, m.sentAt]);

  // 미매칭 메일은 저장만 (브랜드 부수효과 없음)
  if (!brandId) return true;

  // contact_logged + last_contact_at (in/out 모두)
  await query(
    `INSERT INTO brand_sources (brand_id, site, event, payload, occurred_at)
     VALUES ($1,'gmail','contact_logged',$2,$3)`,
    [brandId, JSON.stringify({ channel: "email", direction: m.direction }), m.sentAt]);
  await query(
    "UPDATE brands SET last_contact_at=GREATEST(COALESCE(last_contact_at,'epoch'),$2::timestamptz) WHERE id=$1",
    [brandId, m.sentAt]);

  // 브랜드가 답장(in) → 해당 스레드 무응답 알림 해제
  if (m.direction === "in") {
    await query(
      "UPDATE alerts SET resolved_at=now() WHERE brand_id=$1 AND kind='no_reply' AND resolved_at IS NULL",
      [brandId]);
  }
  // 우리가 회신(out) → '회신 필요'(수신 메일 전달) 알림 해제.
  if (m.direction === "out") {
    await query(
      "UPDATE alerts SET resolved_at=now(), resolved_by='email' WHERE brand_id=$1 AND kind IN ('inbound_fwd','reply_needed') AND resolved_at IS NULL",
      [brandId]);
  }
  return true;
}

/** out 후 N영업일 내 in 없는 브랜드 → no_reply 알림(무응답 감지 cron). */
export async function detectNoReply(businessDays = 3): Promise<number> {
  // 마지막 out 이 in 보다 최신이고 businessDays 초과인 스레드.
  const rows = await query<{ brand_id: string }>(
    `WITH last_dir AS (
       SELECT brand_id,
              max(sent_at) FILTER (WHERE direction='out') AS last_out,
              max(sent_at) FILTER (WHERE direction='in')  AS last_in
         FROM email_messages GROUP BY brand_id)
     SELECT brand_id FROM last_dir
      WHERE last_out IS NOT NULL
        AND (last_in IS NULL OR last_out > last_in)
        AND last_out < now() - ($1 || ' days')::interval`,
    [String(businessDays + 2)]); // 주말 여유 보정(간이)
  let n = 0;
  for (const r of rows) {
    const existing = await queryOne<{ id: string }>(
      "SELECT id FROM alerts WHERE brand_id=$1 AND kind='no_reply' AND resolved_at IS NULL", [r.brand_id]);
    if (existing) continue;
    await query(
      `INSERT INTO alerts (brand_id, kind, tier, message) VALUES ($1,'no_reply',1,$2)`,
      [r.brand_id, "무응답 — 재접촉 또는 다음 액션 제안"]);
    n++;
  }
  return n;
}
