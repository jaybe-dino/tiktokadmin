import { NextRequest, NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/cron-auth";
import { watchCycles } from "@/lib/operations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 매일 — 사이클 이행률 50% 미달 알림 (15 §2 cycle-watch).
export async function POST(req: NextRequest) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const behind = await watchCycles();
  return NextResponse.json({ ok: true, behind });
}
export const GET = POST;
