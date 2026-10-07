// 「브랜드 해외매출 실행전략 세미나」 신청 — 실제 Postgres 로 저장·중복·선정 상한을 확인한다.
//   SAP_TEST_DB_URL 이 있을 때만 돈다. 운영 DB 를 가리키면 안 된다.
//   저장하는 데이터는 모두 example.invalid 합성 값이다(고객 발송·알림 없음).
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const ctx = vi.hoisted(() => ({
  pool: null as never as {
    query: (s: string, a?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
    connect: () => Promise<{ query: (s: string, a?: unknown[]) => Promise<{ rows: unknown[] }>; release: () => void }>;
    end: () => Promise<void>;
  },
}));
vi.mock("../lib/db", async () => {
  const { Pool } = await import("pg");
  if (process.env.SAP_TEST_DB_URL) ctx.pool = new Pool({ connectionString: process.env.SAP_TEST_DB_URL, max: 8 }) as never;
  const query = async (sql: string, args: unknown[] = []) => (await ctx.pool.query(sql, args)).rows;
  return {
    query,
    queryOne: async (sql: string, args: unknown[] = []) => (await query(sql, args))[0] ?? null,
    // 실제 트랜잭션을 쓴다 — 선정 상한은 트랜잭션 안에서 강제되므로 가짜로 두면 의미가 없다.
    tx: async (fn: (c: unknown) => unknown) => {
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

const S = await import("../lib/seminar-apply");
const M = await import("../lib/seminar-apply-model");

const mig = (f: string) => readFileSync(new URL(`../migrations/${f}`, import.meta.url), "utf8");

const BASE: import("../lib/seminar-apply-model").SapFormInput = {
  sessionNo: 1,
  companyName: "TEST 합성회사",
  brandName: "TEST 합성브랜드",
  contactName: "TEST 담당자",
  jobRole: "해외영업",
  email: "sap-base@example.invalid",
  productCategory: "뷰티·화장품",
  overseasStage: "준비 중(상품·인증 점검)",
  targetCountries: ["일본"],
  question: "일본 TikTok Shop 진입 시 가격 구조가 궁금합니다.",
  consentRequired: true,
};
const who = (n: number) => ({ ...BASE, email: `sap-${n}@example.invalid`, companyName: `TEST 회사 ${n}` });

describe.skipIf(!process.env.SAP_TEST_DB_URL)("세미나 공개 신청 (PostgreSQL)", () => {
  beforeAll(async () => {
    await ctx.pool.query(`
      DROP TABLE IF EXISTS sap_rate_hits, sap_consent_events, sap_reg_events,
        sap_registrations, sap_sessions, sap_config, brands CASCADE;
      CREATE EXTENSION IF NOT EXISTS pgcrypto;
      CREATE TABLE brands (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        brand_name text NOT NULL DEFAULT '', email text NOT NULL DEFAULT '');
    `);
    await ctx.pool.query(mig("0113_seminar_apply_2026.sql"));
  });
  afterAll(async () => { await ctx.pool.end(); });
  beforeEach(async () => {
    await ctx.pool.query(`TRUNCATE sap_rate_hits, sap_consent_events, sap_reg_events, sap_registrations, brands CASCADE`);
    await ctx.pool.query(`UPDATE sap_config SET apply_open=true, send_enabled=false, auto_ack_enabled=false WHERE id=1`);
    await ctx.pool.query(`UPDATE sap_sessions SET active=true, select_cap=30, zoom_url=''`);
  });

  // ── 마이그레이션·회차 ──
  it("마이그레이션이 4회차를 KST 11:00~12:00 으로 넣는다", async () => {
    const s = await S.sapSchemaState();
    expect(s.ready).toBe(true);
    const rows = await S.listPublicSessions();
    expect(rows).toHaveLength(4);
    expect(rows.map((r) => M.fmtSessionWhen(r.starts_at, r.ends_at))).toEqual([
      "2026년 10월 13일(화) 11:00~12:00",
      "2026년 10월 16일(금) 11:00~12:00",
      "2026년 10월 20일(화) 11:00~12:00",
      "2026년 10월 23일(금) 11:00~12:00",
    ]);
    expect(rows.every((r) => r.select_cap === 30)).toBe(true);
  });

  it("발송 스위치는 둘 다 OFF 로 들어간다", async () => {
    const c = await ctx.pool.query("SELECT send_enabled, auto_ack_enabled FROM sap_config WHERE id=1");
    expect(c.rows[0]).toMatchObject({ send_enabled: false, auto_ack_enabled: false });
  });

  it("개인정보 안내에 쓸 실제 운영자·문의처가 들어간다", async () => {
    const cfg = await S.getSapConfig();
    expect(cfg.org_legal_name).toBe("디노스튜디오");
    expect(cfg.org_rep_name).toContain("허정발");
    expect(cfg.privacy_contact_email).toBe("chief@dinostudio.kr");
    expect(cfg.privacy_contact_phone).toBe("010-5663-1273");
    expect(cfg.org_address).toContain("사임당로26");
    expect(cfg.org_biz_no).toBe("");          // 확인 안 된 값은 비워 둔다
    expect(cfg.retention_required_months).toBe(3);
    expect(cfg.retention_ads_months).toBe(12);
  });

  // ── ① 4회차 선택 ──
  it("네 회차 모두 신청이 저장되고 고른 회차에 붙는다", async () => {
    for (const no of [1, 2, 3, 4]) {
      const r = await S.submitApplication({ ...who(no), sessionNo: no });
      expect(r.ok, `회차 ${no}`).toBe(true);
      expect(r.saved).toBe(true);
    }
    const rows = await ctx.pool.query(
      `SELECT s.session_no, r.status FROM sap_registrations r
         JOIN sap_sessions s ON s.id=r.session_id ORDER BY s.session_no`);
    expect(rows.rows.map((x) => x.session_no)).toEqual([1, 2, 3, 4]);
    // 접수 ≠ 선정 — 저장 기본 상태는 submitted 다(선착순 자동선정 없음).
    expect(rows.rows.every((x) => x.status === "submitted")).toBe(true);
  });

  it("같은 사람이 다른 회차에는 따로 신청할 수 있다", async () => {
    expect((await S.submitApplication({ ...BASE, sessionNo: 1 })).saved).toBe(true);
    expect((await S.submitApplication({ ...BASE, sessionNo: 3 })).saved).toBe(true);
    const n = await ctx.pool.query("SELECT count(*)::int AS n FROM sap_registrations");
    expect(n.rows[0].n).toBe(2);
  });

  // ── ② 필수 동의 거부 ──
  it("필수 동의가 없으면 저장하지 않는다", async () => {
    const r = await S.submitApplication({ ...BASE, consentRequired: false });
    expect(r.ok).toBe(false);
    expect(r.error ?? "").toContain("개인정보 수집·이용(필수)");
    const n = await ctx.pool.query("SELECT count(*)::int AS n FROM sap_registrations");
    expect(n.rows[0].n).toBe(0);
  });

  it("DB 제약으로도 필수 동의 없는 행을 막는다(코드를 우회해도)", async () => {
    await expect(ctx.pool.query(
      `INSERT INTO sap_registrations
         (session_id, company_name, contact_name, job_role, email, email_norm,
          product_category, overseas_stage, target_countries, question, no_brand, consent_required)
       SELECT id,'TEST','TEST','대표','x@example.invalid','x@example.invalid',
              '뷰티·화장품','준비 중(상품·인증 점검)','일본','q',true,false
         FROM sap_sessions WHERE session_no=1`)).rejects.toThrow();
  });

  // ── ③ 광고 미동의도 신청 가능 ──
  it("광고·선택 동의 없이도 접수되고 동의 이력이 거부로 남는다", async () => {
    const r = await S.submitApplication({ ...BASE, consentAds: false, consentOptional: false });
    expect(r.saved).toBe(true);
    const row = await ctx.pool.query(
      `SELECT consent_required, consent_optional, consent_ads,
              consent_required_at IS NOT NULL AS has_req_at,
              consent_ads_at IS NULL AS no_ads_at,
              consent_ads_expires_at IS NULL AS no_ads_expiry,
              consent_required_expires_at::text AS req_expiry, consent_version
         FROM sap_registrations`);
    expect(row.rows[0]).toMatchObject({
      consent_required: true, consent_optional: false, consent_ads: false,
      has_req_at: true, no_ads_at: true, no_ads_expiry: true,
    });
    expect(String(row.rows[0].consent_version)).toBe("sap-2026-10");
    // 보유기간 만료가 저장된다.
    expect(M.retainedUntilKst(String(row.rows[0].req_expiry))).toBe("2027-01-23");

    const ev = await ctx.pool.query("SELECT kind, granted FROM sap_consent_events ORDER BY kind");
    expect(ev.rows).toEqual([
      { kind: "ads", granted: false },
      { kind: "optional", granted: false },
      { kind: "required", granted: true },
    ]);
  });

  it("광고에 동의하면 만료일이 동의일 + 1년으로 저장된다", async () => {
    const r = await S.submitApplication({ ...BASE, consentAds: true });
    expect(r.saved).toBe(true);
    const row = await ctx.pool.query(
      `SELECT consent_ads, consent_ads_at IS NOT NULL AS has_at,
              consent_ads_expires_at::text AS exp FROM sap_registrations`);
    expect(row.rows[0]).toMatchObject({ consent_ads: true, has_at: true });
    const exp = new Date(String(row.rows[0].exp));
    const months = (exp.getUTCFullYear() - new Date().getUTCFullYear()) * 12
      + (exp.getUTCMonth() - new Date().getUTCMonth());
    expect(months).toBe(12);
  });

  it("광고 동의를 철회해도 앞선 동의 기록은 남는다(수신거부 명단은 건드리지 않는다)", async () => {
    await S.submitApplication({ ...BASE, consentAds: true });
    const id = String((await ctx.pool.query("SELECT id::text AS id FROM sap_registrations")).rows[0].id);
    const r = await S.withdrawAdsConsent(id, "TEST 담당자");
    expect(r.ok).toBe(true);
    const row = await ctx.pool.query(
      "SELECT consent_ads, consent_ads_withdrawn_at IS NOT NULL AS gone FROM sap_registrations");
    expect(row.rows[0]).toMatchObject({ consent_ads: false, gone: true });
    const ev = await ctx.pool.query(
      "SELECT granted FROM sap_consent_events WHERE kind='ads' ORDER BY at");
    expect(ev.rows.map((x) => x.granted)).toEqual([true, false]);
  });

  // ── ④ 31번째 신청도 접수된다(무제한) ──
  it("31번째 신청도 그대로 접수된다 — 접수는 좌석을 점유하지 않는다", async () => {
    for (let i = 1; i <= 31; i++) {
      const r = await S.submitApplication(who(i));
      expect(r.ok, `${i}번째`).toBe(true);
      expect(r.saved, `${i}번째`).toBe(true);
    }
    const n = await ctx.pool.query(
      "SELECT count(*)::int AS n FROM sap_registrations WHERE status='submitted'");
    expect(n.rows[0].n).toBe(31);
    const ses = (await S.listAdminSessions()).find((s) => s.session_no === 1)!;
    expect(ses.submitted).toBe(31);
    expect(ses.selected).toBe(0);
  });

  // ── ⑤ 31번째 선정은 거부된다 ──
  it("회차당 30명까지만 선정되고 31번째 선정은 거부된다", async () => {
    const ids: string[] = [];
    for (let i = 1; i <= 31; i++) {
      await S.submitApplication(who(i));
    }
    const rows = await ctx.pool.query("SELECT id::text AS id FROM sap_registrations ORDER BY created_at");
    for (const r of rows.rows) ids.push(String(r.id));

    for (let i = 0; i < 30; i++) {
      const r = await S.setRegStatus(ids[i], "selected", "적합", "TEST 담당자");
      expect(r.ok, `${i + 1}번째 선정`).toBe(true);
    }
    const over = await S.setRegStatus(ids[30], "selected", "적합", "TEST 담당자");
    expect(over.ok).toBe(false);
    expect(over.error ?? "").toContain("30명");
    expect(over.selected).toBe(30);
    expect(over.cap).toBe(30);

    const n = await ctx.pool.query(
      "SELECT count(*)::int AS n FROM sap_registrations WHERE status='selected'");
    expect(n.rows[0].n).toBe(30);
    // 거부된 건은 접수 상태 그대로 남아 대기로 돌릴 수 있다.
    const left = await ctx.pool.query("SELECT status FROM sap_registrations WHERE id=$1::uuid", [ids[30]]);
    expect(left.rows[0].status).toBe("submitted");
    const wait = await S.setRegStatus(ids[30], "waitlisted", "정원 초과", "TEST 담당자");
    expect(wait.ok).toBe(true);
  });

  it("선정을 하나 내리면 그 자리만큼 다시 선정할 수 있다", async () => {
    for (let i = 1; i <= 31; i++) await S.submitApplication(who(i));
    const ids = (await ctx.pool.query("SELECT id::text AS id FROM sap_registrations ORDER BY created_at"))
      .rows.map((r) => String(r.id));
    for (let i = 0; i < 30; i++) await S.setRegStatus(ids[i], "selected", "적합", "TEST");
    expect((await S.setRegStatus(ids[30], "selected", "적합", "TEST")).ok).toBe(false);

    expect((await S.setRegStatus(ids[0], "not_selected", "회차 변경", "TEST")).ok).toBe(true);
    expect((await S.setRegStatus(ids[30], "selected", "자리 생김", "TEST")).ok).toBe(true);
    const n = await ctx.pool.query("SELECT count(*)::int AS n FROM sap_registrations WHERE status='selected'");
    expect(n.rows[0].n).toBe(30);
  });

  it("동시에 선정해도 상한을 넘지 않는다(트랜잭션 강제)", async () => {
    await ctx.pool.query("UPDATE sap_sessions SET select_cap=5 WHERE session_no=1");
    for (let i = 1; i <= 12; i++) await S.submitApplication(who(i));
    const ids = (await ctx.pool.query("SELECT id::text AS id FROM sap_registrations ORDER BY created_at"))
      .rows.map((r) => String(r.id));

    const results = await Promise.all(ids.map((id) => S.setRegStatus(id, "selected", "동시 시도", "TEST")));
    const okN = results.filter((r) => r.ok).length;
    expect(okN).toBe(5);
    const n = await ctx.pool.query("SELECT count(*)::int AS n FROM sap_registrations WHERE status='selected'");
    expect(n.rows[0].n).toBe(5);
  });

  it("회차별 상한은 따로 센다", async () => {
    await ctx.pool.query("UPDATE sap_sessions SET select_cap=1");
    await S.submitApplication({ ...who(1), sessionNo: 1 });
    await S.submitApplication({ ...who(2), sessionNo: 1 });
    await S.submitApplication({ ...who(3), sessionNo: 2 });
    const rows = await ctx.pool.query(
      `SELECT r.id::text AS id, s.session_no FROM sap_registrations r
         JOIN sap_sessions s ON s.id=r.session_id ORDER BY r.created_at`);
    const [a, b, c] = rows.rows as { id: string; session_no: number }[];
    expect((await S.setRegStatus(a.id, "selected", "", "T")).ok).toBe(true);
    expect((await S.setRegStatus(b.id, "selected", "", "T")).ok).toBe(false);   // 1회차 상한
    expect((await S.setRegStatus(c.id, "selected", "", "T")).ok).toBe(true);    // 2회차는 별개
  });

  // ── ⑥ 중복 신청 ──
  it("같은 회차 + 같은 이메일 재제출은 새로 저장하지 않고 기존 신청자 정보도 돌려주지 않는다", async () => {
    const first = await S.submitApplication(BASE);
    expect(first.saved).toBe(true);

    const again = await S.submitApplication({
      ...BASE, email: " SAP-BASE@Example.INVALID ",     // 대소문자·공백만 다른 같은 주소
      companyName: "다른 회사명", contactName: "다른 담당자",
    });
    expect(again.ok).toBe(true);
    expect(again.already).toBe(true);
    expect(again.saved).toBe(false);
    // 응답에 기존 신청자의 값이 섞여 나오지 않는다.
    expect(JSON.stringify(again)).not.toContain("TEST 담당자");
    expect(JSON.stringify(again)).not.toContain("sap-base@example.invalid");

    const rows = await ctx.pool.query("SELECT company_name, contact_name FROM sap_registrations");
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].company_name).toBe("TEST 합성회사");   // 기존 값이 덮이지 않는다
    // 중복 제출로 동의 이력이 늘어나지 않는다.
    const ev = await ctx.pool.query("SELECT count(*)::int AS n FROM sap_consent_events");
    expect(ev.rows[0].n).toBe(3);
  });

  // ── ⑦ 공개 경로에 Zoom 링크가 나가지 않는다 ──
  it("공개 회차 목록과 CSV 에 접속 링크가 들어가지 않는다", async () => {
    const SECRET = "https://zoom.example.invalid/j/SECRET-LINK-999";
    const ses = (await S.listAdminSessions())[0];
    expect((await S.setSessionZoom(ses.id, SECRET, "대표만", "TEST")).ok).toBe(true);

    // 공개 목록에는 링크 필드가 아예 없다.
    const pub = await S.listPublicSessions();
    expect(JSON.stringify(pub)).not.toContain("SECRET-LINK-999");
    expect(JSON.stringify(pub)).not.toContain("zoom");
    expect(Object.keys(pub[0])).not.toContain("zoom_url");

    // 관리자 조회에는 들어간다(권한 검사는 서버 액션에서 한다).
    const adm = await S.listAdminSessions();
    expect(adm.find((s) => s.id === ses.id)!.zoom_url).toBe(SECRET);

    // CSV 에는 어떤 경우에도 넣지 않는다.
    await S.submitApplication(BASE);
    const list = await S.listRegistrations({});
    const { csvOfRegs, CSV_HEADER } = await import("../lib/seminar-apply-admin-model");
    for (const masked of [false, true]) {
      const csv = csvOfRegs(list.rows, { masked });
      expect(csv).not.toContain("SECRET-LINK-999");
      expect(csv).not.toContain("zoom");
    }
    expect(CSV_HEADER.join(" ")).not.toMatch(/zoom|링크/i);

    // http(s) 가 아닌 값은 저장하지 않는다.
    expect((await S.setSessionZoom(ses.id, "javascript:alert(1)", "", "TEST")).ok).toBe(false);
  });

  it("CSV 가림 모드는 이메일·연락처를 가린다", async () => {
    await S.submitApplication({ ...BASE, phone: "010-1234-5678" });
    const list = await S.listRegistrations({});
    const { csvOfRegs } = await import("../lib/seminar-apply-admin-model");
    const open = csvOfRegs(list.rows, { masked: false });
    const hidden = csvOfRegs(list.rows, { masked: true });
    expect(open).toContain("sap-base@example.invalid");
    expect(open).toContain("01012345678");
    expect(hidden).not.toContain("sap-base@example.invalid");
    expect(hidden).not.toContain("01012345678");
    expect(hidden).toContain("@example.invalid");    // 가린 형태로는 남는다
  });

  // ── ⑧ 서버 검증·봇·속도 제한 ──
  it("미끼 입력에 값이 있으면 저장하지 않는다", async () => {
    const r = await S.submitApplication({ ...BASE, trap: "bot" });
    expect(r.ok).toBe(false);
    expect((await ctx.pool.query("SELECT count(*)::int AS n FROM sap_registrations")).rows[0].n).toBe(0);
  });

  it("화면을 우회한 목록 밖 값은 서버가 거른다", async () => {
    for (const bad of [
      { ...BASE, jobRole: "CTO" },
      { ...BASE, targetCountries: ["화성"] },
      { ...BASE, productCategory: "없는카테고리" },
      { ...BASE, revenueBand: "임의값" },
    ]) {
      expect((await S.submitApplication(bad)).ok).toBe(false);
    }
    expect((await ctx.pool.query("SELECT count(*)::int AS n FROM sap_registrations")).rows[0].n).toBe(0);
  });

  it("같은 IP 에서 너무 잦은 제출은 막고, 그 전까지는 저장된다", async () => {
    const ip = "203.0.113.7";
    let okN = 0;
    for (let i = 1; i <= 8; i++) {
      const r = await S.submitApplication(who(i), { ip });
      if (r.ok && r.saved) okN += 1;
    }
    expect(okN).toBeGreaterThan(0);
    expect(okN).toBeLessThan(8);
    // IP 원문을 저장하지 않는다.
    const hits = await ctx.pool.query("SELECT bucket FROM sap_rate_hits");
    expect(JSON.stringify(hits.rows)).not.toContain(ip);
  });

  it("접수를 닫으면 저장하지 않는다", async () => {
    await ctx.pool.query("UPDATE sap_config SET apply_open=false WHERE id=1");
    const r = await S.submitApplication(BASE);
    expect(r.ok).toBe(false);
    expect((await ctx.pool.query("SELECT count(*)::int AS n FROM sap_registrations")).rows[0].n).toBe(0);
  });

  it("닫힌 회차는 고를 수 없다", async () => {
    await ctx.pool.query("UPDATE sap_sessions SET active=false WHERE session_no=2");
    const r = await S.submitApplication({ ...BASE, sessionNo: 2 });
    expect(r.ok).toBe(false);
    expect(r.error ?? "").toContain("신청을 받지 않습니다");
    expect((await S.listPublicSessions()).map((s) => s.session_no)).toEqual([1, 3, 4]);
  });

  // ── ⑨ DB 저장 실패 ──
  it("저장이 실패하면 성공으로 보여주지 않고 다시 시도할 수 있다", async () => {
    await ctx.pool.query(`
      CREATE OR REPLACE FUNCTION sap_boom() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'disk full (모의)'; END $$ LANGUAGE plpgsql;
      CREATE TRIGGER sap_boom_t BEFORE INSERT ON sap_registrations
        FOR EACH ROW EXECUTE FUNCTION sap_boom();
    `);
    try {
      const r = await S.submitApplication(BASE);
      expect(r.ok).toBe(false);
      expect(r.saved).toBeUndefined();
      expect(r.error ?? "").toContain("저장하지 못했습니다");
      // 반쪽 저장이 남지 않는다.
      expect((await ctx.pool.query("SELECT count(*)::int AS n FROM sap_registrations")).rows[0].n).toBe(0);
      expect((await ctx.pool.query("SELECT count(*)::int AS n FROM sap_consent_events")).rows[0].n).toBe(0);
    } finally {
      await ctx.pool.query("DROP TRIGGER sap_boom_t ON sap_registrations");
    }
    // 복구 후 같은 입력으로 다시 시도하면 저장된다.
    const again = await S.submitApplication(BASE);
    expect(again.saved).toBe(true);
  });

  it("동의 이력 저장이 실패하면 신청도 저장하지 않는다", async () => {
    await ctx.pool.query(`
      CREATE OR REPLACE FUNCTION sap_boom2() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'consent log down (모의)'; END $$ LANGUAGE plpgsql;
      CREATE TRIGGER sap_boom2_t BEFORE INSERT ON sap_consent_events
        FOR EACH ROW EXECUTE FUNCTION sap_boom2();
    `);
    try {
      const r = await S.submitApplication(BASE);
      expect(r.ok).toBe(false);
      expect((await ctx.pool.query("SELECT count(*)::int AS n FROM sap_registrations")).rows[0].n).toBe(0);
    } finally {
      await ctx.pool.query("DROP TRIGGER sap_boom2_t ON sap_consent_events");
    }
  });

  // ── 출처·원장 연결 ──
  it("출처 태그를 보존하고 주소창 쿼리에 개인정보를 요구하지 않는다", async () => {
    await S.submitApplication(BASE, {
      source: "overseas_9k", utmSource: "kakao", utmMedium: "cpc",
      utmCampaign: "oct-seminar", campaignId: "CMP-7",
    });
    const row = await ctx.pool.query(
      "SELECT source, utm_source, utm_medium, utm_campaign, campaign_id FROM sap_registrations");
    expect(row.rows[0]).toMatchObject({
      source: "overseas_9k", utm_source: "kakao", utm_medium: "cpc",
      utm_campaign: "oct-seminar", campaign_id: "CMP-7",
    });
  });

  it("같은 사람이 두 출처로 들어와도 출처 태그만 다르게 남는다(명단이 겹칠 수 있으므로)", async () => {
    await S.submitApplication({ ...BASE, sessionNo: 1 }, { source: "all_70k" });
    await S.submitApplication({ ...BASE, sessionNo: 2 }, { source: "overseas_9k" });
    const rows = await ctx.pool.query("SELECT source FROM sap_registrations ORDER BY source");
    expect(rows.rows.map((r) => r.source)).toEqual(["all_70k", "overseas_9k"]);
  });

  it("원장 연결은 후보를 보여주고 확인 후에만 걸며 원장 값을 고치지 않는다", async () => {
    const b = await ctx.pool.query(
      `INSERT INTO brands (brand_name, email) VALUES ('TEST 합성브랜드','sap-base@example.invalid')
       RETURNING id::text AS id`);
    const brandId = String(b.rows[0].id);
    await S.submitApplication(BASE);
    const regId = String((await ctx.pool.query("SELECT id::text AS id FROM sap_registrations")).rows[0].id);

    const cands = await S.matchCandidates(regId);
    expect(cands.map((c) => c.id)).toContain(brandId);
    // 후보만 보여준 단계에서는 아직 연결되지 않는다.
    expect((await ctx.pool.query("SELECT brand_id FROM sap_registrations")).rows[0].brand_id).toBeNull();

    expect((await S.linkBrand(regId, brandId, "TEST 담당자")).ok).toBe(true);
    const after = await ctx.pool.query(
      "SELECT brand_id::text AS brand_id, matched_at IS NOT NULL AS done FROM sap_registrations");
    expect(after.rows[0]).toMatchObject({ brand_id: brandId, done: true });
    // 원장 값은 그대로다.
    const brand = await ctx.pool.query("SELECT brand_name, email FROM brands WHERE id=$1::uuid", [brandId]);
    expect(brand.rows[0]).toMatchObject({ brand_name: "TEST 합성브랜드", email: "sap-base@example.invalid" });
  });

  it("없는 브랜드로는 연결하지 않는다", async () => {
    await S.submitApplication(BASE);
    const regId = String((await ctx.pool.query("SELECT id::text AS id FROM sap_registrations")).rows[0].id);
    const r = await S.linkBrand(regId, "00000000-0000-0000-0000-000000000000", "TEST");
    expect(r.ok).toBe(false);
  });

  // ── 관리자 조회·이력 ──
  it("회차·상태·상담희망으로 걸러내고 이메일은 정확일치로만 찾는다", async () => {
    await S.submitApplication({ ...who(1), sessionNo: 1, wantsConsult: true });
    await S.submitApplication({ ...who(2), sessionNo: 2 });
    expect((await S.listRegistrations({ sessionNo: 1 })).total).toBe(1);
    expect((await S.listRegistrations({ consult: true })).total).toBe(1);
    expect((await S.listRegistrations({ status: "submitted" })).total).toBe(2);
    expect((await S.listRegistrations({ status: "selected" })).total).toBe(0);
    expect((await S.listRegistrations({ q: "sap-1@example.invalid" })).total).toBe(1);
    expect((await S.listRegistrations({ q: "sap-1" })).total).toBe(0);        // 이메일 부분검색 불가
    expect((await S.listRegistrations({ q: "TEST 회사 1" })).total).toBe(1);  // 회사명은 부분검색 가능
  });

  it("상태 변경이 사유·담당자와 함께 이력에 남는다", async () => {
    await S.submitApplication(BASE);
    const id = String((await ctx.pool.query("SELECT id::text AS id FROM sap_registrations")).rows[0].id);
    await S.setRegStatus(id, "selected", "질문이 주제와 맞음", "TEST 담당자");
    const ev = await S.listRegEvents(id);
    expect(ev[0]).toMatchObject({
      field: "status", old_value: "submitted", new_value: "selected",
      reason: "질문이 주제와 맞음", actor: "TEST 담당자",
    });
    const sel = await ctx.pool.query("SELECT selected_at IS NOT NULL AS stamped FROM sap_registrations");
    expect(sel.rows[0].stamped).toBe(true);
  });

  it("보유기간 경과 건을 세기만 하고 지우지 않는다", async () => {
    await S.submitApplication(BASE);
    const before = await ctx.pool.query("SELECT count(*)::int AS n FROM sap_registrations");
    const st = await S.expiryState(new Date("2030-01-01T00:00:00Z"));
    expect(st.requiredDue).toBe(1);
    const after = await ctx.pool.query("SELECT count(*)::int AS n FROM sap_registrations");
    expect(after.rows[0].n).toBe(before.rows[0].n);   // 아무것도 지우지 않는다
    expect((await S.expiryState(new Date("2026-10-07T00:00:00Z"))).requiredDue).toBe(0);
  });

  it("검수용 합성 신청은 테스트 표시가 붙고 합성만 지워진다", async () => {
    await S.submitApplication(BASE);                      // 실제 신청(표시 없음)
    expect((await S.addTestRegistration(1, "TEST 담당자")).saved).toBe(true);
    expect((await ctx.pool.query("SELECT count(*)::int AS n FROM sap_registrations WHERE is_test")).rows[0].n).toBe(1);
    expect(await S.deleteTestRegistrations()).toBe(1);
    const left = await ctx.pool.query("SELECT is_test FROM sap_registrations");
    expect(left.rows).toHaveLength(1);
    expect(left.rows[0].is_test).toBe(false);
  });
});
