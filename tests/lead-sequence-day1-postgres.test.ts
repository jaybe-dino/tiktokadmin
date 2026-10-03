// 1일차 "주간 슬롯" 안내 일괄 적용 — 실제 Postgres 로 확인한다.
//   DAY1_TEST_DB_URL 이 있을 때만 돈다. 운영 DB 를 가리키면 안 된다.
//   이 테스트는 문구만 바꾼다 — 발송 경로를 전혀 부르지 않는다(합성 데이터).
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

type Row = Record<string, unknown>;
interface PoolLike {
  query: (s: string, a?: unknown[]) => Promise<{ rows: Row[] }>;
  end: () => Promise<void>;
}
const ctx = vi.hoisted(() => ({ pool: null as never as PoolLike }));
vi.mock("../lib/db", async () => {
  const { Pool } = await import("pg");
  if (process.env.DAY1_TEST_DB_URL) ctx.pool = new Pool({ connectionString: process.env.DAY1_TEST_DB_URL }) as never;
  const query = async (sql: string, args: unknown[] = []) => (await ctx.pool.query(sql, args)).rows;
  return { query, queryOne: async (s: string, a: unknown[] = []) => (await query(s, a))[0] ?? null };
});

const D = await import("../lib/lead-sequence-day1");
const N = await import("../lib/weekly-day1-notice");

const ACTOR = "검수자";
const SMS = "[GloveK]\n안내드립니다.\n▶ 상담\nhttps://example.invalid/consult";
const MAIL = "안녕하세요.\n\n본문입니다.\n\n디노스튜디오 GloveK 드림";

/** 유입 루트 하나와 그 1~2일차 문구를 만든다. */
async function seedChannel(key: string, opts: { sms?: string; mail?: string } = {}) {
  const r = await ctx.pool.query(
    "INSERT INTO intake_channels (key, name) VALUES ($1,$2) RETURNING id::text AS id", [key, `TEST ${key}`]);
  const id = r.rows[0].id as string;
  await ctx.pool.query(
    `INSERT INTO lead_sequence_steps
       (channel_id, day_no, enabled, send_sms, send_email, send_hour, sms_body, email_subject, email_body)
     VALUES ($1::uuid, 1, true, true, true, 9, $2, 'TEST 1일차 제목', $3)`,
    [id, opts.sms ?? SMS, opts.mail ?? MAIL]);
  await ctx.pool.query(
    `INSERT INTO lead_sequence_steps
       (channel_id, day_no, enabled, send_sms, send_email, sms_body, email_subject, email_body)
     VALUES ($1::uuid, 2, true, true, true, 'TEST 2일차 문자', 'TEST 2일차 제목', 'TEST 2일차 메일')`, [id]);
  return id;
}

