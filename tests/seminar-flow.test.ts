// 주간 세미나 안내 — 대상 확정·중복 방지·발송·재시도·동시 실행을 가짜 DB 로 검증한다.
//   실제 문자·메일은 보내지 않는다(발송 계층을 전부 가짜로 둔다).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

// ── 가짜 저장소 ─────────────────────────────────────────────
interface LeadRow { id: string; brand_id: string; source: string | null; occurred_at: string }
interface BrandRow { id: string; brand_name: string; contact_name: string; email: string; phone: string; msg_opt_out: boolean; is_test: boolean; state: string }
interface SessionRow { id: string; session_date: string; starts_at: string; followup_at: string; notice_due_at: string; window_from: string; window_to: string; week_mode: string; source_keys: string[]; zoom_url: string; session_title: string; dedupe_scope: string; status: string; note: string; built_at: string | null; created_at: string }
interface TargetRow { id: string; session_id: string; brand_id: string; lead_event_id: string; applied_at: string; source_key: string; brand_name: string; contact_name: string; email: string; phone: string; dedupe_email: string; dedupe_phone: string; status: string; exclude_reason: string; late: boolean }
interface SendRow { id: string; session_id: string; target_id: string; stage: string; channel: string; due_at: string; status: string; attempts: number; claimed_at: string | null; claimed_by: string | null; sent_at: string | null; provider: string; provider_id: string; error: string; skip_reason: string }
interface RunRow { id: string; kind: string; status: string; started_at: string; finished_at: string | null; summary: string; error: string | null; triggered_by: string }

const cfg0 = () => ({
  enabled: true,
  source_keys: ["apply_seminar", "tp_seminar"],
  week_mode: "session_to_session",
  session_weekday: 1, session_hour: 10, session_minute: 30,
  followup_hour: 11, followup_minute: 10,
  notice_lead_days: 0, notice_hour: 9, notice_minute: 0,
  late_policy: "send_now", cutoff_minutes: 30, dedupe_scope: "contact",
  zoom_url: "https://us06web.zoom.us/j/1?pwd=x",
  session_title: "GloveK 온라인 세미나 | 녹화 강의",
  first_session_date: "2026-10-05",
  send_email: true, send_sms: true,
  max_attempts: 3, stale_hours: 6, note: "",
  updated_by: null as string | null, updated_at: "2026-09-30T00:00:00Z",
});

const db = {
  schema: true,
  cfg: cfg0(),
  templates: [] as { stage: string; enabled: boolean; purpose: string; send_email: boolean; send_sms: boolean; email_subject: string; email_body: string; sms_body: string; updated_by: string | null; updated_at: string | null }[],
  brands: [] as BrandRow[],
  leads: [] as LeadRow[],
  sessions: [] as SessionRow[],
  targets: [] as TargetRow[],
  sends: [] as SendRow[],
  runs: [] as RunRow[],
  // 0111 — 보낸 내용 기록. attemptsSchema=false 면 "표 없음"으로 본다.
  attemptsSchema: true,
  attempts: [] as { id: string; send_id: string; attempt_no: number; channel: string; stage: string; to_masked: string; subject: string; body: string; purpose: string; result: string; provider: string; provider_id: string; error: string }[],
  /** beginAttempt 를 실패시켜 "기록 못 남김"을 흉내 낸다. */
  attemptsWriteFails: false,
  /** 첫 전송 직후에 부르는 훅(루프 중 OFF 등을 흉내 낸다). */
  onSend: null as null | (() => void),
  /** seminar_config 조회를 실패시켜 fail closed 를 확인한다. */
  configReadFails: false,
  seq: 0,
  // 발송 계층 관찰용
  smsSent: [] as { to: string; msg: string }[],
  mailSent: [] as { to: string; subject: string; body: string }[],
  smsOk: true, mailOk: true,
  adBlocked: false, adError: "" as string,
};
const id = (p: string) => `${p}${++db.seq}`;

