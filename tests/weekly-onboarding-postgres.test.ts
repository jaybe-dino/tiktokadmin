// 주간 온보딩 신청 — 실제 Postgres 로 저장·중복 방지·관리자 조회를 확인한다.
//   WEEKLY_TEST_DB_URL 이 있을 때만 돈다. 운영 DB 를 가리키면 안 된다.
//   저장하는 데이터는 모두 is_test=true 로 명시한 합성 값이다(고객 발송·알림 없음).
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const ctx = vi.hoisted(() => ({ pool: null as never as { query: (s: string, a?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>; end: () => Promise<void> } }));
vi.mock("../lib/db", async () => {
  const { Pool } = await import("pg");
  if (process.env.WEEKLY_TEST_DB_URL) ctx.pool = new Pool({ connectionString: process.env.WEEKLY_TEST_DB_URL }) as never;
  const query = async (sql: string, args: unknown[] = []) => (await ctx.pool.query(sql, args)).rows;
  return { query, queryOne: async (sql: string, args: unknown[] = []) => (await query(sql, args))[0] ?? null };
});

const W = await import("../lib/weekly-onboarding");

const TEST_INPUT = {
  brandName: "TEST 합성브랜드", companyName: "TEST 합성회사",
  siteUrl: "test-brand.example.com", contactName: "TEST 담당자", contactTitle: "팀장",
  phone: "010-0000-0000", email: "test-weekly@example.invalid", note: "TEST 합성 신청",
  revenueBand: "b1_5",
  isTest: true,
};

describe.skipIf(!process.env.WEEKLY_TEST_DB_URL)("주간 온보딩 신청 (PostgreSQL)", () => {
  beforeAll(async () => {
    await ctx.pool.query(`
      DROP TABLE IF EXISTS weekly_onb_events, weekly_onb_applications, admin_users CASCADE;
      CREATE TABLE admin_users(id text PRIMARY KEY, name text, active boolean);
      INSERT INTO admin_users VALUES ('staff@example.invalid','TEST 직원', true);
    `);
    // 실제 마이그레이션 파일을 그대로 적용한다(파일과 코드가 어긋나면 여기서 터진다).
    await ctx.pool.query(readFileSync(new URL("../migrations/0107_weekly_onboarding_apply.sql", import.meta.url), "utf8"));
    await ctx.pool.query(readFileSync(new URL("../migrations/0108_weekly_onb_revenue.sql", import.meta.url), "utf8"));
  });
  afterAll(async () => { await ctx.pool.end(); });
  beforeEach(async () => { await ctx.pool.query("TRUNCATE weekly_onb_applications, weekly_onb_events"); });

  it("스키마를 올바로 읽는다", async () => {
    const s = await W.weeklySchemaState();
    expect(s.ready).toBe(true);
  });

  it("신청이 저장되고 사이트 주소가 정규화된다", async () => {
    const r = await W.submitWeeklyApplication(TEST_INPUT);
    expect(r.ok).toBe(true);
    expect(r.already).toBe(false);
    const rows = await ctx.pool.query("SELECT * FROM weekly_onb_applications");
    expect(rows.rows).toHaveLength(1);
    const row = rows.rows[0] as Record<string, string | boolean>;
    expect(row.brand_name).toBe("TEST 합성브랜드");
    expect(row.site_url).toBe("https://test-brand.example.com/");
    expect(row.phone).toBe("01000000000");
    expect(row.source).toBe("weekly_onboarding");
    expect(row.status).toBe("new");
    expect(row.is_test).toBe(true);
    expect(row.revenue_band).toBe("b1_5");
  });

  it("매출 구간은 필수이고 목록에 없는 값은 거부한다", async () => {
    for (const bad of ["", "1억", "PRE", undefined]) {
      const r = await W.submitWeeklyApplication({ ...TEST_INPUT, revenueBand: bad as string });
      expect(r.ok, String(bad)).toBe(false);
      expect(r.error, String(bad)).toContain("매출액");
    }
    const n = await ctx.pool.query("SELECT count(*)::int AS n FROM weekly_onb_applications");
    expect(n.rows[0].n).toBe(0);
  });

  it("8개 구간이 모두 실제로 저장된다", async () => {
    const { REVENUE_KEYS } = await import("../lib/weekly-onboarding-model");
    for (const [i, k] of REVENUE_KEYS.entries()) {
      const r = await W.submitWeeklyApplication({
        ...TEST_INPUT, revenueBand: k, email: `band-${i}@example.invalid`, phone: `0100000${String(1000 + i)}`,
      });
      expect(r.ok, k).toBe(true);
    }
    const rows = await ctx.pool.query("SELECT revenue_band FROM weekly_onb_applications ORDER BY created_at");
    expect(new Set(rows.rows.map((x) => x.revenue_band)).size).toBe(REVENUE_KEYS.length);
  });

  it("같은 주 재제출이면 매출 구간만 최신 선택으로 갱신된다", async () => {
    await W.submitWeeklyApplication({ ...TEST_INPUT, revenueBand: "pre" });
    const again = await W.submitWeeklyApplication({ ...TEST_INPUT, revenueBand: "gte100" });
    expect(again.already).toBe(true);
    const rows = await ctx.pool.query("SELECT revenue_band, brand_name FROM weekly_onb_applications");
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].revenue_band).toBe("gte100");
  });

  it("기존 신청(미기입)은 null 로 남고 목록에서 '미기입'으로 읽힌다", async () => {
    const { revenueLabel } = await import("../lib/weekly-onboarding-model");
    await ctx.pool.query(
      `INSERT INTO weekly_onb_applications
         (brand_name, company_name, contact_name, phone, email, week_key, dedupe_key, is_test)
       VALUES ('이전 신청','이전 회사','담당','01099999999','old@example.invalid', $1, 'old|01099999999', true)`,
      [W.weekKey()]);
    const rows = await W.listWeeklyApplications({ includeTest: true });
    expect(rows[0].revenue_band).toBeNull();
    expect(revenueLabel(rows[0].revenue_band)).toBe("미기입");
  });

  it("DB 제약이 허용값 밖을 막는다", async () => {
    await expect(ctx.pool.query(
      `INSERT INTO weekly_onb_applications
         (brand_name, company_name, contact_name, phone, email, week_key, dedupe_key, revenue_band)
       VALUES ('x','x','x','01088887777','bad@example.invalid', $1, 'bad|01088887777', '1억')`,
      [W.weekKey()])).rejects.toThrow();
  });

  it("같은 주에 다시 눌러도 한 건만 남는다", async () => {
    const a = await W.submitWeeklyApplication(TEST_INPUT);
    const b = await W.submitWeeklyApplication(TEST_INPUT);
    expect(a.already).toBe(false);
    expect(b.already).toBe(true);
    expect(b.id).toBe(a.id);
    const n = await ctx.pool.query("SELECT count(*)::int AS n FROM weekly_onb_applications");
    expect(n.rows[0].n).toBe(1);
  });

  it("다음 주에는 다시 신청할 수 있다(영구 차단하지 않는다)", async () => {
    await W.submitWeeklyApplication(TEST_INPUT, new Date("2026-09-30T01:00:00Z"));
    await W.submitWeeklyApplication(TEST_INPUT, new Date("2026-10-07T01:00:00Z"));
    const rows = await ctx.pool.query("SELECT week_key::text FROM weekly_onb_applications ORDER BY week_key");
    expect(rows.rows.map((r) => r.week_key)).toEqual(["2026-09-28", "2026-10-05"]);
  });

  it("필수값·형식이 틀리면 저장하지 않는다", async () => {
    const cases: [Partial<typeof TEST_INPUT>, string][] = [
      [{ brandName: "" }, "브랜드명"],
      [{ companyName: "" }, "회사명"],
      [{ contactName: "" }, "담당자명"],
      [{ email: "nope" }, "이메일"],
      [{ phone: "123" }, "연락처"],
      [{ siteUrl: "그냥글자" }, "사이트"],
    ];
    for (const [over, word] of cases) {
      const r = await W.submitWeeklyApplication({ ...TEST_INPUT, ...over });
      expect(r.ok, word).toBe(false);
      expect(r.error, word).toContain(word);
    }
    const n = await ctx.pool.query("SELECT count(*)::int AS n FROM weekly_onb_applications");
    expect(n.rows[0].n).toBe(0);
  });

  it("사이트 주소는 비워도 접수된다(선택 입력)", async () => {
    const r = await W.submitWeeklyApplication({ ...TEST_INPUT, siteUrl: "" });
    expect(r.ok).toBe(true);
  });

  it("관리자 목록은 기본적으로 TEST 데이터를 감춘다", async () => {
    await W.submitWeeklyApplication(TEST_INPUT);
    expect(await W.listWeeklyApplications()).toHaveLength(0);
    expect(await W.listWeeklyApplications({ includeTest: true })).toHaveLength(1);
  });

  it("상태·담당·메모를 바꾸면 이력이 남는다", async () => {
    const r = await W.submitWeeklyApplication(TEST_INPUT);
    const id = r.id!;
    expect((await W.setWeeklyStatus(id, "contacted", "staff@example.invalid")).ok).toBe(true);
    expect((await W.setWeeklyOwner(id, "staff@example.invalid", "staff@example.invalid")).ok).toBe(true);
    expect((await W.setWeeklyNote(id, "TEST 연락 메모", "staff@example.invalid")).ok).toBe(true);
    const row = (await W.listWeeklyApplications({ includeTest: true }))[0];
    expect(row.status).toBe("contacted");
    expect(row.owner_admin_id).toBe("staff@example.invalid");
    expect(row.admin_note).toBe("TEST 연락 메모");
    const ev = await ctx.pool.query("SELECT field FROM weekly_onb_events ORDER BY at");
    expect(ev.rows.map((x) => x.field)).toEqual(["status", "owner", "note"]);
  });

  it("알 수 없는 상태·등록되지 않은 담당자는 거부한다", async () => {
    const id = (await W.submitWeeklyApplication(TEST_INPUT)).id!;
    expect((await W.setWeeklyStatus(id, "contract_done", "staff@example.invalid")).ok).toBe(false);
    expect((await W.setWeeklyOwner(id, "nobody@example.invalid", "staff@example.invalid")).ok).toBe(false);
  });

  it("이번 주 집계는 TEST 를 빼고 센다", async () => {
    await W.submitWeeklyApplication(TEST_INPUT);
    const c = await W.weeklyCounts();
    expect(c.total).toBe(0);
    expect(c.week).toBe(W.weekKey());
  });

  it("TEST 정리는 합성 데이터만 지운다", async () => {
    await W.submitWeeklyApplication(TEST_INPUT);
    await W.submitWeeklyApplication({ ...TEST_INPUT, email: "real@example.invalid", isTest: false });
    const d = await W.deleteWeeklyTestRows();
    expect(d.deleted).toBe(1);
    const left = await W.listWeeklyApplications({ includeTest: true });
    expect(left).toHaveLength(1);
    expect(left[0].is_test).toBe(false);
  });

  it("0108 미적용이어도 접수와 목록이 깨지지 않는다", async () => {
    // 운영에 0108 이 아직 안 올라간 상태를 그대로 재현한다.
    await ctx.pool.query("ALTER TABLE weekly_onb_applications DROP COLUMN revenue_band");
    try {
      const r = await W.submitWeeklyApplication(TEST_INPUT);
      expect(r.ok).toBe(true);
      expect(r.revenueNotStored).toBe(true);     // 저장되지 않았음을 숨기지 않는다
      const rows = await W.listWeeklyApplications({ includeTest: true });
      expect(rows).toHaveLength(1);
      expect(rows[0].revenue_band).toBeNull();
      const st = await W.weeklySchemaState();
      expect(st.ready).toBe(true);
      expect(st.revenueReady).toBe(false);
      expect(st.revenueMigration).toBe("0108_weekly_onb_revenue.sql");
    } finally {
      await ctx.pool.query(readFileSync(new URL("../migrations/0108_weekly_onb_revenue.sql", import.meta.url), "utf8"));
    }
  });

  it("brands 표를 건드리지 않는다(존재하지 않아도 접수된다)", async () => {
    // brands 표가 아예 없는 DB 에서도 신청이 저장되면, 고객 원장을 건드리지 않는다는 뜻이다.
    const r = await W.submitWeeklyApplication(TEST_INPUT);
    expect(r.ok).toBe(true);
  });
});
