// 신규 리드 연속 안내(드립, 0096) — 유입 후 N일간 정해진 시각에 문자·메일 발송.
//   기존 1회성 자동안내의 확장이며, 설정 단위는 "유입 소스 키"(intake_channels.id).
//   키마다 기간·발송 요일·시각·일차별 문구를 따로 둔다. 화면: /channels 각 키의 「연속 안내」.
//     · 1일차는 기존대로 유입 즉시(키마다 "지정 시각"으로 바꿀 수 있음)
//     · 2일차부터 정해진 요일·시각에 일차별로 다른 문구
//   멱등: 브랜드×일차 1회(lead_sequence_sends UNIQUE) — 크론이 겹쳐 돌아도 중복 발송 없음.
import { query, queryOne } from "./db";
import { renderTemplate } from "./templates";
// 광고 차단 검사·수신거부 링크 — 이 모듈(연속 안내)은 광고 경로이므로 항상 거친다.
import { adGate, ensureRecipient, optoutUrlFor, withSmsOptout, withMailOptout } from "./ad-optout";
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


// ── DB 오류를 사람이 읽을 수 있게 ────────────────────────────
/** 이 기능이 필요로 하는 마이그레이션 파일. 미적용이면 저장·조회가 모두 실패한다. */
export const SEQ_MIGRATION = "0096_lead_sequence.sql";

/**
 * 스키마가 없어서 난 오류인지 판별해 안내 문구로 바꾼다.
 *   42P01 = 테이블 없음, 42703 = 컬럼 없음 → 마이그레이션 미적용.
 * 그 외 오류는 원문을 남겨 원인 파악이 되게 한다(빈 값으로 숨기지 않는다).
 */
export function seqDbError(e: unknown): string {
  const err = e as { code?: string; message?: string };
  const code = err?.code ?? "";
  const msg = err?.message ?? String(e);
  if (code === "42P01" || code === "42703" || /relation .* does not exist|column .* does not exist/i.test(msg)) {
    return `DB 준비 안 됨 — 설정 → DB 마이그레이션에서 ${SEQ_MIGRATION} 을 적용해 주세요. (${msg})`;
  }
  return `저장/조회 실패 — ${msg}`;
}

// ── 설정 조회·저장 ───────────────────────────────────────────
interface ConfigRow {
  channel_id: string; enabled: boolean; days: number; hour: number; stop_on_progress: boolean;
}
const toConfig = (r: ConfigRow): SeqConfig => ({
  channel_id: r.channel_id, enabled: !!r.enabled, days: clampDays(r.days), hour: clampHour(r.hour),
  stopOnProgress: r.stop_on_progress,
});

const CONFIG_COLS = "channel_id, enabled, days, hour, stop_on_progress";

/** 키 하나의 설정. 행이 없으면 꺼짐 기본값, 조회 자체가 실패하면 예외를 그대로 올린다. */
export async function getSeqConfig(channelId: string): Promise<SeqConfig> {
  const r = await queryOne<ConfigRow>(
    `SELECT ${CONFIG_COLS} FROM lead_sequence_config WHERE channel_id=$1`, [channelId]);
  return r ? toConfig(r) : defaultSeqConfig(channelId);
}

/** 발송 워커용 — 스키마가 없으면 "꺼짐"으로 보고 조용히 넘어간다(크론이 매번 터지지 않게). */
async function getSeqConfigSafe(channelId: string): Promise<SeqConfig> {
  return getSeqConfig(channelId).catch(() => defaultSeqConfig(channelId));
}

/** 전체 키 설정 — 화면에서 키 목록과 합쳐 쓴다.
 *  조회에 실패하면 빈 값으로 넘기지 않고 사유를 함께 돌려준다(화면에 그대로 표시). */
