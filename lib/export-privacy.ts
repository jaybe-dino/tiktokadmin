import { query } from "./db";
import { normalizeAddr } from "./ad-optout";

export interface ExportContact {
  email?: string | null;
  phone?: string | null;
  brand_id?: string | null;
  msg_opt_out?: boolean;
  consent_ads_withdrawn_at?: string | null;
}

/** Every export rechecks the live suppression list. Never catch a failed lookup as []. */
export async function excludeOptedOut<T extends ExportContact>(rows: T[]): Promise<T[]> {
  let blocked: { kind: string; addr: string | null; brand_id: string | null }[];
  try {
    blocked = await query(`
      SELECT o.kind, o.addr, o.brand_id FROM ad_optouts o WHERE o.purpose='marketing'
      UNION ALL
      SELECT 'email', r.email, COALESCE(o.brand_id,r.brand_id)
        FROM ad_optouts o JOIN ad_recipients r ON r.id=o.recipient_id WHERE o.purpose='marketing'
      UNION ALL
      SELECT 'phone', r.phone, COALESCE(o.brand_id,r.brand_id)
        FROM ad_optouts o JOIN ad_recipients r ON r.id=o.recipient_id WHERE o.purpose='marketing'
      UNION ALL
      SELECT 'email', b.email, b.id FROM brands b WHERE b.msg_opt_out=true
      UNION ALL
      SELECT 'phone', b.phone, b.id FROM brands b WHERE b.msg_opt_out=true
    `);
  } catch {
    throw new Error("수신거부 명단 확인 실패 — 내보내기를 중단했습니다.");
  }
  const emails = new Set(blocked.filter(r => r.kind === "email").map(r => normalizeAddr("email", r.addr ?? "")).filter(Boolean));
  const phones = new Set(blocked.filter(r => r.kind === "phone").map(r => normalizeAddr("phone", r.addr ?? "")).filter(Boolean));
  const brands = new Set(blocked.map(r => r.brand_id).filter(Boolean));
  return rows.filter(r => !r.msg_opt_out && !r.consent_ads_withdrawn_at
    && !(r.brand_id && brands.has(r.brand_id))
    && !emails.has(normalizeAddr("email", r.email ?? ""))
    && !phones.has(normalizeAddr("phone", r.phone ?? "")));
}