vi.mock("../lib/db", () => {
  const run = async (sql: string, args: unknown[] = []): Promise<Record<string, unknown>[]> => {
    const a = args as never[] as (string | number | boolean | string[] | null)[];

    if (sql.includes("information_schema.tables")) {
      return db.schema
        ? ["seminar_config", "seminar_templates", "seminar_sessions", "seminar_targets", "seminar_sends", "seminar_runs"].map((t) => ({ table_name: t }))
        : [];
    }
    if (sql.includes("to_regclass('public.seminar_send_attempts')")) {
      return db.attemptsSchema ? [{ reg: "seminar_send_attempts" }] : [{ reg: null }];
    }
    if (sql.includes("information_schema.columns") && sql.includes("claimed_by")) {
      return db.attemptsSchema ? [{ column_name: "claimed_by" }] : [];
    }
    if (sql.includes("INSERT INTO seminar_send_attempts")) {
      if (db.attemptsWriteFails) throw new Error("기록 저장 실패(검수용)");
      const [send_id, , , , stage, channel, attempt_no, to_masked, subject, body, purpose] = a as never[] as string[];
      if (db.attempts.some((x) => x.send_id === send_id && x.attempt_no === Number(attempt_no))) return [];
      const row = {
        id: id("at"), send_id, attempt_no: Number(attempt_no), channel, stage,
        to_masked, subject, body, purpose, result: "attempted", provider: "", provider_id: "", error: "",
      };
      db.attempts.push(row);
      return [{ id: row.id }];
    }
    if (sql.includes("FROM seminar_send_attempts WHERE send_id")) {
      const [send_id, no] = a as never[] as string[];
      const hit = db.attempts.find((x) => x.send_id === send_id && x.attempt_no === Number(no));
      return hit ? [{ id: hit.id }] : [];
    }
    if (sql.includes("UPDATE seminar_send_attempts")) {
      const [attId, result, provider, providerId, error] = a as never[] as string[];
      const hit = db.attempts.find((x) => x.id === attId);
      if (hit) { hit.result = result; hit.provider = provider; hit.provider_id = providerId; hit.error = error; }
      return [];
    }
    if (sql.includes("FROM seminar_config")) {
      if (db.configReadFails) throw new Error("설정 조회 실패(검수용)");
      return [{ ...db.cfg }];
    }
    if (sql.includes("UPDATE seminar_config SET")) {
      // set 절을 파싱해 실제 컬럼에 반영
      const sets = sql.slice(sql.indexOf("SET") + 3, sql.indexOf("WHERE")).split(",").map((x) => x.trim());
      sets.forEach((s) => {
        const m = s.match(/^(\w+)=\$(\d+)$/);
        if (m) (db.cfg as unknown as Record<string, unknown>)[m[1]] = a[Number(m[2]) - 1];
      });
      return [];
    }
    if (sql.includes("FROM seminar_templates")) return db.templates.map((t) => ({ ...t }));
    if (sql.includes("UPDATE seminar_templates SET")) {
      const t = db.templates.find((x) => x.stage === a[a.length - 1]);
      if (!t) return [];
      const sets = sql.slice(sql.indexOf("SET") + 3, sql.indexOf("WHERE")).split(",").map((x) => x.trim());
      sets.forEach((s) => {
        const m = s.match(/^(\w+)=\$(\d+)$/);
        if (m) (t as unknown as Record<string, unknown>)[m[1]] = a[Number(m[2]) - 1];
      });
      return [];
    }

    // 신청 목록(세미나 소스 한정 · 기간 · 테스트 제외)
    if (sql.includes("FROM brand_sources bs")) {
      const keys = a[0] as string[];
      const from = new Date(String(a[1])).getTime(), to = new Date(String(a[2])).getTime();
      return db.leads
        .filter((l) => l.source != null && keys.includes(l.source))
        .filter((l) => { const t = new Date(l.occurred_at).getTime(); return t >= from && t < to; })
        .map((l) => ({ l, b: db.brands.find((b) => b.id === l.brand_id)! }))
        .filter((x) => x.b && !x.b.is_test)
        .sort((x, y) => x.l.occurred_at.localeCompare(y.l.occurred_at) || x.l.id.localeCompare(y.l.id))
        .map(({ l, b }) => ({
          leadEventId: l.id, brandId: b.id, appliedAt: l.occurred_at, sourceKey: l.source,
          brandName: b.brand_name, contactName: b.contact_name, email: b.email, phone: b.phone,
          msgOptOut: b.msg_opt_out, state: b.state,
        }));
    }
    if (sql.includes("count(*)::text AS n FROM brand_sources")) {
      const from = new Date(String(a[0])).getTime(), to = new Date(String(a[1])).getTime();
      const n = db.leads.filter((l) => !l.source && (() => { const t = new Date(l.occurred_at).getTime(); return t >= from && t < to; })()).length;
      return [{ n: String(n) }];
    }

    if (sql.includes("INSERT INTO seminar_sessions")) {
      if (!db.sessions.some((s) => s.session_date === a[0])) {
        db.sessions.push({
          id: id("ses"), session_date: String(a[0]), starts_at: String(a[1]), followup_at: String(a[2]),
          notice_due_at: String(a[3]), window_from: String(a[4]), window_to: String(a[5]),
          week_mode: String(a[6]), source_keys: a[7] as string[], zoom_url: String(a[8]),
          session_title: String(a[9]), dedupe_scope: String(a[10]), status: "planned", note: "",
          built_at: null, created_at: "2026-09-30T00:00:00Z",
        });
      }
      return [];
    }
    if (sql.includes("FROM seminar_sessions WHERE session_date=$1")) {
      const s = db.sessions.find((x) => x.session_date === a[0]);
      return s ? [{ ...s }] : [];
    }
    if (sql.includes("FROM seminar_sessions WHERE id=$1")) {
      const s = db.sessions.find((x) => x.id === a[0]);
      return s ? [{ ...s }] : [];
    }
    if (sql.includes("FROM seminar_sessions ORDER BY starts_at DESC")) {
      return [...db.sessions].sort((x, y) => y.starts_at.localeCompare(x.starts_at)).map((s) => ({ ...s }));
    }
    if (sql.includes("UPDATE seminar_sessions SET built_at=now()")) {
      const s = db.sessions.find((x) => x.id === a[0]); if (s) s.built_at = "2026-09-30T00:00:00Z";
      return [];
    }

    // 이월 대상
    if (sql.includes("FROM seminar_targets t") && sql.includes("JOIN seminar_sessions ss")) {
      const before = new Date(String(a[0])).getTime();
      return db.targets
        .filter((t) => t.status === "deferred")
        .filter((t) => { const ss = db.sessions.find((s) => s.id === t.session_id); return ss && new Date(ss.starts_at).getTime() < before; })
        .filter((t) => !db.targets.some((x) => x.session_id === a[1] && x.lead_event_id === t.lead_event_id))
        .map((t) => ({ t, b: db.brands.find((b) => b.id === t.brand_id)! }))
        .filter((x) => x.b && !x.b.is_test)
        .map(({ t, b }) => ({
          leadEventId: t.lead_event_id, brandId: t.brand_id, appliedAt: t.applied_at, sourceKey: t.source_key,
          brandName: b.brand_name, contactName: b.contact_name, email: b.email, phone: b.phone,
          msgOptOut: b.msg_opt_out, state: b.state,
        }));
    }
    if (sql.includes("SELECT lead_event_id, dedupe_email, dedupe_phone, brand_id, status FROM seminar_targets")) {
      return db.targets.filter((t) => t.session_id === a[0])
        .map((t) => ({ lead_event_id: t.lead_event_id, dedupe_email: t.dedupe_email, dedupe_phone: t.dedupe_phone, brand_id: t.brand_id, status: t.status }));
    }
    if (sql.includes("INSERT INTO seminar_targets")) {
      const withStatus = sql.includes("$12");   // 전체 INSERT(상태 인자 포함)
      const [session_id, brand_id, lead_event_id, applied_at, source_key, brand_name, contact_name, email, phone] = a as string[];
      if (db.targets.some((t) => t.session_id === session_id && t.lead_event_id === lead_event_id)) return [];
      const row: TargetRow = {
        id: id("tg"), session_id, brand_id, lead_event_id, applied_at, source_key,
        brand_name, contact_name, email, phone,
        dedupe_email: withStatus ? String(a[9]) : "", dedupe_phone: withStatus ? String(a[10]) : "",
        status: withStatus ? String(a[11]) : "duplicate",
        exclude_reason: withStatus ? String(a[12]) : "같은 연락처가 이미 대상입니다",
        late: withStatus ? Boolean(a[13]) : false,
      };
      // 부분 유니크 인덱스(같은 회차 · eligible · 같은 연락처) 재현
      if (row.status === "eligible") {
        const clash = db.targets.some((t) => t.session_id === session_id && t.status === "eligible" &&
          ((row.dedupe_email && t.dedupe_email === row.dedupe_email) || (row.dedupe_phone && t.dedupe_phone === row.dedupe_phone)));
        if (clash) throw new Error('duplicate key value violates unique constraint "seminar_targets_email_uniq"');
      }
      db.targets.push(row);
      return [{ id: row.id }];
    }
    if (sql.includes("FROM seminar_targets WHERE session_id=$1")) {
      return db.targets.filter((t) => t.session_id === a[0]).map((t) => ({ ...t }));
    }

    if (sql.includes("INSERT INTO seminar_sends")) {
      const [session_id, target_id, stage, channel, due_at] = a as string[];
      if (db.sends.some((s) => s.session_id === session_id && s.target_id === target_id && s.stage === stage && s.channel === channel)) return [];
      const row: SendRow = {
        id: id("sd"), session_id, target_id, stage, channel, due_at, status: "queued",
        attempts: 0, claimed_at: null, claimed_by: null, sent_at: null, provider: "", provider_id: "", error: "", skip_reason: "",
      };
      db.sends.push(row);
      return [{ id: row.id }];
    }
    if (sql.includes("UPDATE seminar_sends SET status='sending'")) {
      const now = new Date(String(a[0])).getTime();
      const limit = Number(a[1]);
      const picked = db.sends.filter((s) => s.status === "queued" && new Date(s.due_at).getTime() <= now)
        .sort((x, y) => x.due_at.localeCompare(y.due_at)).slice(0, limit);
      const by = a[2] == null ? null : String(a[2]);
      picked.forEach((s) => { s.status = "sending"; s.attempts += 1; s.claimed_at = new Date(now).toISOString(); s.claimed_by = by; });
      return picked.map((s) => ({ id: s.id }));
    }
    if (sql.includes("FROM seminar_sends s") && sql.includes("JOIN seminar_targets t")) {
      if (sql.includes("WHERE s.id = ANY")) {
        const ids = a[0] as string[];
        return db.sends.filter((s) => ids.includes(s.id)).map((s) => {
          const t = db.targets.find((x) => x.id === s.target_id)!;
          const ses = db.sessions.find((x) => x.id === s.session_id)!;
          const b = db.brands.find((x) => x.id === t.brand_id)!;
          return {
            id: s.id, session_id: s.session_id, target_id: s.target_id, stage: s.stage, channel: s.channel,
            due_at: s.due_at, attempts: s.attempts,
            brand_name: t.brand_name, contact_name: t.contact_name, email: t.email, phone: t.phone,
            brand_id: t.brand_id, target_status: t.status,
            starts_at: ses.starts_at, followup_at: ses.followup_at, zoom_url: ses.zoom_url, session_title: ses.session_title,
            msg_opt_out: b.msg_opt_out,
          };
        });
      }
      // listSessionSends
      return db.sends.filter((s) => s.session_id === a[0]).map((s) => {
        const t = db.targets.find((x) => x.id === s.target_id)!;
        return { ...s, brand_name: t.brand_name, contact_name: t.contact_name, email: t.email, phone: t.phone,
          log_count: db.attempts.filter((x) => x.send_id === s.id).length };
      });
    }
    if (sql.includes("UPDATE seminar_sends SET status='skipped'")) {
      const s = db.sends.find((x) => x.id === a[0]); if (s) { s.status = "skipped"; s.skip_reason = String(a[1]); }
      return [];
    }
    if (sql.includes("UPDATE seminar_sends SET status='sent'")) {
      const s = db.sends.find((x) => x.id === a[0]);
      if (s) { s.status = "sent"; s.sent_at = "now"; s.provider = String(a[1]); s.provider_id = String(a[2]); s.error = ""; }
      return [];
    }
    if (sql.includes("UPDATE seminar_sends SET status='failed'")) {
      const s = db.sends.find((x) => x.id === a[0]); if (s) { s.status = "failed"; s.error = String(a[1]); }
      return [];
    }
    if (sql.includes("UPDATE seminar_sends SET status='queued'") && sql.includes("due_at=$3")) {
      const s = db.sends.find((x) => x.id === a[0]); if (s) { s.status = "queued"; s.error = String(a[1]); s.due_at = String(a[2]); }
      return [];
    }
    if (sql.includes("UPDATE seminar_sends SET status='queued'") && sql.includes("claimed_by = $2")) {
      // 중단 시 "내가 잡은 미처리분"만 되돌린다.
      const ids = a[0] as unknown as string[];
      const runId = String(a[1]);
      const out = db.sends.filter((s) => ids.includes(s.id) && s.status === "sending" && s.claimed_by === runId);
      out.forEach((s) => { s.status = "queued"; });
      return out.map((s) => ({ id: s.id }));
    }
    if (sql.includes("UPDATE seminar_sends SET status='queued'")) {  // releaseStale
      const cut = new Date(String(a[0])).getTime();
      const out = db.sends.filter((s) => s.status === "sending" && s.claimed_at && new Date(s.claimed_at).getTime() < cut);
      out.forEach((s) => { s.status = "queued"; });
      return out.map((s) => ({ id: s.id }));
    }

    if (sql.includes("INSERT INTO seminar_runs")) {
      if (db.runs.some((r) => r.kind === a[0] && r.status === "running")) {
        throw new Error('duplicate key value violates unique constraint "seminar_runs_one_running"');
      }
      const row: RunRow = { id: id("run"), kind: String(a[0]), status: "running", started_at: new Date().toISOString(), finished_at: null, summary: "", error: null, triggered_by: String(a[1]) };
      db.runs.push(row);
      return [{ id: row.id }];
    }
    if (sql.includes("UPDATE seminar_runs SET status=$2")) {
      const r = db.runs.find((x) => x.id === a[0]);
      if (r) { r.status = String(a[1]); r.summary = String(a[2]); r.error = a[3] == null ? null : String(a[3]); r.finished_at = "now"; }
      return [];
    }
    if (sql.includes("UPDATE seminar_runs SET status='error'")) {
      const cut = new Date(String(a[0])).getTime();
      const out = db.runs.filter((r) => r.status === "running" && new Date(r.started_at).getTime() < cut);
      out.forEach((r) => { r.status = "error"; });
      return out.map((r) => ({ id: r.id }));
    }
    if (sql.includes("FROM seminar_runs ORDER BY")) return db.runs.map((r) => ({ ...r }));
    return [];
  };
  return { query: run, queryOne: async (sql: string, args: unknown[] = []) => (await run(sql, args))[0] ?? null };
});