export async function listSeqConfigs(): Promise<{ configs: Record<string, SeqConfig>; error?: string }> {
  try {
    const rows = await query<ConfigRow>(`SELECT ${CONFIG_COLS} FROM lead_sequence_config`);
    return { configs: Object.fromEntries(rows.map((r) => [r.channel_id, toConfig(r)])) };
  } catch (e) {
    return { configs: {}, error: seqDbError(e) };
  }
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

/** 회차별 기본 뼈대(저장 행이 없는 회차용). */
function blankSteps(channelId: string, days: number): SeqStep[] {
  return Array.from({ length: clampDays(days) }, (_, i) => ({
    channel_id: channelId, day_no: i + 1, enabled: i === 0,
    send_sms: true, send_email: true, send_hour: null,
    sms_body: "", email_subject: "", email_body: "",
  }));
}

/** 키의 회차별 문구 — 조회 실패 시 예외를 올린다(빈 값으로 위장하지 않는다). */
export async function listSeqSteps(channelId: string, days: number): Promise<SeqStep[]> {
  const rows = await query<SeqStep>(
    `SELECT channel_id, day_no, enabled, send_sms, send_email, send_hour, sms_body, email_subject, email_body
       FROM lead_sequence_steps WHERE channel_id=$1 ORDER BY day_no`, [channelId]);
  const byDay = new Map(rows.map((r) => [r.day_no, r]));
  // 1…days 회차를 항상 채워서 돌려준다(저장된 행이 있으면 그 값).
  return blankSteps(channelId, days).map((b) => byDay.get(b.day_no) ?? b);
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

/** 회차 1건 조회 — 저장 직후 "정말 들어갔는지" 확인용. */
export async function getSeqStep(channelId: string, dayNo: number): Promise<SeqStep | null> {
  return queryOne<SeqStep>(
    `SELECT channel_id, day_no, enabled, send_sms, send_email, send_hour, sms_body, email_subject, email_body
       FROM lead_sequence_steps WHERE channel_id=$1 AND day_no=$2`, [channelId, dayNo]);
}

/** 다른 키의 문구를 통째로 복사 — 키마다 비슷한 흐름일 때 처음부터 쓰지 않아도 되게. */
export async function copySeqSteps(fromId: string, toId: string, by: string): Promise<number> {
  const src = await query<SeqStep>(
    `SELECT channel_id, day_no, enabled, send_sms, send_email, send_hour, sms_body, email_subject, email_body
       FROM lead_sequence_steps WHERE channel_id=$1`, [fromId]);
  for (const s of src) await saveSeqStep({ ...s, channel_id: toId }, by);
  return src.length;
}

// ── 등록(유입 시) ─────────────────────────────────────────────
/** 리드 유입 시 그 키의 일정대로 예약을 만든다. 이미 예약된 브랜드면 아무것도 하지 않는다. */
export async function enrollLead(brandId: string, channelId: string, from = new Date()): Promise<{ ok: boolean; scheduled: number; skipped?: string }> {
  if (!channelId) return { ok: true, scheduled: 0, skipped: "유입 키 없음" };
  // 유입 처리 자체를 막지 않도록, 스키마 미적용이면 예약만 건너뛴다.
  const s = await getSeqConfigSafe(channelId);
  if (!s.enabled) return { ok: true, scheduled: 0, skipped: "이 키는 연속 안내 꺼짐" };
  const exists = await queryOne<{ n: string }>(
    "SELECT count(*)::text n FROM lead_sequence_sends WHERE brand_id=$1", [brandId]).catch(() => null);
  if (exists && Number(exists.n) > 0) return { ok: true, scheduled: 0, skipped: "이미 예약됨" };

  // 이미 광고 수신거부한 연락처면 새 예약을 만들지 않는다(같은 연락처로 재등록해도 유지).
  //   확인이 안 되면 예약하지 않는다(fail closed).
  const b = await queryOne<{ email: string | null; phone: string | null; msg_opt_out: boolean }>(
    "SELECT email, phone, COALESCE(msg_opt_out,false) AS msg_opt_out FROM brands WHERE id=$1", [brandId]).catch(() => null);
  const { adGate } = await import("./ad-optout");
  const gate = await adGate({ email: b?.email, phone: b?.phone, brandOptOut: b?.msg_opt_out });
  if (gate.error) return { ok: false, scheduled: 0, skipped: gate.error };
  if (!gate.smsAllowed && !gate.emailAllowed) return { ok: true, scheduled: 0, skipped: gate.reason ?? "광고 수신거부" };

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
    if (!cfgCache.has(k)) cfgCache.set(k, await getSeqConfigSafe(k));
    return cfgCache.get(k)!;
  };
  const stepOf = async (k: string, day: number) => {
    if (!stepCache.has(k)) {
      const list = await listSeqSteps(k, MAX_DAYS).catch(() => [] as SeqStep[]);
      stepCache.set(k, new Map(list.map((x) => [x.day_no, x])));
    }
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

    // ── 광고 차단 검사(발송 직전) ──
    //   이 경로는 광고다. 수신거부를 확인하지 못하면 보내지 않는다(fail closed).
    const gate = await adGate({ phone: r.phone, email: r.email, brandOptOut: r.msg_opt_out });
    if (gate.error) {
      // 확인 실패 — 광고를 내보내지 않고 다음 차례에 다시 시도한다.
      await mark(r.id, "failed", [], gate.error);
      res.failed++;
      continue;
    }
    if (!gate.smsAllowed && !gate.emailAllowed) {
      await cancelLead(r.brand_id, gate.reason ?? "광고 수신거부");
      res.canceled++;
      continue;
    }

    // 이 수신자(이메일·전화 쌍)의 고유 링크 — 같은 사람이면 회차가 달라도 같은 링크.
    //   발급 실패 시 광고를 내보내지 않는다(수신거부 수단 없는 광고를 만들지 않기 위해).
    const rcpt = await ensureRecipient({ email: r.email, phone: r.phone, brandId: r.brand_id }).catch(() => null);
    if (!rcpt) {
      await mark(r.id, "failed", [], "수신거부 링크 발급 실패 — 광고 보류");
      res.failed++;
      continue;
    }
    const optUrl = optoutUrlFor(rcpt.token);

    if (step.send_sms && r.phone && step.sms_body.trim() && gate.smsAllowed) {
      if (testMode) sent.push("sms");
      else {
        // 범위 표기는 이 키의 실제 회차 수로 렌더한다 — 설정이 바뀌어도 문구가 어긋나지 않게.
        const body = withSmsOptout(renderTemplate(step.sms_body, vars), optUrl, { rounds: cfg.days });
        const ok = await sendSms({ receiver: r.phone, msg: body }).then((x) => x.ok).catch(() => false);
        if (ok) sent.push("sms"); else errs.push("문자 실패");
      }
    }
    if (step.send_email && r.email && step.email_body.trim()) {
      // 문자를 받고 바로 수신거부했을 수 있다 — 메일 보내기 직전에 두 주소를 함께 다시 확인한다.
      //   (한쪽만 보면 문자 거부 → 메일 우회가 생긴다)
      const again = await adGate({ phone: r.phone, email: r.email, brandOptOut: r.msg_opt_out });
      if (again.error) {
        // 확인이 안 되면 메일 광고는 보내지 않는다(fail closed).
        errs.push("메일 실패");
      } else if (!again.emailAllowed) {
        // 광고 수신거부로 메일만 중단 — 실패가 아니므로 아무 것도 적지 않는다("대상 아님"으로 남는다).
      } else if (testMode) {
        sent.push("email");
      } else {
        const body = withMailOptout(renderTemplate(step.email_body, vars), optUrl, { rounds: cfg.days });
        const ok = await sendEmail({
          to: r.email,
          subject: renderTemplate(step.email_subject || `[GloveK] ${r.brand_name} 안내`, vars),
          text: body,
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
