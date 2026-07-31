// CS 티켓 (15 §5 경량). sla_due = 생성+24h(urgent 4h).
import { query } from "./db";

export interface CsTicket {
  id: string; brand_id: string | null; brand_name: string | null; channel: string;
  country: string; subject: string; body: string; priority: string; status: string;
  sla_due: string | null; assignee: string | null; resolved_at: string | null; created_at: string;
}

export function listTickets(status?: string): Promise<CsTicket[]> {
  const where = status ? "WHERE t.status=$1" : "WHERE t.status NOT IN ('resolved','closed')";
  const params = status ? [status] : [];
  return query<CsTicket>(
    `SELECT t.*, b.brand_name FROM cs_tickets t LEFT JOIN brands b ON b.id=t.brand_id
      ${where} ORDER BY
        CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
        t.sla_due ASC NULLS LAST`, params);
}

export async function createTicket(t: {
  brand_id?: string | null; channel: string; subject: string; body?: string;
  priority?: string; country?: string; assignee?: string;
}): Promise<string> {
  const hours = t.priority === "urgent" ? 4 : 24;
  const row = await query<{ id: string }>(
    `INSERT INTO cs_tickets (brand_id, channel, subject, body, priority, country, assignee, sla_due)
     VALUES ($1,$2,$3,$4,$5,$6,$7, now() + ($8 || ' hours')::interval) RETURNING id`,
    [t.brand_id ?? null, t.channel, t.subject, t.body ?? "", t.priority ?? "normal",
     t.country ?? "", t.assignee ?? null, String(hours)]);
  return row[0].id;
}

export async function setTicketStatus(id: string, status: string): Promise<void> {
  const resolved = status === "resolved" || status === "closed" ? ", resolved_at=now()" : "";
  await query(`UPDATE cs_tickets SET status=$2${resolved} WHERE id=$1`, [id, status]);
}
