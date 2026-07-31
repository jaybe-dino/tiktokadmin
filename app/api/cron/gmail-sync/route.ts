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
  const gmailEnabled = Boolean(env.gmail.saKeyJson);
  if (gmailEnabled) {
    // TODO: 서비스계정 impersonate → gmail_sync_enabled 계정별 history.list 증분 수집
    //   → matchBrandByAddresses → ingestEmailMessage. (도메인 위임 승인 후 활성화)
    synced = await syncViaGmail();
  }

  const noReply = await detectNoReply(3);
  return NextResponse.json({ ok: true, gmailEnabled, synced, noReplyAlerts: noReply });
}
export const GET = POST;

// 도메인 위임 승인 전까지는 no-op. 승인 후 googleapis 클라이언트로 교체.
async function syncViaGmail(): Promise<number> {
  return 0;
}
