import { NextRequest, NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/cron-auth";
import { runScheduledAgents } from "@/lib/agents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// 스케줄 에이전트 실행 (06). Vercel Cron(Bearer CRON_SECRET) 또는 ?token=&key=.
//   전체: /api/cron/agents  ·  특정: /api/cron/agents?key=daily_ops_check
export async function POST(req: NextRequest) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const key = req.nextUrl.searchParams.get("key") || undefined;
  const res = await runScheduledAgents(key);
  return NextResponse.json({ ok: true, ...res });
}
export const GET = POST;
