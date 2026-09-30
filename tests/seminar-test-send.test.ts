// 세미나 — 지정 수신자 테스트 발송. 저장된 연락처 외에는 어떤 주소로도 나가지 않는다.
//   실제 문자·메일 계층은 가짜다. 고객 회차·수신거부 표는 이 경로에서 건드리지 않는다.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

const db = {
  schemaTable: true,
  schemaCols: true,
  cfg: {
    enabled: false, source_keys: ["apply_seminar"], week_mode: "session_to_session",
    session_weekday: 1, session_hour: 10, session_minute: 30,
    followup_hour: 11, followup_minute: 10,
    notice_lead_days: 0, notice_hour: 9, notice_minute: 0,
    late_policy: "send_now", cutoff_minutes: 30, dedupe_scope: "contact",
    zoom_url: "https://us06web.zoom.us/j/1?pwd=x",
    session_title: "GloveK 온라인 세미나 | 녹화 강의",
    first_session_date: "2026-10-05",
    send_email: true, send_sms: true, max_attempts: 3, stale_hours: 6, note: "",
    updated_by: null as string | null, updated_at: null as string | null,
    test_phone: "", test_email: "",
  },
  templates: [] as Record<string, unknown>[],
  rows: [] as Record<string, unknown>[],
  smsSent: [] as { to: string; msg: string; title?: string }[],
  mailSent: [] as { to: string; subject: string; body: string }[],
  smsOk: true, mailOk: true,
  /** 고객 표를 건드렸는지 감시 — 이 경로에서는 0 이어야 한다. */
  touchedCustomerTables: 0,
  seq: 0,
};

vi.mock("../lib/db", () => {
  const run = async (sql: string, args: unknown[] = []): Promise<Record<string, unknown>[]> => {
    const a = args as never[] as (string | number | boolean | string[] | null)[];
    if (/seminar_sessions|seminar_targets|seminar_sends\b|ad_optouts|ad_recipients|brands\b/.test(sql)) {
      db.touchedCustomerTables += 1;
    }
    if (sql.includes("to_regclass('public.seminar_test_sends')")) {
      return [{ reg: db.schemaTable ? "seminar_test_sends" : null }];
    }
    if (sql.includes("information_schema.columns")) {
      return db.schemaCols ? (a[0] as string[]).map((c) => ({ column_name: c })) : [];
    }
    if (sql.includes("FROM seminar_config WHERE id=1") && sql.includes("test_phone")) {
      return [{ test_phone: db.cfg.test_phone, test_email: db.cfg.test_email }];
    }
    if (sql.includes("FROM seminar_config")) return [{ ...db.cfg }];
    if (sql.includes("UPDATE seminar_config SET")) {
      const sets = sql.slice(sql.indexOf("SET") + 3, sql.indexOf("WHERE")).split(",").map((x) => x.trim());
      sets.forEach((s) => {
        const m = s.match(/^(\w+)=\$(\d+)$/);
        if (m) (db.cfg as unknown as Record<string, unknown>)[m[1]] = a[Number(m[2]) - 1];
      });
      return [];
    }
    if (sql.includes("FROM seminar_templates")) return db.templates.map((t) => ({ ...t }));
    if (sql.includes("INSERT INTO seminar_test_sends")) {
      if (db.rows.some((r) => r.channel === a[0] && r.status === "sending")) {
        throw new Error('duplicate key value violates unique constraint "seminar_test_sends_one_sending"');
      }
      const row = {
        id: `t${++db.seq}`, channel: a[0], stage: a[1], session_date: a[2], to_masked: a[3],
        subject: a[4], body_preview: a[5], created_by: a[6], status: "sending",
        provider: "", provider_id: "", error: "", created_at: new Date().toISOString(), sent_at: null,
      };
      db.rows.push(row);
      return [{ id: row.id }];
    }
    if (sql.includes("UPDATE seminar_test_sends SET status='sent'")) {
      const r = db.rows.find((x) => x.id === a[0]);
      if (r) { r.status = "sent"; r.provider = sql.includes("provider='aligo'") ? "aligo" : a[1]; r.provider_id = sql.includes("provider='aligo'") ? a[1] : a[2]; }
      return [];
    }
    if (sql.includes("UPDATE seminar_test_sends SET status='failed'")) {
      const r = db.rows.find((x) => x.id === a[0]);
      if (r) { r.status = "failed"; r.error = a[1]; }
      return [];
    }
    if (sql.includes("UPDATE seminar_test_sends SET status='canceled'")) {
      const cut = new Date(String(a[0])).getTime();
      const out = db.rows.filter((r) => r.status === "sending" && new Date(String(r.created_at)).getTime() < cut);
      out.forEach((r) => { r.status = "canceled"; });
      return out.map((r) => ({ id: r.id }));
    }
    if (sql.includes("FROM seminar_test_sends ORDER BY")) return db.rows.map((r) => ({ ...r }));
    return [];
  };
  return { query: run, queryOne: async (sql: string, args: unknown[] = []) => (await run(sql, args))[0] ?? null };
});

