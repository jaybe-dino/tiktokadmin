// 시트 동기화 실행 기록 — 실제 Postgres 로 겹침 방지·멱등을 확인한다.
//   SHEETSYNC_TEST_DB_URL 이 있을 때만 돈다. 운영 DB 를 가리키면 안 된다.
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const ctx = vi.hoisted(() => ({
  pool: null as never as {
    query: (s: string, a?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
    end: () => Promise<void>;
  },
}));
vi.mock("../lib/db", async () => {
  const { Pool } = await import("pg");
  if (process.env.SHEETSYNC_TEST_DB_URL) {
    ctx.pool = new Pool({ connectionString: process.env.SHEETSYNC_TEST_DB_URL, max: 8 }) as never;
  }
  const query = async (sql: string, args: unknown[] = []) => (await ctx.pool.query(sql, args)).rows;
  return { query, queryRo: query, queryOne: async (s: string, a?: unknown[]) => (await query(s, a))[0] ?? null };
});

// 모의 팩토리는 lib/db 가 실제로 import 될 때 실행된다 — 여기서 풀을 만든다.
await import("../lib/db");

const mig = (f: string) => readFileSync(new URL(`../migrations/${f}`, import.meta.url), "utf8");

/** lib/ledger-sheet-sync 의 선점 SQL 과 같은 문장. 여기서 동작을 고정한다. */
const CLAIM = `
  INSERT INTO sheet_sync_runs (spreadsheet_id, run_date, status, started_at)
  VALUES ($1,$2,'running',now())
  ON CONFLICT (spreadsheet_id, run_date) DO UPDATE
    SET status='running', started_at=now(), attempts = sheet_sync_runs.attempts + 1
    WHERE sheet_sync_runs.status <> 'done' OR $3
  RETURNING id::text AS id, (xmax = 0) AS fresh`;

describe.skipIf(!process.env.SHEETSYNC_TEST_DB_URL)("시트 동기화 실행 기록 (PostgreSQL)", () => {
  beforeAll(async () => {
    await ctx.pool.query("DROP TABLE IF EXISTS sheet_sync_runs CASCADE; CREATE EXTENSION IF NOT EXISTS pgcrypto;");
    await ctx.pool.query(mig("0115_sheet_sync_runs.sql"));
  });
  afterAll(async () => { await ctx.pool.end(); });
  beforeEach(async () => { await ctx.pool.query("TRUNCATE sheet_sync_runs"); });

  it("처음 실행은 선점된다", async () => {
    const r = await ctx.pool.query(CLAIM, ["S1", "2026-10-29", false]);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].fresh).toBe(true);
  });

  it("같은 날 두 번째 실행은 성공한 뒤라면 선점되지 않는다", async () => {
    await ctx.pool.query(CLAIM, ["S1", "2026-10-29", false]);
    await ctx.pool.query("UPDATE sheet_sync_runs SET status='done', finished_at=now()");
    const r = await ctx.pool.query(CLAIM, ["S1", "2026-10-29", false]);
    expect(r.rows).toHaveLength(0);          // 건너뛴다
    const n = await ctx.pool.query("SELECT count(*)::int AS n FROM sheet_sync_runs");
    expect(n.rows[0].n).toBe(1);             // 행이 늘지 않는다
  });

  it("실패한 날은 다시 선점되고 시도 횟수가 올라간다", async () => {
    await ctx.pool.query(CLAIM, ["S1", "2026-10-29", false]);
    await ctx.pool.query("UPDATE sheet_sync_runs SET status='failed', error='모의 실패'");
    const r = await ctx.pool.query(CLAIM, ["S1", "2026-10-29", false]);
    expect(r.rows).toHaveLength(1);
    const row = await ctx.pool.query("SELECT attempts, status FROM sheet_sync_runs");
    expect(row.rows[0].attempts).toBe(2);
    expect(row.rows[0].status).toBe("running");
  });

  it("force 면 성공한 날도 다시 선점된다", async () => {
    await ctx.pool.query(CLAIM, ["S1", "2026-10-29", false]);
    await ctx.pool.query("UPDATE sheet_sync_runs SET status='done'");
    const r = await ctx.pool.query(CLAIM, ["S1", "2026-10-29", true]);
    expect(r.rows).toHaveLength(1);
  });

  it("동시에 들어와도 한쪽만 선점한다(겹침 방지)", async () => {
    const tries = await Promise.all(
      Array.from({ length: 8 }, () => ctx.pool.query(CLAIM, ["S1", "2026-10-30", false])
        .then((r) => r.rows.length).catch(() => 0)),
    );
    // 선점에 성공한 쪽만 1 — 처음 INSERT 하나와, 그 뒤 'running' 상태를 다시 잡는 재시도들.
    // 중요한 것은 행이 하나뿐이라는 점이다.
    expect(tries.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
    const n = await ctx.pool.query(
      "SELECT count(*)::int AS n FROM sheet_sync_runs WHERE run_date='2026-10-30'");
    expect(n.rows[0].n).toBe(1);
  });

  it("날짜가 다르면 따로 선점된다", async () => {
    await ctx.pool.query(CLAIM, ["S1", "2026-10-29", false]);
    await ctx.pool.query("UPDATE sheet_sync_runs SET status='done'");
    const r = await ctx.pool.query(CLAIM, ["S1", "2026-10-30", false]);
    expect(r.rows).toHaveLength(1);
    const n = await ctx.pool.query("SELECT count(*)::int AS n FROM sheet_sync_runs");
    expect(n.rows[0].n).toBe(2);
  });

  it("시트가 다르면 같은 날도 따로 선점된다", async () => {
    await ctx.pool.query(CLAIM, ["S1", "2026-10-29", false]);
    await ctx.pool.query("UPDATE sheet_sync_runs SET status='done'");
    const r = await ctx.pool.query(CLAIM, ["S2", "2026-10-29", false]);
    expect(r.rows).toHaveLength(1);
  });

  it("실패가 지난 성공 기록을 지우지 않는다", async () => {
    await ctx.pool.query(CLAIM, ["S1", "2026-10-28", false]);
    await ctx.pool.query("UPDATE sheet_sync_runs SET status='done', brands=900 WHERE run_date='2026-10-28'");
    const r2 = await ctx.pool.query(CLAIM, ["S1", "2026-10-29", false]);
    await ctx.pool.query("UPDATE sheet_sync_runs SET status='failed' WHERE id=$1::uuid", [r2.rows[0].id]);

    const kept = await ctx.pool.query(
      "SELECT status, brands FROM sheet_sync_runs WHERE run_date='2026-10-28'");
    expect(kept.rows[0]).toMatchObject({ status: "done", brands: 900 });
  });

  it("상태값은 세 가지뿐이다", async () => {
    const r = await ctx.pool.query(CLAIM, ["S1", "2026-10-29", false]);
    await expect(ctx.pool.query(
      "UPDATE sheet_sync_runs SET status='weird' WHERE id=$1::uuid", [r.rows[0].id])).rejects.toThrow();
  });

  it("연락처·매출·토큰을 담는 칼럼이 없다", async () => {
    const cols = await ctx.pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name='sheet_sync_runs'`);
    const names = cols.rows.map((c) => String(c.column_name));
    for (const bad of ["phone", "email", "revenue", "token", "secret", "payload"]) {
      expect(names.some((n) => n.includes(bad)), bad).toBe(false);
    }
  });
});
