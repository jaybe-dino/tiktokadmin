// AI 공용 레이어 — Anthropic 클라이언트·모델을 단일 지점에서 관리(QA #15).
//   모델 ID 하드코딩 금지 → env ANTHROPIC_MODEL(기본 claude-sonnet-5).
//   시크릿은 env 만. 개인정보(카드·신분증·비밀번호)는 프롬프트/출력 금지.
import Anthropic from "@anthropic-ai/sdk";
import { env } from "./env";

export const AI_MODEL = env.anthropicModel;
export function aiEnabled(): boolean {
  return Boolean(env.anthropicKey);
}
export function aiClient(): Anthropic {
  return new Anthropic({ apiKey: env.anthropicKey });
}

/**
 * 단발 텍스트 생성 헬퍼(도구 없음). 키 미설정이면 null(비활성).
 * API 오류는 삼키지 않고 로그 후 재던짐 → 호출부/에이전트 런이 실패를 인지·기록.
 * (기본 max_tokens 를 넉넉히 잡아, 사고(thinking) 모델에서도 텍스트가 비거나 잘리지 않도록.)
 */
export async function aiText(input: {
  system: string; user: string; maxTokens?: number;
}): Promise<string | null> {
  if (!aiEnabled()) return null;
  try {
    const resp = await aiClient().messages.create({
      model: AI_MODEL,
      max_tokens: input.maxTokens ?? 1500,
      system: input.system,
      messages: [{ role: "user", content: input.user }],
    });
    const text = resp.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("\n").trim();
    if (!text) throw new Error("AI 응답이 비어 있음(토큰 소진/차단 가능)");
    return text;
  } catch (e) {
    console.error("[ai] aiText 실패:", (e as Error).message);
    throw e;
  }
}