vi.mock("../lib/sms", () => ({
  sendSms: async (i: { receiver: string; msg: string; title?: string }) => {
    db.smsSent.push({ to: i.receiver, msg: i.msg, title: i.title });
    return db.smsOk ? { ok: true, msgId: "aligo-test-1", message: "성공" } : { ok: false, message: "문자 실패(모의)" };
  },
}));
vi.mock("../lib/mailer", () => ({
  sendEmail: async (i: { to: string; subject: string; text: string }) => {
    db.mailSent.push({ to: i.to, subject: i.subject, body: i.text });
    return db.mailOk ? { ok: true, id: "mail-test-1", via: "gmail" } : { ok: false, error: "메일 실패(모의)" };
  },
}));

const T = await import("../lib/seminar-test");

const PHONE = "01000000000";
const EMAIL = "tester@example.com";

function reset() {
  db.schemaTable = true; db.schemaCols = true; db.seq = 0;
  db.rows = []; db.smsSent = []; db.mailSent = []; db.smsOk = true; db.mailOk = true;
  db.touchedCustomerTables = 0;
  db.cfg.test_phone = PHONE; db.cfg.test_email = EMAIL;
  db.cfg.zoom_url = "https://us06web.zoom.us/j/1?pwd=x";
  // 문구는 초안(enabled=false) 그대로 — 테스트 발송은 활성화를 요구하지 않는다.
  db.templates = [
    { stage: "notice", enabled: false, purpose: "service", send_email: true, send_sms: true,
      email_subject: "[GloveK] {{세미나명}} 참가 안내 ({{일시}})",
      email_body: "{{담당자명}}님, {{세미나명}} 안내입니다.\n일시 {{일시}}\n링크 {{줌링크}}",
      sms_body: "[GloveK] {{세미나명}} {{일시}} {{줌링크}}", updated_by: null, updated_at: null },
    { stage: "followup", enabled: false, purpose: "ad", send_email: true, send_sms: true,
      email_subject: "[GloveK] 2부 ({{일시}})", email_body: "2부 {{일시}} {{줌링크}}",
      sms_body: "2부 {{일시}} {{줌링크}}", updated_by: null, updated_at: null },
  ];
}
beforeEach(reset);

describe("수신자 저장", () => {
  it("형식이 틀리면 저장하지 않는다", async () => {
    expect((await T.setTestRecipients({ phone: "123" }, "u")).ok).toBe(false);
    expect((await T.setTestRecipients({ email: "not-an-email" }, "u")).ok).toBe(false);
  });
  it("표기가 달라도 국내 번호로 정규화해 저장한다", async () => {
    expect((await T.setTestRecipients({ phone: "+82 10-0000-0000" }, "u")).ok).toBe(true);
    expect(db.cfg.test_phone).toBe("01000000000");
  });
  it("주소는 마스킹해서만 남긴다", () => {
    expect(T.maskTo("sms", "01040321029")).toBe("010****1029");
    expect(T.maskTo("email", "someone@dinostudio.kr")).toBe("so*****@dinostudio.kr");
  });
});

