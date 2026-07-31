import { NextRequest, NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/cron-auth";
import { processMeetings, detectNoShows } from "@/lib/meeting-process";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 미팅 후처리 워커 (08) — 전사본 있는 미팅 요약→기록→팔로업 + 노쇼 감지.
export async function POST(req: NextRequest) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const [proc, noShows] = await Promise.all([processMeetings(5), detectNoShows()]);
  return NextResponse.json({ ok: true, ...proc, noShows });
}
export const GET = POST;
