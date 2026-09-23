// 신규 리드 연속 안내(드립, 0096) — 유입 후 N일간 정해진 시각에 문자·메일 발송.
//   기존 1회성 자동안내의 확장이며, 설정 단위는 "유입 소스 키"(intake_channels.id).
//   키마다 기간·발송 요일·시각·일차별 문구를 따로 둔다. 화면: /channels 각 키의 「연속 안내」.
//     · 1일차는 기존대로 유입 즉시(키마다 "지정 시각"으로 바꿀 수 있음)
//     · 2일차부터 정해진 요일·시각에 일차별로 다른 문구
//   멱등: 브랜드×일차 1회(lead_sequence_sends UNIQUE) — 크론이 겹쳐 돌아도 중복 발송 없음.
import { query, queryOne } from "./db";
import { renderTemplate } from "./templates";
import {
  clampDays, clampHour, defaultSeqConfig, planSchedule, MAX_SEQ_DAYS as MAX_DAYS,
  type SeqConfig, type SeqStep,
} from "./lead-sequence-plan";

// 순수 계산부는 DB 없는 모듈에 두고 그대로 재수출한다(클라이언트 화면도 같은 규칙을 쓴다).
export {
  KST_OFFSET_MIN, MAX_SEQ_DAYS, dayLabel,
  defaultSeqConfig, kstSlot, planSchedule,
  type SeqConfig, type SeqStep, type PlanInput,
} from "./lead-sequence-plan";

// ── 설정 조회·저장 ───────────────────────────────────────────
interface ConfigRow {
  channel_id: string; enabled: boolean; days: number; hour: number; stop_on_progress: boolean;
}
const toConfig = (r: ConfigRow): SeqConfig => ({
  channel_id: r.channel_id, enabled: !!r.enabled, days: clampDays(r.days), hour: clampHour(r.hour),
  stopOnProgress: r.stop_on_progress,
});

const CONFIG_COLS = "channel_id, enabled, days, hour, stop_on_progress";

/** 키 하나의 설정 — 없으면(0096 미적용 포함) 꺼짐 기본값. */
export async function getSeqConfig(channelId: string): Promise<SeqConfig> {
  const r = await queryOne<ConfigRow>(
    `SELECT ${CONFIG_COLS} FROM lead_sequence_config WHERE channel_id=$1`, [channelId]).catch(() => null);
  return r ? toConfig(r) : defaultSeqConfig(channelId);
}

/** 전체 키 설정 — 화면에서 키 목록과 합쳐 쓴다. */
export async function listSeqConfigs(): Promise<Record<string, SeqConfig>> {
  const rows = await query<ConfigRow>(`SELECT ${CONFIG_COLS} FROM lead_sequence_config`).catch(() => []);
  return Object.fromEntries(rows.map((r) => [r.channel_id, toConfig(r)]));
}

export async function saveSeqConfig(c: SeqConfig, by: string): Promise<void> {
  if (!c.channel_id) throw new Error("유입 소스 키를 지정하세요.");
  await query(
    `INSERT INTO lead_sequence_config (channel_id, enabled, days, hour, stop_on_progress, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (channel_id) DO UPDATE SET enabled=EXCLUDED.enabled, days=EXCLUDED.days, hour=EXCLUDED.hour,
       stop_on_progress=EXCLUDED.stop_on_progress, updated_by=EXCLUDED.updated_by, updated_at=now()`,
    [c.channel_id, c.enabled, clampDays(c.days), clampHour(c.hour), c.stopOnProgress, by]);
}

/** 키의 일차별 문구 — 저장된 행이 없는 일차는 빈 기본값으로 채워 항상 days 개를 돌려준다. */
export async function listSeqSteps(channelId: string, days: number): Promise<SeqStep[]> {
  const rows = await query<SeqStep>(
    `SELECT channel_id, day_no, enabled, send_sms, send_email, send_hour, sms_body, email_subject, email_body
       FROM lead_sequence_steps WHERE channel_id=$1 ORDER BY day_no`, [channelId]).catch(() => []);
  const byDay = new Map(rows.map((r) => [r.day_no, r]));
  // 1…days 회차를 항상 채워서 돌려준다.
  return Array.from({ length: clampDays(days) }, (_, i) => {
    const d = i + 1;
    return byDay.get(d) ?? {
      channel_id: channelId, day_no: d, enabled: d === 1,
      send_sms: true, send_email: true, send_hour: null,
      sms_body: "", email_subject: "", email_body: "",
    };
  });
}

