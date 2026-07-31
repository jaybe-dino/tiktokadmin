import { NextRequest, NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/cron-auth";
import { closeCyclesAndDraftSettlements } from "@/lib/operations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 말일 — 사이클 마감 + 정산 draft 생성 (15 §2/§4).
export async function POST(req: NextRequest) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const res = await closeCyclesAndDraftSettlements();
  return NextResponse.json({ ok: true, ...res });
}
export const GET = POST;
