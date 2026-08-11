import { query, queryOne } from "./db";
import { normalizeEmail } from "./dedup";
import { touchLastContact } from "./repo/brands";
import type { Role } from "./types";

// 이메일 → 고객 카드 매칭·기록 (M9).

export interface BrandEmail {
  id: string;
  brand_id: string;
  direction: "in" | "out" | "unknown";
  from_addr: string | null;
  to_addr: string | null;
  subject: string | null;
  snippet: string | null;
  owner_part: string | null;
  owner_id: string | null;
  message_id: string | null;
  occurred_at: string;
  linked_by: string | null;
  created_at: string;
  source?: "linked" | "sync"; // linked=수기 태깅(brand_emails), sync=공식 메일함 자동수집(email_messages)
}

export async function listBrandEmails(brandId: string): Promise<BrandEmail[]> {
  return query<BrandEmail>(
    "SELECT * FROM brand_emails WHERE brand_id=$1 ORDER BY occurred_at DESC LIMIT 100",
    [brandId],
  );
}

/**
 * 브랜드 이메일 커뮤 통합 — 수기 태깅(brand_emails) + 공식 메일함 자동수집(email_messages).
 *   두 소스를 합쳐 최신순으로. sync 행 id 는 'mm-<uuid>' 로 구분(삭제 대상은 linked 만).
 *   같은 메시지가 양쪽에 있으면(message_id=gmail_msg_id) 중복 제거.
 */
export async function listBrandComms(brandId: string): Promise<BrandEmail[]> {
  const [linked, synced] = await Promise.all([
    query<BrandEmail>(
      "SELECT * FROM brand_emails WHERE brand_id=$1 ORDER BY occurred_at DESC LIMIT 100",
      [brandId],
    ).catch(() => [] as BrandEmail[]),
    query<{ id: string; direction: string; from_addr: string | null; to_addrs: string[] | null; subject: string | null; snippet: string | null; gmail_msg_id: string | null; sent_at: string }>(
      `SELECT id, direction, from_addr, to_addrs, subject, snippet, gmail_msg_id, sent_at
         FROM email_messages WHERE brand_id=$1 ORDER BY sent_at DESC LIMIT 100`,
      [brandId],
    ).catch(() => []),
  ]);

  const linkedMsgIds = new Set(linked.map((l) => l.message_id).filter(Boolean) as string[]);
  const syncRows: BrandEmail[] = synced
    .filter((m) => !(m.gmail_msg_id && linkedMsgIds.has(m.gmail_msg_id)))
    .map((m) => ({
      id: `mm-${m.id}`,
      brand_id: brandId,
      direction: (m.direction === "in" || m.direction === "out" ? m.direction : "unknown") as "in" | "out" | "unknown",
      from_addr: m.from_addr,
      to_addr: (m.to_addrs ?? []).join(", ") || null,
      subject: m.subject,
      snippet: m.snippet,
      owner_part: null,
      owner_id: null,
      message_id: m.gmail_msg_id,
      occurred_at: m.sent_at,
      linked_by: null,
      created_at: m.sent_at,
      source: "sync" as const,
    }));

  const linkedRows: BrandEmail[] = linked.map((l) => ({ ...l, source: "linked" as const }));
  return [...linkedRows, ...syncRows]
    .sort((a, b) => (a.occurred_at < b.occurred_at ? 1 : -1))
    .slice(0, 120);
}

const ROLE_PART: Record<Role, string> = {
  intake: "intake", sales: "sales", onboard: "onboard", ads: "ads", settle: "settle",
  lead: "lead", exec: "exec",
};

/** 참여 이메일 목록 → (고객 brand_id, 담당 파트/담당자) 판정. */
async function resolveMatch(participants: string[]): Promise<{
  brandId: string | null;
  ownerId: string | null;
  ownerPart: string | null;
}> {
  const emails = participants.map(normalizeEmail).filter(Boolean) as string[];
  if (emails.length === 0) return { brandId: null, ownerId: null, ownerPart: null };

  // 담당자(어드민) 이메일과 겹치는지
  const owner = await queryOne<{ id: string; role: Role }>(
    "SELECT id, role FROM admin_users WHERE id = ANY($1) AND active LIMIT 1",
    [emails],
  );

  // 고객 매칭: 담당자 아닌 이메일로 brands.email 매칭
  const ownerEmail = owner?.id;
  const custEmails = emails.filter((e) => e !== ownerEmail);
  const brand = await queryOne<{ id: string }>(
    "SELECT id FROM brands WHERE email = ANY($1) LIMIT 1",
    [custEmails.length ? custEmails : emails],
  );

  return {
    brandId: brand?.id ?? null,
    ownerId: owner?.id ?? null,
    ownerPart: owner ? ROLE_PART[owner.role] : null,
  };
}

export interface IncomingEmail {
  from?: string;
  to?: string | string[];
  cc?: string | string[];
  subject?: string;
  text?: string;
  message_id?: string;
  date?: string;
  direction?: "in" | "out";
  brand_id?: string; // 직접 지정(수동 붙여넣기) 시
}

function asList(v?: string | string[]): string[] {
  if (!v) return [];
  return Array.isArray(v) ? v : v.split(/[,;]/).map((s) => s.trim());
}

/** 이메일 한 건을 고객 카드에 기록. 매칭 실패 시 저장 안 함. */
export async function linkEmail(
  e: IncomingEmail,
  linkedBy: string,
): Promise<{ ok: boolean; brand_id?: string; matched: boolean }> {
  const participants = [e.from ?? "", ...asList(e.to), ...asList(e.cc)].filter(Boolean);

  let brandId = e.brand_id ?? null;
  let ownerId: string | null = null;
  let ownerPart: string | null = null;
  if (!brandId) {
    const m = await resolveMatch(participants);
    brandId = m.brandId;
    ownerId = m.ownerId;
    ownerPart = m.ownerPart;
  } else {
    const m = await resolveMatch(participants);
    ownerId = m.ownerId;
    ownerPart = m.ownerPart;
  }

  if (!brandId) return { ok: true, matched: false };

  const fromNorm = normalizeEmail(e.from);
  const owner = await queryOne<{ id: string }>("SELECT id FROM admin_users WHERE id=$1", [fromNorm]);
  const direction = e.direction ?? (owner ? "out" : "in");
  const snippet = (e.text ?? "").replace(/\s+/g, " ").trim().slice(0, 600);

  await query(
    `INSERT INTO brand_emails
       (brand_id, direction, from_addr, to_addr, subject, snippet, owner_part, owner_id, message_id, occurred_at, linked_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, COALESCE($10::timestamptz, now()), $11)
     ON CONFLICT (brand_id, message_id) DO NOTHING`,
    [
      brandId, direction, e.from ?? null, asList(e.to).join(", ") || null,
      e.subject ?? null, snippet, ownerPart, ownerId, e.message_id ?? null,
      e.date ?? null, linkedBy,
    ],
  );

  await touchLastContact(brandId, e.date);
  await query(
    "UPDATE alerts SET resolved_at=now(), resolved_by='email' WHERE brand_id=$1 AND kind='stale' AND resolved_at IS NULL",
    [brandId],
  );

  return { ok: true, brand_id: brandId, matched: true };
}
