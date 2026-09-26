// Zoom 웹훅 인증 판정 — 라우트에서 떼어낸 순수 로직(그래서 테스트할 수 있다).
//   시크릿이 없으면 어떤 요청도 받지 않는다(fail closed):
//   서명을 확인할 수 없는 요청을 처리하면 누구나 회의·전사를 심을 수 있다.
import { createHmac, timingSafeEqual } from "node:crypto";

/** 서명 타임스탬프 허용 오차(초) — 오래된 요청 재전송 차단. */
export const REPLAY_WINDOW_SEC = 300;

export interface ZoomWebhookAuth {
  ok: boolean;
  status: number;          // 200 | 401 | 503
  error?: string;
}

export function timingSafeEq(a: string, b: string): boolean {
  const ba = Buffer.from(a), bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/** URL 검증 챌린지 응답값 — 시크릿으로 서명한다. 시크릿이 없으면 응답하지 않는다(null). */
export function urlValidationAnswer(secret: string | undefined, plainToken: string): string | null {
  if (!secret) return null;
  return createHmac("sha256", secret).update(plainToken).digest("hex");
}

/**
 * 서명·타임스탬프 검증.
 *   시크릿 미설정 → 503(설정 문제임을 구분해 알린다). 서명 불일치·낡은 타임스탬프 → 401.
 */
export function verifyZoomWebhook(input: {
  secret: string | undefined; ts: string | null; sig: string | null; raw: string; nowMs?: number;
}): ZoomWebhookAuth {
  if (!input.secret) {
    return { ok: false, status: 503, error: "webhook secret not configured" };
  }
  const tsNum = Number(input.ts ?? "");
  const now = (input.nowMs ?? Date.now()) / 1000;
  if (!input.ts || !Number.isFinite(tsNum) || Math.abs(now - tsNum) > REPLAY_WINDOW_SEC) {
    return { ok: false, status: 401, error: "stale timestamp" };
  }
  const expected = "v0=" + createHmac("sha256", input.secret).update(`v0:${input.ts}:${input.raw}`).digest("hex");
  if (!timingSafeEq(input.sig ?? "", expected)) return { ok: false, status: 401, error: "unauthorized" };
  return { ok: true, status: 200 };
}
