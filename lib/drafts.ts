// 초안함 (Drafts Inbox) — email_drafts 승인·발송. 발송은 Resend(08 경로).
import { query, queryOne } from "./db";
import { env } from "./env";
import { canSend } from "./lifecycle";

export interface EmailDraft {
  id: string; brand_id: string; brand_name: string; meeting_id: string | null;
  kind: string; to_email: string; subject: string; body_md: string; status: string;
  in_reply_to: string | null; context_summary: string | null; source: string | null;
  created_at: string;
}

export function listDrafts(status = "draft"): Promise<EmailDraft[]> {
  return query<EmailDraft>(
    `SELECT d.*, b.brand_name FROM email_drafts d JOIN brands b ON b.id=d.brand_id
      WHERE d.status=$1 ORDER BY d.created_at DESC LIMIT 100`, [status]);
}

export async function discardDraft(id: string): Promise<void> {
  const d = await queryOne<{ in_reply_to: string | null }>(
    "SELECT in_reply_to FROM email_drafts WHERE id=$1", [id]).catch(() => null);
  await query("UPDATE email_drafts SET status='discarded' WHERE id=$1", [id]);
  // 연결된 수신 메일은 재드래프트 방지 위해 'ignored'(담당자가 발송 안함 판단)
  if (d?.in_reply_to) {
    await query("UPDATE email_messages SET reply_state='ignored' WHERE id=$1", [d.in_reply_to]).catch(() => {});
  }
}

/** 담당자 초안 수정(제목·본문). 발송 전 검토 편집용. */
export async function editDraft(id: string, subject: string, bodyMd: string, editedBy: string): Promise<void> {
  await query("UPDATE email_drafts SET subject=$2, body_md=$3, edited_by=$4 WHERE id=$1 AND status='draft'",
    [id, subject, bodyMd, editedBy]);
}

/**
 * 승인·발송. 광고성이면 수신동의 게이트(17 §5). Resend 미설정 시 approved 로만 표시.
 *   edits 주어지면 발송 전 제목·본문 반영(담당자 수정 후 승인).
 */
export async function approveAndSend(
  id: string, editedBy: string, edits?: { subject?: string; body?: string },
): Promise<{ ok: boolean; error?: string; sent: boolean }> {
  if (edits && (edits.subject !== undefined || edits.body !== undefined)) {
    await query(
      "UPDATE email_drafts SET subject=COALESCE($2,subject), body_md=COALESCE($3,body_md), edited_by=$4 WHERE id=$1 AND status='draft'",
      [id, edits.subject ?? null, edits.body ?? null, editedBy]).catch(() => {});
  }
  const d = await queryOne<EmailDraft>("SELECT * FROM email_drafts WHERE id=$1", [id]);
  if (!d) return { ok: false, error: "초안 없음", sent: false };

  const gate = await canSend(d.brand_id, d.kind, d.to_email);
  if (!gate.ok) return { ok: false, error: gate.reason, sent: false };

  if (!env.resend.apiKey) {
    await query("UPDATE email_drafts SET status='approved', edited_by=$2 WHERE id=$1", [id, editedBy]);
    return { ok: true, sent: false };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${env.resend.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ from: env.resend.from, to: d.to_email, subject: d.subject, text: d.body_md }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.message ?? "발송 실패", sent: false };
    await query("UPDATE email_drafts SET status='sent', edited_by=$2, sent_at=now(), resend_id=$3 WHERE id=$1",
      [id, editedBy, data.id ?? null]);
    // 연결된 수신 메일이 있으면 회신 완료로 표시
    if (d.in_reply_to) {
      await query("UPDATE email_messages SET reply_state='replied' WHERE id=$1", [d.in_reply_to]).catch(() => {});
    }
    // contact_logged(email) 자동 기록
    await query(
      `INSERT INTO brand_sources (brand_id, site, event, payload, occurred_at)
       VALUES ($1,'admin','contact_logged',$2,now())`,
      [d.brand_id, JSON.stringify({ channel: "email", direction: "out", kind: d.kind })]);
    await query("UPDATE brands SET last_contact_at=now() WHERE id=$1", [d.brand_id]);
    return { ok: true, sent: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message, sent: false };
  }
}
