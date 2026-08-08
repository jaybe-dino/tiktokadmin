import { NextRequest, NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/cron-auth";
import { flushBrandSyncOutbox } from "@/lib/glovek-push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// admin → glovek 변경분 push 전용 크론(아웃박스 플러시). glovek-sync 크론에도 포함돼 있으나,
//   더 잦은 주기로 돌리고 싶을 때를 위한 독립 엔드포인트. GLOVEK_PUSH_URL/TOKEN 미설정 시 dormant.
export async function POST(req: NextRequest) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const push = await flushBrandSyncOutbox();
    return NextResponse.json({ ok: true, push });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
export const GET = POST;
