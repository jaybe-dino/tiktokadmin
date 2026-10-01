// Integration regression: run only against an explicitly supplied disposable DB.
// PM_COMMS_TEST_DB_URL must never point at production.
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";
const ctx = vi.hoisted(() => ({ pool: null as any }));
vi.mock("../lib/db", async () => {
  const { Pool } = await import("pg");
  if (process.env.PM_COMMS_TEST_DB_URL) ctx.pool = new Pool({ connectionString: process.env.PM_COMMS_TEST_DB_URL });
  const query = async (sql: string, args: unknown[] = []) => (await ctx.pool.query(sql, args)).rows;
  return { query, queryOne: async (sql: string, args: unknown[] = []) => (await query(sql, args))[0] ?? null };
});
vi.mock("../lib/env", () => ({ env: { gmail: { saKeyJson: "" }, zoom: { webhookSecret: "" } } }));
import { brandCommTimeline } from "../lib/pm-comms";

describe.skipIf(!process.env.PM_COMMS_TEST_DB_URL)("PM conversation channels (PostgreSQL)", () => {
  beforeAll(async () => {
    await ctx.pool.query(`
      CREATE TABLE brand_sources(id text, brand_id text, occurred_at timestamptz, event text, site text, source_url text, payload jsonb);
      CREATE TABLE pm_manual_comms(id text, brand_id text, occurred_at timestamptz, channel text, author text, source_label text, source_url text, body text);
      CREATE TABLE admin_users(active boolean, gmail_sync_enabled boolean);
    `);
  });
  afterAll(async () => { await ctx.pool.end(); });
  beforeEach(async () => {
    await ctx.pool.query("TRUNCATE brand_sources, pm_manual_comms");
    await ctx.pool.query(`INSERT INTO brand_sources VALUES
      ('legacy','brand-a','2026-09-30T09:44:00Z','note','admin',NULL,'{"text":"[카카오톡 원문 · 화면 전사 2/2] 고객 문의내용","by":"operator"}'),
      ('summary','brand-a','2026-09-30T09:43:00Z','note','admin',NULL,'{"text":"[카카오톡 요약] 후속 확인 필요"}'),
      ('ordinary','brand-a','2026-09-30T09:42:00Z','note','admin',NULL,'{"text":"카카오톡 연동 문의 메모"}'),
      ('other','brand-b','2026-09-30T09:44:00Z','note','admin',NULL,'{"text":"[카카오톡 원문] 다른 브랜드 비공개 내용"}');
      INSERT INTO pm_manual_comms VALUES
      ('k1','brand-a','2026-10-01T01:00:00Z','kakao','고객','브랜드 실무방',NULL,'신규 문의내용'),
      ('s1','brand-a','2026-10-01T00:00:00Z','slack','담당자','내부 운영',NULL,'내부 후속 조치'),
      ('m1','brand-a','2026-09-30T23:00:00Z','phone','담당자','유선',NULL,'전화 내용');`);
  });
  it("counts saved Kakao records separately from the unavailable automatic collector", async () => {
    const tl = await brandCommTimeline("brand-a");
    const k = tl.channels.find(c => c.channel === "kakao")!;
    expect(k.query).toBe("ok");
    expect(k.count).toBe(3);
    expect(k.ingest).toBe("none");
    expect(new Date(k.latestAt!).toISOString()).toBe("2026-10-01T01:00:00.000Z");
    expect(tl.total).toBe(6);
    expect(new Set(tl.items.map(i => i.id)).size).toBe(6);
    expect(tl.items.find(i => i.id === "note-legacy")?.channel).toBe("kakao");
    expect(tl.items.find(i => i.id === "note-ordinary")?.channel).toBe("note");
    expect(tl.items.find(i => i.id === "manual-s1")?.channel).toBe("slack");
    expect(tl.items.find(i => i.id === "manual-m1")?.channel).toBe("manual");
    expect(tl.items.some(i => i.bodyFull.includes("다른 브랜드"))).toBe(false);
  });
  it("filters and searches Kakao across both tables without duplicates", async () => {
    const tl = await brandCommTimeline("brand-a", { channels: ["kakao"], q: "문의내용" });
    expect(tl.total).toBe(2);
    expect(tl.items.map(i => i.id)).toEqual(["manual-k1", "note-legacy"]);
    expect(tl.items.every(i => i.channel === "kakao")).toBe(true);
    expect(tl.items[1].bodyFull).toContain("화면 전사");
  });
  it("reports a missing storage table instead of claiming zero saved records", async () => {
    await ctx.pool.query("ALTER TABLE pm_manual_comms RENAME TO unavailable_manual_comms");
    try {
      const tl = await brandCommTimeline("brand-a", { channels: ["kakao"] });
      expect(tl.channels.find(c => c.channel === "kakao")?.query).toBe("error");
      expect(tl.channels.find(c => c.channel === "kakao")?.count).toBeNull();
      expect(tl.partial).toBe(true);
      expect(tl.items).toHaveLength(2);
    } finally { await ctx.pool.query("ALTER TABLE unavailable_manual_comms RENAME TO pm_manual_comms"); }
  });
});
