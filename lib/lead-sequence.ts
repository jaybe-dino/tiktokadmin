// 신규 리드 연속 안내(드립, 0096) — 유입 후 N일간 매일 정해진 시각에 문자·메일 발송.
//   기존 1회성 자동안내의 확장이며, 설정 단위는 "유입 소스"(intake_sources.key).
//   유입 루트마다 기간·시각·일차별 문구를 따로 둔다. 화면: /channels(유입 소스·자동발송).
//     · 1일차는 기존대로 유입 즉시(소스별로 "지정 시각"으로 바꿀 수 있음)
//     · 2일차부터 매일 지정 시각(기본 오전 10시, KST)에 일차별로 다른 문구
//   멱등: 브랜드×일차 1회(lead_sequence_sends UNIQUE) — 크론이 겹쳐 돌아도 중복 발송 없음.
import { query, queryOne } from "./db";
import { renderTemplate } from "./templates";

export const KST_OFFSET_MIN = 9 * 60;
export const MAX_SEQ_DAYS = 30;

export interface SeqConfig {
  source_key: string;
  enabled: boolean;
  days: number;              // 며칠간
  hour: number;              // 발송 시각(KST 시)
  day1Immediate: boolean;    // 1일차는 유입 즉시
  skipWeekend: boolean;      // 주말 건너뛰기
  stopOnProgress: boolean;   // 상담·미팅 등 단계가 진전되면 중단
}

export interface SeqStep {
  source_key: string; day_no: number; enabled: boolean;
  send_sms: boolean; send_email: boolean;
  sms_body: string; email_subject: string; email_body: string;
}

const clampDays = (n: unknown): number => Math.min(MAX_SEQ_DAYS, Math.max(1, Math.round(Number(n) || 7)));
const clampHour = (n: unknown): number => {
  const v = Math.round(Number(n));
  return Number.isFinite(v) ? Math.min(23, Math.max(0, v)) : 10;
};

export function defaultSeqConfig(sourceKey: string): SeqConfig {
  return { source_key: sourceKey, enabled: false, days: 7, hour: 10, day1Immediate: true, skipWeekend: false, stopOnProgress: true };
}

interface ConfigRow {
  source_key: string; enabled: boolean; days: number; hour: number;
  day1_immediate: boolean; skip_weekend: boolean; stop_on_progress: boolean;
}
const toConfig = (r: ConfigRow): SeqConfig => ({
  source_key: r.source_key, enabled: !!r.enabled, days: clampDays(r.days), hour: clampHour(r.hour),
  day1Immediate: r.day1_immediate, skipWeekend: !!r.skip_weekend, stopOnProgress: r.stop_on_progress,
});

const CONFIG_COLS = "source_key, enabled, days, hour, day1_immediate, skip_weekend, stop_on_progress";

/** 소스 하나의 설정 — 없으면(0096 미적용 포함) 꺼짐 기본값. */
export async function getSeqConfig(sourceKey: string): Promise<SeqConfig> {
  const r = await queryOne<ConfigRow>(
    `SELECT ${CONFIG_COLS} FROM lead_sequence_config WHERE source_key=$1`, [sourceKey]).catch(() => null);
  return r ? toConfig(r) : defaultSeqConfig(sourceKey);
}

/** 전체 소스 설정 — 화면에서 소스 목록과 합쳐 쓴다. */
export async function listSeqConfigs(): Promise<Record<string, SeqConfig>> {
  const rows = await query<ConfigRow>(`SELECT ${CONFIG_COLS} FROM lead_sequence_config`).catch(() => []);
  return Object.fromEntries(rows.map((r) => [r.source_key, toConfig(r)]));
}

export async function saveSeqConfig(c: SeqConfig, by: string): Promise<void> {
  if (!c.source_key) throw new Error("유입 소스를 지정하세요.");
  await query(
    `INSERT INTO lead_sequence_config (source_key, enabled, days, hour, day1_immediate, skip_weekend, stop_on_progress, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (source_key) DO UPDATE SET enabled=EXCLUDED.enabled, days=EXCLUDED.days, hour=EXCLUDED.hour,
       day1_immediate=EXCLUDED.day1_immediate, skip_weekend=EXCLUDED.skip_weekend,
       stop_on_progress=EXCLUDED.stop_on_progress, updated_by=EXCLUDED.updated_by, updated_at=now()`,
    [c.source_key, c.enabled, clampDays(c.days), clampHour(c.hour), c.day1Immediate, c.skipWeekend, c.stopOnProgress, by]);
}

