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
  /**
   * 옵트인 — 공용 푸터를 붙이지 않고 text 를 "그대로" 보낸다.
   *   보낸 내용을 기록해 두고 그대로 전송해야 하는 경로(세미나 안내)에서 쓴다.
   *   미지정이면 기존처럼 푸터를 붙인다(기존 호출자 동작 보존).
   */
  skipFooter?: boolean;
  /**
   * 옵트인 — Gmail 이 실패해도 Resend 로 넘어가지 않는다.
   *   접수 여부를 모르는 상태에서 다른 제공자로 또 보내면 중복이 될 수 있는 경로에서 쓴다.
   */
  noFallback?: boolean;
}): Promise<{
  ok: boolean; id?: string; skipped?: boolean; error?: string; via?: string;
  /** 제공자 응답을 확인하지 못함(연결 실패·시간초과). 명시적 거절과 구분한다. */
  indeterminate?: boolean;
}> {
  if (!input.to || !input.to.includes("@")) return { ok: false, error: "수신 이메일 없음" };

  // 회사 공용 푸터 부착(구 서명 제거·멱등). skipFooter 면 본문을 그대로 쓴다.
  const { appendFooter } = await import("./email-footer");
  const bodyText = input.skipFooter ? input.text : appendFooter(input.text);

  // ① Gmail 위임 — 기본 발신 메일함(또는 명시 from)에서 발송.
  const { gmailComposeEnabled, sendGmailMessage } = await import("./gmail-client");
  if (gmailComposeEnabled()) {
    const { defaultSendMailbox } = await import("./shared-mailboxes");
    const from = input.from || (await defaultSendMailbox());
    if (from) {
      let r: { ok: boolean; id?: string; error?: string };
      try {
        r = await sendGmailMessage({
          from, to: input.to, subject: input.subject, bodyText,
          attachments: input.attachments,
        });
      } catch (e) {
        // 연결 자체가 실패했다 — 접수 여부를 모른다.
        if (!input.noFallback) throw e;                     // 기존 호출자 동작 보존
        return { ok: false, via: "gmail", error: (e as Error).message.slice(0, 200), indeterminate: true };
      }
      if (r.ok) return { ok: true, id: r.id, via: "gmail" };
      // 폴백을 끈 경로는 여기서 멈춘다(다른 제공자로 또 보내지 않는다).
      if (input.noFallback) return { ok: false, via: "gmail", error: r.error, indeterminate: false };
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
        from: env.resend.from, to: input.to, subject: input.subject, text: bodyText,
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
    // 응답을 받지 못했다 — 거절이 아니라 "결과 불명"이다.
    return { ok: false, via: "resend", error: (e as Error).message, indeterminate: true };
  }
}
