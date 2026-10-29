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
    ctx.pool = new Pool({ connectionString: process.env.SHEETSYNC_TEST_DB_URL, max: 16 }) as never;
  }
  const query = async (sql: string, args: unknown[] = []) => (await ctx.pool.query(sql, args)).rows;
  return { query, queryRo: query, queryOne: async (s: string, a?: unknown[]) => (await query(s, a))[0] ?? null };
});
vi.mock("../lib/env", () => ({
  env: {
    adminUrl: "https://admin.example.invalid",
    sheets: {
      saKeyJson: "", subject: "", ledgerSpreadsheetId: "SHEET1",
      ledgerTab: "유입·커뮤현황", logTab: "갱신기록",
    },
  },
}));

// 모의 팩토리는 lib/db 가 실제로 import 될 때 실행된다 — 여기서 풀을 만든다.
await import("../lib/db");
// 선점 SQL 은 운영 코드에서 그대로 가져온다 — 베껴 적으면 문장이 갈라진다.
const { CLAIM_SQL, RUNNING_STALE_MINUTES } = await import("../lib/ledger-sheet-sync");

const mig = (f: string) => readFileSync(new URL(`../migrations/${f}`, import.meta.url), "utf8");

/** 선점 한 번. 행이 돌아오면 이 호출이 writer 다. */
const claim = (date: string, force = false, stale = RUNNING_STALE_MINUTES) =>
  ctx.pool.query(CLAIM_SQL, ["S1", date, force, stale]);

describe.skipIf(!process.env.SHEETSYNC_TEST_DB_URL)("시트 동기화 실행 기록 (PostgreSQL)", () => {
  beforeAll(async () => {
    await ctx.pool.query("DROP TABLE IF EXISTS sheet_sync_runs CASCADE; CREATE EXTENSION IF NOT EXISTS pgcrypto;");
    await ctx.pool.query(mig("0115_sheet_sync_runs.sql"));
  });
  afterAll(async () => { await ctx.pool.end(); });
  beforeEach(async () => { await ctx.pool.query("TRUNCATE sheet_sync_runs"); });

  it("처음 실행은 선점된다", async () => {
    const r = await claim("2026-10-29");
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].fresh).toBe(true);
  });

  it("같은 날 두 번째 실행은 성공한 뒤라면 선점되지 않는다", async () => {
    await claim("2026-10-29");
    await ctx.pool.query("UPDATE sheet_sync_runs SET status='done', finished_at=now()");
    const r = await claim("2026-10-29");
    expect(r.rows).toHaveLength(0);          // 건너뛴다
    const n = await ctx.pool.query("SELECT count(*)::int AS n FROM sheet_sync_runs");
    expect(n.rows[0].n).toBe(1);             // 행이 늘지 않는다
  });

  it("진행 중(running)인 실행은 빼앗지 못한다", async () => {
    const first = await claim("2026-10-29");
    expect(first.rows).toHaveLength(1);
    const second = await claim("2026-10-29");
    expect(second.rows).toHaveLength(0);     // 겹쳐 돌지 않는다
    const row = await ctx.pool.query("SELECT attempts, status FROM sheet_sync_runs");
    expect(row.rows[0].attempts).toBe(1);    // 시도 횟수도 올라가지 않는다
    expect(row.rows[0].status).toBe("running");
  });

  it("force 로도 진행 중인 실행을 빼앗지 못한다", async () => {
    await claim("2026-10-29");
    const r = await claim("2026-10-29", true);
    expect(r.rows).toHaveLength(0);
  });

  it("상한을 넘겨 멈춰 있는 running 은 회수한다", async () => {
    await claim("2026-10-29");
    await ctx.pool.query(
      "UPDATE sheet_sync_runs SET started_at = now() - make_interval(mins => $1::int)",
      [RUNNING_STALE_MINUTES + 1]);
    const r = await claim("2026-10-29");
    expect(r.rows).toHaveLength(1);
    const row = await ctx.pool.query("SELECT attempts FROM sheet_sync_runs");
    expect(row.rows[0].attempts).toBe(2);
  });

  it("실패한 날은 다시 선점되고 시도 횟수가 올라간다", async () => {
    await claim("2026-10-29");
    await ctx.pool.query("UPDATE sheet_sync_runs SET status='failed', error='모의 실패'");
    const r = await claim("2026-10-29");
    expect(r.rows).toHaveLength(1);
    const row = await ctx.pool.query("SELECT attempts, status FROM sheet_sync_runs");
    expect(row.rows[0].attempts).toBe(2);
    expect(row.rows[0].status).toBe("running");
  });

  it("force 면 성공한 날도 다시 선점된다", async () => {
    await claim("2026-10-29");
    await ctx.pool.query("UPDATE sheet_sync_runs SET status='done'");
    const r = await claim("2026-10-29", true);
    expect(r.rows).toHaveLength(1);
  });

  it("동시에 들어오면 정확히 한쪽만 선점한다(writer 하나)", async () => {
    const tries = await Promise.all(
      Array.from({ length: 12 }, () => claim("2026-10-30")
        .then((r) => r.rows.length).catch(() => 0)),
    );
    // 핵심: 선점에 성공한 호출이 정확히 하나다. 나머지는 빈손으로 돌아가 멈춘다.
    expect(tries.reduce((a, b) => a + b, 0)).toBe(1);
    const n = await ctx.pool.query(
      "SELECT count(*)::int AS n FROM sheet_sync_runs WHERE run_date='2026-10-30'");
    expect(n.rows[0].n).toBe(1);
  });

  it("날짜가 다르면 따로 선점된다", async () => {
    await claim("2026-10-29");
    await ctx.pool.query("UPDATE sheet_sync_runs SET status='done'");
    const r = await claim("2026-10-30");
    expect(r.rows).toHaveLength(1);
    const n = await ctx.pool.query("SELECT count(*)::int AS n FROM sheet_sync_runs");
    expect(n.rows[0].n).toBe(2);
  });

  it("시트가 다르면 같은 날도 따로 선점된다", async () => {
    await claim("2026-10-29");
    await ctx.pool.query("UPDATE sheet_sync_runs SET status='done'");
    const r = await ctx.pool.query(CLAIM_SQL, ["S2", "2026-10-29", false, RUNNING_STALE_MINUTES]);
    expect(r.rows).toHaveLength(1);
  });

  it("실패가 지난 성공 기록을 지우지 않는다", async () => {
    await claim("2026-10-28");
    await ctx.pool.query("UPDATE sheet_sync_runs SET status='done', brands=900 WHERE run_date='2026-10-28'");
    const r2 = await claim("2026-10-29");
    await ctx.pool.query("UPDATE sheet_sync_runs SET status='failed' WHERE id=$1::uuid", [r2.rows[0].id]);

    const kept = await ctx.pool.query(
      "SELECT status, brands FROM sheet_sync_runs WHERE run_date='2026-10-28'");
    expect(kept.rows[0]).toMatchObject({ status: "done", brands: 900 });
  });

  it("상태값은 세 가지뿐이다", async () => {
    const r = await claim("2026-10-29");
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
