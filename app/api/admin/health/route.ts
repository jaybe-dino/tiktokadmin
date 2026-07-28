import { NextRequest, NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/cron-auth";
import { query, queryOne } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 진단: DB 연결·테이블·데이터 수·API(ingest) 수신 내역.
//   GET /api/admin/health?token=<CRON_SECRET>
async function handle(req: NextRequest) {
  if (!cronAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized (CRON_SECRET 필요)" }, { status: 401 });
  }

  const out: Record<string, unknown> = { ok: true, checkedAt: new Date().toISOString() };

  // 배포 커밋 확인(Vercel 이 주입)
  out.commit = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null;
  out.branch = process.env.VERCEL_GIT_COMMIT_REF ?? null;

  // 1) DB 연결
  try {
    await query("SELECT 1");
    out.db = "connected";
  } catch (e) {
    out.db = "ERROR: " + (e as Error).message;
    return NextResponse.json(out, { status: 200 });
  }

  // 2) 적용된 마이그레이션
  out.migrations = await query<{ name: string }>("SELECT name FROM schema_migrations ORDER BY name")
    .then((r) => r.map((x) => x.name))
    .catch((e) => "ERROR: " + (e as Error).message);

  // 3) 테이블 존재 여부
  const tables = [
    "brands", "brand_sources", "ingest_events", "stage_requirements",
    "brand_files", "proposals", "brand_emails", "payments_manual",
  ];
  const tableStatus: Record<string, string> = {};
  for (const t of tables) {
    tableStatus[t] = await query(`SELECT count(*)::text n FROM ${t}`)
      .then((r) => `${(r[0] as { n: string }).n} rows`)
      .catch((e) => "MISSING/ERROR: " + (e as Error).message);
  }
  out.tables = tableStatus;

  // 4) 브랜드 샘플 (카드 테스트용 실제 ID)
  out.sampleBrands = await query<{ id: string; brand_name: string; state: string }>(
    "SELECT id, brand_name, state FROM brands ORDER BY updated_at DESC LIMIT 5",
  ).catch((e) => "ERROR: " + (e as Error).message);

  // 5) API 수신(ingest) 최근 내역 — 각 사이트 연동 확인
  out.recentIngest = await query<{ site: string; event: string; status: string; created_at: string }>(
    "SELECT site, event, status, created_at FROM ingest_events ORDER BY created_at DESC LIMIT 10",
  ).catch((e) => "ERROR: " + (e as Error).message);
  out.ingestBySite = await query<{ site: string; n: string }>(
    "SELECT site, count(*)::text n FROM ingest_events GROUP BY site",
  ).catch((e) => "ERROR: " + (e as Error).message);

  // 6) glovek 읽기전용 연결(설정 시)
  out.glovekRoConfigured = Boolean(process.env.GLOVEK_DB_URL_RO);

  // 7) 공유 DB 의 모든 테이블(대략 row 수 추정) — glovek 미활용 데이터(추가 브랜드) 발굴용
  out.allTables = await query<{ table: string; est_rows: number }>(
    `SELECT relname AS table, n_live_tup AS est_rows
       FROM pg_stat_user_tables ORDER BY n_live_tup DESC`,
  ).catch((e) => "ERROR: " + (e as Error).message);

  return NextResponse.json(out, { status: 200 });
}

export const GET = handle;
export const POST = handle;