describe("미리보기 — 실제 안내와 같은 치환", () => {
  it("문구가 초안이어도 미리보기가 된다(활성화를 요구하지 않는다)", async () => {
    const pv = await T.previewSeminarTest({ channel: "sms" });
    expect(pv.ok).toBe(true);
    expect(db.templates[0].enabled).toBe(false);
  });
  it("치환이 끝나고 남는 자리표시자가 없다", async () => {
    const pv = await T.previewSeminarTest({ channel: "email" });
    expect(pv.body).not.toContain("{{");
    expect(pv.subject).not.toContain("{{");
    expect(pv.body).toContain("GloveK 온라인 세미나 | 녹화 강의");
    expect(pv.body).toContain("https://us06web.zoom.us/j/1?pwd=x");
  });
  it("기본 회차는 2026-10-05 10:30(KST) 이고 담당자는 Jaybe 다", async () => {
    const pv = await T.previewSeminarTest({ channel: "email" });
    expect(pv.sessionDate).toBe("2026-10-05");
    expect(pv.body).toContain("2026년 10월 5일(월) 오전 10:30");
    expect(pv.body).toContain("Jaybe");
  });
  it("[테스트] 표시와 안내 문구가 들어간다", async () => {
    const pv = await T.previewSeminarTest({ channel: "sms" });
    expect(pv.body.startsWith("[테스트]")).toBe(true);
    expect(pv.body).toContain("실제 세미나 안내가 아닙니다");
    const mail = await T.previewSeminarTest({ channel: "email" });
    expect(mail.subject.startsWith("[테스트]")).toBe(true);
  });
  it("받는 곳은 마스킹해서만 보여준다", async () => {
    const pv = await T.previewSeminarTest({ channel: "sms" });
    expect(pv.toMasked).toBe("010****0000");
    expect(JSON.stringify(pv)).not.toContain(PHONE);
  });
  it("2차는 미리보기만 되고 발송 대상이 아니다", async () => {
    const pv = await T.previewSeminarTest({ channel: "email", stage: "followup" });
    expect(pv.sendable).toBe(false);
    expect(pv.blockers.join()).toContain("2차");
  });
  it("수신자가 없거나 Zoom 링크가 없으면 막힌다", async () => {
    db.cfg.test_phone = "";
    expect((await T.previewSeminarTest({ channel: "sms" })).blockers.join()).toContain("테스트 문자 번호");
    reset();
    db.cfg.zoom_url = "";
    expect((await T.previewSeminarTest({ channel: "sms" })).blockers.join()).toContain("Zoom");
  });
  it("0105 미적용이면 사유를 알려준다", async () => {
    db.schemaTable = false;
    const pv = await T.previewSeminarTest({ channel: "sms" });
    expect(pv.ok).toBe(false);
    expect(pv.error).toContain("0105");
  });
});

