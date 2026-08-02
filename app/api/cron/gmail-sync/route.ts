import { NextRequest, NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/cron-auth";
import { env } from "@/lib/env";
import { detectNoReply } from "@/lib/email-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Gmail 증분 수집(폴백 폴링) + 무응답 감지 (09-A).
//   도메인 위임(GOOGLE_SA_KEY_JSON) 미설정이면 수집은 스킵, 무응답 감지만 수행.
export async function POST(req: NextRequest) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let synced = 0;
  let accounts = 0;
  const gmailEnabled = Boolean(env.gmail.saKeyJson);
  if (gmailEnabled) {
    const { syncAllMailboxes } = await import("@/lib/gmail-client");
    const r = await syncAllMailboxes().catch(() => ({ accounts: 0, saved: 0 }));
    synced = r.saved; accounts = r.accounts;
  }

  const noReply = await detectNoReply(3);

  // 수집 직후 미답 고객 메일 → AI 요약 + 근거기반 회신 초안(초안함). 발송은 담당 승인 후.
  const { draftInboundReplies } = await import("@/lib/inbound-reply");
  const inbound = await draftInboundReplies(10).catch(() => ({ pending: 0, drafted: 0, ai: false }));

  return NextResponse.json({ ok: true, gmailEnabled, accounts, synced, noReplyAlerts: noReply, inbound });
}
export const GET = POST;