export async function saveSeqStep(s: SeqStep, by: string): Promise<void> {
  if (!s.channel_id) throw new Error("유입 소스 키를 지정하세요.");
  await query(
    `INSERT INTO lead_sequence_steps (channel_id, day_no, enabled, send_sms, send_email, send_hour, sms_body, email_subject, email_body, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (channel_id, day_no) DO UPDATE SET enabled=EXCLUDED.enabled, send_sms=EXCLUDED.send_sms,
       send_email=EXCLUDED.send_email, send_hour=EXCLUDED.send_hour, sms_body=EXCLUDED.sms_body,
       email_subject=EXCLUDED.email_subject, email_body=EXCLUDED.email_body,
       updated_by=EXCLUDED.updated_by, updated_at=now()`,
    [s.channel_id, Math.min(MAX_DAYS, Math.max(1, s.day_no)), s.enabled, s.send_sms, s.send_email,
     s.send_hour == null ? null : clampHour(s.send_hour),
     s.sms_body ?? "", s.email_subject ?? "", s.email_body ?? "", by]);
}

/** 다른 키의 문구를 통째로 복사 — 키마다 비슷한 흐름일 때 처음부터 쓰지 않아도 되게. */
export async function copySeqSteps(fromId: string, toId: string, by: string): Promise<number> {
  const src = await query<SeqStep>(
    `SELECT channel_id, day_no, enabled, send_sms, send_email, send_hour, sms_body, email_subject, email_body
       FROM lead_sequence_steps WHERE channel_id=$1`, [fromId]).catch(() => []);
  for (const s of src) await saveSeqStep({ ...s, channel_id: toId }, by);
  return src.length;
}

// ── 등록(유입 시) ─────────────────────────────────────────────
/** 리드 유입 시 그 키의 일정대로 예약을 만든다. 이미 예약된 브랜드면 아무것도 하지 않는다. */
export async function enrollLead(brandId: string, channelId: string, from = new Date()): Promise<{ ok: boolean; scheduled: number; skipped?: string }> {
  if (!channelId) return { ok: true, scheduled: 0, skipped: "유입 키 없음" };
  const s = await getSeqConfig(channelId);
  if (!s.enabled) return { ok: true, scheduled: 0, skipped: "이 키는 연속 안내 꺼짐" };
  const exists = await queryOne<{ n: string }>(
    "SELECT count(*)::text n FROM lead_sequence_sends WHERE brand_id=$1", [brandId]).catch(() => null);
  if (exists && Number(exists.n) > 0) return { ok: true, scheduled: 0, skipped: "이미 예약됨" };

  const steps = await listSeqSteps(channelId, s.days);
  const hourByDay = Object.fromEntries(steps.map((x) => [x.day_no, x.send_hour]));
  let n = 0;
  for (const p of planSchedule(from, { ...s, hourByDay })) {
    const r = await query(
      `INSERT INTO lead_sequence_sends (brand_id, channel_id, day_no, due_at) VALUES ($1,$2,$3,$4)
       ON CONFLICT (brand_id, day_no) DO NOTHING`,
      [brandId, channelId, p.day_no, p.due_at.toISOString()]).catch(() => null);
    if (r) n++;
  }
  return { ok: true, scheduled: n };
}

/**
 * 키를 모르고 들어온 리드(메타 웹훅·신청폼·수기 등록 등)용 —
 * 그 소스에 연결된 키 중 연속 안내가 켜진 것이 "정확히 하나"일 때만 그 키의 일정을 쓴다.
 * 여러 개면 어느 일정인지 알 수 없으므로 예약하지 않는다.
 */