/** 소스의 일차별 문구 — 저장된 행이 없는 일차는 빈 기본값으로 채워 항상 days 개를 돌려준다. */
export async function listSeqSteps(sourceKey: string, days: number): Promise<SeqStep[]> {
  const rows = await query<SeqStep>(
    `SELECT source_key, day_no, enabled, send_sms, send_email, sms_body, email_subject, email_body
       FROM lead_sequence_steps WHERE source_key=$1 ORDER BY day_no`, [sourceKey]).catch(() => []);
  const byDay = new Map(rows.map((r) => [r.day_no, r]));
  return Array.from({ length: clampDays(days) }, (_, i) => {
    const d = i + 1;
    return byDay.get(d) ?? {
      source_key: sourceKey, day_no: d, enabled: d === 1,
      send_sms: true, send_email: true, sms_body: "", email_subject: "", email_body: "",
    };
  });
}

export async function saveSeqStep(s: SeqStep, by: string): Promise<void> {
  if (!s.source_key) throw new Error("유입 소스를 지정하세요.");
  await query(
    `INSERT INTO lead_sequence_steps (source_key, day_no, enabled, send_sms, send_email, sms_body, email_subject, email_body, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (source_key, day_no) DO UPDATE SET enabled=EXCLUDED.enabled, send_sms=EXCLUDED.send_sms,
       send_email=EXCLUDED.send_email, sms_body=EXCLUDED.sms_body, email_subject=EXCLUDED.email_subject,
       email_body=EXCLUDED.email_body, updated_by=EXCLUDED.updated_by, updated_at=now()`,
    [s.source_key, Math.min(MAX_SEQ_DAYS, Math.max(1, s.day_no)), s.enabled, s.send_sms, s.send_email,
     s.sms_body ?? "", s.email_subject ?? "", s.email_body ?? "", by]);
}

/** 다른 소스의 문구를 통째로 복사 — 루트마다 비슷한 흐름일 때 처음부터 쓰지 않아도 되게. */
export async function copySeqSteps(fromKey: string, toKey: string, by: string): Promise<number> {
  const src = await query<SeqStep>(
    `SELECT source_key, day_no, enabled, send_sms, send_email, sms_body, email_subject, email_body
       FROM lead_sequence_steps WHERE source_key=$1`, [fromKey]).catch(() => []);
  for (const s of src) await saveSeqStep({ ...s, source_key: toKey }, by);
  return src.length;
}

// ── 예정 시각 계산 ────────────────────────────────────────────
// 한국시간 기준으로 "며칠 뒤 몇 시"를 구한다. 서버 TZ 와 무관하게 동작하도록
// UTC 로 환산해 계산한다(Vercel 은 UTC).
/** from(유입시각) 기준 offsetDays 일 뒤 KST hour 시 → UTC Date. */
export function kstSlot(from: Date, offsetDays: number, hour: number): Date {
  const kst = new Date(from.getTime() + KST_OFFSET_MIN * 60_000);
  const y = kst.getUTCFullYear(), m = kst.getUTCMonth(), d = kst.getUTCDate();
  const slotKst = Date.UTC(y, m, d + offsetDays, clampHour(hour), 0, 0, 0);
  return new Date(slotKst - KST_OFFSET_MIN * 60_000);
}

/** 주말(KST 기준 토·일)이면 다음 월요일로 밀어낸다. */
export function shiftWeekend(at: Date): Date {
  const kst = new Date(at.getTime() + KST_OFFSET_MIN * 60_000);
  const dow = kst.getUTCDay();              // 0=일 6=토
  const add = dow === 6 ? 2 : dow === 0 ? 1 : 0;
  return add ? new Date(at.getTime() + add * 86_400_000) : at;
}

/** 일차별 예정 시각 목록. */
export function planSchedule(from: Date, s: Pick<SeqConfig, "days" | "hour" | "day1Immediate" | "skipWeekend">): { day_no: number; due_at: Date }[] {
  const out: { day_no: number; due_at: Date }[] = [];
  // 1일차를 언제로 잡느냐에 따라 이후 날짜 기준이 달라진다.
  //   · 즉시 발송: 1일차=유입 시각, 2일차=다음 날 지정시각, 3일차=그다음 날 …
  //     (유입이 지정시각 전이어도 2일차를 같은 날로 잡지 않는다 — 하루 두 번 발송 방지)
  //   · 즉시 아님: 1일차=당일 지정시각(이미 지났으면 다음 날), 이후 하루씩.
  const todaySlot = kstSlot(from, 0, s.hour);
  const startOffset = todaySlot.getTime() > from.getTime() ? 0 : 1;
  for (let d = 1; d <= clampDays(s.days); d++) {
    let due = s.day1Immediate
      ? (d === 1 ? new Date(from) : kstSlot(from, d - 1, s.hour))
      : kstSlot(from, startOffset + (d - 1), s.hour);
    if (s.skipWeekend && !(d === 1 && s.day1Immediate)) due = shiftWeekend(due);
    out.push({ day_no: d, due_at: due });
  }
  return out;
}

