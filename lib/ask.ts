import Anthropic from "@anthropic-ai/sdk";
import { env } from "./env";
import { TOOLS } from "./mcp-tools";

// /ask · app_mention → 도메인 툴을 가진 Claude 질의 (05 §5, 06).

const MODEL = "claude-sonnet-5";

const SYSTEM = `너는 Glovek 운영 어드민의 AI 오퍼레이터다.
제공된 도메인 툴로 원장(brands)을 조회·정리해 한국어로 간결하게 답한다.
상태 변경(transition/drop)은 직접 실행하지 말고 제안만 한다. 개인정보(카드·신분증)는 출력 금지.
숫자는 표/목록으로, 결론을 먼저 제시한다.`;

function anthropicTools(): Anthropic.Tool[] {
  return Object.entries(TOOLS).map(([name, def]) => ({
    name,
    description: def.description,
    input_schema: def.inputSchema as Anthropic.Tool.InputSchema,
  }));
}

export async function runAsk(question: string, actorName: string): Promise<string> {
  if (!env.anthropicKey) return "ANTHROPIC_API_KEY 가 설정되지 않아 답변할 수 없습니다.";
  const client = new Anthropic({ apiKey: env.anthropicKey });
  const tools = anthropicTools();
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: question }];

  for (let i = 0; i < 6; i++) {
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: 1500,
      system: SYSTEM,
      tools,
      messages,
    });

    if (resp.stop_reason === "tool_use") {
      messages.push({ role: "assistant", content: resp.content });
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const block of resp.content) {
        if (block.type === "tool_use") {
          const def = TOOLS[block.name];
          let out: unknown;
          try {
            out = def ? await def.handler(block.input as Record<string, unknown>, actorName) : { error: "unknown tool" };
          } catch (err) {
            out = { error: (err as Error).message };
          }
          results.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: JSON.stringify(out).slice(0, 8000),
          });
        }
      }
      messages.push({ role: "user", content: results });
      continue;
    }

    // 최종 텍스트
    const text = resp.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    return text || "(응답 없음)";
  }
  return "질의 처리 한도를 초과했습니다. 질문을 좁혀서 다시 시도해 주세요.";
}

/** response_url 로 지연 응답 게시 */
export async function postToResponseUrl(responseUrl: string, text: string, inChannel = false): Promise<void> {
  await fetch(responseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ response_type: inChannel ? "in_channel" : "ephemeral", text }),
  }).catch((e) => console.warn("[ask] response_url 실패", e.message));
}