vi.mock("../lib/sms", () => ({
  sendSms: async (i: { receiver: string; msg: string }) => {
    db.smsSent.push({ to: i.receiver, msg: i.msg });
    if (db.smsSent.length + db.mailSent.length === 1 && db.onSend) db.onSend();
    return db.smsOk ? { ok: true, msgId: "aligo-1", message: "성공" } : { ok: false, message: "문자 실패(모의)" };
  },
}));
vi.mock("../lib/mailer", () => ({
  sendEmail: async (i: { to: string; subject: string; text: string }) => {
    db.mailSent.push({ to: i.to, subject: i.subject, body: i.text });
    if (db.smsSent.length + db.mailSent.length === 1 && db.onSend) db.onSend();
    return db.mailOk ? { ok: true, id: "mail-1", via: "gmail" } : { ok: false, error: "메일 실패(모의)" };
  },
}));
vi.mock("../lib/ad-optout", () => ({
  adGate: async () => (db.adError
    ? { smsAllowed: false, emailAllowed: false, error: db.adError }
    : { smsAllowed: !db.adBlocked, emailAllowed: !db.adBlocked, reason: db.adBlocked ? "광고 수신거부" : undefined }),
  ensureRecipient: async () => ({ id: "r1", token: "tok", email: "", phone: "", brand_id: null, kind: "lead" }),
  optoutUrlFor: (t: string) => `https://admin.glovek.space/u/${t}`,
  withSmsOptout: (b: string, u: string) => `${b}\n무료수신거부 ${u}`,
  withMailOptout: (b: string, u: string) => `${b}\n수신거부 ${u}`,
}));

