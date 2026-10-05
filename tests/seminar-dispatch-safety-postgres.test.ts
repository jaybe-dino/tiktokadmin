// 세미나 발송 안전장치 — 실제 Postgres + provider 모의(외부 발송 없음).
//   SEMINAR_TEST_DB_URL 이 있을 때만 돈다. 운영 DB 를 가리키면 안 된다.
//   sms·mailer 는 전부 모의로 바꿔치기해서 실제 메일·문자가 나가지 않는다.
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

type Row = Record<string, unknown>;
interface PoolLike {
  query: (s: string, a?: unknown[]) => Promise<{ rows: Row[] }>;
  end: () => Promise<void>;
}
interface SentRec { kind: "sms" | "email"; to: string; subject: string; body: string }

const ctx = vi.hoisted(() => ({
  pool: null as never as PoolLike,
  sent: [] as SentRec[],
  /** 첫 전송 직후에 실행할 훅(루프 중 OFF·조회 실패를 흉내 낸다). */
  onFirstSend: null as null | (() => Promise<void>),
  smsOk: true,
  /** 제공자 호출이 예외로 끝나는 상황(시간초과 등). */
  mailThrows: false,
}));

vi.mock("../lib/db", async () => {
  const { Pool } = await import("pg");
  if (process.env.SEMINAR_TEST_DB_URL) ctx.pool = new Pool({ connectionString: process.env.SEMINAR_TEST_DB_URL }) as never;
  const query = async (sql: string, args: unknown[] = []) => (await ctx.pool.query(sql, args)).rows;
  return { query, queryOne: async (s: string, a: unknown[] = []) => (await query(s, a))[0] ?? null };
});
vi.mock("../lib/sms", () => ({
  sendSms: async (i: { receiver: string; msg: string }) => {
    ctx.sent.push({ kind: "sms", to: i.receiver, subject: "", body: i.msg });
    if (ctx.sent.length === 1 && ctx.onFirstSend) await ctx.onFirstSend();
    return ctx.smsOk ? { ok: true, msgId: `sms-${ctx.sent.length}` } : { ok: false, message: "모의 실패" };
  },
}));
vi.mock("../lib/mailer", () => ({
  sendEmail: async (i: { to: string; subject: string; text: string }) => {
    if (ctx.mailThrows) throw new Error("연결 시간 초과(검수용)");
    ctx.sent.push({ kind: "email", to: i.to, subject: i.subject, body: i.text });
    if (ctx.sent.length === 1 && ctx.onFirstSend) await ctx.onFirstSend();
    return { ok: true, id: `mail-${ctx.sent.length}`, via: "resend" };
  },
}));

const S = await import("../lib/seminar");
const T = await import("../lib/seminar-test");

const mig = (f: string) => readFileSync(new URL(`../migrations/${f}`, import.meta.url), "utf8");
const CONFIG_TITLE = "틱톡샵 온라인 세미나 | glovek";
const OLD_SNAPSHOT_TITLE = "GloveK 온라인 세미나 | 녹화 강의";
const ZOOM = "https://zoom.example/j/82484286530";
const NOW = new Date("2026-10-05T02:00:00Z");     // 11:00 KST

let sessionId = "";
const brandIds: string[] = [];

/** 대상 1명 + 그 사람의 1차 메일 예약 1건. */
async function seedTarget(n: number, opts: { email?: string; phone?: string } = {}) {
  const b = await ctx.pool.query(
    `INSERT INTO brands (brand_name, contact_name, email, phone)
     VALUES ($1,$2,$3,$4) RETURNING id::text AS id`,
    [`TEST 브랜드 ${n}`, `TEST 담당 ${n}`, opts.email ?? `t${n}@example.invalid`, opts.phone ?? `0100000${String(1000 + n)}`]);
  const brandId = b.rows[0].id as string;
  brandIds.push(brandId);
  const t = await ctx.pool.query(
    `INSERT INTO seminar_targets
       (session_id, brand_id, lead_event_id, applied_at, source_key, brand_name, contact_name,
        email, phone, dedupe_email, dedupe_phone, status)
     VALUES ($1::uuid,$2::uuid, gen_random_uuid(), now(), 'apply_seminar', $3,$4,$5,$6,$5,$6,'eligible')
     RETURNING id::text AS id`,
    [sessionId, brandId, `TEST 브랜드 ${n}`, `TEST 담당 ${n}`,
      opts.email ?? `t${n}@example.invalid`, opts.phone ?? `0100000${String(1000 + n)}`]);
  const targetId = t.rows[0].id as string;
  const s = await ctx.pool.query(
    `INSERT INTO seminar_sends (session_id, target_id, stage, channel, due_at)
     VALUES ($1::uuid,$2::uuid,'notice','email', $3) RETURNING id::text AS id`,
    [sessionId, targetId, new Date(NOW.getTime() - 60_000).toISOString()]);
  return { brandId, targetId, sendId: s.rows[0].id as string };
}

