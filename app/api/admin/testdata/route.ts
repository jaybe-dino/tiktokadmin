import { NextRequest, NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/cron-auth";
import { query, queryOne } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 더미데이터 관리 — 현재 데이터를 더미(is_test=true)로 표시하거나, 더미를 일괄 삭제.
//   GET /api/admin/testdata?token=<CRON_SECRET>&op=count   (기본: 현황)
//                                              &op=mark    (현재 모든 브랜드 → 더미)
//                                              &op=purge   (더미 브랜드 삭제, CASCADE)
//   원칙: 실데이터(is_test=false)는 절대 건드리지 않음. purge 는 더미만 삭제.
//   실시간 연동(glovek/apply/meta) 유입은 is_test=false 로 들어오거나 더미→실데이터 승격.

async function handle(req: NextRequest) {
  if (!cronAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized (CRON_SECRET 필요)" }, { status: 401 });
  }
  const op = req.nextUrl.searchParams.get("op") ?? "count";

  const counts = async () => {
    const r = await queryOne<{ test: string; real: string }>(
      "SELECT count(*) FILTER (WHERE is_test) AS test, count(*) FILTER (WHERE NOT is_test) AS real FROM brands");
    return { dummy: Number(r?.test ?? 0), real: Number(r?.real ?? 0) };
  };

  try {
    if (op === "mark") {
      // 현재 존재하는 모든 브랜드를 더미로 표시(실데이터 소스 유입 시 자동 승격됨).
      const r = await query<{ id: string }>("UPDATE brands SET is_test=true WHERE is_test=false RETURNING id");
      return NextResponse.json({ ok: true, op, marked: r.length, ...(await counts()) });
    }
    if (op === "purge") {
      // 더미 브랜드 삭제 → 연결 데이터 CASCADE 정리. 실데이터 무영향.
      const r = await query<{ id: string }>("DELETE FROM brands WHERE is_test=true RETURNING id");
      return NextResponse.json({ ok: true, op, deleted: r.length, ...(await counts()) });
    }
    return NextResponse.json({ ok: true, op: "count", ...(await counts()) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