const S = await import("../lib/seminar");

// 2026-10-05(월) 회차. 모집 구간은 09-28 10:00 ~ 10-05 10:00 (KST).
const D = "2026-10-05";
const kstIso = (day: string, h: number, m: number) => {
  const [y, mo, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h - 9, m)).toISOString();
};

function brand(n: number, over: Partial<BrandRow> = {}): BrandRow {
  return {
    id: `b${n}`, brand_name: `브랜드${n}`, contact_name: `담당${n}`,
    email: `b${n}@example.com`, phone: `0101111${String(1000 + n)}`,
    msg_opt_out: false, is_test: false, state: "lead_new", ...over,
  };
}
function lead(n: number, brandId: string, source: string | null, at: string): LeadRow {
  return { id: `l${n}`, brand_id: brandId, source, occurred_at: at };
}

function reset() {
  db.schema = true; db.cfg = cfg0(); db.seq = 0;
  db.brands = []; db.leads = []; db.sessions = []; db.targets = []; db.sends = []; db.runs = [];
  db.smsSent = []; db.mailSent = []; db.smsOk = true; db.mailOk = true;
  db.attemptsSchema = true; db.attempts = []; db.attemptsWriteFails = false;
  db.onSend = null; db.configReadFails = false;
  db.adBlocked = false; db.adError = "";
  db.templates = [
    { stage: "notice", enabled: true, purpose: "service", send_email: true, send_sms: true,
      email_subject: "[GloveK] {{세미나명}} 참가 안내 ({{일시}})", email_body: "{{담당자명}}님 {{일시}} {{줌링크}}",
      sms_body: "[GloveK] {{세미나명}} {{일시}} {{줌링크}}", updated_by: null, updated_at: null },
    { stage: "followup", enabled: true, purpose: "ad", send_email: true, send_sms: true,
      email_subject: "[GloveK] 2부 세션 ({{일시}})", email_body: "2부 {{일시}} {{줌링크}}",
      sms_body: "2부 {{일시}} {{줌링크}}", updated_by: null, updated_at: null },
  ];
}
beforeEach(reset);

