// 세미나 모집 허브 — 실제 Postgres 로 저장·중복·행사간 분리·외부 인증을 확인한다.
//   SEV_TEST_DB_URL 이 있을 때만 돈다. 운영 DB 를 가리키면 안 된다.
//   넣는 데이터는 전부 example.invalid 를 쓰는 합성 값이다(고객 발송·알림 없음).
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

type Row = Record<string, unknown>;
interface PoolLike {
  query: (s: string, a?: unknown[]) => Promise<{ rows: Row[] }>;
  connect: () => Promise<{ query: (s: string, a?: unknown[]) => Promise<{ rows: Row[] }>; release: () => void }>;
  end: () => Promise<void>;
}
const ctx = vi.hoisted(() => ({ pool: null as never as PoolLike }));

vi.mock("../lib/db", async () => {
  const { Pool } = await import("pg");
  if (process.env.SEV_TEST_DB_URL) ctx.pool = new Pool({ connectionString: process.env.SEV_TEST_DB_URL }) as never;
  const query = async (sql: string, args: unknown[] = []) => (await ctx.pool.query(sql, args)).rows;
  return {
    query,
    queryOne: async (sql: string, args: unknown[] = []) => (await query(sql, args))[0] ?? null,
    tx: async (fn: (c: unknown) => Promise<unknown>) => {
      const c = await ctx.pool.connect();
      try {
        await c.query("BEGIN");
        const out = await fn(c);
        await c.query("COMMIT");
        return out;
      } catch (e) { await c.query("ROLLBACK"); throw e; } finally { c.release(); }
    },
  };
});
// 쿠키를 읽는 경로는 이 테스트에서 쓰지 않는다(토큰 짝을 직접 넘기는 함수로 검증한다).
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }) }));

const S = await import("../lib/seminar-events");
const SH = await import("../lib/seminar-event-share");
const M = await import("../lib/seminar-events-model");

const ACTOR = "staff@example.invalid";
const applicant = (n: string) => ({
  companyName: `TEST 회사 ${n}`, brandName: `TEST 브랜드 ${n}`,
  contactName: `TEST 담당 ${n}`, contactTitle: "팀장",
  phone: `0100000${n.padStart(4, "0")}`, email: `sev-${n}@example.invalid`,
  siteUrl: "test-brand.example.com", countries: "일본", note: "TEST 문의",
  privacyAgreed: true,
});

/** 공개·접수중 행사를 하나 만든다. */
async function openEvent(slug: string, extra: Partial<Parameters<typeof S.saveEvent>[0]> = {}) {
  const r = await S.saveEvent({
    slug, title: `TEST ${slug}`, mode: "online",
    status: "open", publish: true, apply_open: true, ...extra,
  }, ACTOR);
  expect(r.ok, r.error).toBe(true);
  return r.id as string;
}

