import { NextRequest, NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/cron-auth";
import { backfillGlovek } from "@/lib/backfill";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// glovek.space 실시간(근사) 동기화 — 공유 DB의 glovek 테이블(상담·온보딩·리퍼럴 등)을
//   읽어 원장(brands)에 병합. 주기 실행(vercel cron)으로 실시간에 가깝게 유지.
//   glovek 테이블은 읽기전용(쓰기 금지). 유입 브랜드는 실데이터(is_test=false)로 승격.
export async function POST(req: NextRequest) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const result = await backfillGlovek("glovek-sync");
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
export const GET = POST;
