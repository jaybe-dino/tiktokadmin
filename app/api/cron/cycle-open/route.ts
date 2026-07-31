import { NextRequest, NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/cron-auth";
import { openCycles } from "@/lib/operations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 매월 1일 — 운영중 브랜드 사이클·워크아이템 발행 (15 §2).
export async function POST(req: NextRequest) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const res = await openCycles();
  return NextResponse.json({ ok: true, ...res });
}
export const GET = POST;
