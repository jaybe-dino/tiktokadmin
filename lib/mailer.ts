// 공용 메일 발송 헬퍼 — 담당자 전달·시스템 알림·팔로업 등 아웃바운드 재사용.
//   발송 경로: ① Gmail 기본 발신 메일함(위임) 우선 → ② Resend 폴백.
//   Gmail 우선이라 Resend 도메인 인증 없이도 지정 메일함 명의로 발송된다.
//   from 명시 시 그 메일함으로 발송(예: 인바운드 회신은 받은 메일함으로).
import { env } from "./env";

export async function sendEmail(input: {
  to: string; subject: string; text: string; replyTo?: string;
  from?: string;              // 지정 발신 공용 메일함(미지정 시 기본 발신 메일함)
  /** 첨부 — content 는 base64 문자열 (예: ICS 캘린더 초대). mimeType 선택. */
  attachments?: { filename: string; content: string; mimeType?: string }[];
}): Promise<{ ok: boolean; id?: string; skipped?: boolean; error?: string; via?: string }> {
  if (!input.to || !input.to.includes("@")) return { ok: false, error: "수신 이메일 없음" };

  // ① Gmail 위임 — 기본 발신 메일함(또는 명시 from)에서 발송.
  const { gmailComposeEnabled, sendGmailMessage } = await import("./gmail-client");
  if (gmailComposeEnabled()) {
    const { defaultSendMailbox } = await import("./shared-mailboxes");
    const from = input.from || (await defaultSendMailbox());
    if (from) {
      const r = await sendGmailMessage({
        from, to: input.to, subject: input.subject, bodyText: input.text,
        attachments: input.attachments,
      });
      if (r.ok) return { ok: true, id: r.id, via: "gmail" };
      // Gmail 실패 시 Resend 폴백(아래로 진행) — 완전 실패보다 발송 우선.
      console.error("[mailer] Gmail 발송 실패, Resend 폴백:", r.error);
    }
  }

  // ② Resend 폴백.
  if (!env.resend.apiKey) return { ok: false, skipped: true };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${env.resend.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: env.resend.from, to: input.to, subject: input.subject, text: input.text,
        ...(input.replyTo ? { reply_to: input.replyTo } : {}),
        ...(input.attachments?.length
          ? { attachments: input.attachments.map((a) => ({ filename: a.filename, content: a.content })) }
          : {}),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: (data as { message?: string }).message ?? "발송 실패" };
    return { ok: true, id: (data as { id?: string }).id, via: "resend" };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