// ── 등록(유입 시) ─────────────────────────────────────────────
/** 리드 유입 시 그 소스의 일정대로 예약을 만든다. 이미 예약된 브랜드면 아무것도 하지 않는다. */
export async function enrollLead(brandId: string, sourceKey: string, from = new Date()): Promise<{ ok: boolean; scheduled: number; skipped?: string }> {
  const s = await getSeqConfig(sourceKey);
  if (!s.enabled) return { ok: true, scheduled: 0, skipped: "이 소스는 연속 안내 꺼짐" };
  const exists = await queryOne<{ n: string }>(
    "SELECT count(*)::text n FROM lead_sequence_sends WHERE brand_id=$1", [brandId]).catch(() => null);
  if (exists && Number(exists.n) > 0) return { ok: true, scheduled: 0, skipped: "이미 예약됨" };

  let n = 0;
  for (const p of planSchedule(from, s)) {
    const r = await query(
      `INSERT INTO lead_sequence_sends (brand_id, source_key, day_no, due_at) VALUES ($1,$2,$3,$4)
       ON CONFLICT (brand_id, day_no) DO NOTHING`,
      [brandId, sourceKey, p.day_no, p.due_at.toISOString()]).catch(() => null);
    if (r) n++;
  }
  return { ok: true, scheduled: n };
}

/** 1일차를 기존 자동안내(welcome)가 이미 보냈을 때 — 그 예약을 발송됨으로 닫아 중복을 막는다. */
export async function markDay1Sent(brandId: string, sourceKey: string, channels: string[]): Promise<void> {
  const s = await getSeqConfig(sourceKey);
  if (!s.enabled || !s.day1Immediate) return;
  await query(
    `UPDATE lead_sequence_sends SET status='sent', channels=$2, sent_at=now(), note='자동안내(1일차)로 발송됨'
      WHERE brand_id=$1 AND day_no=1 AND status='queued'`, [brandId, channels]).catch(() => {});
}

/** 남은 예약 중단 — 수신거부·단계 진전·드랍 등. */
export async function cancelLead(brandId: string, note: string): Promise<number> {
  const r = await query<{ id: string }>(
    `UPDATE lead_sequence_sends SET status='canceled', note=$2
      WHERE brand_id=$1 AND status='queued' RETURNING id`, [brandId, note.slice(0, 200)]).catch(() => []);
  return r.length;
}

// ── 발송(크론) ────────────────────────────────────────────────
const STOP_STATES = new Set(["dropped", "churned"]);

export interface SeqRunResult { due: number; sent: number; skipped: number; failed: number; canceled: number }

