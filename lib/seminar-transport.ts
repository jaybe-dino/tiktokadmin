// 세미나 안내의 제공자 경계 — "기록한 그대로" 보내고, 결과를 정확히 분류한다.
//
//   왜 따로 두는가
//     공용 sendEmail 은 본문에 회사 푸터를 붙이고(=기록과 달라짐), Gmail 이 실패하면
//     Resend 로 자동 폴백한다(=접수 여부를 모르는 채 다른 제공자로 또 보냄).
//     세미나 경로만 그 두 가지를 끄고, 최종 본문을 먼저 확정해 기록·전송에 같은 값을 쓴다.
//
//   일부러 하지 않는 것
//     · 공용 함수의 기본 동작을 바꾸지 않는다 — 옵트인 옵션으로만 끈다.
//     · 결과가 불명이면 다른 제공자로 다시 보내지 않는다.
//     · 여기서 재시도하지 않는다. 재시도 여부는 호출부(dispatchDue)가 기록을 보고 정한다.
import type { SeminarChannel } from "./seminar-schedule";

export interface TransportResult {
  ok: boolean;
  provider: string;
  providerId?: string;
  error?: string;
  /** 제공자 응답을 확인하지 못함(연결 실패·시간초과). 명시적 거절과 구분한다. */
  indeterminate?: boolean;
}

/**
 * 메일이 "실제로 나갈" 최종 본문. 공용 푸터까지 붙인 값이다.
 *   기록에도 이 값을 남기고, 전송에도 이 값을 그대로 넘긴다(skipFooter).
 */
export async function finalEmailText(text: string): Promise<string> {
  const { appendFooter } = await import("./email-footer");
  return appendFooter(text);
}

/** 채널별 최종 전송 본문. 문자는 공용 헬퍼가 본문을 건드리지 않아 그대로다. */
export async function finalBody(channel: SeminarChannel, body: string): Promise<string> {
  return channel === "email" ? finalEmailText(body) : body;
}

/** 메일 1건. 푸터 재부착과 제공자 폴백을 모두 끈다. */
export async function sendSeminarEmail(to: string, subject: string, finalText: string): Promise<TransportResult> {
  const { sendEmail } = await import("./mailer");
  try {
    const out = await sendEmail({
      to, subject, text: finalText,
      skipFooter: true,     // 기록한 본문을 그대로 보낸다
      noFallback: true,     // 접수 여부를 모르는 채 다른 제공자로 또 보내지 않는다
    });
    if (out.ok) return { ok: true, provider: out.via ?? "mail", providerId: out.id };
    return {
      ok: false, provider: out.via ?? "mail",
      error: out.error ?? (out.skipped ? "메일 발송 설정이 없습니다" : "발송 실패"),
      // skipped = 설정이 없어 보내지 않은 것이므로 결과가 분명하다.
      indeterminate: out.skipped ? false : Boolean(out.indeterminate),
    };
  } catch (e) {
    // 공용 헬퍼가 던진 예외 — 접수됐을 수도 있다.
    return { ok: false, provider: "mail", error: (e as Error).message.slice(0, 200), indeterminate: true };
  }
}

/** 문자 1건. 본문은 공용 헬퍼가 그대로 보낸다(푸터 부착 없음). */
export async function sendSeminarSms(to: string, body: string, title: string): Promise<TransportResult> {
  const { sendSms } = await import("./sms");
  try {
    const out = await sendSms({ receiver: to, msg: body, title });
    if (out.ok) return { ok: true, provider: "aligo", providerId: out.msgId };
    return {
      ok: false, provider: "aligo", error: out.message,
      // ALIGO 가 code 를 돌려줬으면 명시적 거절이다. 연결 실패면 indeterminate 가 켜져 온다.
      indeterminate: Boolean(out.indeterminate),
    };
  } catch (e) {
    return { ok: false, provider: "aligo", error: (e as Error).message.slice(0, 200), indeterminate: true };
  }
}

export async function sendSeminarMessage(
  channel: SeminarChannel, to: string, msg: { subject: string; body: string },
): Promise<TransportResult> {
  return channel === "sms"
    ? sendSeminarSms(to, msg.body, "GloveK 세미나")
    : sendSeminarEmail(to, msg.subject, msg.body);
}
