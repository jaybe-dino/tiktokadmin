// 수신 메일 → 담당자 자동 전달 (14) — 회사 공용 메일함으로 온 고객 메일을,
//   해당 고객(brand)의 현재 단계 담당자에게 자동 전달(메일+Slack DM+알림).
//   조건: direction='in' · 브랜드 매칭됨 · 현재 단계에 담당자 지정됨 · 아직 미전달.
//   원칙: 전달은 "알림/사본"까지만 — 답장은 담당자가 초안함에서 승인.
import { query, queryOne } from "./db";
import { env } from "./env";
import { ownerFieldForState } from "./states";
import { sendEmail } from "./mailer";
import { slackPostDM } from "./slack";
import { mailboxForwards } from "./shared-mailboxes";
import type { State } from "./types";

interface FwdMsg {
  id: string; brand_id: string; owner_email: string; from_addr: string;
  subject: string; snippet: string; body_text: string | null; ai_summary: string | null; sent_at: string;
}

/** 수신 메일 1건을 현재 단계 담당자에게 전달. 반환: 전달 여부. */
export async function forwardMessageToOwner(messageId: string): Promise<{ forwarded: boolean; to?: string; reason?: string }> {
  const m = await queryOne<FwdMsg & { direction: string; forwarded_at: string | null }>(
    "SELECT id, brand_id, owner_email, from_addr, subject, snippet, body_text, ai_summary, sent_at, direction, forwarded_at FROM email_messages WHERE id=$1",
    [messageId]);
  if (!m) return { forwarded: false, reason: "메일 없음" };
  if (m.direction !== "in") return { forwarded: false, reason: "수신 메일 아님" };
  if (m.forwarded_at) return { forwarded: false, reason: "이미 전달됨" };
  if (!m.brand_id) return { forwarded: false, reason: "브랜드 미매칭" };

  // 수집한 공용 메일함이 전달 대상인지(공용함이 아니면 기본 전달 허용)
  const isSharedForward = await mailboxForwards(m.owner_email);
  const isKnownShared = await queryOne<{ email: string }>(
    "SELECT email FROM shared_mailboxes WHERE email=$1", [m.owner_email]).catch(() => null);
  if (isKnownShared && !isSharedForward) return { forwarded: false, reason: "해당 메일함 전달 비활성" };

  // 브랜드 + 현재 단계 담당자
  const b = await queryOne<{ brand_name: string; state: State; owner_intake: string | null; owner_sales: string | null; owner_onboard: string | null; owner_ads: string | null }>(
    "SELECT brand_name, state, owner_intake, owner_sales, owner_onboard, owner_ads FROM brands WHERE id=$1", [m.brand_id]);
  if (!b) return { forwarded: false, reason: "브랜드 없음" };
  const field = ownerFieldForState(b.state);
  const ownerEmail = field ? (b as unknown as Record<string, string | null>)[field] : null;
  if (!ownerEmail) return { forwarded: false, reason: "현재 단계 담당자 미지정" };

  const owner = await queryOne<{ id: string; name: string; slack_user_id: string | null }>(
    "SELECT id, name, slack_user_id FROM admin_users WHERE id=$1 AND active=true", [ownerEmail]);
  if (!owner) return { forwarded: false, reason: "담당자 계정 없음/비활성" };

  const brandUrl = `${env.adminUrl || ""}/brand/${m.brand_id}`;
  const body = (m.body_text || m.snippet || "").slice(0, 4000);
  const summaryLine = m.ai_summary ? `\n[AI 요약]\n${m.ai_summary}\n` : "";
  const mailText =
    `${owner.name}님, 담당 고객 [${b.brand_name}] 에게서 메일이 도착했습니다.\n` +
    `\n보낸이: ${m.from_addr}\n제목: ${m.subject}\n수신함: ${m.owner_email}\n${summaryLine}` +
    `\n[원문]\n${body}\n\n브랜드360: ${brandUrl}\n\n※ 회신은 어드민 초안함에서 검토·승인 후 발송하세요.`;

  // 1) 담당자 메일 전달(Resend)
  const mail = await sendEmail({
    to: owner.id, replyTo: m.from_addr,
    subject: `[전달] ${b.brand_name} · ${m.subject}`,
    text: mailText,
  });

  // 2) Slack DM(있으면)
  if (owner.slack_user_id) {
    await slackPostDM(owner.slack_user_id, {
      text: `📩 담당 고객 *${b.brand_name}* 수신 메일 — ${m.subject}\n${m.ai_summary ? "요약: " + m.ai_summary + "\n" : ""}<${brandUrl}|브랜드360 열기>`,
    }).catch(() => {});
  }

  // 3) 알림(메일/Slack 미연동이어도 어드민에서 보이게) — 브랜드당 중복 방지
  await query(
    `INSERT INTO alerts (brand_id, kind, tier, message) VALUES ($1,'inbound_fwd',1,$2)
     ON CONFLICT (brand_id,kind) DO UPDATE SET message=EXCLUDED.message, resolved_at=NULL, created_at=now()`,
    [m.brand_id, `${b.brand_name} 수신 메일 → ${owner.name} 전달: ${m.subject}`.slice(0, 300)]).catch(() => {});

  // 4) 전달 이력 기록(멱등)
  await query("UPDATE email_messages SET forwarded_to=$2, forwarded_at=now() WHERE id=$1", [m.id, owner.id]);

  return { forwarded: true, to: owner.id, reason: mail.skipped ? "메일미연동(알림/Slack만)" : undefined };
}

/** 미전달 수신 메일 일괄 전달 → 전달 건수. (gmail-sync 크론에서 수집 직후 호출) */
export async function forwardNewInbound(limit = 20): Promise<{ candidates: number; forwarded: number }> {
  const rows = await query<{ id: string }>(
    `SELECT id FROM email_messages
      WHERE direction='in' AND brand_id IS NOT NULL AND forwarded_at IS NULL
      ORDER BY sent_at DESC LIMIT $1`, [limit]).catch(() => []);
  let forwarded = 0;
  for (const r of rows) {
    const res = await forwardMessageToOwner(r.id).catch(() => ({ forwarded: false }));
    if (res.forwarded) forwarded++;
  }
  return { candidates: rows.length, forwarded };
}
