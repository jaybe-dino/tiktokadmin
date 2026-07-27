import { NextRequest, NextResponse } from "next/server";
import { verifySlackSignature, slackPost } from "@/lib/slack";
import { runAsk } from "@/lib/ask";

export const runtime = "nodejs";

// Slack Events API — url_verification + app_mention(자연어 질의).
export async function POST(req: NextRequest) {
  const raw = await req.text();
  const body = JSON.parse(raw || "{}");

  // 최초 URL 검증은 서명 전에 통과시킴
  if (body.type === "url_verification") {
    return NextResponse.json({ challenge: body.challenge });
  }

  const ts = req.headers.get("x-slack-request-timestamp") ?? "";
  const sig = req.headers.get("x-slack-signature") ?? "";
  if (!verifySlackSignature(raw, ts, sig)) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }

  const event = body.event as { type: string; text?: string; channel?: string; ts?: string; user?: string } | undefined;
  if (event?.type === "app_mention" && event.text) {
    // 멘션 제거 후 질의. 3초 내 ack, 스레드에 결과 게시.
    const question = event.text.replace(/<@[^>]+>/g, "").trim();
    const channel = event.channel!;
    const threadTs = event.ts;
    runAsk(question, `slack:${event.user ?? "unknown"}`)
      .then((answer) => slackPost({ channelId: channel, text: answer, threadTs }))
      .catch((e) => console.error("[events]", e));
  }

  return NextResponse.json({ ok: true });
}