describe("대상 = 그 주 세미나 신청만", () => {
  it("세미나 소스만 들어오고 다른 유입 루트는 제외된다", async () => {
    db.brands = [brand(1), brand(2), brand(3)];
    db.leads = [
      lead(1, "b1", "apply_seminar", kstIso("2026-09-29", 12, 0)),
      lead(2, "b2", "tp_seminar", kstIso("2026-09-30", 12, 0)),
      lead(3, "b3", "meta_ads", kstIso("2026-09-30", 12, 0)),      // 다른 유입 루트
    ];
    const pv = await S.previewSession(D, new Date(kstIso("2026-10-01", 9, 0)));
    expect(pv.targets.map((t) => t.brandId).sort()).toEqual(["b1", "b2"]);
  });

  it("구간 밖(누적 리드)은 들어오지 않는다", async () => {
    db.brands = [brand(1), brand(2)];
    db.leads = [
      lead(1, "b1", "apply_seminar", kstIso("2026-09-20", 12, 0)),  // 지지난 주
      lead(2, "b2", "apply_seminar", kstIso("2026-09-29", 12, 0)),  // 이번 구간
    ];
    const pv = await S.previewSession(D, new Date(kstIso("2026-10-01", 9, 0)));
    expect(pv.targets.map((t) => t.brandId)).toEqual(["b2"]);
  });

  it("테스트 리드는 제외된다", async () => {
    db.brands = [brand(1), brand(2, { is_test: true })];
    db.leads = [
      lead(1, "b1", "apply_seminar", kstIso("2026-09-29", 12, 0)),
      lead(2, "b2", "apply_seminar", kstIso("2026-09-29", 13, 0)),
    ];
    const pv = await S.previewSession(D, new Date(kstIso("2026-10-01", 9, 0)));
    expect(pv.targets.map((t) => t.brandId)).toEqual(["b1"]);
  });

  it("소스가 비어 있는 유입은 대상에서 빠지되 건수를 알린다(조용히 누락하지 않는다)", async () => {
    db.brands = [brand(1)];
    db.leads = [lead(1, "b1", null, kstIso("2026-09-29", 12, 0))];
    const pv = await S.previewSession(D, new Date(kstIso("2026-10-01", 9, 0)));
    expect(pv.targets).toEqual([]);
    expect(pv.unclassified).toBe(1);
  });

  it("주간 경계 설정을 바꾸면 같은 신청이 다른 회차로 간다", async () => {
    db.brands = [brand(1)];
    db.leads = [lead(1, "b1", "apply_seminar", kstIso("2026-10-05", 9, 30))];  // 회차 당일 오전 9:30
    const a = await S.previewSession(D, new Date(kstIso("2026-10-05", 9, 40)));
    expect(a.targets.map((t) => t.brandId)).toEqual(["b1"]);   // A: 접수마감 10:00 전이라 포함
    db.cfg.week_mode = "calendar_week";
    const b = await S.previewSession(D, new Date(kstIso("2026-10-05", 9, 40)));
    expect(b.targets).toEqual([]);                              // B: 지난 일요일까지만
  });
});

describe("중복·연락처 누락", () => {
  it("같은 연락처로 두 번 신청하면 한 번만 대상이 된다", async () => {
    db.brands = [brand(1)];
    db.leads = [
      lead(1, "b1", "apply_seminar", kstIso("2026-09-29", 10, 0)),
      lead(2, "b1", "apply_seminar", kstIso("2026-09-30", 10, 0)),
    ];
    const r = await S.buildSessionTargets(D, "t", new Date(kstIso("2026-10-01", 9, 0)));
    expect(r.eligible).toBe(1);
    expect(r.duplicate).toBe(1);
    // 메일·문자 각 1건씩만 예약된다
    expect(db.sends.filter((s) => s.stage === "notice").length).toBe(2);
  });

  it("같은 팀이라도 연락처가 다르면 각자 받는다(연락처 기준)", async () => {
    db.brands = [brand(1), { ...brand(2), id: "b1b", brand_name: "브랜드1", email: "other@example.com", phone: "01099998888" }];
    db.leads = [
      lead(1, "b1", "apply_seminar", kstIso("2026-09-29", 10, 0)),
      lead(2, "b1b", "apply_seminar", kstIso("2026-09-29", 11, 0)),
    ];
    const r = await S.buildSessionTargets(D, "t", new Date(kstIso("2026-10-01", 9, 0)));
    expect(r.eligible).toBe(2);
  });

  it("팀 기준으로 바꾸면 한 팀에 1건만 나간다", async () => {
    db.cfg.dedupe_scope = "brand";
    db.brands = [brand(1)];
    db.leads = [
      lead(1, "b1", "apply_seminar", kstIso("2026-09-29", 10, 0)),
      lead(2, "b1", "apply_seminar", kstIso("2026-09-30", 10, 0)),
    ];
    const r = await S.buildSessionTargets(D, "t", new Date(kstIso("2026-10-01", 9, 0)));
    expect(r.eligible).toBe(1);
  });

  it("전화만 있으면 문자 예약만, 메일만 있으면 메일 예약만 생긴다", async () => {
    db.brands = [brand(1, { email: "" }), { ...brand(2), id: "b2", phone: "" }];
    db.leads = [
      lead(1, "b1", "apply_seminar", kstIso("2026-09-29", 10, 0)),
      lead(2, "b2", "apply_seminar", kstIso("2026-09-29", 11, 0)),
    ];
    await S.buildSessionTargets(D, "t", new Date(kstIso("2026-10-01", 9, 0)));
    const byBrand = (bid: string) => db.sends.filter((s) => {
      const t = db.targets.find((x) => x.id === s.target_id)!;
      return t.brand_id === bid && s.stage === "notice";
    }).map((s) => s.channel).sort();
    expect(byBrand("b1")).toEqual(["sms"]);
    expect(byBrand("b2")).toEqual(["email"]);
  });

  it("연락처가 하나도 없으면 제외 사유가 남는다", async () => {
    db.brands = [brand(1, { email: "", phone: "" })];
    db.leads = [lead(1, "b1", "apply_seminar", kstIso("2026-09-29", 10, 0))];
    const r = await S.buildSessionTargets(D, "t", new Date(kstIso("2026-10-01", 9, 0)));
    expect(r.excluded).toBe(1);
    expect(db.targets[0].exclude_reason).toContain("연락처가 모두 없습니다");
    expect(db.sends).toEqual([]);
  });

  it("전체 수신거부는 서비스 안내에서도 제외된다", async () => {
    db.brands = [brand(1, { msg_opt_out: true })];
    db.leads = [lead(1, "b1", "apply_seminar", kstIso("2026-09-29", 10, 0))];
    const r = await S.buildSessionTargets(D, "t", new Date(kstIso("2026-10-01", 9, 0)));
    expect(r.excluded).toBe(1);
    expect(db.targets[0].exclude_reason).toContain("수신거부");
  });

  it("다시 확정해도 예약이 늘어나지 않는다(멱등)", async () => {
    db.brands = [brand(1)];
    db.leads = [lead(1, "b1", "apply_seminar", kstIso("2026-09-29", 10, 0))];
    const now = new Date(kstIso("2026-10-01", 9, 0));
    await S.buildSessionTargets(D, "t", now);
    const first = db.sends.length;
    const again = await S.buildSessionTargets(D, "t", now);
    expect(db.sends.length).toBe(first);
    expect(again.eligible).toBe(0);
  });

  it("나중에 들어온 신청만 추가된다", async () => {
    db.brands = [brand(1), brand(2)];
    db.leads = [lead(1, "b1", "apply_seminar", kstIso("2026-09-29", 10, 0))];
    const now = new Date(kstIso("2026-10-01", 9, 0));
    await S.buildSessionTargets(D, "t", now);
    db.leads.push(lead(2, "b2", "apply_seminar", kstIso("2026-10-01", 10, 0)));
    const r = await S.buildSessionTargets(D, "t", new Date(kstIso("2026-10-01", 11, 0)));
    expect(r.eligible).toBe(1);
    expect(db.targets.filter((t) => t.status === "eligible").length).toBe(2);
  });
});

