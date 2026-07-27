import { NextRequest, NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/cron-auth";
import { runDailyDigest, runEscalate } from "@/lib/escalation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// 매일 09:00·14:00 KST. ?digest=1 이면 일일 다이제스트도 발송(09:00 호출용).
export async function GET(req: NextRequest) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const escalation = await runEscalate();
  const wantDigest = req.nextUrl.searchParams.get("digest") === "1";
  if (wantDigest) await runDailyDigest();
  return NextResponse.json({ ok: true, escalation, digest: wantDigest });
}
