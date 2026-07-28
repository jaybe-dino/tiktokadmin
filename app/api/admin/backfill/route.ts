import { NextRequest, NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/cron-auth";
import { backfillGlovek } from "@/lib/backfill";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// glovek DB 직접 적재. 브라우저/curl 1회 호출.
//   GET /api/admin/backfill?token=<CRON_SECRET>&source=glovek
// 읽기전용 연결(GLOVEK_DB_URL_RO 또는 공유 DATABASE_URL)로 glovek 테이블을 읽어 brands 병합.
async function handle(req: NextRequest) {
  if (!cronAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized (CRON_SECRET 필요)" }, { status: 401 });
  }
  const source = req.nextUrl.searchParams.get("source") ?? "glovek";
  if (source !== "glovek") {
    return NextResponse.json(
      { error: "지원 소스: glovek (apply/tpartners는 CSV 또는 ingest 연동 사용)" },
      { status: 400 },
    );
  }
  try {
    const result = await backfillGlovek("backfill");
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
