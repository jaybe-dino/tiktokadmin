import { NextRequest, NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/cron-auth";
import { runRevenueJobs } from "@/lib/brand-revenue-jobs";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function GET(req: NextRequest) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try { return NextResponse.json({ ok: true, ...await runRevenueJobs() }); }
  catch { return NextResponse.json({ ok: false, error: "REVENUE_WORKER_UNAVAILABLE" }, { status: 503 }); }
}
export const POST = GET;
