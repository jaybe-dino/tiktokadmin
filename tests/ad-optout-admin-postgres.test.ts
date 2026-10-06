// 발송제외(수신거부) 명단 관리 — 실제 Postgres 로 등록·검색·해제·이력을 확인한다.
//   OPTOUT_TEST_DB_URL 이 있을 때만 돈다. 운영 DB 를 가리키면 안 된다.
//   주소는 전부 example.invalid / 0100000xxxx 합성 값이다(발송·알림 없음).
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const ctx = vi.hoisted(() => ({ pool: null as never as { query: (s: string, a?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>; end: () => Promise<void> } }));
vi.mock("../lib/db", async () => {
  const { Pool } = await import("pg");
  if (process.env.OPTOUT_TEST_DB_URL) ctx.pool = new Pool({ connectionString: process.env.OPTOUT_TEST_DB_URL }) as never;
  const query = async (sql: string, args: unknown[] = []) => (await ctx.pool.query(sql, args)).rows;
  return {
    query,
    queryOne: async (sql: string, args: unknown[] = []) => (await query(sql, args))[0] ?? null,
    tx: async (fn: (c: { query: (s: string, a?: unknown[]) => Promise<{ rows: unknown[] }> }) => unknown) =>
      fn({ query: async (s: string, a?: unknown[]) => ({ rows: await query(s, a) }) }),
  };
});

const A = await import("../lib/ad-optout");

const ACTOR = "TEST 담당자";

describe.skipIf(!process.env.OPTOUT_TEST_DB_URL)("발송제외 명단 관리 (PostgreSQL)", () => {
  beforeAll(async () => {
    await ctx.pool.query(`
      DROP TABLE IF EXISTS ad_optout_events, ad_optouts, ad_recipients, brands CASCADE;
      CREATE EXTENSION IF NOT EXISTS pgcrypto;
      CREATE TABLE brands(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), brand_name text NOT NULL);
    `);
    await ctx.pool.query(readFileSync(new URL("../migrations/0098_ad_optout.sql", import.meta.url), "utf8"));
    await ctx.pool.query(readFileSync(new URL("../migrations/0112_ad_optout_admin.sql", import.meta.url), "utf8"));
  });
  afterAll(async () => { await ctx.pool.end(); });
  beforeEach(async () => { await ctx.pool.query("TRUNCATE ad_optout_events, ad_optouts, ad_recipients"); });

  it("마이그레이션이 들어가면 준비 완료로 읽는다", async () => {
    const s = await A.optOutSchemaState();
    expect(s.ready).toBe(true);
    expect(s.missing).toEqual([]);
  });

  it("수동 등록이 저장되고 원문 주소는 돌려주지 않는다", async () => {
    const r = await A.addOptOutManual({ value: "Stop.Me@Example.invalid", reason: "전화로 거부 요청" }, ACTOR);
    expect(r.ok).toBe(true);
    expect(r.added).toBe(1);
    expect(r.note ?? "").not.toContain("stop.me@example.invalid");

    const rows = await ctx.pool.query("SELECT kind, addr, addr_masked, source, note FROM ad_optouts");
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].kind).toBe("email");
    expect(rows.rows[0].addr).toBe("stop.me@example.invalid");   // 정규화(소문자)
    expect(rows.rows[0].source).toBe("admin");
    expect(rows.rows[0].note).toBe("전화로 거부 요청");

    // 목록도 가린 주소만 준다.
    const list = await A.listOptOuts({});
    expect(list.total).toBe(1);
    expect(list.rows[0].addr_masked).toContain("*");
    expect(JSON.stringify(list.rows)).not.toContain("stop.me@example.invalid");
  });

  it("전화번호는 숫자만 남겨 저장하고 국제표기도 같은 사람으로 본다", async () => {
    const a = await A.addOptOutManual({ value: "010-0000-1234", reason: "문자 거부" }, ACTOR);
    expect(a.added).toBe(1);
    const b = await A.addOptOutManual({ value: "+82 10 0000 1234", reason: "재요청" }, ACTOR);
    expect(b.ok).toBe(true);
    expect(b.added).toBe(0);                      // 새로 만들지 않는다
    const rows = await ctx.pool.query("SELECT addr, confirm_count FROM ad_optouts");
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].addr).toBe("01000001234");
    expect(rows.rows[0].confirm_count).toBe(2);   // 확인 횟수만 올라간다
  });

  it("형식이 틀린 입력은 저장하지 않는다", async () => {
    for (const bad of ["", "   ", "골뱅이없음", "a@b", "010-123"]) {
      const r = await A.addOptOutManual({ value: bad, reason: "x" }, ACTOR);
      expect(r.ok, bad).toBe(false);
    }
    const n = await ctx.pool.query("SELECT count(*)::int AS n FROM ad_optouts");
    expect(n.rows[0].n).toBe(0);
  });

  it("검색은 전체 주소가 정확히 같을 때만 찾는다(부분 검색으로 명단을 훑을 수 없다)", async () => {
    await A.addOptOutManual({ value: "exact@example.invalid", reason: "거부" }, ACTOR);
    await A.addOptOutManual({ value: "01000005555", reason: "거부" }, ACTOR);

    expect((await A.listOptOuts({ q: "exact@example.invalid" })).total).toBe(1);
    expect((await A.listOptOuts({ q: "EXACT@Example.INVALID" })).total).toBe(1);   // 정규화는 통한다
    expect((await A.listOptOuts({ q: "exact" })).total).toBe(0);                    // 부분 검색은 안 된다
    expect((await A.listOptOuts({ q: "example.invalid" })).total).toBe(0);
    expect((await A.listOptOuts({ q: "010-0000-5555" })).total).toBe(1);
    expect((await A.listOptOuts({ q: "5555" })).total).toBe(0);

    expect((await A.listOptOuts({ kind: "email" })).total).toBe(1);
    expect((await A.listOptOuts({ kind: "phone" })).total).toBe(1);
    expect((await A.listOptOuts({})).total).toBe(2);
  });

  it("고객이 직접 누른 수신거부는 담당자가 해제할 수 없다", async () => {
    await ctx.pool.query(
      `INSERT INTO ad_optouts (purpose, kind, addr, addr_masked, source)
       VALUES ('marketing','email','self@example.invalid','se**@example.invalid','link')`);
    const id = String((await ctx.pool.query("SELECT id::text AS id FROM ad_optouts")).rows[0].id);

    const r = await A.removeOptOut(id, "실수로 들어간 것 같아서", ACTOR);
    expect(r.ok).toBe(false);
    expect(r.error ?? "").toContain("해제할 수 없습니다");
    expect((await ctx.pool.query("SELECT count(*)::int AS n FROM ad_optouts")).rows[0].n).toBe(1);
    // 거부되면 이력도 남기지 않는다(지운 적이 없으므로).
    expect((await ctx.pool.query("SELECT count(*)::int AS n FROM ad_optout_events WHERE action='remove'")).rows[0].n).toBe(0);
  });

  it("담당자가 넣은 건은 사유를 적어야 해제되고 이력이 남는다", async () => {
    await A.addOptOutManual({ value: "wrong@example.invalid", reason: "오등록" }, ACTOR);
    const id = String((await ctx.pool.query("SELECT id::text AS id FROM ad_optouts")).rows[0].id);

    const noReason = await A.removeOptOut(id, "   ", ACTOR);
    expect(noReason.ok).toBe(false);
    expect((await ctx.pool.query("SELECT count(*)::int AS n FROM ad_optouts")).rows[0].n).toBe(1);

    const ok = await A.removeOptOut(id, "동명이인 오등록 확인", ACTOR);
    expect(ok.ok).toBe(true);
    expect((await ctx.pool.query("SELECT count(*)::int AS n FROM ad_optouts")).rows[0].n).toBe(0);

    const ev = await A.listOptOutEvents(10);
    expect(ev.map((e) => e.action)).toEqual(["remove", "add"]);
    expect(ev[0].reason).toBe("동명이인 오등록 확인");
    expect(ev[0].actor).toBe(ACTOR);
    // 이력에도 원문 주소는 남기지 않는다.
    expect(JSON.stringify(ev)).not.toContain("wrong@example.invalid");
    const fp = await ctx.pool.query("SELECT addr_fingerprint FROM ad_optout_events ORDER BY at");
    expect(new Set(fp.rows.map((r) => r.addr_fingerprint)).size).toBe(1);  // 같은 주소 = 같은 지문
    expect(String(fp.rows[0].addr_fingerprint)).toBe(A.addrFingerprint("email", "WRONG@example.invalid"));
  });

  it("없는 id 해제는 조용히 성공하지 않는다", async () => {
    const r = await A.removeOptOut("00000000-0000-0000-0000-000000000000", "확인", ACTOR);
    expect(r.ok).toBe(false);
    expect(r.error ?? "").toContain("찾지 못했습니다");
  });

  it("일괄 등록은 한 건이 틀려도 나머지를 넣고 실패를 가려서 알려준다", async () => {
    const r = await A.addOptOutsBulk(
      "bulk1@example.invalid\n010-0000-7777, bulk1@example.invalid\n형식틀림\n",
      "일괄 반입", ACTOR);
    expect(r.added).toBe(2);        // 중복 입력은 하나로 접힌다
    expect(r.already).toBe(0);
    expect(r.failed).toHaveLength(1);
    expect(JSON.stringify(r.failed)).not.toContain("형식틀림");
    expect((await A.listOptOuts({})).total).toBe(2);

    // 두 번째 일괄 등록은 전부 "이미 있음"이다.
    const again = await A.addOptOutsBulk("bulk1@example.invalid\n01000007777", "재확인", ACTOR);
    expect(again.added).toBe(0);
    expect(again.already).toBe(2);
    expect((await A.listOptOuts({})).total).toBe(2);
  });

  it("집계가 수단·경로별로 맞는다", async () => {
    await A.addOptOutManual({ value: "c1@example.invalid", reason: "r" }, ACTOR);
    await A.addOptOutManual({ value: "01000008888", reason: "r" }, ACTOR);
    await ctx.pool.query(
      `INSERT INTO ad_optouts (purpose, kind, addr, addr_masked, source)
       VALUES ('marketing','email','link@example.invalid','li**@example.invalid','link')`);
    const c = await A.optOutCounts();
    expect(c.total).toBe(3);
    expect(c.email).toBe(2);
    expect(c.phone).toBe(1);
    expect(c.bySource.admin).toBe(2);
    expect(c.bySource.link).toBe(1);
  });

  it("명단에 있으면 adGate 가 문자·메일 모두 막는다(한쪽만 거부해도)", async () => {
    await A.addOptOutManual({ value: "gate@example.invalid", reason: "거부" }, ACTOR);
    const g = await A.adGate({ email: "gate@example.invalid", phone: "01000009999" });
    expect(g.emailAllowed).toBe(false);
    expect(g.smsAllowed).toBe(false);
    expect(g.error).toBeUndefined();
    expect(g.reason ?? "").toContain("수신거부");

    const free = await A.adGate({ email: "free@example.invalid", phone: "01000001111" });
    expect(free.emailAllowed).toBe(true);
    expect(free.smsAllowed).toBe(true);
  });

  it("브랜드 전체 수신거부는 명단과 별개로 그대로 막는다", async () => {
    const g = await A.adGate({ email: "any@example.invalid", phone: "01000002222", brandOptOut: true });
    expect(g.emailAllowed).toBe(false);
    expect(g.smsAllowed).toBe(false);
    expect(g.reason ?? "").toContain("전체 수신거부");
  });

  it("페이지 나누기가 동작한다", async () => {
    for (let i = 0; i < 12; i++) {
      await A.addOptOutManual({ value: `page-${i}@example.invalid`, reason: "r" }, ACTOR);
    }
    const p1 = await A.listOptOuts({ page: 1, pageSize: 10 });
    expect(p1.total).toBe(12);
    expect(p1.rows).toHaveLength(10);
    expect(p1.pages).toBe(2);
    const p2 = await A.listOptOuts({ page: 2, pageSize: 10 });
    expect(p2.rows).toHaveLength(2);
    const ids = new Set([...p1.rows, ...p2.rows].map((r) => r.id));
    expect(ids.size).toBe(12);
  });
});
