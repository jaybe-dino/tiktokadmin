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

async function runMigrations() {
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
      if (done.has(file)) {
        skipped.push(file);
        continue;
      }
      const sql = readFileSync(path.join(dir, file), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
        await client.query("COMMIT");
        applied.push(file);
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`${file}: ${(err as Error).message}`);
      }
    }
  } finally {
    client.release();
  }
  return { applied, skipped, total: files.length };
}

async function handle(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized (CRON_SECRET 필요)" }, { status: 401 });
  }
  try {
    const result = await runMigrations();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}

export const POST = handle;
export const GET = handle;
