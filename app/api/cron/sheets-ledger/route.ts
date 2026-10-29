import { NextRequest, NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/cron-auth";
import { syncLedgerToSheet } from "@/lib/ledger-sheet-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// 원장 전체 → 기존 Google Sheet 기록. 매일 00:00 UTC = 09:00 KST.
//   GET/POST 모두 받는다(Vercel Cron 은 GET, 수동 재시도는 POST).
//   ?force=1   같은 날 다시 돌린다 — 수동 재시도용이며 시트는 덮어쓰기가 아니라 갱신이다.
//   ?dryRun=1  시트를 읽기만 하고 쓰지 않는다. 첫 실행 전 점검용(건수·열별 현황만).
async function handle(req: NextRequest) {
  if (!cronAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized (CRON_SECRET 필요)" }, { status: 401 });
  }
  const force = req.nextUrl.searchParams.get("force") === "1";
  const dryRun = req.nextUrl.searchParams.get("dryRun") === "1";
  const r = await syncLedgerToSheet({ force, dryRun });
  // 응답에도 연락처·매출을 담지 않는다 — 건수와 상태만.
  return NextResponse.json(r, { status: r.ok ? 200 : 500 });
}

export async function GET(req: NextRequest) { return handle(req); }
export async function POST(req: NextRequest) { return handle(req); }
