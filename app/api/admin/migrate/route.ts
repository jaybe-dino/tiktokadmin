import { NextRequest, NextResponse } from "next/server";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { getPool } from "@/lib/db";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// 로컬 없이 스키마를 생성하기 위한 1회용 마이그레이션 엔드포인트.
//   POST /api/admin/migrate  (Authorization: Bearer <CRON_SECRET>)
//   또는 GET /api/admin/migrate?token=<CRON_SECRET>
// migrations/*.sql 을 순서대로 적용하고 schema_migrations 로 추적(재호출 안전).
// CRON_SECRET 미설정 시 거부(무보호 DDL 방지).

function authorized(req: NextRequest): boolean {
  const secret = env.cronSecret;
  if (!secret) return false;
  if (req.headers.get("authorization") === `Bearer ${secret}`) return true;
  if (req.nextUrl.searchParams.get("token") === secret) return true;
  return false;
}

async function runMigrations(force: boolean) {
  const dir = path.join(process.cwd(), "migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const client = await getPool().connect();
  const applied: string[] = [];
  const skipped: string[] = [];
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);
    const { rows } = await client.query<{ name: string }>("SELECT name FROM schema_migrations");
    const done = new Set(rows.map((r) => r.name));

    for (const file of files) {
      // force=1: schema_migrations 기록 무시하고 전부 재적용(모든 마이그레이션이 IF NOT EXISTS라 안전).
      //   "기록은 됐지만 테이블이 실제로 없는" 불일치 상태 복구용.
      if (!force && done.has(file)) {
        skipped.push(file);
        continue;
      }
      const sql = readFileSync(path.join(dir, file), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO schema_migrations (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET applied_at=now()",
          [file]);
        await client.query("COMMIT");
        applied.push(file);
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`${file}: ${(err as Error).message}`);
      }
    }

    // 진단: 실제 테이블 존재 여부 + 현재 DB — "기록 vs 실제" 불일치 확인용.
    const diag = await client.query<{ db: string; shared_mailboxes: string | null; brands: string | null; email_drafts: string | null }>(
      `SELECT current_database() AS db,
              to_regclass('public.shared_mailboxes')::text AS shared_mailboxes,
              to_regclass('public.brands')::text AS brands,
              to_regclass('public.email_drafts')::text AS email_drafts`);
    return { applied, skipped, total: files.length, diagnostic: diag.rows[0] };
  } finally {
    client.release();
  }
}

async function handle(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized (CRON_SECRET 필요)" }, { status: 401 });
  }
  try {
    const force = req.nextUrl.searchParams.get("force") === "1";
    const result = await runMigrations(force);
    return NextResponse.json({ ok: true, force, ...result });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}

export const POST = handle;
export const GET = handle;