describe("늦은 신청", () => {
  it("send_now 는 확인 즉시 1회 안내로 예약된다", async () => {
    db.brands = [brand(1)];
    db.leads = [lead(1, "b1", "apply_seminar", kstIso("2026-10-05", 9, 30))];  // 안내 09:00 이후
    const now = new Date(kstIso("2026-10-05", 9, 40));
    const r = await S.buildSessionTargets(D, "t", now);
    expect(r.eligible).toBe(1);
    expect(db.targets[0].late).toBe(true);
    const notice = db.sends.find((s) => s.stage === "notice")!;
    expect(new Date(notice.due_at).getTime()).toBe(now.getTime());
  });

  it("next_week 는 이월되고 다음 회차에 편입된다", async () => {
    db.cfg.late_policy = "next_week";
    db.brands = [brand(1)];
    db.leads = [lead(1, "b1", "apply_seminar", kstIso("2026-10-05", 9, 30))];
    const r = await S.buildSessionTargets(D, "t", new Date(kstIso("2026-10-05", 9, 40)));
    expect(r.deferred).toBe(1);
    expect(db.sends).toEqual([]);
    // 다음 회차를 만들면 이월분이 들어온다
    const r2 = await S.buildSessionTargets("2026-10-12", "t", new Date(kstIso("2026-10-06", 9, 0)));
    expect(r2.eligible).toBe(1);
  });

  it("skip 은 자동 안내에서 빠진다", async () => {
    db.cfg.late_policy = "skip";
    db.brands = [brand(1)];
    db.leads = [lead(1, "b1", "apply_seminar", kstIso("2026-10-05", 9, 30))];
    const r = await S.buildSessionTargets(D, "t", new Date(kstIso("2026-10-05", 9, 40)));
    expect(r.excluded).toBe(1);
    expect(db.sends).toEqual([]);
  });
});

