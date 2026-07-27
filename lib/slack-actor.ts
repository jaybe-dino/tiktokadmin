import { queryOne } from "./db";
import type { OpsActor } from "./ops-auth";
import type { Role } from "./types";

// Slack user → 어드민 액터. slack_user_id 매핑이 없으면 null(권한 없음).
export async function resolveSlackActor(slackUserId: string): Promise<OpsActor | null> {
  const u = await queryOne<{ id: string; role: Role }>(
    "SELECT id, role FROM admin_users WHERE slack_user_id=$1 AND active",
    [slackUserId],
  );
  if (!u) return null;
  return { actor: `slack:${slackUserId}`, role: u.role };
}
