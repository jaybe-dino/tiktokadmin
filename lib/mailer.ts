// 공용 메일 발송 헬퍼 (Resend) — 담당자 전달·시스템 알림 메일 등 재사용.
//   RESEND_API_KEY 미설정 시 { ok:false, skipped:true } 반환(로컬/미연동 안전).
import { env } from "./env";

export async function sendEmail(input: {
  to: string; subject: string; text: string; replyTo?: string;
  /** Resend attachments — content 는 base64 문자열 (예: ICS 캘린더 초대) */
  attachments?: { filename: string; content: string }[];
}): Promise<{ ok: boolean; id?: string; skipped?: boolean; error?: string }> {
  if (!env.resend.apiKey) return { ok: false, skipped: true };
  if (!input.to || !input.to.includes("@")) return { ok: false, error: "수신 이메일 없음" };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${env.resend.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: env.resend.from, to: input.to, subject: input.subject, text: input.text,
        ...(input.replyTo ? { reply_to: input.replyTo } : {}),
        ...(input.attachments?.length ? { attachments: input.attachments } : {}),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: (data as { message?: string }).message ?? "발송 실패" };
    return { ok: true, id: (data as { id?: string }).id };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
