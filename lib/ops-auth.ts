import { NextRequest } from "next/server";
import { currentUser } from "./auth";
import { env } from "./env";
import type { Role } from "./types";

// ops API 인증: 어드민 세션 OR 내부 토큰(Slack/MCP/cron).
// 모든 쓰기(상태변경·체크·담당변경)는 게이트 검증 ops 를 경유 (00 4-5).

export interface OpsActor {
  actor: string; // admin:{id}|slack:{user}|mcp:{agent}
  role: Role;
}

/**
 * 요청에서 액터를 해석. 우선순위:
 *  1) 어드민 세션 쿠키 → admin:{email}
 *  2) X-Internal-Token == MCP_TOKEN → body.actor 사용 (slack:/mcp:)
 * 실패 시 null.
 */
export async function resolveActor(
  req: NextRequest,
  body: Record<string, unknown>,
): Promise<OpsActor | null> {
  const user = await currentUser();
  if (user) return { actor: `admin:${user.id}`, role: user.role };

  const token = req.headers.get("x-internal-token");
  if (token && env.mcpToken && token === env.mcpToken) {
    const actor = (body.actor as string) || "mcp:system";
    const role = (body.actor_role as Role) || "exec"; // 내부 자동화는 exec 권한
    return { actor, role };
  }
  return null;
}