describe("실제 테스트 발송", () => {
  it("문자 1건이 저장된 번호로 나가고 provider id 가 남는다", async () => {
    const r = await T.sendSeminarTest({ channel: "sms", by: "u" });
    expect(r.ok).toBe(true);
    expect(db.smsSent).toHaveLength(1);
    expect(db.smsSent[0].to).toBe(PHONE);
    expect(db.smsSent[0].msg.startsWith("[테스트]")).toBe(true);
    expect(db.rows[0].status).toBe("sent");
    expect(db.rows[0].provider_id).toBe("aligo-test-1");
  });
  it("메일 1건이 저장된 주소로 나간다", async () => {
    const r = await T.sendSeminarTest({ channel: "email", by: "u" });
    expect(r.ok).toBe(true);
    expect(db.mailSent).toHaveLength(1);
    expect(db.mailSent[0].to).toBe(EMAIL);
    expect(db.mailSent[0].subject.startsWith("[테스트]")).toBe(true);
    expect(db.rows[0].provider_id).toBe("mail-test-1");
  });
  it("저장되지 않은 주소로는 보낼 수 없다", async () => {
    db.cfg.test_phone = "";
    const r = await T.sendSeminarTest({ channel: "sms", by: "u" });
    expect(r.ok).toBe(false);
    expect(db.smsSent).toEqual([]);
  });
  it("Zoom 링크가 없으면 보내지 않는다", async () => {
    db.cfg.zoom_url = "";
    const r = await T.sendSeminarTest({ channel: "sms", by: "u" });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("Zoom");
    expect(db.smsSent).toEqual([]);
  });
  it("중복 클릭은 두 번째가 막힌다", async () => {
    const [a, b] = await Promise.all([
      T.sendSeminarTest({ channel: "sms", by: "u" }),
      T.sendSeminarTest({ channel: "sms", by: "u" }),
    ]);
    const okCount = [a, b].filter((x) => x.ok).length;
    expect(okCount).toBe(1);
    expect(db.smsSent).toHaveLength(1);
    expect([a, b].find((x) => !x.ok)!.error).toContain("이미 진행 중");
  });
  it("실패는 원장에 사유와 함께 남는다", async () => {
    db.smsOk = false;
    const r = await T.sendSeminarTest({ channel: "sms", by: "u" });
    expect(r.ok).toBe(false);
    expect(db.rows[0].status).toBe("failed");
    expect(String(db.rows[0].error)).toContain("실패");
  });
  it("멈춘 선점은 회수돼 다음 시도가 막히지 않는다", async () => {
    db.rows.push({ id: "old", channel: "sms", status: "sending", created_at: new Date(Date.now() - 10 * 60_000).toISOString() });
    const r = await T.sendSeminarTest({ channel: "sms", by: "u" });
    expect(r.ok).toBe(true);
  });
  it("고객 회차·대상·발송 원장·수신거부 표를 건드리지 않는다", async () => {
    await T.sendSeminarTest({ channel: "sms", by: "u" });
    await T.sendSeminarTest({ channel: "email", by: "u" });
    expect(db.touchedCustomerTables).toBe(0);
  });
  it("마스터 스위치가 꺼져 있어도 테스트는 나간다(그게 목적이다)", async () => {
    expect(db.cfg.enabled).toBe(false);
    expect((await T.sendSeminarTest({ channel: "sms", by: "u" })).ok).toBe(true);
  });
  it("실제 발송 단계는 1차 참가안내뿐이다", () => {
    expect(T.TEST_SENDABLE_STAGES).toEqual(["notice"]);
  });
});

describe("배선 감사", () => {
  it("0105 마이그레이션은 추가만 한다", () => {
    const sql = read("../migrations/0105_seminar_test_send.sql");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS test_phone");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS seminar_test_sends");
    expect(sql).toContain("seminar_test_sends_one_sending");
    expect(sql.replace(/ON DELETE CASCADE/g, "")).not.toMatch(/\b(DROP|TRUNCATE|DELETE|UPDATE)\b/i);
  });
  it("서버액션이 역할을 검사하고 화면 입력 주소를 쓰지 않는다", () => {
    const src = read("../app/(dash)/seminar/actions.ts");
    const body = src.slice(src.indexOf("export async function seminarSendTestAction"));
    expect(body.slice(0, 400)).toContain("writer()");
    // 발송 액션은 채널과 날짜만 받는다 — 주소를 인자로 받지 않는다.
    expect(body).toMatch(/seminarSendTestAction\(channel: string, sessionDate\?: string\)/);
    const lib = read("../lib/seminar-test.ts");
    expect(lib).toContain("화면 입력을 쓰지 않는다");
  });
  it("테스트 경로가 고객 회차·수신거부 모듈을 import 하지 않는다", () => {
    const lib = read("../lib/seminar-test.ts");
    expect(lib).not.toMatch(/ad-optout|seminar_targets|seminar_sends|buildSessionTargets|dispatchDue/);
  });
  it("실제 연락처는 저장소 코드에 들어 있지 않다", () => {
    for (const f of ["../lib/seminar-test.ts", "../components/SeminarPanel.tsx",
                     "../app/(dash)/seminar/actions.ts", "../migrations/0105_seminar_test_send.sql"]) {
      const src = read(f);
      expect(src, f).not.toMatch(/01040321029/);
      expect(src, f).not.toMatch(/jaybe@dinostudio\.kr/);
    }
  });
});