describe.skipIf(!process.env.SEMINAR_TEST_DB_URL)("세미나 발송 안전장치 (PostgreSQL · provider 모의)", () => {
  beforeAll(async () => {
    await ctx.pool.query(`
      DROP TABLE IF EXISTS seminar_send_attempts, seminar_sends, seminar_targets, seminar_sessions,
        seminar_runs, seminar_templates, seminar_config, seminar_test_sends, brands CASCADE;
      CREATE TABLE brands (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        brand_name text NOT NULL DEFAULT '', contact_name text NOT NULL DEFAULT '',
        email text NOT NULL DEFAULT '', phone text NOT NULL DEFAULT '',
        is_test boolean NOT NULL DEFAULT false,
        msg_opt_out boolean NOT NULL DEFAULT false);
    `);
    await ctx.pool.query(mig("0103_seminar_notify.sql"));
    await ctx.pool.query(mig("0105_seminar_test_send.sql"));
    await ctx.pool.query(mig("0111_seminar_send_attempts.sql"));
  });
  afterAll(async () => { await ctx.pool.end(); });

  beforeEach(async () => {
    ctx.sent = []; ctx.onFirstSend = null; ctx.smsOk = true; ctx.mailThrows = false;
    await ctx.pool.query("TRUNCATE seminar_send_attempts, seminar_sends, seminar_targets, seminar_sessions, seminar_runs, brands CASCADE");
    brandIds.length = 0;
    // 보낼 수 있는 상태로 되돌린다(마스터 ON · 링크 · 문구 활성).
    await ctx.pool.query(
      `UPDATE seminar_config SET enabled=true, zoom_url=$1, session_title=$2, max_attempts=3, stale_hours=6 WHERE id=1`,
      [ZOOM, CONFIG_TITLE]);
    await ctx.pool.query("UPDATE seminar_templates SET enabled=true");
    const ses = await ctx.pool.query(
      `INSERT INTO seminar_sessions
         (session_date, starts_at, followup_at, notice_due_at, window_from, window_to,
          week_mode, source_keys, zoom_url, session_title, dedupe_scope)
       VALUES (DATE '2026-10-05', $1, $2, $3, $4, $5,
               'session_to_session', ARRAY['apply_seminar']::text[], $6, $7, 'contact')
       RETURNING id::text AS id`,
      [new Date("2026-10-05T01:30:00Z").toISOString(), new Date("2026-10-05T02:10:00Z").toISOString(),
        new Date("2026-10-05T00:00:00Z").toISOString(), new Date("2026-09-28T01:30:00Z").toISOString(),
        new Date("2026-10-05T01:30:00Z").toISOString(), ZOOM, OLD_SNAPSHOT_TITLE]);
    sessionId = ses.rows[0].id as string;
  });

  // ── ① 마스터 OFF ─────────────────────────────────────────
  it("시작부터 OFF 면 선점도 전송도 하지 않는다", async () => {
    await seedTarget(1);
    await ctx.pool.query("UPDATE seminar_config SET enabled=false WHERE id=1");
    const r = await S.dispatchDue(100, NOW, "test");
    expect(r.sent).toBe(0);
    expect(r.blocked?.join(" ")).toContain("마스터 스위치");
    expect(ctx.sent).toHaveLength(0);
    const rows = await ctx.pool.query("SELECT status, attempts, claimed_by FROM seminar_sends");
    expect(rows.rows[0]).toMatchObject({ status: "queued", attempts: 0, claimed_by: null });
    const runs = await ctx.pool.query("SELECT count(*)::int AS n FROM seminar_runs");
    expect(runs.rows[0].n).toBe(0);
  });

  it("루프 도중 OFF 되면 그 뒤로는 보내지 않고 미처리분만 되돌린다", async () => {
    for (let i = 1; i <= 4; i++) await seedTarget(i);
    ctx.onFirstSend = async () => {
      await ctx.pool.query("UPDATE seminar_config SET enabled=false WHERE id=1");
    };
    const r = await S.dispatchDue(100, NOW, "test");
    expect(ctx.sent).toHaveLength(1);                 // 첫 건만 나갔다
    expect(r.sent).toBe(1);
    expect(r.blocked?.join(" ")).toContain("꺼져 중단");

    const rows = await ctx.pool.query(
      "SELECT status, attempts FROM seminar_sends ORDER BY status, attempts");
    const sent = rows.rows.filter((x) => x.status === "sent");
    const queued = rows.rows.filter((x) => x.status === "queued");
    expect(sent).toHaveLength(1);
    expect(queued).toHaveLength(3);
    // 실제 시도한 건의 기록·attempts 는 되돌리지 않는다.
    expect(sent[0].attempts).toBe(1);
    // 미처리 반환분도 attempts 를 임의로 깎지 않는다(되돌리는 것은 상태뿐).
    for (const q of queued) expect(q.attempts).toBe(1);
    // 기록은 실제로 보낸 1건만 남는다.
    const att = await ctx.pool.query("SELECT count(*)::int AS n FROM seminar_send_attempts");
    expect(att.rows[0].n).toBe(1);
  });

  it("스위치 조회가 실패하면 보내지 않고 중단한다(fail closed)", async () => {
    for (let i = 1; i <= 3; i++) await seedTarget(i);
    ctx.onFirstSend = async () => {
      await ctx.pool.query("ALTER TABLE seminar_config RENAME TO seminar_config_hidden");
    };
    try {
      const r = await S.dispatchDue(100, NOW, "test");
      expect(ctx.sent).toHaveLength(1);
      expect(r.blocked?.join(" ")).toContain("확인 실패");
    } finally {
      await ctx.pool.query("ALTER TABLE seminar_config_hidden RENAME TO seminar_config");
    }
    const queued = await ctx.pool.query("SELECT count(*)::int AS n FROM seminar_sends WHERE status='queued'");
    expect(queued.rows[0].n).toBe(2);
  });

  // ── ② 선점 소유권 ────────────────────────────────────────
  it("중단해도 다른 실행이 가로챈 선점은 되돌리지 않는다", async () => {
    for (let i = 1; i <= 4; i++) await seedTarget(i);
    const foreignRun = "11111111-1111-1111-1111-111111111111";
    let stolenId = "";

    // 우리 실행이 선점한 뒤, 멈춘 사이에 다른 실행이 회수·재선점해 간 상황을 흉내 낸다.
    ctx.onFirstSend = async () => {
      // 지금 전송 중인 건(이미 기록이 생긴 건)은 빼고, 아직 손대지 않은 선점 건을 고른다.
      const mine = await ctx.pool.query(
        `SELECT s.id::text AS id FROM seminar_sends s
          WHERE s.status='sending'
            AND NOT EXISTS (SELECT 1 FROM seminar_send_attempts a WHERE a.send_id = s.id)
          ORDER BY s.id LIMIT 1`);
      stolenId = mine.rows[0].id as string;
      await ctx.pool.query(
        "UPDATE seminar_sends SET claimed_by=$2::uuid WHERE id=$1::uuid", [stolenId, foreignRun]);
      await ctx.pool.query("UPDATE seminar_config SET enabled=false WHERE id=1");
    };
    await S.dispatchDue(100, NOW, "test");

    expect(stolenId).toBeTruthy();
    const stolen = await ctx.pool.query(
      "SELECT status, claimed_by::text AS claimed_by FROM seminar_sends WHERE id=$1::uuid", [stolenId]);
    // 남의 것이 된 행은 상태도 소유자도 그대로 둔다.
    expect(stolen.rows[0].status).toBe("sending");
    expect(stolen.rows[0].claimed_by).toBe(foreignRun);
    // 내가 잡은 나머지는 정상적으로 예약으로 돌아간다.
    const back = await ctx.pool.query("SELECT count(*)::int AS n FROM seminar_sends WHERE status='queued'");
    expect(back.rows[0].n).toBeGreaterThanOrEqual(1);
  });

  it("제외 처리도 자기 선점일 때만 한다", async () => {
    // A = 먼저 처리돼 전송되는 건, B = 제외 대상(대상 아님)이고 그 사이 소유권을 빼앗긴다.
    const a = await seedTarget(1);
    const b = await seedTarget(2);
    await ctx.pool.query("UPDATE seminar_sends SET due_at=$2 WHERE id=$1::uuid",
      [b.sendId, new Date(NOW.getTime() - 30_000).toISOString()]);      // A 보다 뒤에 처리되게
    await ctx.pool.query("UPDATE seminar_targets SET status='duplicate' WHERE id=$1::uuid", [b.targetId]);
    const foreignRun = "44444444-4444-4444-4444-444444444444";
    ctx.onFirstSend = async () => {
      await ctx.pool.query(
        `UPDATE seminar_sends SET claimed_by=$1::uuid
          WHERE status='sending'
            AND NOT EXISTS (SELECT 1 FROM seminar_send_attempts x WHERE x.send_id = seminar_sends.id)`,
        [foreignRun]);
    };
    await S.dispatchDue(100, NOW, "test");

    const rows = await ctx.pool.query(
      "SELECT id::text AS id, status, skip_reason FROM seminar_sends WHERE id = ANY($1::uuid[])",
      [[a.sendId, b.sendId]]);
    const bRow = rows.rows.find((x) => x.id === b.sendId)!;
    // 남의 것이 된 행은 skipped 로 바꾸지 않는다.
    expect(bRow.status).toBe("sending");
    expect(bRow.skip_reason).toBe("");
  });

  // ── ③ 보낸 내용 기록 ─────────────────────────────────────
  it("기록한 제목·본문이 provider 에 넘긴 값과 글자까지 같다", async () => {
    await seedTarget(1);
    await S.dispatchDue(100, NOW, "test");
    expect(ctx.sent).toHaveLength(1);
    const a = await ctx.pool.query(
      "SELECT subject, body, channel, stage, attempt_no, result, provider, provider_id, to_masked FROM seminar_send_attempts");
    expect(a.rows).toHaveLength(1);
    expect(a.rows[0].subject).toBe(ctx.sent[0].subject);
    expect(a.rows[0].body).toBe(ctx.sent[0].body);
    expect(a.rows[0]).toMatchObject({
      channel: "email", stage: "notice", attempt_no: 1, result: "sent", provider: "resend",
    });
    expect(a.rows[0].provider_id).toBe("mail-1");
    // 원문 연락처는 남기지 않는다.
    expect(String(a.rows[0].to_masked)).not.toBe(ctx.sent[0].to);
    expect(String(a.rows[0].to_masked)).toContain("*");
  });

  it("제목은 설정값을 따른다(회차 스냅샷이 달라도)", async () => {
    await seedTarget(1);
    await S.dispatchDue(100, NOW, "test");
    expect(ctx.sent[0].subject).toContain(CONFIG_TITLE);
    expect(ctx.sent[0].subject).not.toContain(OLD_SNAPSHOT_TITLE);
    // 회차 스냅샷은 그대로 둔다(지난 기록을 덮어쓰지 않는다).
    const ses = await ctx.pool.query("SELECT session_title FROM seminar_sessions WHERE id=$1::uuid", [sessionId]);
    expect(ses.rows[0].session_title).toBe(OLD_SNAPSHOT_TITLE);
  });

  it("미리보기 제목과 실제 발송 제목이 같다([테스트] 표시만 다르다)", async () => {
    await seedTarget(1);
    await S.dispatchDue(100, NOW, "test");
    const pv = await T.previewSeminarTest({ channel: "email", stage: "notice", sessionDate: "2026-10-05" });
    expect(pv.subject.replace(`${T.TEST_MARK} `, "")).toBe(ctx.sent[0].subject);
  });

  it("기록을 남기지 못하면 보내지 않는다", async () => {
    await seedTarget(1);
    // 기록 insert 가 실패하는 상황을 만든다(검수용 제약).
    await ctx.pool.query(
      "ALTER TABLE seminar_send_attempts ADD CONSTRAINT tmp_block CHECK (purpose = '_never_')");
    try {
      const r = await S.dispatchDue(100, NOW, "test");
      expect(ctx.sent).toHaveLength(0);                 // 전송 시도 자체가 없다
      expect(r.sent).toBe(0);
      const row = await ctx.pool.query("SELECT status, error FROM seminar_sends");
      expect(row.rows[0].status).toBe("queued");        // 다음 실행에서 다시 시도할 수 있게
      expect(String(row.rows[0].error)).toContain("기록");
    } finally {
      await ctx.pool.query("ALTER TABLE seminar_send_attempts DROP CONSTRAINT tmp_block");
    }
  });

  it("0111 미적용이면 아예 보내지 않는다", async () => {
    await seedTarget(1);
    await ctx.pool.query("ALTER TABLE seminar_send_attempts RENAME TO seminar_send_attempts_hidden");
    try {
      const r = await S.dispatchDue(100, NOW, "test");
      expect(ctx.sent).toHaveLength(0);
      expect(r.blocked?.join(" ")).toContain("기록을 남길 수 없어");
      const row = await ctx.pool.query("SELECT status, attempts FROM seminar_sends");
      expect(row.rows[0]).toMatchObject({ status: "queued", attempts: 0 });
    } finally {
      await ctx.pool.query("ALTER TABLE seminar_send_attempts_hidden RENAME TO seminar_send_attempts");
    }
  });

  it("재시도하면 시도마다 기록이 따로 쌓이고 앞선 기록은 그대로다", async () => {
    const t1 = await seedTarget(1);
    await ctx.pool.query("UPDATE seminar_sends SET channel='sms' WHERE id=$1::uuid", [t1.sendId]);
    ctx.smsOk = false;                                   // 1차 시도 실패 → 재시도 예약
    await S.dispatchDue(100, NOW, "test");
    const first = await ctx.pool.query(
      "SELECT id::text AS id, attempt_no, result, body FROM seminar_send_attempts");
    expect(first.rows).toHaveLength(1);
    expect(first.rows[0]).toMatchObject({ attempt_no: 1, result: "failed" });

    // 두 번째 시도 — 예정 시각을 당겨 다시 집히게 한다.
    ctx.smsOk = true;
    await ctx.pool.query("UPDATE seminar_sends SET due_at = $1", [new Date(NOW.getTime() - 60_000).toISOString()]);
    await S.dispatchDue(100, new Date(NOW.getTime() + 60_000), "test");

    const all = await ctx.pool.query(
      "SELECT id::text AS id, attempt_no, result, body FROM seminar_send_attempts ORDER BY attempt_no");
    expect(all.rows).toHaveLength(2);
    expect(all.rows[0]).toEqual(first.rows[0]);          // 1번째 기록은 글자 하나 안 바뀜
    expect(all.rows[1]).toMatchObject({ attempt_no: 2, result: "sent" });
  });

  it("지난 발송을 소급 생성하지 않는다 — 기록 없는 건은 0으로 보인다", async () => {
    const old = await seedTarget(1);
    const fresh = await seedTarget(2);
    // 0111 이전에 이미 나간 건을 흉내 낸다(기록 없이 sent).
    await ctx.pool.query(
      "UPDATE seminar_sends SET status='sent', sent_at=now(), attempts=1 WHERE id=$1::uuid", [old.sendId]);
    await S.dispatchDue(100, NOW, "test");

    const rows = await S.listSessionSends(sessionId);
    const oldRow = rows.find((x) => x.id === old.sendId)!;
    const newRow = rows.find((x) => x.id === fresh.sendId)!;
    expect(oldRow.log_count).toBe(0);                    // 화면에서 "기록 없음"
    expect(newRow.log_count).toBe(1);
    const n = await ctx.pool.query("SELECT count(*)::int AS n FROM seminar_send_attempts");
    expect(n.rows[0].n).toBe(1);                         // 소급 생성 없음
  });

  it("긴 제목도 자르지 않고 그대로 기록한다(500자 초과)", async () => {
    const long = "가".repeat(400) + "-" + "A".repeat(400);     // 800자 이상
    await ctx.pool.query(
      "UPDATE seminar_templates SET email_subject=$1 WHERE stage='notice'", [`[GloveK] ${long} {{세미나명}}`]);
    try {
      await seedTarget(1);
      await S.dispatchDue(100, NOW, "test");
      expect(ctx.sent).toHaveLength(1);
      expect(ctx.sent[0].subject.length).toBeGreaterThan(500);
      const a = await ctx.pool.query("SELECT subject, length(subject)::int AS n FROM seminar_send_attempts");
      expect(a.rows[0].subject).toBe(ctx.sent[0].subject);     // 글자까지 같다
      expect(a.rows[0].n).toBe(ctx.sent[0].subject.length);
    } finally {
      await ctx.pool.query(
        "UPDATE seminar_templates SET email_subject='[GloveK] {{세미나명}} 참가 안내 ({{일시}})' WHERE stage='notice'");
    }
  });

  it("기록 직후 전송 전에 OFF 되면 보내지 않고 그 기록을 전송 안 함으로 남긴다", async () => {
    const t = await seedTarget(1);
    // beginAttempt 가 행을 넣는 순간(= 트리거)에 스위치를 끈다.
    await ctx.pool.query(`
      CREATE OR REPLACE FUNCTION tmp_off() RETURNS trigger AS $fn$
      BEGIN UPDATE seminar_config SET enabled=false WHERE id=1; RETURN NEW; END;
      $fn$ LANGUAGE plpgsql;
      CREATE TRIGGER tmp_off_trg AFTER INSERT ON seminar_send_attempts
        FOR EACH ROW EXECUTE FUNCTION tmp_off();
    `);
    try {
      const r = await S.dispatchDue(100, NOW, "test");
      expect(ctx.sent).toHaveLength(0);                        // 전송 자체가 없다
      expect(r.sent).toBe(0);
      expect(r.blocked?.join(" ")).toContain("기록 직후");
      const a = await ctx.pool.query("SELECT result, error FROM seminar_send_attempts WHERE send_id=$1::uuid", [t.sendId]);
      expect(a.rows[0].result).toBe("aborted");
      expect(String(a.rows[0].error)).toContain("전송 직전 중단");
    } finally {
      await ctx.pool.query("DROP TRIGGER IF EXISTS tmp_off_trg ON seminar_send_attempts; DROP FUNCTION IF EXISTS tmp_off();");
    }
  });

  it("회수된 옛 실행은 남이 가져간 행을 전송하지 않는다", async () => {
    await seedTarget(1);
    await seedTarget(2);
    const foreignRun = "22222222-2222-2222-2222-222222222222";
    // 첫 건을 보내는 사이, 아직 처리하지 않은 행의 소유권을 다른 실행이 가져간다.
    ctx.onFirstSend = async () => {
      await ctx.pool.query(
        `UPDATE seminar_sends SET claimed_by=$1::uuid
          WHERE status='sending'
            AND NOT EXISTS (SELECT 1 FROM seminar_send_attempts a WHERE a.send_id = seminar_sends.id)`,
        [foreignRun]);
    };
    const r = await S.dispatchDue(100, NOW, "test");
    expect(ctx.sent).toHaveLength(1);                          // 남의 행은 보내지 않았다
    expect(r.skipped).toBeGreaterThanOrEqual(1);
    const stolen = await ctx.pool.query(
      "SELECT status, claimed_by::text AS claimed_by FROM seminar_sends WHERE claimed_by=$1::uuid", [foreignRun]);
    expect(stolen.rows).toHaveLength(1);
    expect(stolen.rows[0].status).toBe("sending");             // 상태도 바꾸지 않았다
    const att = await ctx.pool.query("SELECT count(*)::int AS n FROM seminar_send_attempts");
    expect(att.rows[0].n).toBe(1);                             // 남의 행에는 기록도 만들지 않았다
  });

  it("전송 뒤 완료 기록 시점에 선점이 사라지면 성공으로 적지 않고 중단한다", async () => {
    const t = await seedTarget(1);
    const foreignRun = "33333333-3333-3333-3333-333333333333";
    ctx.onFirstSend = async () => {
      // 전송이 나간 직후(완료 갱신 전) 소유권이 넘어간 상황.
      await ctx.pool.query("UPDATE seminar_sends SET claimed_by=$2::uuid WHERE id=$1::uuid", [t.sendId, foreignRun]);
    };
    const r = await S.dispatchDue(100, NOW, "test");
    expect(ctx.sent).toHaveLength(1);
    expect(r.sent).toBe(0);                                    // 성공으로 세지 않는다
    expect(r.blocked?.join(" ")).toContain("완료 기록을 남기지 못했습니다");
    const row = await ctx.pool.query("SELECT status FROM seminar_sends WHERE id=$1::uuid", [t.sendId]);
    expect(row.rows[0].status).toBe("sending");                // 남의 행을 sent 로 덮지 않았다
    // 보낸 내용 기록은 남아 있어 수동 대조가 가능하다.
    const a = await ctx.pool.query("SELECT result, provider_id FROM seminar_send_attempts WHERE send_id=$1::uuid", [t.sendId]);
    expect(a.rows[0].result).toBe("sent");
  });

  it("같은 시도 번호 기록이 있으면 보내지 않고 기존 기록을 그대로 둔다", async () => {
    const t = await seedTarget(1);
    await ctx.pool.query(
      `INSERT INTO seminar_send_attempts
         (send_id, session_id, target_id, stage, channel, attempt_no, to_masked, subject, body, purpose, result, provider, provider_id)
       VALUES ($1::uuid,$2::uuid,$3::uuid,'notice','email',1,'aa***@x.kr','이전 제목','이전 본문','service','sent','resend','prev-1')`,
      [t.sendId, sessionId, t.targetId]);
    const r = await S.dispatchDue(100, NOW, "test");
    expect(ctx.sent).toHaveLength(0);                          // 중복 전송 없음
    expect(r.review).toBeGreaterThan(0);
    const row = await ctx.pool.query("SELECT status, error FROM seminar_sends WHERE id=$1::uuid", [t.sendId]);
    expect(row.rows[0].status).toBe("needs_review");
    const a = await ctx.pool.query("SELECT subject, body, result, provider_id FROM seminar_send_attempts WHERE send_id=$1::uuid", [t.sendId]);
    expect(a.rows).toHaveLength(1);
    expect(a.rows[0]).toMatchObject({ subject: "이전 제목", body: "이전 본문", result: "sent", provider_id: "prev-1" });
  });

  // ── 결과 저장 실패 후 복구 → 재실행에서도 provider 호출은 총 1회 ──
  it("결과·확인필요 저장이 모두 실패해도, DB 복구·stale 회수 후 다시 보내지 않는다", async () => {
    const t = await seedTarget(1);
    // 전송 뒤의 모든 기록 갱신을 막는다(결과 저장도, needs_review 저장도 실패).
    await ctx.pool.query(`
      CREATE OR REPLACE FUNCTION tmp_block_upd() RETURNS trigger AS $fn$
      BEGIN
        -- 선점(queued→sending)은 통과시키고, 그 뒤의 갱신만 막는다.
        IF TG_TABLE_NAME = 'seminar_sends' AND OLD.status <> 'sending' THEN RETURN NEW; END IF;
        RAISE EXCEPTION 'DB 장애(검수용)';
      END;
      $fn$ LANGUAGE plpgsql;
      CREATE TRIGGER tmp_block_att BEFORE UPDATE ON seminar_send_attempts
        FOR EACH ROW EXECUTE FUNCTION tmp_block_upd();
      CREATE TRIGGER tmp_block_snd BEFORE UPDATE ON seminar_sends
        FOR EACH ROW EXECUTE FUNCTION tmp_block_upd();
    `);
    try {
      await S.dispatchDue(100, NOW, "test").catch(() => null);
    } finally {
      await ctx.pool.query(`
        DROP TRIGGER IF EXISTS tmp_block_att ON seminar_send_attempts;
        DROP TRIGGER IF EXISTS tmp_block_snd ON seminar_sends;
        DROP FUNCTION IF EXISTS tmp_block_upd();`);
    }
    expect(ctx.sent).toHaveLength(1);                      // 제공자는 한 번 받았다
    // 결과를 못 적었으니 기록은 attempted 로, 예약은 sending 으로 남아 있다.
    const mid = await ctx.pool.query(
      `SELECT s.status, (SELECT result FROM seminar_send_attempts a WHERE a.send_id=s.id) AS result
         FROM seminar_sends s WHERE s.id=$1::uuid`, [t.sendId]);
    expect(mid.rows[0]).toMatchObject({ status: "sending", result: "attempted" });

    // DB 복구 뒤 stale 회수 — 기록이 불확실하므로 예약으로 되돌리지 않는다.
    await ctx.pool.query("UPDATE seminar_sends SET claimed_at = $1", [new Date(NOW.getTime() - 30 * 60_000).toISOString()]);
    const rel = await S.releaseStale(NOW);
    expect(rel.sends).toBe(0);
    expect(rel.review).toBe(1);
    const after = await ctx.pool.query("SELECT status FROM seminar_sends WHERE id=$1::uuid", [t.sendId]);
    expect(after.rows[0].status).toBe("needs_review");

    // 다시 돌려도 보내지 않는다.
    await S.dispatchDue(100, new Date(NOW.getTime() + 3_600_000), "test");
    expect(ctx.sent).toHaveLength(1);                      // provider 호출 총 1회
  });

  it("예약으로 억지로 되돌려도 기록이 있으면 재발송하지 않는다", async () => {
    const t = await seedTarget(1);
    // 전송 뒤 seminar_sends 갱신만 실패시킨다(기록은 sent 로 남는다).
    await ctx.pool.query(`
      CREATE OR REPLACE FUNCTION tmp_block_snd_only() RETURNS trigger AS $fn$
      BEGIN
        IF OLD.status <> 'sending' THEN RETURN NEW; END IF;
        RAISE EXCEPTION 'DB 장애(검수용)';
      END;
      $fn$ LANGUAGE plpgsql;
      CREATE TRIGGER tmp_block_snd2 BEFORE UPDATE ON seminar_sends
        FOR EACH ROW EXECUTE FUNCTION tmp_block_snd_only();`);
    try {
      await S.dispatchDue(100, NOW, "test").catch(() => null);
    } finally {
      await ctx.pool.query(`
        DROP TRIGGER IF EXISTS tmp_block_snd2 ON seminar_sends;
        DROP FUNCTION IF EXISTS tmp_block_snd_only();`);
    }
    expect(ctx.sent).toHaveLength(1);
    const att = await ctx.pool.query("SELECT result FROM seminar_send_attempts WHERE send_id=$1::uuid", [t.sendId]);
    expect(att.rows[0].result).toBe("sent");               // 기록에는 접수가 남았다

    // 운영자가 손으로 예약 상태를 되돌린 최악의 경우까지 가정한다.
    await ctx.pool.query(
      "UPDATE seminar_sends SET status='queued', claimed_by=NULL, due_at=$2 WHERE id=$1::uuid",
      [t.sendId, new Date(NOW.getTime() - 60_000).toISOString()]);
    await S.dispatchDue(100, NOW, "test");
    expect(ctx.sent).toHaveLength(1);                      // provider 호출 총 1회
    const fin = await ctx.pool.query("SELECT status, error FROM seminar_sends WHERE id=$1::uuid", [t.sendId]);
    expect(fin.rows[0].status).toBe("needs_review");
    expect(String(fin.rows[0].error)).toContain("대조");
  });

  it("제공자 예외·시간초과는 거절과 달리 자동 재전송하지 않는다", async () => {
    const t = await seedTarget(1);
    ctx.mailThrows = true;
    const r = await S.dispatchDue(100, NOW, "test");
    ctx.mailThrows = false;
    expect(r.sent).toBe(0);
    expect(r.retry).toBe(0);                               // 재시도 예약으로 돌리지 않는다
    expect(r.review).toBeGreaterThan(0);
    const row = await ctx.pool.query(
      `SELECT s.status, (SELECT result FROM seminar_send_attempts a WHERE a.send_id=s.id) AS result
         FROM seminar_sends s WHERE s.id=$1::uuid`, [t.sendId]);
    expect(row.rows[0]).toMatchObject({ status: "needs_review", result: "unknown" });

    // 다시 돌려도 보내지 않는다.
    await S.dispatchDue(100, new Date(NOW.getTime() + 3_600_000), "test");
    expect(ctx.sent).toHaveLength(0);
  });

  it("stale 회수는 기록 없는 선점만 예약으로 되돌린다", async () => {
    const clean = await seedTarget(1);     // 기록 없음 → 되돌림
    const dirty = await seedTarget(2);     // attempted 기록 → 확인 필요
    await ctx.pool.query(
      "UPDATE seminar_sends SET status='sending', claimed_at = $1, claimed_by = gen_random_uuid()",
      [new Date(NOW.getTime() - 30 * 60_000).toISOString()]);
    await ctx.pool.query(
      `INSERT INTO seminar_send_attempts (send_id, session_id, target_id, stage, channel, attempt_no, body, purpose)
       VALUES ($1::uuid,$2::uuid,$3::uuid,'notice','email',1,'본문','service')`,
      [dirty.sendId, sessionId, dirty.targetId]);

    const rel = await S.releaseStale(NOW);
    expect(rel.sends).toBe(1);
    expect(rel.review).toBe(1);
    const rows = await ctx.pool.query("SELECT id::text AS id, status, claimed_by FROM seminar_sends");
    const c = rows.rows.find((x) => x.id === clean.sendId)!;
    const d = rows.rows.find((x) => x.id === dirty.sendId)!;
    expect(c).toMatchObject({ status: "queued", claimed_by: null });
    expect(d.status).toBe("needs_review");
  });

  it("정상 실행은 실행 이력을 done 으로 닫는다", async () => {
    await seedTarget(1);
    await S.dispatchDue(100, NOW, "test");
    const runs = await ctx.pool.query("SELECT status, summary FROM seminar_runs ORDER BY started_at DESC");
    expect(runs.rows[0].status).toBe("done");
    expect(String(runs.rows[0].summary)).toContain("접수 1");
  });
});