describe.skipIf(!process.env.SEV_TEST_DB_URL)("세미나 모집 허브 (PostgreSQL)", () => {
  beforeAll(async () => {
    await ctx.pool.query(`
      DROP TABLE IF EXISTS sev_share_attempts, sev_share_sessions, sev_shares,
        sev_reg_events, sev_registrations, sev_events, sev_files, admin_users, brands CASCADE;
      CREATE TABLE admin_users(id text PRIMARY KEY, name text, active boolean);
      INSERT INTO admin_users VALUES ('${ACTOR}','TEST 직원', true);
      -- 브랜드 원장이 건드려지지 않는지 보기 위한 합성 표.
      CREATE TABLE brands(id serial PRIMARY KEY, brand_name text, updated_at timestamptz DEFAULT now());
      INSERT INTO brands (brand_name) VALUES ('TEST 기존브랜드');
    `);
    // 실제 마이그레이션 파일을 그대로 적용한다(파일과 코드가 어긋나면 여기서 터진다).
    await ctx.pool.query(readFileSync(new URL("../migrations/0109_seminar_events.sql", import.meta.url), "utf8"));
  });
  afterAll(async () => { await ctx.pool.end(); });
  beforeEach(async () => {
    await ctx.pool.query(`TRUNCATE sev_share_attempts, sev_share_sessions, sev_shares,
      sev_reg_events, sev_registrations CASCADE`);
    await ctx.pool.query("DELETE FROM sev_events WHERE created_by <> 'seed:0109'");
  });

  it("스키마를 올바로 읽는다", async () => {
    const st = await S.sevSchemaState();
    expect(st.ready).toBe(true);
    expect(st.missing).toEqual([]);
  });

  // ── 초기 초안 ──
  it("초기 행사 5건이 전부 초안·비공개로 들어있다", async () => {
    const all = await S.listAllEvents();
    const seeds = all.filter((e) => e.created_by === "seed:0109");
    expect(seeds).toHaveLength(5);
    for (const e of seeds) {
      expect(e.status).toBe("draft");
      expect(e.publish).toBe(false);
      expect(e.apply_open).toBe(false);
      expect(e.online_url).toBe("");
    }
  });
  it("초안은 공개 목록·공개 상세에 나오지 않는다", async () => {
    expect(await S.listPublicEvents()).toEqual([]);
    expect(await S.getPublicEvent("weekly-tiktokshop-online")).toBeNull();
  });
  it("시간 미확정 행사는 time_tbd 로 들어가 시간을 꾸미지 않는다", async () => {
    const e = await S.getEventBySlug("hanjin-oneclick-connect-1022");
    expect(e?.time_tbd).toBe(true);
    expect(e?.venue_note).toContain("미확인");
    expect(M.fmtWhen(e!)).toMatch(/시간 미정$/);
  });
  it("반복 일정은 다음 회차가 10월 5일 10:30 KST 로 보인다", async () => {
    const e = await S.getEventBySlug("weekly-tiktokshop-online");
    expect(M.fmtWhen(e!)).toContain("2026년 10월 5일(월) 10:30");
  });
  it("마이그레이션을 두 번 적용해도 초안이 늘거나 덮이지 않는다", async () => {
    await ctx.pool.query(readFileSync(new URL("../migrations/0109_seminar_events.sql", import.meta.url), "utf8"));
    const again = (await S.listAllEvents()).filter((e) => e.created_by === "seed:0109");
    expect(again).toHaveLength(5);
  });

  // ── 행사 저장 ──
  it("행사를 만들면 공개 목록에 반영된다", async () => {
    await openEvent("test-open-1");
    const pub = await S.listPublicEvents();
    expect(pub.map((e) => e.slug)).toContain("test-open-1");
  });
  it("같은 slug 는 두 번 만들 수 없다", async () => {
    await openEvent("test-dup");
    const r = await S.saveEvent({ slug: "test-dup", title: "다시", mode: "online", status: "open" }, ACTOR);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/이미 있습니다/);
  });
  it("초안 상태로는 공개할 수 없다", async () => {
    const r = await S.saveEvent({ slug: "test-draft-pub", title: "초안", mode: "online", status: "draft", publish: true }, ACTOR);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/초안/);
  });
  it("참가 링크가 없으면 링크 공개를 켤 수 없다", async () => {
    const r = await S.saveEvent({ slug: "test-nolink", title: "링크없음", mode: "online", status: "open", show_online_url: true }, ACTOR);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/참가 링크/);
  });
  it("종료가 시작보다 앞서면 저장하지 않는다", async () => {
    const r = await S.saveEvent({
      slug: "test-badtime", title: "시간역전", mode: "online", status: "open",
      startsAtLocal: "2026-10-06T13:00:00+09:00", endsAtLocal: "2026-10-06T12:00:00+09:00",
    }, ACTOR);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/앞설 수 없습니다/);
  });
  it("상태 토글은 공개 가능 조건을 다시 본다", async () => {
    const id = await openEvent("test-flags");
    // 초안으로 되돌리면 공개가 함께 내려간다("공개된 초안"을 남기지 않는다).
    expect((await S.setEventFlags(id, { status: "draft" })).ok).toBe(true);
    expect((await S.getEvent(id))?.publish).toBe(false);
    expect(await S.getPublicEvent("test-flags")).toBeNull();
    // 초안인 채로 공개를 켜 달라는 요청은 거절한다.
    const r = await S.setEventFlags(id, { publish: true });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/초안/);
  });
  it("종료된 행사도 지워지지 않고 이력으로 남는다", async () => {
    const id = await openEvent("test-done");
    await S.setEventFlags(id, { status: "done" });
    const pub = await S.listPublicEvents();
    const row = pub.find((e) => e.slug === "test-done");
    expect(row?.status).toBe("done");
  });

  // ── 신청 접수 ──
  it("신청이 저장되고 동의 시각·버전이 남는다", async () => {
    await openEvent("test-apply");
    const r = await S.submitRegistration("test-apply", { ...applicant("1"), marketingAgreed: true });
    expect(r.ok, r.error).toBe(true);
    const { rows } = await ctx.pool.query(
      "SELECT privacy_agreed, privacy_agreed_at, marketing_agreed, marketing_agreed_at, consent_version, status, source FROM sev_registrations");
    expect(rows[0].privacy_agreed).toBe(true);
    expect(rows[0].privacy_agreed_at).not.toBeNull();
    expect(rows[0].marketing_agreed).toBe(true);
    expect(rows[0].marketing_agreed_at).not.toBeNull();
    expect(rows[0].consent_version).toBe(M.CONSENT_VERSION);
    expect(rows[0].status).toBe("applied");   // 접수 ≠ 확정
    expect(rows[0].source).toBe("seminar_event");
  });
  it("마케팅 동의를 안 하면 동의 시각이 비어 있고 접수는 된다", async () => {
    await openEvent("test-apply2");
    expect((await S.submitRegistration("test-apply2", applicant("2"))).ok).toBe(true);
    const { rows } = await ctx.pool.query("SELECT marketing_agreed, marketing_agreed_at FROM sev_registrations");
    expect(rows[0].marketing_agreed).toBe(false);
    expect(rows[0].marketing_agreed_at).toBeNull();
  });
  it("개인정보 동의가 없으면 접수하지 않는다", async () => {
    await openEvent("test-noconsent");
    const r = await S.submitRegistration("test-noconsent", { ...applicant("3"), privacyAgreed: false });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/동의/);
    const { rows } = await ctx.pool.query("SELECT count(*)::int AS n FROM sev_registrations");
    expect(rows[0].n).toBe(0);
  });
  it("필수값·형식을 서버에서 검사한다", async () => {
    await openEvent("test-valid");
    const bad = [
      [{ companyName: "" }, /회사명/],
      [{ contactName: "" }, /담당자명/],
      [{ email: "a@b" }, /이메일/],
      [{ phone: "123" }, /연락처/],
      [{ siteUrl: "그냥글자" }, /사이트/],
    ] as const;
    for (const [patch, re] of bad) {
      const r = await S.submitRegistration("test-valid", { ...applicant("9"), ...patch });
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(re);
    }
  });
  it("같은 행사·같은 연락처 재제출은 1건으로 남는다", async () => {
    await openEvent("test-dedupe");
    const a = await S.submitRegistration("test-dedupe", applicant("5"));
    const b = await S.submitRegistration("test-dedupe", applicant("5"));
    expect(a.already).toBe(false);
    expect(b.already).toBe(true);
    expect(b.id).toBe(a.id);
    const { rows } = await ctx.pool.query("SELECT count(*)::int AS n FROM sev_registrations");
    expect(rows[0].n).toBe(1);
  });
  it("전화 표기가 달라도 같은 사람으로 본다", async () => {
    await openEvent("test-dedupe2");
    await S.submitRegistration("test-dedupe2", applicant("6"));
    const b = await S.submitRegistration("test-dedupe2", { ...applicant("6"), phone: "010-0000-0006" });
    expect(b.already).toBe(true);
  });
  it("다른 행사에는 같은 사람이 따로 신청된다", async () => {
    await openEvent("test-ev-a");
    await openEvent("test-ev-b");
    expect((await S.submitRegistration("test-ev-a", applicant("7"))).already).toBe(false);
    expect((await S.submitRegistration("test-ev-b", applicant("7"))).already).toBe(false);
    const { rows } = await ctx.pool.query("SELECT count(*)::int AS n FROM sev_registrations");
    expect(rows[0].n).toBe(2);
  });
  it("초안·마감·종료·취소·접수닫힘은 각각의 이유로 거절한다", async () => {
    const id = await openEvent("test-gate");
    const cases: [Record<string, unknown>, RegExp][] = [
      [{ status: "closed" }, /마감/],
      [{ status: "done" }, /종료/],
      [{ status: "cancelled" }, /취소/],
      [{ apply_open: false }, /신청을 받지 않습니다/],
    ];
    for (const [patch, re] of cases) {
      await S.setEventFlags(id, { status: "open", apply_open: true });
      await S.setEventFlags(id, patch);
      const r = await S.submitRegistration("test-gate", applicant("8"));
      expect(r.ok, JSON.stringify(patch)).toBe(false);
      expect(r.error).toMatch(re);
    }
    await S.setEventFlags(id, { status: "draft", publish: false, apply_open: true });
    expect((await S.submitRegistration("test-gate", applicant("8"))).error).toMatch(/공개되지 않은/);
  });
  it("정원이 차면 더 받지 않고, 행사 상태는 그대로 둔다", async () => {
    const id = await openEvent("test-cap", { capacity: 2 });
    expect((await S.submitRegistration("test-cap", applicant("11"))).ok).toBe(true);
    expect((await S.submitRegistration("test-cap", applicant("12"))).ok).toBe(true);
    const third = await S.submitRegistration("test-cap", applicant("13"));
    expect(third.ok).toBe(false);
    expect(third.error).toMatch(/정원/);
    // 자동 마감하지 않는다 — 상태는 관리자가 바꾼다.
    expect((await S.getEvent(id))?.status).toBe("open");
  });
  it("동시에 들어와도 정원을 넘기지 않는다", async () => {
    await openEvent("test-cap-race", { capacity: 1 });
    // 행사 행을 잠그고 세기 때문에 둘 중 하나만 통과해야 한다.
    const both = await Promise.all([
      S.submitRegistration("test-cap-race", applicant("17")),
      S.submitRegistration("test-cap-race", applicant("18")),
    ]);
    expect(both.filter((r) => r.ok)).toHaveLength(1);
    expect(both.find((r) => !r.ok)?.error).toMatch(/정원/);
    const { rows } = await ctx.pool.query("SELECT count(*)::int AS n FROM sev_registrations");
    expect(rows[0].n).toBe(1);
  });
  it("취소된 신청은 정원에서 빠져 다음 사람이 들어온다", async () => {
    await openEvent("test-cap2", { capacity: 1 });
    const first = await S.submitRegistration("test-cap2", applicant("14"));
    expect((await S.submitRegistration("test-cap2", applicant("15"))).ok).toBe(false);
    await S.setRegStatus(first.id!, "cancelled", ACTOR);
    expect((await S.submitRegistration("test-cap2", applicant("15"))).ok).toBe(true);
  });
  it("접수는 브랜드 원장을 만들거나 바꾸지 않는다", async () => {
    const before = await ctx.pool.query("SELECT id, brand_name, updated_at FROM brands ORDER BY id");
    await openEvent("test-noledger");
    await S.submitRegistration("test-noledger", applicant("16"));
    const after = await ctx.pool.query("SELECT id, brand_name, updated_at FROM brands ORDER BY id");
    expect(after.rows).toEqual(before.rows);
    expect(after.rows).toHaveLength(1);
  });

  // ── 관리자 조회 ──
  it("검색·상태 필터·페이지네이션이 동작한다", async () => {
    await openEvent("test-list");
    for (let i = 20; i < 32; i++) await S.submitRegistration("test-list", applicant(String(i)));
    const id = (await S.getEventBySlug("test-list"))!.id;

    const p1 = await S.listRegistrations({ eventId: id, page: 1, pageSize: 10 });
    expect(p1.total).toBe(12);
    expect(p1.pages).toBe(2);
    expect(p1.rows).toHaveLength(10);
    const paged = await S.listRegistrations({ eventId: id, page: 2, pageSize: 10 });
    expect(paged.page).toBe(2);
    expect(paged.pages).toBe(2);
    expect(paged.rows).toHaveLength(2);
    // 너무 작은 페이지 크기는 하한으로 올려 과도한 요청을 막는다.
    expect((await S.listRegistrations({ eventId: id, pageSize: 1 })).pageSize).toBe(10);

    const byName = await S.listRegistrations({ eventId: id, q: "회사 21" });
    expect(byName.total).toBe(1);
    const byPhone = await S.listRegistrations({ eventId: id, q: "010-0000-0022" });
    expect(byPhone.total).toBe(1);
    const byEmail = await S.listRegistrations({ eventId: id, q: "sev-23@example.invalid" });
    expect(byEmail.total).toBe(1);

    await S.setRegStatus(p1.rows[0].id, "confirmed", ACTOR);
    expect((await S.listRegistrations({ eventId: id, status: "confirmed" })).total).toBe(1);
    expect((await S.listRegistrations({ eventId: id, status: "applied" })).total).toBe(11);
  });
  it("한 행사 목록에 다른 행사 신청자가 섞이지 않는다", async () => {
    await openEvent("test-iso-a");
    await openEvent("test-iso-b");
    await S.submitRegistration("test-iso-a", applicant("30"));
    await S.submitRegistration("test-iso-b", applicant("31"));
    const a = (await S.getEventBySlug("test-iso-a"))!.id;
    const list = await S.listRegistrations({ eventId: a });
    expect(list.total).toBe(1);
    expect(list.rows[0].email).toBe("sev-30@example.invalid");
  });
  it("집계는 상태별·마케팅 동의·정원 점유를 센다", async () => {
    await openEvent("test-counts", { capacity: 10 });
    const id = (await S.getEventBySlug("test-counts"))!.id;
    const r1 = await S.submitRegistration("test-counts", { ...applicant("40"), marketingAgreed: true });
    await S.submitRegistration("test-counts", applicant("41"));
    await S.setRegStatus(r1.id!, "confirmed", ACTOR);
    const c = await S.regCounts(id);
    expect(c.total).toBe(2);
    expect(c.byStatus.confirmed).toBe(1);
    expect(c.byStatus.applied).toBe(1);
    expect(c.marketing).toBe(1);
    expect(c.taken).toBe(2);
  });
  it("상태·담당·메모 변경이 이력으로 남고 메모 본문은 남지 않는다", async () => {
    await openEvent("test-hist");
    const r = await S.submitRegistration("test-hist", applicant("50"));
    await S.setRegStatus(r.id!, "attended", ACTOR);
    await S.setRegOwner(r.id!, ACTOR, ACTOR);
    await S.setRegNote(r.id!, "내부 메모 비밀값", ACTOR);
    const { rows } = await ctx.pool.query(
      "SELECT field, old_value, new_value FROM sev_reg_events WHERE registration_id=$1::uuid ORDER BY at", [r.id]);
    expect(rows.map((x) => x.field)).toEqual(["status", "owner", "admin_note"]);
    expect(rows[0]).toMatchObject({ old_value: "applied", new_value: "attended" });
    expect(JSON.stringify(rows)).not.toContain("비밀값");
  });
  it("등록되지 않은 담당자는 지정되지 않는다", async () => {
    await openEvent("test-owner");
    const r = await S.submitRegistration("test-owner", applicant("51"));
    expect((await S.setRegOwner(r.id!, "nobody@example.invalid", ACTOR)).ok).toBe(false);
  });
  it("검수용 합성 데이터는 TEST 로만 들어가고 기본 목록에서 가려진다", async () => {
    await openEvent("test-synthetic");
    const id = (await S.getEventBySlug("test-synthetic"))!.id;
    expect((await S.addTestRegistration(id, ACTOR)).ok).toBe(true);
    expect((await S.listRegistrations({ eventId: id })).total).toBe(0);
    const withTest = await S.listRegistrations({ eventId: id, includeTest: true });
    expect(withTest.total).toBe(1);
    expect(withTest.rows[0].is_test).toBe(true);
    expect(withTest.rows[0].company_name).toContain("[TEST]");
    expect(withTest.rows[0].email).toContain("example.invalid");
  });
  it("TEST 지우기는 실제 신청을 건드리지 않는다", async () => {
    await openEvent("test-clear");
    const id = (await S.getEventBySlug("test-clear"))!.id;
    await S.submitRegistration("test-clear", applicant("60"));
    await S.addTestRegistration(id, ACTOR);
    const r = await S.deleteSevTestRegs(id);
    expect(r.deleted).toBe(1);
    expect((await S.listRegistrations({ eventId: id, includeTest: true })).total).toBe(1);
  });

  // ── 포스터 ──
  it("포스터를 교체하면 이전 파일은 지워지지 않고 removed_at 만 찍힌다", async () => {
    const id = await openEvent("test-poster");
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
    const a = await S.savePoster(id, "a.png", "image/png", png, ACTOR);
    const b = await S.savePoster(id, "b.png", "image/png", png, ACTOR);
    expect(a.ok && b.ok).toBe(true);
    expect((await S.getEvent(id))?.poster_file_id).toBe(b.fileId);
    const { rows } = await ctx.pool.query("SELECT id::text, removed_at FROM sev_files ORDER BY created_at");
    expect(rows).toHaveLength(2);
    expect(rows[0].removed_at).not.toBeNull();
    expect(rows[1].removed_at).toBeNull();
  });
  it("초안 행사의 포스터는 공개 경로로 나오지 않는다", async () => {
    const id = await openEvent("test-poster2");
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9]);
    const f = await S.savePoster(id, "p.png", "image/png", png, ACTOR);
    expect(await S.getPublicPoster(f.fileId!)).not.toBeNull();
    await S.setEventFlags(id, { publish: false });
    expect(await S.getPublicPoster(f.fileId!)).toBeNull();
    expect(await S.getAdminPoster(f.fileId!)).not.toBeNull();   // 관리자 미리보기는 가능
  });

  // ── 외부 공유 ──
  it("발급 직후에는 비밀번호가 없어 열리지 않는다", async () => {
    const id = await openEvent("test-share");
    const c = await SH.createShare(id, "TEST 공유대상", ACTOR);
    expect(c.ok).toBe(true);
    const shares = await SH.listShares(id);
    expect(shares[0].has_password).toBe(false);
    expect(shares[0].enabled).toBe(false);
    expect(shares[0].live).toBe(false);
    expect(shares[0].allow_download).toBe(false);
    expect(shares[0].fields).toEqual(["company", "brand", "status"]);
    // 비밀번호 없이 켜지지 않는다
    const en = await SH.setShareEnabled(shares[0].id, true, ACTOR);
    expect(en.ok).toBe(false);
    expect(en.error).toMatch(/비밀번호/);
    // 아무 비밀번호로도 열리지 않는다
    expect((await SH.loginShare(c.token!, "")).ok).toBe(false);
    expect((await SH.loginShare(c.token!, "whatever-pw")).ok).toBe(false);
  });
  it("관리자 목록에 비밀번호 해시가 들어가지 않는다", async () => {
    const id = await openEvent("test-share-hash");
    const c = await SH.createShare(id, "x", ACTOR);
    await SH.setSharePassword((await SH.listShares(id))[0].id, "seminar-2026", ACTOR);
    const shares = await SH.listShares(id);
    expect(JSON.stringify(shares)).not.toContain("scrypt");
    expect(shares[0].has_password).toBe(true);
    expect(c.token).toMatch(/^[a-f0-9]{48}$/);
  });
  it("비밀번호를 설정하고 켜면 열람 세션이 발급된다", async () => {
    const id = await openEvent("test-share-ok");
    const c = await SH.createShare(id, "TEST 주최사", ACTOR);
    const sid = (await SH.listShares(id))[0].id;
    expect((await SH.setSharePassword(sid, "seminar-2026", ACTOR)).ok).toBe(true);
    expect((await SH.setShareEnabled(sid, true, ACTOR)).ok).toBe(true);

    expect((await SH.loginShare(c.token!, "wrong-password")).ok).toBe(false);
    const ok = await SH.loginShare(c.token!, "seminar-2026");
    expect(ok.ok).toBe(true);
    const view = await SH.shareViewForSession(c.token!, ok.session!);
    expect(view?.eventId).toBe(id);
    expect(view?.fields).toEqual(["company", "brand", "status"]);
  });
  it("다른 행사 링크에 세션을 끼워 넣어도 거절한다(IDOR)", async () => {
    const a = await openEvent("test-idor-a");
    const b = await openEvent("test-idor-b");
    const ca = await SH.createShare(a, "A", ACTOR);
    const cb = await SH.createShare(b, "B", ACTOR);
    const sa = (await SH.listShares(a))[0].id;
    const sb = (await SH.listShares(b))[0].id;
    for (const s of [sa, sb]) {
      await SH.setSharePassword(s, "seminar-2026", ACTOR);
      await SH.setShareEnabled(s, true, ACTOR);
    }
    const sess = (await SH.loginShare(ca.token!, "seminar-2026")).session!;
    expect(await SH.shareViewForSession(ca.token!, sess)).not.toBeNull();
    // A 의 세션으로 B 의 링크를 열 수 없다
    expect(await SH.shareViewForSession(cb.token!, sess)).toBeNull();
    // 토큰 모양이 아니면 쿼리까지 가지 않는다
    expect(await SH.shareViewForSession("../../etc/passwd", sess)).toBeNull();
    expect(await SH.shareViewForSession(ca.token!, "nope")).toBeNull();
  });
  it("꺼지거나 만료·철회되면 살아 있던 세션도 막힌다", async () => {
    const id = await openEvent("test-share-off");
    const c = await SH.createShare(id, "C", ACTOR);
    const sid = (await SH.listShares(id))[0].id;
    await SH.setSharePassword(sid, "seminar-2026", ACTOR);
    await SH.setShareEnabled(sid, true, ACTOR);
    const sess = (await SH.loginShare(c.token!, "seminar-2026")).session!;
    expect(await SH.shareViewForSession(c.token!, sess)).not.toBeNull();

    await SH.setShareEnabled(sid, false, ACTOR);
    expect(await SH.shareViewForSession(c.token!, sess)).toBeNull();

    await SH.setShareEnabled(sid, true, ACTOR);
    const sess2 = (await SH.loginShare(c.token!, "seminar-2026")).session!;
    await ctx.pool.query("UPDATE sev_shares SET expires_at = now() - interval '1 minute' WHERE id=$1::uuid", [sid]);
    expect(await SH.shareViewForSession(c.token!, sess2)).toBeNull();
    expect((await SH.loginShare(c.token!, "seminar-2026")).ok).toBe(false);

    await ctx.pool.query("UPDATE sev_shares SET expires_at = NULL WHERE id=$1::uuid", [sid]);
    const sess3 = (await SH.loginShare(c.token!, "seminar-2026")).session!;
    await SH.revokeShare(sid);
    expect(await SH.shareViewForSession(c.token!, sess3)).toBeNull();
    expect((await SH.setShareEnabled(sid, true, ACTOR)).error).toMatch(/철회/);
  });
  it("주소 회전은 기존 링크와 세션을 끊는다", async () => {
    const id = await openEvent("test-rotate");
    const c = await SH.createShare(id, "D", ACTOR);
    const sid = (await SH.listShares(id))[0].id;
    await SH.setSharePassword(sid, "seminar-2026", ACTOR);
    await SH.setShareEnabled(sid, true, ACTOR);
    const sess = (await SH.loginShare(c.token!, "seminar-2026")).session!;
    const rot = await SH.rotateShareToken(sid);
    expect(rot.token).not.toBe(c.token);
    expect(await SH.shareViewForSession(c.token!, sess)).toBeNull();
    expect((await SH.loginShare(c.token!, "seminar-2026")).ok).toBe(false);
    const again = await SH.loginShare(rot.token!, "seminar-2026");
    expect(again.ok).toBe(true);
  });
  it("비밀번호를 바꾸면 기존 세션이 끊긴다", async () => {
    const id = await openEvent("test-pwchange");
    const c = await SH.createShare(id, "E", ACTOR);
    const sid = (await SH.listShares(id))[0].id;
    await SH.setSharePassword(sid, "seminar-2026", ACTOR);
    await SH.setShareEnabled(sid, true, ACTOR);
    const sess = (await SH.loginShare(c.token!, "seminar-2026")).session!;
    await SH.setSharePassword(sid, "seminar-2027", ACTOR);
    expect(await SH.shareViewForSession(c.token!, sess)).toBeNull();
    expect((await SH.loginShare(c.token!, "seminar-2026")).ok).toBe(false);
    expect((await SH.loginShare(c.token!, "seminar-2027")).ok).toBe(true);
  });
  it("로그아웃하면 그 세션만 끊긴다", async () => {
    const id = await openEvent("test-logout");
    const c = await SH.createShare(id, "F", ACTOR);
    const sid = (await SH.listShares(id))[0].id;
    await SH.setSharePassword(sid, "seminar-2026", ACTOR);
    await SH.setShareEnabled(sid, true, ACTOR);
    const s1 = (await SH.loginShare(c.token!, "seminar-2026")).session!;
    const s2 = (await SH.loginShare(c.token!, "seminar-2026")).session!;
    await SH.revokeSessionToken(s1);
    expect(await SH.shareViewForSession(c.token!, s1)).toBeNull();
    expect(await SH.shareViewForSession(c.token!, s2)).not.toBeNull();
  });
  it("시도 횟수를 넘기면 잠시 막는다", async () => {
    const id = await openEvent("test-ratelimit");
    const c = await SH.createShare(id, "G", ACTOR);
    const sid = (await SH.listShares(id))[0].id;
    await SH.setSharePassword(sid, "seminar-2026", ACTOR);
    await SH.setShareEnabled(sid, true, ACTOR);
    for (let i = 0; i < M.SHARE_ATTEMPT_MAX; i++) await SH.loginShare(c.token!, `wrong-${i}`);
    const blocked = await SH.loginShare(c.token!, "seminar-2026");
    expect(blocked.ok).toBe(false);
    expect(blocked.error).toMatch(/시도가 너무 많습니다/);
    // 창을 지나면 다시 열린다
    await ctx.pool.query("UPDATE sev_share_attempts SET at = now() - interval '20 minutes' WHERE share_id=$1::uuid", [sid]);
    expect((await SH.loginShare(c.token!, "seminar-2026")).ok).toBe(true);
  });
  it("비밀번호 시도 기록에 입력값이 남지 않는다", async () => {
    const id = await openEvent("test-attemptlog");
    const c = await SH.createShare(id, "H", ACTOR);
    const sid = (await SH.listShares(id))[0].id;
    await SH.setSharePassword(sid, "seminar-2026", ACTOR);
    await SH.setShareEnabled(sid, true, ACTOR);
    await SH.loginShare(c.token!, "my-secret-attempt");
    const { rows } = await ctx.pool.query("SELECT * FROM sev_share_attempts");
    expect(JSON.stringify(rows)).not.toContain("my-secret-attempt");
    expect(rows[0].ok).toBe(false);
  });

  // ── 외부 명단 ──
  it("기본 노출 항목만 나오고 연락처·내부 메모는 나오지 않는다", async () => {
    const id = await openEvent("test-roster");
    const r = await S.submitRegistration("test-roster", applicant("70"));
    await S.setRegNote(r.id!, "내부용 메모 비밀값", ACTOR);
    const c = await SH.createShare(id, "I", ACTOR);
    const sid = (await SH.listShares(id))[0].id;
    await SH.setSharePassword(sid, "seminar-2026", ACTOR);
    await SH.setShareEnabled(sid, true, ACTOR);
    const view = await SH.shareViewForSession(c.token!, (await SH.loginShare(c.token!, "seminar-2026")).session!);
    const data = await SH.readRoster(view!);
    expect(data.headers.map((h) => h.key)).toEqual(["company", "brand", "status"]);
    const flat = JSON.stringify(data);
    expect(flat).toContain("TEST 회사 70");
    expect(flat).not.toContain("비밀값");
    expect(flat).not.toContain("0100000070");
    expect(flat).not.toContain("sev-70@example.invalid");
  });
  it("연락처를 노출로 고르면 마스킹된 값만 나온다", async () => {
    const id = await openEvent("test-roster-mask");
    await S.submitRegistration("test-roster-mask", applicant("71"));
    const c = await SH.createShare(id, "J", ACTOR);
    const sid = (await SH.listShares(id))[0].id;
    await SH.setSharePassword(sid, "seminar-2026", ACTOR);
    await SH.setShareFields(sid, ["company", "phone_masked", "email_masked", "admin_note", "phone"], false);
    await SH.setShareEnabled(sid, true, ACTOR);
    const view = await SH.shareViewForSession(c.token!, (await SH.loginShare(c.token!, "seminar-2026")).session!);
    expect(view!.fields).toEqual(["company", "phone_masked", "email_masked"]);  // 허용 목록 밖은 버려진다
    const data = await SH.readRoster(view!);
    const flat = JSON.stringify(data);
    expect(flat).toContain("****");
    expect(flat).not.toContain("0100000071");
    expect(flat).not.toContain("sev-71@example.invalid");
    expect(view!.allowDownload).toBe(false);
  });
  it("취소된 신청과 검수용 TEST 는 외부 명단에서 빠진다", async () => {
    const id = await openEvent("test-roster-filter");
    const keep = await S.submitRegistration("test-roster-filter", applicant("72"));
    const drop = await S.submitRegistration("test-roster-filter", applicant("73"));
    await S.setRegStatus(drop.id!, "cancelled", ACTOR);
    await S.addTestRegistration(id, ACTOR);
    const c = await SH.createShare(id, "K", ACTOR);
    const sid = (await SH.listShares(id))[0].id;
    await SH.setSharePassword(sid, "seminar-2026", ACTOR);
    await SH.setShareEnabled(sid, true, ACTOR);
    const view = await SH.shareViewForSession(c.token!, (await SH.loginShare(c.token!, "seminar-2026")).session!);
    const data = await SH.readRoster(view!);
    expect(data.total).toBe(1);
    expect(JSON.stringify(data)).toContain("TEST 회사 72");
    expect(keep.ok).toBe(true);
  });
  it("외부 명단은 그 행사 신청자만 담는다", async () => {
    const a = await openEvent("test-roster-iso-a");
    await openEvent("test-roster-iso-b");
    await S.submitRegistration("test-roster-iso-a", applicant("74"));
    await S.submitRegistration("test-roster-iso-b", applicant("75"));
    const c = await SH.createShare(a, "L", ACTOR);
    const sid = (await SH.listShares(a))[0].id;
    await SH.setSharePassword(sid, "seminar-2026", ACTOR);
    await SH.setShareEnabled(sid, true, ACTOR);
    const view = await SH.shareViewForSession(c.token!, (await SH.loginShare(c.token!, "seminar-2026")).session!);
    const data = await SH.readRoster(view!);
    expect(data.total).toBe(1);
    expect(JSON.stringify(data)).toContain("회사 74");
    expect(JSON.stringify(data)).not.toContain("회사 75");
  });
  it("외부 내려받기는 관리자가 켜야 허용으로 바뀐다", async () => {
    const id = await openEvent("test-roster-dl");
    const c = await SH.createShare(id, "M", ACTOR);
    const sid = (await SH.listShares(id))[0].id;
    await SH.setSharePassword(sid, "seminar-2026", ACTOR);
    await SH.setShareEnabled(sid, true, ACTOR);
    let view = await SH.shareViewForSession(c.token!, (await SH.loginShare(c.token!, "seminar-2026")).session!);
    expect(view!.allowDownload).toBe(false);
    await SH.setShareFields(sid, ["company"], true);
    view = await SH.shareViewForSession(c.token!, (await SH.loginShare(c.token!, "seminar-2026")).session!);
    expect(view!.allowDownload).toBe(true);
  });
  it("외부 공유를 해도 브랜드 원장은 그대로다", async () => {
    const before = await ctx.pool.query("SELECT count(*)::int AS n FROM brands");
    const id = await openEvent("test-roster-ledger");
    await S.submitRegistration("test-roster-ledger", applicant("76"));
    const c = await SH.createShare(id, "N", ACTOR);
    const sid = (await SH.listShares(id))[0].id;
    await SH.setSharePassword(sid, "seminar-2026", ACTOR);
    await SH.setShareEnabled(sid, true, ACTOR);
    await SH.loginShare(c.token!, "seminar-2026");
    const after = await ctx.pool.query("SELECT count(*)::int AS n FROM brands");
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });
});
