// 마이그레이션 상태 조회 + 적용 로직(엔드포인트·인앱 카드 공용).
// migrations/*.sql 을 순서대로 적용하고 schema_migrations 로 추적(재호출 안전).
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { getPool } from "./db";

export interface MigrationState {
  applied: string[];   // schema_migrations 에 기록되어 적용된 파일
  pending: string[];   // 파일은 있으나 아직 적용 안 됨
  total: number;       // migrations 디렉터리의 .sql 총 개수
  drift: boolean;      // pending 이 있으면 true (코드가 요구하는 스키마 > 실제 DB)
}

export interface MigrationApplyResult {
  applied: string[];
  skipped: string[];
  total: number;
  diagnostic?: Record<string, string | null>;
}

function migrationDir(): string {
  return path.join(process.cwd(), "migrations");
}

function migrationFiles(): string[] {
  return readdirSync(migrationDir()).filter((f) => f.endsWith(".sql")).sort();
}

/** schema_migrations 를 읽어 적용/미적용 목록을 반환(쓰기 없음, 읽기 전용). */
export async function getMigrationState(): Promise<MigrationState> {
  const files = migrationFiles();
  const client = await getPool().connect();
  try {
    // schema_migrations 자체가 없으면 전부 미적용으로 간주.
    const exists = await client.query<{ reg: string | null }>(
      "SELECT to_regclass('public.schema_migrations')::text AS reg",
    );
    let done = new Set<string>();
    if (exists.rows[0]?.reg) {
      const { rows } = await client.query<{ name: string }>("SELECT name FROM schema_migrations");
      done = new Set(rows.map((r) => r.name));
    }
    const applied = files.filter((f) => done.has(f));
    const pending = files.filter((f) => !done.has(f));
    return { applied, pending, total: files.length, drift: pending.length > 0 };
  } finally {
    client.release();
  }
}

/** 미적용 마이그레이션을 순서대로 적용. force=true 면 기록 무시하고 전부 재적용(IF NOT EXISTS 라 안전). */
export async function applyMigrations(force = false): Promise<MigrationApplyResult> {
  const files = migrationFiles();
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
      if (!force && done.has(file)) { skipped.push(file); continue; }
      const sql = readFileSync(path.join(migrationDir(), file), "utf8");
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

    // 진단: 기록 vs 실제 테이블 존재 불일치 확인용.
    const diag = await client.query<Record<string, string | null>>(
      `SELECT current_database() AS db,
              to_regclass('public.brands')::text AS brands,
              to_regclass('public.mkt_proposal_docs')::text AS mkt_proposal_docs,
              to_regclass('public.mkt_proposal_templates')::text AS mkt_proposal_templates`);
    return { applied, skipped, total: files.length, diagnostic: diag.rows[0] };
  } finally {
    client.release();
  }
}
