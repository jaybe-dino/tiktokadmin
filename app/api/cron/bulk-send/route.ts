import { NextRequest, NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/cron-auth";
import { processBulkSends } from "@/lib/bulk-send";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 대량 발송 워커 — bulk_sends 큐(queued/sending)를 소비해 실제 발송(문자·메일).
//   수동 트리거(발송센터 "지금 발송")도 이 경로를 통해 즉시 1배치 실행.
export async function POST(req: NextRequest) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const res = await processBulkSends();
  return NextResponse.json({ ok: true, ...res });
}
export const GET = POST;
