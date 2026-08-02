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

/** 단발 텍스트 생성 헬퍼(도구 없음). 키 없으면 null. */
export async function aiText(input: {
  system: string; user: string; maxTokens?: number;
}): Promise<string | null> {
  if (!aiEnabled()) return null;
  const resp = await aiClient().messages.create({
    model: AI_MODEL,
    max_tokens: input.maxTokens ?? 1200,
    system: input.system,
    messages: [{ role: "user", content: input.user }],
  });
  return resp.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("\n").trim();
}
