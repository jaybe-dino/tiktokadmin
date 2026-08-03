// 초안함 (Drafts Inbox) — email_drafts 승인·발송. 발송은 Resend(08 경로).
import { query, queryOne } from "./db";
import { env } from "./env";
import { canSend } from "./lifecycle";
import { createShortLink, isDriveUrl } from "./shortlink";

/**
 * 발송 직전 본문의 구글 드라이브 링크를 쇼트링크로 치환 (기획확정 8절 · 첨부 발송).
 *   drive.google.com / docs.google.com URL → SHORTLINK_BASE/코드 (브랜드 연결·클릭 트래킹).
 *   같은 URL 은 한 번만 생성해 재사용. 어느 단계든 실패하면 원본 본문 그대로 반환.
 */
async function shortenDriveLinks(bodyMd: string, brandId: string, createdBy: string): Promise<string> {
  try {
    const urlRe = /https?:\/\/[^\s<>()"'\]]+/g;
    const found = bodyMd.match(urlRe) ?? [];
    const driveUrls = [...new Set(found.filter(isDriveUrl))];
    if (driveUrls.length === 0) return bodyMd;

    const replacements = new Map<string, string>();
    for (const url of driveUrls) {
      const link = await createShortLink(url, {
        brandId, createdBy, label: "드라이브 첨부(초안함 발송)",
      });
      replacements.set(url, link.url);
    }
    let out = bodyMd;
    // 긴 URL 부터 치환 — 접두 관계 URL(같은 문서의 하위 경로) 오치환 방지
    for (const url of [...replacements.keys()].sort((a, b) => b.length - a.length)) {
      out = out.split(url).join(replacements.get(url)!);
    }
    return out;
  } catch (e) {
    console.error("[drafts] 드라이브 쇼트링크 치환 실패 — 원본 유지", (e as Error).message);
    return bodyMd;
  }
}

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

  // 발송 직전 드라이브 링크 → 쇼트링크 치환 (실패 시 원본 유지)
  const bodyToSend = await shortenDriveLinks(d.body_md, d.brand_id, editedBy);

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${env.resend.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ from: env.resend.from, to: d.to_email, subject: d.subject, text: bodyToSend }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.message ?? "발송 실패", sent: false };
    // body_md 는 실제 발송본(쇼트링크 치환 반영)으로 보존 — 기록·클릭 추적 대조용
    await query(
      "UPDATE email_drafts SET status='sent', edited_by=$2, sent_at=now(), resend_id=$3, body_md=$4 WHERE id=$1",
      [id, editedBy, data.id ?? null, bodyToSend]);
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
