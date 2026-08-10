import { createHmac, timingSafeEqual } from "node:crypto";
import { env, slackChannel } from "./env";

// Slack Web API 클라이언트 + 서명검증 (05-SLACK-APP).
// 어드민 발신은 전부 봇 토큰으로 통일.

const API = "https://slack.com/api";

export type Block = Record<string, unknown>;

async function call(method: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (!env.slack.botToken) {
    console.warn(`[slack] SLACK_BOT_TOKEN 없음 → ${method} 스킵`);
    return { ok: false, skipped: true };
  }
  const res = await fetch(`${API}/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.slack.botToken}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(payload),
  });
  const json = (await res.json()) as Record<string, unknown>;
  if (!json.ok) console.warn(`[slack] ${method} 실패:`, json.error);
  return json;
}

export interface PostArgs {
  channelKey?: string; // intake|onboard|ads|pay|leads|daily
  channelId?: string;
  text?: string;
  blocks?: Block[];
  threadTs?: string;
}

export async function slackPost(args: PostArgs): Promise<{ ok: boolean; ts?: string; channel?: string }> {
  const channel = args.channelId ?? slackChannel(args.channelKey ?? "");
  if (!channel) return { ok: false };
  const r = await call("chat.postMessage", {
    channel,
    text: args.text ?? "",
    blocks: args.blocks,
    thread_ts: args.threadTs,
  });
  return { ok: Boolean(r.ok), ts: r.ts as string | undefined, channel };
}

export async function slackUpdate(channel: string, ts: string, args: { text?: string; blocks?: Block[] }): Promise<void> {
  await call("chat.update", { channel, ts, text: args.text ?? "", blocks: args.blocks });
}

/** 이메일 → Slack 사용자 ID (users.lookupByEmail). 담당자 슬랙ID = 회사 이메일 기준. 실패 시 null. */
export async function slackUserIdByEmail(email: string): Promise<string | null> {
  if (!email || !email.includes("@")) return null;
  const r = await call("users.lookupByEmail", { email });
  if (!r.ok) return null;
  return (r.user as { id?: string } | undefined)?.id ?? null;
}

export async function slackPostDM(slackUserIdOrEmail: string, args: { text?: string; blocks?: Block[] }): Promise<void> {
  // 이메일이면 Slack 사용자 ID 로 조회(담당자 슬랙ID = 이메일). 아니면 그대로 사용.
  let userId = slackUserIdOrEmail;
  if (slackUserIdOrEmail.includes("@")) {
    const looked = await slackUserIdByEmail(slackUserIdOrEmail);
    if (!looked) return; // 이메일로 슬랙 사용자 미발견 → 스킵
    userId = looked;
  }
  // conversations.open → channel id, then postMessage
  const open = await call("conversations.open", { users: userId });
  const channel = (open.channel as { id?: string } | undefined)?.id;
  if (channel) await call("chat.postMessage", { channel, text: args.text ?? "", blocks: args.blocks });
}

export async function slackEphemeral(channel: string, user: string, args: { text?: string; blocks?: Block[] }): Promise<void> {
  await call("chat.postEphemeral", { channel, user, text: args.text ?? "", blocks: args.blocks });
}

export async function slackOpenView(triggerId: string, view: Record<string, unknown>): Promise<Record<string, unknown>> {
  return call("views.open", { trigger_id: triggerId, view });
}

// ── 서명 검증 (05 §1) ────────────────────────────────────────
export function verifySlackSignature(rawBody: string, timestamp: string, signature: string): boolean {
  const secret = env.slack.signingSecret;
  if (!secret || !timestamp || !signature) return false;
  // 5분 리플레이 방지
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const base = `v0:${timestamp}:${rawBody}`;
  const mySig = `v0=${createHmac("sha256", secret).update(base).digest("hex")}`;
  if (mySig.length !== signature.length) return false;
  try {
    return timingSafeEqual(Buffer.from(mySig), Buffer.from(signature));
  } catch {
    return false;
  }
}