export async function enrollLeadBySource(brandId: string, source: string, from = new Date()): Promise<{ ok: boolean; scheduled: number; skipped?: string }> {
  const rows = await query<{ id: string }>(
    `SELECT c.id FROM intake_channels c JOIN lead_sequence_config q ON q.channel_id=c.id
      WHERE c.source=$1 AND q.enabled`, [source]).catch(() => []);
  if (rows.length !== 1) {
    return { ok: true, scheduled: 0, skipped: rows.length === 0 ? "이 소스에 켜진 연속 안내 없음" : "이 소스에 켜진 키가 여러 개 — 자동 예약 보류" };
  }
  return enrollLead(brandId, rows[0].id, from);
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
    id: string; brand_id: string; channel_id: string | null; day_no: number;
    brand_name: string; contact_name: string | null; email: string | null; phone: string | null;
    state: string; msg_opt_out: boolean; test_mode: boolean | null;
  }>(
    `SELECT q.id, q.brand_id, q.channel_id, q.day_no,
            b.brand_name, b.contact_name, b.email, b.phone, b.state,
            COALESCE(b.msg_opt_out,false) AS msg_opt_out, c.test_mode
       FROM lead_sequence_sends q
       JOIN brands b ON b.id = q.brand_id
       LEFT JOIN intake_channels c ON c.id = q.channel_id
      WHERE q.status='queued' AND q.due_at <= $1
      ORDER BY q.due_at
      LIMIT $2`, [now.toISOString(), limit]).catch(() => []);
  res.due = rows.length;
  if (rows.length === 0) return res;

  // 키별 설정·문구는 한 번씩만 읽는다(같은 키의 예약이 여러 건이므로).
  const cfgCache = new Map<string, SeqConfig>();
  const stepCache = new Map<string, Map<number, SeqStep>>();
  const cfgOf = async (k: string) => {
    if (!cfgCache.has(k)) cfgCache.set(k, await getSeqConfig(k));
    return cfgCache.get(k)!;
  };
  const stepOf = async (k: string, day: number) => {
    if (!stepCache.has(k)) stepCache.set(k, new Map((await listSeqSteps(k, MAX_DAYS)).map((x) => [x.day_no, x])));
    return stepCache.get(k)!.get(day);
  };

  const { sendSms } = await import("./sms");
  const { sendEmail } = await import("./mailer");

  for (const r of rows) {
    if (!r.channel_id) { await mark(r.id, "skipped", [], "유입 키가 삭제됨"); res.skipped++; continue; }
    const cfg = await cfgOf(r.channel_id);
    // 중단 조건 — 남은 일차까지 한 번에 취소한다.
    const stopReason = r.msg_opt_out ? "수신거부"
      : STOP_STATES.has(r.state) ? "드랍·이탈"
      : !cfg.enabled ? "키 연속 안내 꺼짐"
      : cfg.stopOnProgress && r.state !== "lead_new" ? `단계 진전(${r.state})`
      : null;
    if (stopReason) { await cancelLead(r.brand_id, stopReason); res.canceled++; continue; }

    const step = await stepOf(r.channel_id, r.day_no);
    if (!step || !step.enabled) { await mark(r.id, "skipped", [], "해당 일차 꺼짐"); res.skipped++; continue; }

    const vars = { "브랜드명": r.brand_name, "담당자명": r.contact_name || r.brand_name, "일차": String(r.day_no) };
    const sent: string[] = [];
    const errs: string[] = [];
    // 키가 테스트 모드면 실제로 보내지 않고 "보낼 내용"만 기록한다(기존 1회성 안내와 같은 규칙).
    const testMode = Boolean(r.test_mode);

    if (step.send_sms && r.phone && step.sms_body.trim()) {
      if (testMode) sent.push("sms");
      else {
        const ok = await sendSms({ receiver: r.phone, msg: renderTemplate(step.sms_body, vars) })
          .then((x) => x.ok).catch(() => false);
        if (ok) sent.push("sms"); else errs.push("문자 실패");
      }
    }
    if (step.send_email && r.email && step.email_body.trim()) {
      if (testMode) sent.push("email");
      else {
        const ok = await sendEmail({
          to: r.email,
          subject: renderTemplate(step.email_subject || `[GloveK] ${r.brand_name} 안내`, vars),
          text: renderTemplate(step.email_body, vars),
        }).then((x) => x.ok).catch(() => false);
        if (ok) sent.push("email"); else errs.push("메일 실패");
      }
    }

    if (sent.length) {
      await mark(r.id, "sent", sent, testMode ? "테스트 모드 — 실제 발송 없음" : errs.join(" · "));
      if (!testMode) {
        await query("UPDATE brands SET last_contact_at=now() WHERE id=$1", [r.brand_id]).catch(() => {});
        await query(
          `INSERT INTO brand_sources (brand_id, site, event, payload, occurred_at)
           VALUES ($1,'admin','contact_logged',$2,now())`,
          [r.brand_id, JSON.stringify({ channel: sent.join("+"), kind: "lead_sequence", channel_id: r.channel_id, day: r.day_no })]).catch(() => {});
      }
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
  brand_id: string; brand_name: string; channel_id: string | null; day_no: number; due_at: string;
  status: string; channels: string[]; note: string;
}
/** 다가오는 예약·최근 발송. channelId 를 주면 그 키 것만. */
export async function listSeqQueue(channelId?: string, limit = 30): Promise<SeqQueueRow[]> {
  const where = channelId ? "AND q.channel_id=$2" : "";
  const args: unknown[] = channelId ? [limit, channelId] : [limit];
  return query<SeqQueueRow>(
    `SELECT q.brand_id, b.brand_name, q.channel_id, q.day_no, q.due_at::text AS due_at, q.status, q.channels, q.note
       FROM lead_sequence_sends q JOIN brands b ON b.id=q.brand_id
      WHERE q.status IN ('queued','sent','failed') ${where}
      ORDER BY (q.status='queued') DESC, q.due_at
      LIMIT $1`, args).catch(() => []);
}
