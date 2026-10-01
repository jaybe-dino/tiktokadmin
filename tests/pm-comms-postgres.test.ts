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
    // 같은 DB 에 다시 돌려도 되게 매번 새로 만든다(이전 실행이 남아 있어도 실패하지 않는다).
    await ctx.pool.query(`
      DROP TABLE IF EXISTS brand_sources, pm_manual_comms, admin_users;
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
      ('mention','brand-a','2026-09-30T09:41:00Z','note','admin',NULL,'{"text":"카카오톡으로 안내 드렸습니다"}'),
      ('pay','brand-a','2026-09-30T09:40:00Z','note','admin',NULL,'{"text":"카카오페이 결제 확인"}'),
      ('alrim','brand-a','2026-09-30T09:39:00Z','note','admin',NULL,'{"text":"[카카오 알림톡 발송] 완료"}'),
      ('scr1','brand-a','2026-09-30T09:38:00Z','note','admin',NULL,'{"text":"카카오 화면 전사 1/2 — 고객 요청 정리"}'),
      ('brk','brand-a','2026-09-30T09:37:00Z','note','admin',NULL,'{"text":"[카카오톡] 9/30 대화"}'),
      ('kt','brand-a','2026-09-30T09:36:00Z','note','admin',NULL,'{"text":"카톡 · 9/30 대화 정리"}'),
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
    expect(k.count).toBe(6);   // 수동 등록 1 + 머리말 메모 5
    expect(k.ingest).toBe("none");
    expect(new Date(k.latestAt!).toISOString()).toBe("2026-10-01T01:00:00.000Z");
    // 가장 최근 기록이 사람이 적어 넣은 대화면 "대화 시각"으로 표시한다.
    expect(k.latestKind).toBe("conversation");
    expect(tl.total).toBe(12);
    expect(new Set(tl.items.map(i => i.id)).size).toBe(12);
    expect(tl.items.find(i => i.id === "note-legacy")?.channel).toBe("kakao");
    expect(tl.items.find(i => i.id === "note-ordinary")?.channel).toBe("note");
    // 머리말로 시작하는 기존 메모는 카카오로 분류한다(증거 ID 는 그대로).
    for (const id of ["note-scr1", "note-brk", "note-kt"]) {
      expect(tl.items.find(i => i.id === id)?.channel, id).toBe("kakao");
    }
    // 단순 언급·다른 카카오 서비스는 채널을 바꾸지 않는다.
    for (const id of ["note-mention", "note-pay", "note-alrim"]) {
      expect(tl.items.find(i => i.id === id)?.channel, id).toBe("note");
    }
    expect(tl.items.find(i => i.id === "manual-s1")?.channel).toBe("slack");
    expect(tl.items.find(i => i.id === "manual-m1")?.channel).toBe("manual");
    expect(tl.items.some(i => i.bodyFull.includes("다른 브랜드"))).toBe(false);
  });
  it("marks a legacy note timestamp as a stored time, not a received time", async () => {
    // 수동 등록 대화를 빼면 카카오의 최근 기록은 메모뿐 — 이때는 "저장 시각"이어야 한다.
    await ctx.pool.query("DELETE FROM pm_manual_comms WHERE channel='kakao'");
    const tl = await brandCommTimeline("brand-a", { channels: ["kakao"] });
    const k = tl.channels.find(c => c.channel === "kakao")!;
    expect(k.count).toBe(5);
    expect(k.latestKind).toBe("stored");
    expect(k.ingest).toBe("none");
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
      // 수동 등록 표가 없어도 기존 메모에서 분류한 카카오 기록은 그대로 보인다.
      expect(tl.items).toHaveLength(5);
    } finally { await ctx.pool.query("ALTER TABLE unavailable_manual_comms RENAME TO pm_manual_comms"); }
  });
});
