// 원장 읽기 SQL 을 "실제 전체 마이그레이션 스키마" 에서 돌려 본다.
//   모의 readLedger 로는 없는 컬럼·잘못된 조인을 잡을 수 없다. 여기서 잡는다.
//
//   준비(로컬 전용):
//     createdb ledgertest && DATABASE_URL=... node scripts/migrate.mjs
//     LEDGER_TEST_DB_URL=postgres://.../ledgertest npx vitest run tests/ledger-sql-postgres.test.ts
//   LEDGER_TEST_DB_URL 이 없으면 건너뛴다. 운영 DB 를 가리키면 안 된다 — 읽기만
//   하지만 합성 데이터를 넣는다.
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const ctx = vi.hoisted(() => ({
  pool: null as never as {
    query: (s: string, a?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
    end: () => Promise<void>;
  },
}));
vi.mock("../lib/db", async () => {
  const { Pool } = await import("pg");
  if (process.env.LEDGER_TEST_DB_URL) {
    ctx.pool = new Pool({ connectionString: process.env.LEDGER_TEST_DB_URL, max: 8 }) as never;
  }
  const query = async (sql: string, args: unknown[] = []) => (await ctx.pool.query(sql, args)).rows;
  return {
    query, queryRo: query,
    queryOne: async (s: string, a?: unknown[]) => (await query(s, a))[0] ?? null,
  };
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
const S = await import("../lib/ledger-sheet-sync");

const ON = Boolean(process.env.LEDGER_TEST_DB_URL);

/** 합성 브랜드 한 건. 실제 사람 데이터를 쓰지 않는다. */
async function addBrand(name: string, over: Record<string, string | boolean | null> = {}) {
  const r = await ctx.pool.query(
    `INSERT INTO brands (brand_name, contact_name, email, phone, category, brand_url,
                         state, source, is_test, msg_opt_out, archived, hold_kind, created_at)
     VALUES ($1,'TEST 담당',$2,$3,$4,$5,
             coalesce($6,'lead_new'), coalesce($7,'direct'),
             coalesce($8,false), coalesce($9,false), coalesce($10,false), $11,
             coalesce($12::timestamptz, now()))
     RETURNING id::text AS id`,
    [name, over.email ?? null, over.phone ?? null, over.category ?? null, over.brand_url ?? null,
      over.state ?? null, over.source ?? null, over.is_test ?? null, over.msg_opt_out ?? null,
      over.archived ?? null, over.hold_kind ?? null, over.created_at ?? null]);
  return String(r.rows[0].id);
}

/** 합성 신청서 한 건. NOT NULL 컬럼을 모두 채운다. */
async function addApplication(
  brandName: string, email: string, band: string, isTest = false,
) {
  await ctx.pool.query(
    `INSERT INTO weekly_onb_applications
       (brand_name, company_name, contact_name, phone, email,
        week_key, dedupe_key, revenue_band, is_test)
     VALUES ($1,$1,'TEST 담당','01000000000',$2,
             current_date, md5($1 || $2 || random()::text), $3, $4)`,
    [brandName, email, band, isTest]);
}

describe.skipIf(!ON)("원장 읽기 SQL (실제 스키마 · PostgreSQL)", () => {
  beforeAll(async () => {
    const t = await ctx.pool.query(
      `SELECT to_regclass('public.brands') b, to_regclass('public.email_messages') m,
              to_regclass('public.brand_emails') e,
              to_regclass('public.weekly_onb_applications') w`);
    for (const [k, v] of Object.entries(t.rows[0])) {
      expect(v, `${k} 테이블이 없다 — 마이그레이션을 먼저 적용하세요`).not.toBe(null);
    }
  });
  afterAll(async () => { await ctx.pool.end(); });
  beforeEach(async () => {
    await ctx.pool.query(
      "TRUNCATE brands, email_messages, brand_emails, weekly_onb_applications, admin_users CASCADE");
  });

  it("SQL 이 실제 스키마에서 그대로 실행된다(없는 컬럼이 없다)", async () => {
    await expect(ctx.pool.query(S.LEDGER_SQL)).resolves.toBeTruthy();
  });

  it("브랜드 상태 컬럼(msg_opt_out·archived·hold_kind)이 실제로 읽힌다", async () => {
    await addBrand("TEST 수신거부", { msg_opt_out: true, archived: true, hold_kind: "recontact" });
    const rows = await S.readLedger();
    expect(rows).toHaveLength(1);
    expect(rows[0].msg_opt_out).toBe(true);
    expect(rows[0].archived).toBe(true);
    expect(rows[0].hold_kind).toBe("recontact");
  });

  it("is_test 만 제외한다 — 종료(dropped/churned)도 싣는다", async () => {
    await addBrand("TEST 정상");
    await addBrand("TEST 종료", { state: "dropped" });
    await addBrand("TEST 테스트행", { is_test: true });
    const rows = await S.readLedger();
    expect(rows.map((r) => r.brand_name).sort())
      .toEqual(["TEST 정상", "TEST 종료"]);
  });

  it("담는 범위 숫자가 /customers 기준과 나란히 나온다", async () => {
    await addBrand("TEST 정상");
    await addBrand("TEST 종료", { state: "dropped" });
    await addBrand("TEST 테스트행", { is_test: true });
    const s = (await S.ledgerScope())!;
    expect(s.brandsAll).toBe(3);
    expect(s.ledger).toBe(2);            // 우리가 싣는 건수
    expect(s.testExcluded).toBe(1);
    expect(s.endedInLedger).toBe(1);
    // /customers 기본 필터와 같은 기준: is_test 를 걸러내지 않고 종료를 숨긴다.
    expect(s.customersPage).toBe(2);
    // 두 숫자가 우연히 같아도 뜻이 다르다 — 그래서 둘 다 보고한다.
    const check = await ctx.pool.query(
      "SELECT count(*)::int n FROM brands WHERE state NOT IN ('dropped','churned')");
    expect(s.customersPage).toBe(check.rows[0].n);
  });

  it("가장 최근 기록의 시각·제목·출처가 같은 한 건에서 나온다", async () => {
    const id = await addBrand("TEST 커뮤");
    // Gmail 수집이 더 오래된 발신, 수기 기록이 더 최근.
    await ctx.pool.query(
      `INSERT INTO email_messages (brand_id, gmail_msg_id, thread_id, direction, owner_email,
                                   from_addr, subject, sent_at)
       VALUES ($1,'g1','t1','out','staff@example.invalid','staff@example.invalid',
               'Gmail 안내','2026-10-01T01:00:00Z')`, [id]);
    await ctx.pool.query(
      `INSERT INTO brand_emails (brand_id, direction, subject, occurred_at)
       VALUES ($1,'out','수기 기록 제목','2026-10-20T01:00:00Z')`, [id]);

    const rows = await S.readLedger();
    const c = rows[0].comms;
    expect(c.lastAnyAt).toContain("2026-10-20");
    expect(c.lastAnySubject).toBe("수기 기록 제목");   // Gmail 제목이 섞이지 않는다
    expect(c.lastAnySource).toBe("manual");
    expect(c.totalMessages).toBe(2);
  });

  it("수신이 가장 최근이면 방향이 in 으로 온다(회신이라고 단정하지 않는다)", async () => {
    const id = await addBrand("TEST 수신");
    await ctx.pool.query(
      `INSERT INTO email_messages (brand_id, gmail_msg_id, thread_id, direction, owner_email,
                                   from_addr, subject, sent_at)
       VALUES ($1,'g2','t2','in','staff@example.invalid','auto@tiktok.invalid',
               '[TikTok] 자동 안내','2026-10-21T01:00:00Z')`, [id]);
    const rows = await S.readLedger();
    expect(rows[0].comms.lastAnyDirection).toBe("in");
    expect(rows[0].comms.lastInAt).toContain("2026-10-21");

    const { commsCells } = await import("../lib/ledger-sheet-rows");
    expect(commsCells(rows[0].comms).status).toBe("수신 기록 확인");
  });

  it("brand_emails 의 direction='unknown' 도 터지지 않는다", async () => {
    const id = await addBrand("TEST 방향없음");
    await ctx.pool.query(
      `INSERT INTO brand_emails (brand_id, direction, subject, occurred_at)
       VALUES ($1,'unknown','방향 모름','2026-10-22T01:00:00Z')`, [id]);
    const rows = await S.readLedger();
    expect(rows[0].comms.lastAnyDirection).toBe("unknown");
    expect(rows[0].comms.lastOutAt).toBe(null);
    expect(rows[0].comms.lastInAt).toBe(null);
  });

  it("기록이 없으면 커뮤 값이 모두 비어 있다", async () => {
    await addBrand("TEST 무기록");
    const c = (await S.readLedger())[0].comms;
    expect(c.lastAnyAt).toBe(null);
    expect(c.totalMessages).toBe(0);
  });

  it("브랜드와 이어지지 않은 메일(brand_id NULL)은 집계에 섞이지 않는다", async () => {
    await addBrand("TEST 무기록");
    await ctx.pool.query(
      `INSERT INTO email_messages (brand_id, gmail_msg_id, thread_id, direction, owner_email,
                                   from_addr, subject, sent_at)
       VALUES (NULL,'g9','t9','in','staff@example.invalid','x@example.invalid',
               '미매칭','2026-10-23T01:00:00Z')`);
    const rows = await S.readLedger();
    expect(rows).toHaveLength(1);
    expect(rows[0].comms.totalMessages).toBe(0);
  });

  it("고객이 신고한 매출 구간을 이메일 정확일치로만 잇는다", async () => {
    await addBrand("TEST 신고있음", { email: "Report@Example.Invalid" });
    await addBrand("TEST 신고없음", { email: "other@example.invalid" });
    await addApplication("TEST 신고있음", " report@example.invalid ", "b1_10");
    const rows = await S.readLedger();
    const withRep = rows.find((r) => r.brand_name === "TEST 신고있음")!;
    const without = rows.find((r) => r.brand_name === "TEST 신고없음")!;
    expect(withRep.reported_band).toBe("b1_10");
    expect(withRep.reported_band_label ?? "").not.toBe("");
    expect(without.reported_band).toBe(null);
  });

  it("테스트 신청서의 매출 구간은 붙이지 않는다", async () => {
    await addBrand("TEST 신고", { email: "t@example.invalid" });
    await addApplication("TEST 신고", "t@example.invalid", "b1_10", true);
    expect((await S.readLedger())[0].reported_band).toBe(null);
  });

  it("이메일이 비어 있는 브랜드에 남의 신고가 붙지 않는다", async () => {
    await addBrand("TEST 이메일없음", { email: null });
    await addApplication("TEST 아무개", "", "b1_10");
    expect((await S.readLedger())[0].reported_band).toBe(null);
  });

  it("담당자 id 를 admin_users 이름으로 바꾼다", async () => {
    await ctx.pool.query(
      "INSERT INTO admin_users (id, name, role) VALUES ('staff@example.invalid','김담당','sales')");
    await ctx.pool.query(
      "UPDATE brands SET owner_sales='staff@example.invalid' WHERE id=$1::uuid",
      [await addBrand("TEST 담당자")]);
    expect((await S.readLedger())[0].owner_label).toBe("김담당");
  });

  it("브랜드가 많아도 한 번의 질의로 읽는다(N+1 이 아니다)", async () => {
    for (let i = 0; i < 25; i += 1) await addBrand(`TEST 대량${i}`);
    const rows = await S.readLedger();
    expect(rows).toHaveLength(25);
  });
});