describe("발송", () => {
  async function seedOne() {
    db.brands = [brand(1)];
    db.leads = [lead(1, "b1", "apply_seminar", kstIso("2026-09-29", 10, 0))];
    await S.buildSessionTargets(D, "t", new Date(kstIso("2026-10-01", 9, 0)));
  }

  it("보낸 내용이 시도별로 기록되고, 기록 본문이 실제 전송 본문과 같다", async () => {
    await seedOne();
    await S.dispatchDue(50, new Date(kstIso("2026-10-05", 9, 1)));
    expect(db.attempts).toHaveLength(2);                 // 메일 + 문자
    const mail = db.attempts.find((x) => x.channel === "email")!;
    const sms = db.attempts.find((x) => x.channel === "sms")!;
    expect(mail.subject).toBe(db.mailSent[0].subject);
    expect(mail.body).toBe(db.mailSent[0].body);
    expect(sms.body).toBe(db.smsSent[0].msg);
    expect(mail.result).toBe("sent");
    expect(mail.to_masked).toContain("*");               // 원문 주소를 남기지 않는다
  });

  it("제목은 회차 스냅샷이 아니라 지금 설정값을 따른다", async () => {
    await seedOne();
    db.cfg.session_title = "틱톡샵 온라인 세미나 | glovek";
    db.sessions.forEach((x) => { x.session_title = "GloveK 온라인 세미나 | 녹화 강의"; });
    await S.dispatchDue(50, new Date(kstIso("2026-10-05", 9, 1)));
    expect(db.mailSent[0].subject).toContain("틱톡샵 온라인 세미나 | glovek");
    expect(db.mailSent[0].subject).not.toContain("녹화 강의");
    // 회차 스냅샷은 그대로 둔다.
    expect(db.sessions[0].session_title).toBe("GloveK 온라인 세미나 | 녹화 강의");
  });

  it("실행 중 마스터 스위치가 꺼지면 그 뒤로 보내지 않는다", async () => {
    await seedOne();
    // 첫 전송 직후 스위치를 끈다.
    const origSms = db.smsOk;
    db.onSend = () => { db.cfg.enabled = false; };
    const r = await S.dispatchDue(50, new Date(kstIso("2026-10-05", 9, 1)));
    db.onSend = null;
    expect(db.mailSent.length + db.smsSent.length).toBe(1);
    expect(r.blocked?.join(" ")).toContain("꺼져 중단");
    // 1차 2건 중 하나만 나가고 나머지 하나는 예약으로 돌아간다(2차는 아직 예정 시각 전).
    const notice = db.sends.filter((x) => x.stage === "notice");
    expect(notice.filter((x) => x.status === "sent")).toHaveLength(1);
    expect(notice.filter((x) => x.status === "queued")).toHaveLength(1);
    expect(notice.every((x) => x.attempts === 1)).toBe(true);   // attempts 를 되돌리지 않는다
    expect(origSms).toBe(true);
  });

  it("스위치를 읽지 못하면 보내지 않는다(fail closed)", async () => {
    await seedOne();
    db.onSend = () => { db.configReadFails = true; };
    const r = await S.dispatchDue(50, new Date(kstIso("2026-10-05", 9, 1)));
    db.onSend = null; db.configReadFails = false;
    expect(db.mailSent.length + db.smsSent.length).toBe(1);
    expect(r.blocked?.join(" ")).toContain("확인 실패");
  });

  it("기록을 남기지 못하면 전송하지 않는다", async () => {
    await seedOne();
    db.attemptsWriteFails = true;
    const r = await S.dispatchDue(50, new Date(kstIso("2026-10-05", 9, 1)));
    expect(db.mailSent).toHaveLength(0);
    expect(db.smsSent).toHaveLength(0);
    expect(r.sent).toBe(0);
    expect(db.sends.every((x) => x.status === "queued")).toBe(true);
  });

  it("기록 표가 없으면 아예 보내지 않는다", async () => {
    await seedOne();
    db.attemptsSchema = false;
    const r = await S.dispatchDue(50, new Date(kstIso("2026-10-05", 9, 1)));
    expect(db.mailSent).toHaveLength(0);
    expect(r.blocked?.join(" ")).toContain("기록을 남길 수 없어");
    expect(db.sends.every((x) => x.status === "queued" && x.attempts === 0)).toBe(true);
  });

  it("1차 안내가 예정 시각에 나가고 provider 와 메시지 id 가 남는다", async () => {
    await seedOne();
    const r = await S.dispatchDue(50, new Date(kstIso("2026-10-05", 9, 1)));
    expect(r.sent).toBe(2);   // 메일 + 문자
    expect(db.mailSent).toHaveLength(1);
    expect(db.smsSent).toHaveLength(1);
    const sent = db.sends.filter((s) => s.status === "sent");
    expect(sent.map((s) => s.provider).sort()).toEqual(["aligo", "gmail"]);
    expect(sent.every((s) => s.provider_id)).toBe(true);
  });

  it("문구가 치환되고 확정 Zoom 링크가 그대로 들어간다", async () => {
    await seedOne();
    await S.dispatchDue(50, new Date(kstIso("2026-10-05", 9, 1)));
    expect(db.mailSent[0].subject).toContain("GloveK 온라인 세미나 | 녹화 강의");
    expect(db.mailSent[0].body).toContain("2026년 10월 5일(월) 오전 10:30");
    expect(db.mailSent[0].body).toContain(db.cfg.zoom_url);
    expect(db.mailSent[0].body).not.toContain("{{");
  });

  it("2차(11:10)는 같은 회차의 같은 신청자에게만 나간다", async () => {
    await seedOne();
    // 1차 시각엔 2차가 나가지 않는다
    await S.dispatchDue(50, new Date(kstIso("2026-10-05", 9, 1)));
    expect(db.sends.filter((s) => s.stage === "followup" && s.status === "sent")).toHaveLength(0);
    // 11:10 이후에 2차만 나간다
    db.mailSent = []; db.smsSent = [];
    const r = await S.dispatchDue(50, new Date(kstIso("2026-10-05", 11, 11)));
    const fu = db.sends.filter((s) => s.stage === "followup" && s.status === "sent");
    expect(r.sent).toBe(2);
    expect(fu).toHaveLength(2);
    const targetIds = new Set(db.sends.filter((s) => s.stage === "notice").map((s) => s.target_id));
    expect(fu.every((s) => targetIds.has(s.target_id))).toBe(true);
  });

  it("2차가 광고성이면 광고 수신거부와 수신거부 링크가 적용된다", async () => {
    await seedOne();
    await S.dispatchDue(50, new Date(kstIso("2026-10-05", 11, 11)));
    expect(db.mailSent.find((m) => m.subject.includes("2부"))!.body).toContain("수신거부");
    // 1차(서비스 안내)에는 광고 수신거부 문구를 붙이지 않는다
    const notice = db.mailSent.find((m) => m.subject.includes("참가 안내"));
    expect(notice?.body ?? "").not.toContain("수신거부");
  });

  it("광고 수신거부 대상이면 2차만 막히고 1차 서비스 안내는 영향받지 않는다", async () => {
    await seedOne();
    db.adBlocked = true;
    const r = await S.dispatchDue(50, new Date(kstIso("2026-10-05", 11, 11)));
    const notice = db.sends.filter((s) => s.stage === "notice");
    const fu = db.sends.filter((s) => s.stage === "followup");
    expect(notice.every((s) => s.status === "sent")).toBe(true);
    expect(fu.every((s) => s.status === "skipped")).toBe(true);
    expect(fu[0].skip_reason).toContain("광고 수신거부");
    expect(r.skipped).toBe(2);
  });

  it("광고 수신거부 조회가 실패하면 광고를 보내지 않는다(fail closed)", async () => {
    await seedOne();
    db.adError = "조회 실패(모의)";
    await S.dispatchDue(50, new Date(kstIso("2026-10-05", 11, 11)));
    const fu = db.sends.filter((s) => s.stage === "followup");
    expect(fu.every((s) => s.status === "skipped")).toBe(true);
    expect(fu[0].skip_reason).toContain("확인 실패");
  });

  it("실패하면 재시도하고 한도를 넘으면 실패로 확정한다", async () => {
    await seedOne();
    db.smsOk = false; db.mailOk = false;
    let now = new Date(kstIso("2026-10-05", 9, 1));
    const r1 = await S.dispatchDue(50, now);
    expect(r1.retry).toBe(2);
    expect(db.sends.filter((s) => s.stage === "notice").every((s) => s.status === "queued")).toBe(true);
    // 재시도 예정 시각까지 기다렸다가 다시 — 3회째에 failed 로 확정
    for (let i = 0; i < 2; i++) {
      now = new Date(now.getTime() + 30 * 60_000);
      await S.dispatchDue(50, now);
    }
    const notice = db.sends.filter((s) => s.stage === "notice");
    expect(notice.every((s) => s.status === "failed")).toBe(true);
    expect(notice[0].error).toContain("실패");
    expect(notice[0].attempts).toBe(3);
  });

  it("이미 보낸 건은 다시 보내지 않는다", async () => {
    await seedOne();
    await S.dispatchDue(50, new Date(kstIso("2026-10-05", 9, 1)));
    db.mailSent = []; db.smsSent = [];
    const r = await S.dispatchDue(50, new Date(kstIso("2026-10-05", 9, 5)));
    expect(r.due).toBe(0);
    expect(db.mailSent).toEqual([]);
    expect(db.smsSent).toEqual([]);
  });

  it("동시에 두 실행이 겹치면 뒤엣것은 아무것도 보내지 않는다", async () => {
    await seedOne();
    const now = new Date(kstIso("2026-10-05", 9, 1));
    const [a, b] = await Promise.all([S.dispatchDue(50, now), S.dispatchDue(50, now)]);
    const sent = [a, b].reduce((n, x) => n + x.sent, 0);
    expect(sent).toBe(2);                       // 두 번 보내지 않는다
    expect(db.mailSent).toHaveLength(1);
    expect(db.smsSent).toHaveLength(1);
    expect([a, b].some((x) => (x.blocked ?? []).join().includes("진행 중"))).toBe(true);
  });

  it("마스터 스위치가 꺼져 있으면 아무것도 보내지 않고 예약은 남는다", async () => {
    await seedOne();
    db.cfg.enabled = false;
    const r = await S.dispatchDue(50, new Date(kstIso("2026-10-05", 9, 1)));
    expect(r.sent).toBe(0);
    expect(db.mailSent).toEqual([]);
    expect(db.sends.every((s) => s.status === "queued")).toBe(true);
    expect(r.blocked?.join()).toContain("마스터");
  });

  it("Zoom 링크가 없으면 보내지 않는다", async () => {
    await seedOne();
    db.cfg.zoom_url = "";
    db.sessions[0].zoom_url = "";
    const r = await S.dispatchDue(50, new Date(kstIso("2026-10-05", 9, 1)));
    expect(r.sent).toBe(0);
    expect(r.blocked?.join()).toContain("Zoom");
    expect(db.mailSent).toEqual([]);
  });

  it("문구가 초안이면 보내지 않는다", async () => {
    await seedOne();
    db.templates[0].enabled = false;
    const r = await S.dispatchDue(50, new Date(kstIso("2026-10-05", 9, 1)));
    expect(db.sends.filter((s) => s.stage === "notice").every((s) => s.status === "skipped")).toBe(true);
    expect(r.sent).toBe(0);
  });

  it("예정 시각이 오래 지난 예약은 보내지 않는다(묵은 안내 방지)", async () => {
    await seedOne();
    const r = await S.dispatchDue(50, new Date(kstIso("2026-10-06", 9, 1)));  // 하루 뒤
    expect(r.sent).toBe(0);
    expect(r.skipped).toBeGreaterThan(0);
    expect(db.sends.find((s) => s.status === "skipped")!.skip_reason).toContain("지나");
  });

  it("멈춘 선점은 회수돼 다음 실행이 이어받는다", async () => {
    await seedOne();
    db.sends.forEach((s) => { s.status = "sending"; s.claimed_at = kstIso("2026-10-05", 8, 0); });
    const r = await S.dispatchDue(50, new Date(kstIso("2026-10-05", 9, 1)));
    expect(r.sent).toBe(2);
  });
});