describe.skipIf(!process.env.DAY1_TEST_DB_URL)("1일차 안내 일괄 적용 (PostgreSQL)", () => {
  beforeAll(async () => {
    await ctx.pool.query(`
      DROP TABLE IF EXISTS lead_sequence_sends, lead_sequence_steps, lead_sequence_config,
        intake_channels, brands CASCADE;
      CREATE TABLE brands (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), brand_name text);
      CREATE TABLE intake_channels (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        key text UNIQUE NOT NULL, name text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now());
    `);
    // 실제 마이그레이션 파일을 그대로 적용한다.
    await ctx.pool.query(readFileSync(new URL("../migrations/0096_lead_sequence.sql", import.meta.url), "utf8"));
  });
  afterAll(async () => { await ctx.pool.end(); });
  beforeEach(async () => {
    await ctx.pool.query("TRUNCATE lead_sequence_steps, lead_sequence_config, intake_channels CASCADE");
  });

  it("미리보기는 저장하지 않는다", async () => {
    await seedChannel("meta");
    const rep = await D.applyDay1Notice({ mode: "apply", dryRun: true, actor: ACTOR });
    expect(rep.dryRun).toBe(true);
    expect(rep.changed).toBe(1);
    expect(rep.rows[0].sms_after).toContain(N.WEEKLY_APPLY_URL);
    const row = await ctx.pool.query("SELECT sms_body, email_body FROM lead_sequence_steps WHERE day_no=1");
    expect(row.rows[0].sms_body).toBe(SMS);          // DB 는 그대로다
    expect(row.rows[0].email_body).toBe(MAIL);
  });

  it("모든 유입 루트의 1일차에 들어간다", async () => {
    for (const k of ["meta", "consult", "tpartners"]) await seedChannel(k);
    const rep = await D.applyDay1Notice({ mode: "apply", dryRun: false, actor: ACTOR });
    expect(rep.changed).toBe(3);
    expect(rep.skipped).toBe(0);
    expect(rep.mismatch).toEqual([]);
    const rows = await ctx.pool.query(
      "SELECT sms_body, email_body FROM lead_sequence_steps WHERE day_no=1");
    expect(rows.rows).toHaveLength(3);
    for (const r of rows.rows) {
      expect(r.sms_body).toContain("주간 슬롯 3개");
      expect(r.sms_body).toContain(N.WEEKLY_APPLY_URL);
      expect(r.email_body).toContain("주간 슬롯 3개");
      expect(String(r.email_body).trim().endsWith("디노스튜디오 GloveK 드림")).toBe(true);
    }
  });

  it("2일차는 건드리지 않는다", async () => {
    await seedChannel("meta");
    await D.applyDay1Notice({ mode: "apply", dryRun: false, actor: ACTOR });
    const d2 = await ctx.pool.query(
      "SELECT sms_body, email_subject, email_body FROM lead_sequence_steps WHERE day_no=2");
    expect(d2.rows[0]).toEqual({
      sms_body: "TEST 2일차 문자", email_subject: "TEST 2일차 제목", email_body: "TEST 2일차 메일",
    });
  });

  it("1일차의 다른 설정(켜짐·발송 채널·시각·제목)도 그대로다", async () => {
    await seedChannel("meta");
    const before = await ctx.pool.query(
      "SELECT enabled, send_sms, send_email, send_hour, email_subject FROM lead_sequence_steps WHERE day_no=1");
    await D.applyDay1Notice({ mode: "apply", dryRun: false, actor: ACTOR });
    const after = await ctx.pool.query(
      "SELECT enabled, send_sms, send_email, send_hour, email_subject FROM lead_sequence_steps WHERE day_no=1");
    expect(after.rows[0]).toEqual(before.rows[0]);
  });

  it("두 번 눌러도 문구가 겹치지 않는다", async () => {
    await seedChannel("meta");
    await D.applyDay1Notice({ mode: "apply", dryRun: false, actor: ACTOR });
    const again = await D.applyDay1Notice({ mode: "apply", dryRun: false, actor: ACTOR });
    expect(again.changed).toBe(0);
    const r = await ctx.pool.query("SELECT sms_body FROM lead_sequence_steps WHERE day_no=1");
    expect(String(r.rows[0].sms_body).split(N.WEEKLY_APPLY_URL)).toHaveLength(2);
  });

  it("되돌리면 원래 문구로 정확히 돌아온다", async () => {
    await seedChannel("meta");
    await D.applyDay1Notice({ mode: "apply", dryRun: false, actor: ACTOR });
    const rep = await D.applyDay1Notice({ mode: "remove", dryRun: false, actor: ACTOR });
    expect(rep.changed).toBe(1);
    const r = await ctx.pool.query("SELECT sms_body, email_body FROM lead_sequence_steps WHERE day_no=1");
    expect(r.rows[0].sms_body).toBe(SMS);
    expect(r.rows[0].email_body).toBe(MAIL);
  });

  it("1일차 문구가 비어 있는 루트는 건너뛴다", async () => {
    await seedChannel("blank", { sms: "", mail: "" });
    const rep = await D.applyDay1Notice({ mode: "apply", dryRun: false, actor: ACTOR });
    expect(rep.changed).toBe(0);
    expect(rep.skipped).toBe(1);
    expect(rep.rows[0].skip).toContain("비어 있어");
    const r = await ctx.pool.query("SELECT sms_body FROM lead_sequence_steps WHERE day_no=1");
    expect(r.rows[0].sms_body).toBe("");
  });

  it("문자가 장문 한도를 넘게 되는 루트는 건너뛴다", async () => {
    await seedChannel("toolong", { sms: "가".repeat(N.LMS_MAX_BYTES / 2) });
    const rep = await D.applyDay1Notice({ mode: "apply", dryRun: false, actor: ACTOR });
    expect(rep.changed).toBe(0);
    expect(rep.rows[0].skip).toContain("장문 한도");
  });

  it("손으로 고친 문구는 자동으로 빼지 않고 그대로 둔다", async () => {
    const id = await seedChannel("edited");
    await ctx.pool.query(
      "UPDATE lead_sequence_steps SET sms_body=$2 WHERE channel_id=$1::uuid AND day_no=1",
      [id, `${SMS}\n\n온보딩 신청은 여기로: ${N.WEEKLY_APPLY_URL}`]);
    const rep = await D.applyDay1Notice({ mode: "remove", dryRun: false, actor: ACTOR });
    expect(rep.rows[0].skip).toContain("손으로 수정");
    const r = await ctx.pool.query("SELECT sms_body FROM lead_sequence_steps WHERE day_no=1");
    expect(String(r.rows[0].sms_body)).toContain("온보딩 신청은 여기로");
  });

  it("1일차 행이 없는 루트는 목록에 나오지 않는다(없는 행을 만들지 않는다)", async () => {
    await ctx.pool.query("INSERT INTO intake_channels (key, name) VALUES ('nostep','TEST 회차없음')");
    const rep = await D.applyDay1Notice({ mode: "apply", dryRun: true, actor: ACTOR });
    expect(rep.rows).toHaveLength(0);
    const n = await ctx.pool.query("SELECT count(*)::int AS n FROM lead_sequence_steps");
    expect(n.rows[0].n).toBe(0);
  });

  it("연속 안내가 꺼진 루트도 문구는 넣되 상태를 바꾸지 않는다", async () => {
    const id = await seedChannel("off");
    await ctx.pool.query("UPDATE lead_sequence_steps SET enabled=false WHERE channel_id=$1::uuid", [id]);
    const rep = await D.applyDay1Notice({ mode: "apply", dryRun: false, actor: ACTOR });
    expect(rep.rows[0].seq_enabled).toBe(false);
    const r = await ctx.pool.query("SELECT enabled, sms_body FROM lead_sequence_steps WHERE day_no=1");
    expect(r.rows[0].enabled).toBe(false);            // 꺼진 채 그대로
    expect(String(r.rows[0].sms_body)).toContain(N.WEEKLY_APPLY_URL);
  });

  it("예약·발송 이력을 만들지 않는다(발송 경로를 타지 않는다)", async () => {
    await seedChannel("meta");
    await D.applyDay1Notice({ mode: "apply", dryRun: false, actor: ACTOR });
    const n = await ctx.pool.query("SELECT count(*)::int AS n FROM lead_sequence_sends");
    expect(n.rows[0].n).toBe(0);
    const b = await ctx.pool.query("SELECT count(*)::int AS n FROM brands");
    expect(b.rows[0].n).toBe(0);
  });
});