/** 예정 시각이 지난 예약을 발송한다. 크론(매시)에서 호출. */
export async function runDueSequence(limit = 200, now = new Date()): Promise<SeqRunResult> {
  const res: SeqRunResult = { due: 0, sent: 0, skipped: 0, failed: 0, canceled: 0 };
  const rows = await query<{
    id: string; brand_id: string; source_key: string; day_no: number;
    brand_name: string; contact_name: string | null; email: string | null; phone: string | null;
    state: string; msg_opt_out: boolean;
  }>(
    `SELECT q.id, q.brand_id, q.source_key, q.day_no,
            b.brand_name, b.contact_name, b.email, b.phone, b.state,
            COALESCE(b.msg_opt_out,false) AS msg_opt_out
       FROM lead_sequence_sends q JOIN brands b ON b.id = q.brand_id
      WHERE q.status='queued' AND q.due_at <= $1
      ORDER BY q.due_at
      LIMIT $2`, [now.toISOString(), limit]).catch(() => []);
  res.due = rows.length;
  if (rows.length === 0) return res;

  // 소스별 설정·문구는 한 번씩만 읽는다(같은 소스의 예약이 여러 건이므로).
  const cfgCache = new Map<string, SeqConfig>();
  const stepCache = new Map<string, Map<number, SeqStep>>();
  const cfgOf = async (k: string) => {
    if (!cfgCache.has(k)) cfgCache.set(k, await getSeqConfig(k));
    return cfgCache.get(k)!;
  };
  const stepOf = async (k: string, day: number) => {
    if (!stepCache.has(k)) stepCache.set(k, new Map((await listSeqSteps(k, MAX_SEQ_DAYS)).map((x) => [x.day_no, x])));
    return stepCache.get(k)!.get(day);
  };

  const { sendSms } = await import("./sms");
  const { sendEmail } = await import("./mailer");

  for (const r of rows) {
    const cfg = await cfgOf(r.source_key);
    // 중단 조건 — 남은 일차까지 한 번에 취소한다.
    const stopReason = r.msg_opt_out ? "수신거부"
      : STOP_STATES.has(r.state) ? "드랍·이탈"
      : !cfg.enabled ? "소스 연속 안내 꺼짐"
      : cfg.stopOnProgress && r.state !== "lead_new" ? `단계 진전(${r.state})`
      : null;
    if (stopReason) {
      await cancelLead(r.brand_id, stopReason);
      res.canceled++;
      continue;
    }

    const step = await stepOf(r.source_key, r.day_no);
    if (!step || !step.enabled) {
      await mark(r.id, "skipped", [], "해당 일차 문구 꺼짐");
      res.skipped++;
      continue;
    }

    const vars = { "브랜드명": r.brand_name, "담당자명": r.contact_name || r.brand_name, "일차": String(r.day_no) };
    const sent: string[] = [];
    const errs: string[] = [];

    if (step.send_sms && r.phone && step.sms_body.trim()) {
      const ok = await sendSms({ receiver: r.phone, msg: renderTemplate(step.sms_body, vars) })
        .then((x) => x.ok).catch(() => false);
      if (ok) sent.push("sms"); else errs.push("문자 실패");
    }
    if (step.send_email && r.email && step.email_body.trim()) {
      const ok = await sendEmail({
        to: r.email,
        subject: renderTemplate(step.email_subject || `[GloveK] ${r.brand_name} 안내`, vars),
        text: renderTemplate(step.email_body, vars),
      }).then((x) => x.ok).catch(() => false);
      if (ok) sent.push("email"); else errs.push("메일 실패");
    }

    if (sent.length) {
      await mark(r.id, "sent", sent, errs.join(" · "));
      await query("UPDATE brands SET last_contact_at=now() WHERE id=$1", [r.brand_id]).catch(() => {});
      await query(
        `INSERT INTO brand_sources (brand_id, site, event, payload, occurred_at)
         VALUES ($1,'admin','contact_logged',$2,now())`,
        [r.brand_id, JSON.stringify({ channel: sent.join("+"), kind: "lead_sequence", source: r.source_key, day: r.day_no })]).catch(() => {});
      res.sent++;
    } else {
      // 보낼 수단이 없으면(연락처 없음·문구 비어 있음) 건너뛴다 — 실패로 쌓아두지 않는다.
      const noTarget = !r.phone && !r.email;
      await mark(r.id, errs.length ? "failed" : "skipped", [], errs.join(" · ") || (noTarget ? "연락처 없음" : "발송할 문구 없음"));
      if (errs.length) res.failed++; else res.skipped++;
    }
  }
  return res;
}

async function mark(id: string, status: string, channels: string[], note: string): Promise<void> {
  await query(
    "UPDATE lead_sequence_sends SET status=$2, channels=$3, note=$4, sent_at=now() WHERE id=$1",
    [id, status, channels, note.slice(0, 200)]).catch(() => {});
}

// ── 화면용 조회 ───────────────────────────────────────────────
export interface SeqQueueRow {
  brand_id: string; brand_name: string; source_key: string; day_no: number; due_at: string;
  status: string; channels: string[]; note: string;
}
/** 다가오는 예약·최근 발송. sourceKey 를 주면 그 유입 루트 것만. */
export async function listSeqQueue(sourceKey?: string, limit = 30): Promise<SeqQueueRow[]> {
  const where = sourceKey ? "AND q.source_key=$2" : "";
  const args: unknown[] = sourceKey ? [limit, sourceKey] : [limit];
  return query<SeqQueueRow>(
    `SELECT q.brand_id, b.brand_name, q.source_key, q.day_no, q.due_at::text AS due_at, q.status, q.channels, q.note
       FROM lead_sequence_sends q JOIN brands b ON b.id=q.brand_id
      WHERE q.status IN ('queued','sent','failed') ${where}
      ORDER BY (q.status='queued') DESC, q.due_at
      LIMIT $1`, args).catch(() => []);
}
