import { NextRequest, NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/cron-auth";
import { runDueSequence } from "@/lib/lead-sequence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 신규 리드 연속 안내 워커 — 예정 시각이 지난 예약을 발송한다.
//   매시 실행하고 발송 시각 판정은 예약 행(due_at)이 한다 →
//   설정에서 "오전 10시"를 다른 시각으로 바꿔도 배포 없이 그대로 동작.
export async function POST(req: NextRequest) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const res = await runDueSequence();
  return NextResponse.json({ ok: true, ...res });
}
export const GET = POST;