describe("설정 안전장치", () => {
  it("Zoom 링크 없이 자동발송을 켤 수 없다", async () => {
    db.cfg.zoom_url = "";
    const r = await S.updateSeminarConfig({ enabled: true }, "u");
    expect(r.ok).toBe(false);
    expect(r.error).toContain("Zoom");
  });
  it("잘못된 형식의 링크는 저장되지 않는다", async () => {
    const r = await S.updateSeminarConfig({ zoomUrl: "us06web.zoom.us/j/1" }, "u");
    expect(r.ok).toBe(false);
  });
  it("세미나 소스를 모두 지울 수 없다", async () => {
    const r = await S.updateSeminarConfig({ sourceKeys: [] }, "u");
    expect(r.ok).toBe(false);
  });
  it("빈 문구를 켤 수 없다", async () => {
    db.templates[0].sms_body = "";
    const r = await S.updateSeminarTemplate("notice", { enabled: true }, "u");
    expect(r.ok).toBe(false);
    expect(r.error).toContain("문자");
  });
  it("첫 회차 이전 회차는 만들지 않는다", async () => {
    await expect(S.buildSessionTargets("2026-09-28", "t", new Date())).rejects.toThrow(/첫 회차/);
  });
  it("0103 미적용이면 발송이 아니라 사유를 돌려준다", async () => {
    db.schema = false;
    const r = await S.dispatchDue(50, new Date());
    expect(r.ok).toBe(false);
    expect(r.error).toContain("0103");
  });
});

describe("배선 감사", () => {
  it("0103 마이그레이션은 추가만 한다", () => {
    const sql = read("../migrations/0103_seminar_notify.sql");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS seminar_sends");
    expect(sql).toContain("UNIQUE (session_id, target_id, stage, channel)");
    expect(sql).toContain("seminar_runs_one_running");
    expect(sql.replace(/ON DELETE CASCADE/g, "")).not.toMatch(/\b(DROP|TRUNCATE|DELETE)\b/i);
  });
  it("기본값은 보내지 않는 상태다", () => {
    const sql = read("../migrations/0103_seminar_notify.sql");
    expect(sql).toMatch(/enabled boolean NOT NULL DEFAULT false/);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS seminar_templates[\s\S]*?enabled boolean NOT NULL DEFAULT false/);
  });
  it("크론이 잠금·인증을 지난다", () => {
    const route = read("../app/api/cron/seminar/route.ts");
    expect(route).toContain("cronAuthorized");
    expect(route).toContain("dispatchDue");
  });
  it("스케줄이 분 단위로 등록돼 11:10 을 놓치지 않는다", () => {
    const v = JSON.parse(read("../vercel.json")) as { crons: { path: string; schedule: string }[] };
    const c = v.crons.find((x) => x.path.startsWith("/api/cron/seminar"));
    expect(c, "vercel.json 에 세미나 크론이 없다").toBeTruthy();
    expect(c!.schedule).toBe("*/5 * * * *");
  });
  it("서버액션의 설정 변경은 역할을 검사한다", () => {
    const src = read("../app/(dash)/seminar/actions.ts");
    expect(src).toContain("WRITE_ROLES");
    for (const fn of ["seminarSaveConfigAction", "seminarSaveTemplateAction", "seminarBuildAction", "seminarDispatchAction"]) {
      const body = src.slice(src.indexOf(`export async function ${fn}`));
      expect(body.slice(0, 300), fn).toContain("writer()");
    }
  });
  it("Zapier 유입 경로는 건드리지 않았다", () => {
    const hook = read("../app/api/leadhook/route.ts");
    expect(hook).not.toContain("seminar");
  });
});
