// 주간 세미나 안내 자동발송 — 설정·회차 생성·대상 확정·발송 원장.
//
//   대상 판정의 핵심: 신청 이벤트(brand_sources.event='lead') 의 occurred_at 과
//   payload->>'source' 만 본다. brands.source 는 최초 생성 때만 정해져 재신청을
//   반영하지 않고, brands.updated_at 은 아무 수정에나 움직이므로 쓰지 않는다.
//
//   보내지 않는 조건은 모두 코드로 막는다 — 마스터 스위치 OFF · Zoom 링크 미설정 ·
//   문구 초안 · 채널 OFF · 예정 시각이 오래 지남 · 수신거부.
import { query, queryOne } from "./db";
import {
  buildSession, nextSessionDate, latePlan, dedupeKeys, normEmail, normPhone,
  sendBlockers, isHttpUrl, shiftDay, atKst,
  type SeminarSession, type SeminarScheduleConfig, type WeekMode, type LatePolicy,
  type DedupeScope, type SeminarStage, type SeminarChannel,
} from "./seminar-schedule";

import {
  seminarVars, composeSeminarMessage, maskTo,
  type ComposedMessage,
} from "./seminar-message";
import {
  attemptsSchemaState, beginAttempt, finishAttempt,
  SEMINAR_ATTEMPTS_MIGRATION,
} from "./seminar-attempts";

export const SEMINAR_SCHEMA_MIGRATION = "0103_seminar_notify.sql";
/** 'sending' 으로 선점된 채 멈춘 발송을 되돌리기까지의 시간(분). */
export const SEND_CLAIM_STALE_MIN = 10;
/** 실행 잠금이 걸린 채 멈춘 run 을 풀기까지의 시간(분). */
export const RUN_STALE_MIN = 15;

// ── 설정 ────────────────────────────────────────────────────
export interface SeminarConfig extends SeminarScheduleConfig {
  enabled: boolean;
  sourceKeys: string[];
  latePolicy: LatePolicy;
  dedupeScope: DedupeScope;
  zoomUrl: string;
  sessionTitle: string;
  firstSessionDate: string;
  sendEmail: boolean;
  sendSms: boolean;
  maxAttempts: number;
  staleHours: number;
  note: string;
  updatedBy: string | null;
  updatedAt: string | null;
}

interface ConfigRow {
  enabled: boolean; source_keys: string[]; week_mode: WeekMode;
  session_weekday: number; session_hour: number; session_minute: number;
  followup_hour: number; followup_minute: number;
  notice_lead_days: number; notice_hour: number; notice_minute: number;
  late_policy: LatePolicy; cutoff_minutes: number; dedupe_scope: DedupeScope;
  zoom_url: string; session_title: string; first_session_date: string;
  send_email: boolean; send_sms: boolean;
  max_attempts: number; stale_hours: number; note: string;
  updated_by: string | null; updated_at: string | null;
}

const toConfig = (r: ConfigRow): SeminarConfig => ({
  enabled: r.enabled, sourceKeys: r.source_keys ?? [], weekMode: r.week_mode,
  sessionWeekday: r.session_weekday, sessionHour: r.session_hour, sessionMinute: r.session_minute,
  followupHour: r.followup_hour, followupMinute: r.followup_minute,
  noticeLeadDays: r.notice_lead_days, noticeHour: r.notice_hour, noticeMinute: r.notice_minute,
  latePolicy: r.late_policy, cutoffMinutes: r.cutoff_minutes, dedupeScope: r.dedupe_scope,
  zoomUrl: r.zoom_url ?? "", sessionTitle: r.session_title ?? "",
  firstSessionDate: r.first_session_date, sendEmail: r.send_email, sendSms: r.send_sms,
  maxAttempts: r.max_attempts, staleHours: r.stale_hours, note: r.note ?? "",
  updatedBy: r.updated_by, updatedAt: r.updated_at,
});

export async function seminarSchemaState(): Promise<{ ready: boolean; missing: string[]; error?: string }> {
  const need = ["seminar_config", "seminar_templates", "seminar_sessions", "seminar_targets", "seminar_sends", "seminar_runs"];
  try {
    const rows = await query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema='public' AND table_name = ANY($1::text[])`, [need]);
    const have = new Set(rows.map((r) => r.table_name));
    const missing = need.filter((t) => !have.has(t));
    return { ready: missing.length === 0, missing };
  } catch (e) {
    return { ready: false, missing: need, error: (e as Error).message.slice(0, 200) };
  }
}

export async function getSeminarConfig(): Promise<SeminarConfig> {
  const r = await queryOne<ConfigRow>(
    `SELECT enabled, source_keys, week_mode, session_weekday, session_hour, session_minute,
            followup_hour, followup_minute, notice_lead_days, notice_hour, notice_minute,
            late_policy, cutoff_minutes, dedupe_scope, zoom_url, session_title,
            first_session_date::text AS first_session_date, send_email, send_sms,
            max_attempts, stale_hours, note, updated_by, updated_at::text AS updated_at
       FROM seminar_config WHERE id=1`);
  if (!r) throw new Error(`세미나 설정 행이 없습니다 — 마이그레이션 ${SEMINAR_SCHEMA_MIGRATION} 적용이 필요합니다.`);
  return toConfig(r);
}

export interface ConfigPatch {
  enabled?: boolean; sourceKeys?: string[]; weekMode?: WeekMode;
  sessionHour?: number; sessionMinute?: number; followupHour?: number; followupMinute?: number;
  noticeLeadDays?: number; noticeHour?: number; noticeMinute?: number;
  latePolicy?: LatePolicy; cutoffMinutes?: number; dedupeScope?: DedupeScope;
  zoomUrl?: string; sessionTitle?: string; firstSessionDate?: string;
  sendEmail?: boolean; sendSms?: boolean;
  maxAttempts?: number; staleHours?: number; note?: string;
}

const COL: Record<keyof ConfigPatch, string> = {
  enabled: "enabled", sourceKeys: "source_keys", weekMode: "week_mode",
  sessionHour: "session_hour", sessionMinute: "session_minute",
  followupHour: "followup_hour", followupMinute: "followup_minute",
  noticeLeadDays: "notice_lead_days", noticeHour: "notice_hour", noticeMinute: "notice_minute",
  latePolicy: "late_policy", cutoffMinutes: "cutoff_minutes", dedupeScope: "dedupe_scope",
  zoomUrl: "zoom_url", sessionTitle: "session_title", firstSessionDate: "first_session_date",
  sendEmail: "send_email", sendSms: "send_sms",
  maxAttempts: "max_attempts", staleHours: "stale_hours", note: "note",
};

export async function updateSeminarConfig(patch: ConfigPatch, by: string): Promise<{ ok: boolean; error?: string }> {
  // Zoom 링크는 형식을 확인한다 — 허위/오타 링크가 고객에게 나가지 않게.
  if (patch.zoomUrl !== undefined && patch.zoomUrl.trim() && !isHttpUrl(patch.zoomUrl)) {
    return { ok: false, error: "Zoom 링크는 http(s):// 로 시작하는 주소여야 합니다." };
  }
  if (patch.sourceKeys !== undefined) {
    const keys = patch.sourceKeys.map((k) => k.trim()).filter(Boolean);
    if (keys.length === 0) return { ok: false, error: "세미나 유입 소스를 최소 1개 선택해야 합니다." };
    patch = { ...patch, sourceKeys: [...new Set(keys)] };
  }
  // 마스터 스위치를 켜려면 실제로 보낼 수 있는 상태여야 한다.
  if (patch.enabled === true) {
    const cur = await getSeminarConfig();
    const zoom = patch.zoomUrl ?? cur.zoomUrl;
    if (!isHttpUrl(zoom)) return { ok: false, error: "고정 Zoom 링크를 먼저 저장해야 자동발송을 켤 수 있습니다." };
  }

  const set: string[] = [];
  const args: unknown[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    const col = COL[k as keyof ConfigPatch];
    if (!col) continue;
    args.push(k === "zoomUrl" ? String(v).trim() : v);
    set.push(`${col}=$${args.length}`);
  }
  if (set.length === 0) return { ok: true };
  args.push(by);
  await query(`UPDATE seminar_config SET ${set.join(", ")}, updated_by=$${args.length}, updated_at=now() WHERE id=1`, args);
  return { ok: true };
}

// ── 문구 ────────────────────────────────────────────────────
export interface SeminarTemplate {
  stage: SeminarStage; enabled: boolean; purpose: "service" | "ad";
  sendEmail: boolean; sendSms: boolean;
  emailSubject: string; emailBody: string; smsBody: string;
  updatedBy: string | null; updatedAt: string | null;
}

interface TplRow {
  stage: SeminarStage; enabled: boolean; purpose: "service" | "ad";
  send_email: boolean; send_sms: boolean;
  email_subject: string; email_body: string; sms_body: string;
  updated_by: string | null; updated_at: string | null;
}
const toTpl = (r: TplRow): SeminarTemplate => ({
  stage: r.stage, enabled: r.enabled, purpose: r.purpose,
  sendEmail: r.send_email, sendSms: r.send_sms,
  emailSubject: r.email_subject ?? "", emailBody: r.email_body ?? "", smsBody: r.sms_body ?? "",
  updatedBy: r.updated_by, updatedAt: r.updated_at,
});

export async function listSeminarTemplates(): Promise<SeminarTemplate[]> {
  const rows = await query<TplRow>(
    `SELECT stage, enabled, purpose, send_email, send_sms, email_subject, email_body, sms_body,
            updated_by, updated_at::text AS updated_at
       FROM seminar_templates ORDER BY stage DESC`);   // notice → followup 순
  return rows.map(toTpl);
}

export interface TemplatePatch {
  enabled?: boolean; purpose?: "service" | "ad";
  sendEmail?: boolean; sendSms?: boolean;
  emailSubject?: string; emailBody?: string; smsBody?: string;
}
export async function updateSeminarTemplate(stage: SeminarStage, patch: TemplatePatch, by: string):
  Promise<{ ok: boolean; error?: string }> {
  // 빈 문구를 켤 수 없게 한다 — 켜 두고 내용이 없어 빈 메시지가 나가는 일을 막는다.
  if (patch.enabled === true) {
    const cur = (await listSeminarTemplates()).find((t) => t.stage === stage);
    const body = patch.smsBody ?? cur?.smsBody ?? "";
    const mail = patch.emailBody ?? cur?.emailBody ?? "";
    const subj = patch.emailSubject ?? cur?.emailSubject ?? "";
    const sms = patch.sendSms ?? cur?.sendSms ?? false;
    const email = patch.sendEmail ?? cur?.sendEmail ?? false;
    if (sms && !body.trim()) return { ok: false, error: "문자 문구가 비어 있어 켤 수 없습니다." };
    if (email && (!mail.trim() || !subj.trim())) return { ok: false, error: "메일 제목·본문이 비어 있어 켤 수 없습니다." };
    if (!sms && !email) return { ok: false, error: "문자·메일 중 최소 하나는 켜야 합니다." };
  }
  const map: Record<keyof TemplatePatch, string> = {
    enabled: "enabled", purpose: "purpose", sendEmail: "send_email", sendSms: "send_sms",
    emailSubject: "email_subject", emailBody: "email_body", smsBody: "sms_body",
  };
  const set: string[] = [];
  const args: unknown[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    const col = map[k as keyof TemplatePatch];
    if (!col) continue;
    args.push(v);
    set.push(`${col}=$${args.length}`);
  }
  if (set.length === 0) return { ok: true };
  args.push(by, stage);
  await query(
    `UPDATE seminar_templates SET ${set.join(", ")}, updated_by=$${args.length - 1}, updated_at=now()
      WHERE stage=$${args.length}`, args);
  return { ok: true };
}

// ── 대상 조회(미리보기 · 회차 확정 공용) ────────────────────
export interface Applicant {
  leadEventId: string; brandId: string; appliedAt: string; sourceKey: string;
  brandName: string; contactName: string; email: string; phone: string;
  msgOptOut: boolean; state: string;
}

/**
 * 모집 구간에 들어온 세미나 신청. 신청 1건 = 1행(같은 팀이 여러 번 신청하면 여러 행).
 *   테스트 리드(is_test)는 제외한다. 정렬은 신청 시각 오름차순 — 먼저 신청한 건이 대표가 된다.
 */
export async function applicantsInWindow(sourceKeys: string[], from: Date, to: Date): Promise<Applicant[]> {
  return query<Applicant>(
    `SELECT bs.id AS "leadEventId", b.id AS "brandId",
            bs.occurred_at::text AS "appliedAt",
            coalesce(bs.payload->>'source','') AS "sourceKey",
            coalesce(b.brand_name,'') AS "brandName", coalesce(b.contact_name,'') AS "contactName",
            coalesce(b.email,'') AS email, coalesce(b.phone,'') AS phone,
            coalesce(b.msg_opt_out,false) AS "msgOptOut", b.state
       FROM brand_sources bs
       JOIN brands b ON b.id = bs.brand_id
      WHERE bs.event = 'lead'
        AND bs.payload->>'source' = ANY($1::text[])
        AND bs.occurred_at >= $2 AND bs.occurred_at < $3
        AND coalesce(b.is_test,false) = false
      ORDER BY bs.occurred_at, bs.id`,
    [sourceKeys, from.toISOString(), to.toISOString()]);
}

/**
 * 구간 안에 있으나 payload 에 소스가 없어 판정에서 빠진 신청 수.
 *   0 이 아니면 유입 연동이 소스를 안 보내고 있다는 뜻이라 화면에 그대로 띄운다(조용히 누락시키지 않는다).
 */
export async function unclassifiedLeadCount(from: Date, to: Date): Promise<number> {
  const r = await queryOne<{ n: string }>(
    `SELECT count(*)::text AS n FROM brand_sources
      WHERE event='lead' AND occurred_at >= $1 AND occurred_at < $2
        AND coalesce(payload->>'source','') = ''`,
    [from.toISOString(), to.toISOString()]);
  return Number(r?.n ?? 0);
}

export type TargetStatus = "eligible" | "duplicate" | "excluded" | "deferred";
export interface PlannedTarget extends Applicant {
  status: TargetStatus;
  reason: string;
  late: boolean;
}

/**
 * 신청 목록 → 회차 대상 명단. 순수 판정(여기서 DB 를 건드리지 않는다).
 *   · 연락처가 하나도 없으면 excluded
 *   · 전체 수신거부(msg_opt_out)면 excluded — 기존 정책 그대로
 *   · 같은 회차에서 이미 잡힌 수신자면 duplicate(재신청·팀 내 같은 연락처)
 *   · 안내 예정 시각을 지나 들어온 신청은 정책에 따라 즉시 안내 / 다음 회차 이월 / 제외
 */
export function planTargets(
  applicants: Applicant[], session: SeminarSession, cfg: SeminarConfig, now: Date,
): PlannedTarget[] {
  const taken = new Set<string>();
  const out: PlannedTarget[] = [];
  for (const a of applicants) {
    const email = normEmail(a.email);
    const phone = normPhone(a.phone);
    if (!email && !phone) {
      out.push({ ...a, status: "excluded", reason: "이메일·연락처가 모두 없습니다", late: false });
      continue;
    }
    if (a.msgOptOut) {
      out.push({ ...a, status: "excluded", reason: "전체 수신거부(msg_opt_out)", late: false });
      continue;
    }
    const keys = dedupeKeys(cfg.dedupeScope, { brandId: a.brandId, email: a.email, phone: a.phone });
    if (keys.some((k) => taken.has(k))) {
      out.push({
        ...a, status: "duplicate", late: false,
        reason: cfg.dedupeScope === "brand" ? "같은 팀이 이미 대상입니다" : "같은 연락처가 이미 대상입니다",
      });
      continue;
    }
    const late = new Date(a.appliedAt).getTime() > session.noticeDueAt.getTime();
    if (late) {
      const plan = latePlan(cfg.latePolicy, now, session);
      if (plan.action !== "send_now") {
        out.push({ ...a, status: plan.action === "defer" ? "deferred" : "excluded", reason: plan.reason, late: true });
        continue;
      }
      keys.forEach((k) => taken.add(k));
      out.push({ ...a, status: "eligible", reason: plan.reason, late: true });
      continue;
    }
    keys.forEach((k) => taken.add(k));
    out.push({ ...a, status: "eligible", reason: "", late: false });
  }
  return out;
}

// ── 회차 ────────────────────────────────────────────────────
export interface SessionRow {
  id: string; session_date: string; starts_at: string; followup_at: string;
  notice_due_at: string; window_from: string; window_to: string;
  week_mode: WeekMode; source_keys: string[]; zoom_url: string; session_title: string; dedupe_scope: DedupeScope;
  status: string; note: string; built_at: string | null; created_at: string;
}
const SESSION_COLS = `id, session_date::text AS session_date, starts_at::text AS starts_at,
  followup_at::text AS followup_at, notice_due_at::text AS notice_due_at,
  window_from::text AS window_from, window_to::text AS window_to,
  week_mode, source_keys, zoom_url, session_title, dedupe_scope, status, note,
  built_at::text AS built_at, created_at::text AS created_at`;

export async function listSessions(limit = 12): Promise<SessionRow[]> {
  return query<SessionRow>(`SELECT ${SESSION_COLS} FROM seminar_sessions ORDER BY starts_at DESC LIMIT $1`, [limit]);
}
export async function getSession(id: string): Promise<SessionRow | null> {
  return queryOne<SessionRow>(`SELECT ${SESSION_COLS} FROM seminar_sessions WHERE id=$1`, [id]);
}

/** 회차 행을 만들거나(없으면) 가져온다. 이미 있으면 시각·구간을 건드리지 않는다(확정된 회차 보존). */
export async function ensureSession(sessionDate: string, cfg: SeminarConfig, by: string): Promise<SessionRow> {
  if (cfg.firstSessionDate && sessionDate < cfg.firstSessionDate) {
    throw new Error(`첫 회차(${cfg.firstSessionDate}) 이전 회차는 만들지 않습니다.`);
  }
  const s = buildSession(sessionDate, cfg);
  await query(
    `INSERT INTO seminar_sessions
       (session_date, starts_at, followup_at, notice_due_at, window_from, window_to,
        week_mode, source_keys, zoom_url, session_title, dedupe_scope, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (session_date) DO NOTHING`,
    [sessionDate, s.startsAt.toISOString(), s.followupAt.toISOString(), s.noticeDueAt.toISOString(),
     s.windowFrom.toISOString(), s.windowTo.toISOString(),
     cfg.weekMode, cfg.sourceKeys, cfg.zoomUrl, cfg.sessionTitle, cfg.dedupeScope, by]);
  const row = await queryOne<SessionRow>(
    `SELECT ${SESSION_COLS} FROM seminar_sessions WHERE session_date=$1`, [sessionDate]);
  if (!row) throw new Error("회차를 만들지 못했습니다.");
  return row;
}

/** 저장된 회차 행 → 계산용 구조체(설정이 바뀌어도 그 회차의 판정은 저장값을 따른다). */
export function sessionOf(row: SessionRow): SeminarSession {
  return {
    sessionDate: row.session_date,
    startsAt: new Date(row.starts_at),
    followupAt: new Date(row.followup_at),
    noticeDueAt: new Date(row.notice_due_at),
    windowFrom: new Date(row.window_from),
    windowTo: new Date(row.window_to),
  };
}

export interface BuildResult {
  ok: boolean; error?: string;
  sessionId?: string; sessionDate?: string;
  eligible?: number; duplicate?: number; excluded?: number; deferred?: number;
  queued?: number; unclassified?: number;
  blockers?: string[];
}

/**
 * 회차 대상 확정 + 발송 예약 생성. 여러 번 돌려도 같은 결과가 된다(멱등).
 *   이미 보낸 예약은 건드리지 않는다 — 새로 들어온 신청만 추가된다.
 */
export async function buildSessionTargets(sessionDate: string, by: string, now = new Date()): Promise<BuildResult> {
  const cfg = await getSeminarConfig();
  const row = await ensureSession(sessionDate, cfg, by);
  if (row.status === "canceled") return { ok: false, error: "취소된 회차입니다." };
  const s = sessionOf(row);

  const applicants = await applicantsInWindow(row.source_keys, s.windowFrom, s.windowTo);
  // 지난 회차에서 다음 회차로 넘긴 신청을 함께 편입한다(늦은 신청 이월).
  const carried = await query<Applicant>(
    `SELECT t.lead_event_id AS "leadEventId", t.brand_id AS "brandId",
            t.applied_at::text AS "appliedAt", t.source_key AS "sourceKey",
            coalesce(b.brand_name,'') AS "brandName", coalesce(b.contact_name,'') AS "contactName",
            coalesce(b.email,'') AS email, coalesce(b.phone,'') AS phone,
            coalesce(b.msg_opt_out,false) AS "msgOptOut", b.state
       FROM seminar_targets t
       JOIN seminar_sessions ss ON ss.id = t.session_id
       JOIN brands b ON b.id = t.brand_id
      WHERE t.status='deferred' AND ss.starts_at < $1
        AND coalesce(b.is_test,false) = false
        AND NOT EXISTS (SELECT 1 FROM seminar_targets x
                         WHERE x.session_id=$2 AND x.lead_event_id=t.lead_event_id)
      ORDER BY t.applied_at`, [s.startsAt.toISOString(), row.id]);

  // 이 회차에 이미 잡혀 있는 대상은 그대로 두고, 중복 판정에만 반영한다.
  const existing = await query<{ lead_event_id: string; dedupe_email: string; dedupe_phone: string; brand_id: string; status: string }>(
    `SELECT lead_event_id, dedupe_email, dedupe_phone, brand_id, status FROM seminar_targets WHERE session_id=$1`,
    [row.id]);
  const known = new Set(existing.map((e) => e.lead_event_id));
  const cfgForSession: SeminarConfig = { ...cfg, dedupeScope: row.dedupe_scope };

  const fresh = [...carried, ...applicants].filter((a) => !known.has(a.leadEventId));
  // 이미 대상인 수신자를 먼저 점유시켜 두면 새 신청이 자동으로 duplicate 가 된다.
  const seeded: Applicant[] = existing
    .filter((e) => e.status === "eligible")
    .map((e) => ({
      leadEventId: e.lead_event_id, brandId: e.brand_id, appliedAt: new Date(0).toISOString(),
      sourceKey: "", brandName: "", contactName: "", email: e.dedupe_email, phone: e.dedupe_phone,
      msgOptOut: false, state: "",
    }));
  const planned = planTargets([...seeded, ...fresh], s, cfgForSession, now)
    .filter((p) => !seeded.some((x) => x.leadEventId === p.leadEventId));

  const counts = { eligible: 0, duplicate: 0, excluded: 0, deferred: 0, queued: 0 };
  for (const p of planned) {
    const inserted = await queryOne<{ id: string }>(
      `INSERT INTO seminar_targets
         (session_id, brand_id, lead_event_id, applied_at, source_key,
          brand_name, contact_name, email, phone, dedupe_email, dedupe_phone, status, exclude_reason, late)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (session_id, lead_event_id) DO NOTHING
       RETURNING id`,
      [row.id, p.brandId, p.leadEventId, p.appliedAt, p.sourceKey,
       p.brandName, p.contactName, p.email, p.phone,
       p.status === "eligible" ? normEmail(p.email) : "", p.status === "eligible" ? normPhone(p.phone) : "",
       p.status, p.reason, p.late])
      .catch(async (e) => {
        // 경합으로 유니크 인덱스에 걸리면 중복으로 기록한다(빠뜨리지 않는다).
        if (!/seminar_targets_(email|phone)_uniq/.test((e as Error).message)) throw e;
        await query(
          `INSERT INTO seminar_targets
             (session_id, brand_id, lead_event_id, applied_at, source_key, brand_name, contact_name,
              email, phone, status, exclude_reason)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'duplicate','같은 연락처가 이미 대상입니다')
           ON CONFLICT (session_id, lead_event_id) DO NOTHING`,
          [row.id, p.brandId, p.leadEventId, p.appliedAt, p.sourceKey, p.brandName, p.contactName, p.email, p.phone]);
        return null;
      });
    counts[p.status] += 1;
    if (inserted && p.status === "eligible") {
      counts.queued += await queueSends(row, inserted.id, p, now);
    }
  }

  await query("UPDATE seminar_sessions SET built_at=now(), updated_at=now() WHERE id=$1", [row.id]);
  const unclassified = await unclassifiedLeadCount(s.windowFrom, s.windowTo).catch(() => 0);
  const blockers = await sessionBlockers(row);
  return {
    ok: true, sessionId: row.id, sessionDate: row.session_date,
    ...counts, unclassified, blockers,
  };
}

/** 대상 1명에게 단계×채널 예약을 만든다. 이미 있으면 그대로 둔다. */
async function queueSends(row: SessionRow, targetId: string, p: PlannedTarget, now: Date): Promise<number> {
  const tpls = await listSeminarTemplates();
  const cfg = await getSeminarConfig();
  let n = 0;
  for (const t of tpls) {
    const dueBase = t.stage === "notice" ? new Date(row.notice_due_at) : new Date(row.followup_at);
    // 늦은 신청의 1차 안내는 예정 시각이 이미 지났으므로 확인 즉시로 잡는다.
    const due = t.stage === "notice" && p.late && dueBase.getTime() < now.getTime() ? now : dueBase;
    for (const ch of ["email", "sms"] as SeminarChannel[]) {
      const channelOn = ch === "email" ? (cfg.sendEmail && t.sendEmail) : (cfg.sendSms && t.sendSms);
      if (!channelOn) continue;
      const addr = ch === "email" ? normEmail(p.email) : normPhone(p.phone);
      if (!addr) continue;   // 그 채널의 연락처가 없으면 예약 자체를 만들지 않는다
      const r = await queryOne<{ id: string }>(
        `INSERT INTO seminar_sends (session_id, target_id, stage, channel, due_at)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (session_id, target_id, stage, channel) DO NOTHING
         RETURNING id`,
        [row.id, targetId, t.stage, ch, due.toISOString()]);
      if (r) n += 1;
    }
  }
  return n;
}

/** 이 회차가 지금 보낼 수 없는 이유(설정·문구 기준). 비어 있으면 보낼 수 있다. */
export async function sessionBlockers(row: SessionRow): Promise<string[]> {
  const cfg = await getSeminarConfig();
  const tpls = await listSeminarTemplates();
  const out = new Set<string>();
  if (!cfg.enabled) out.add("자동발송 마스터 스위치가 꺼져 있습니다");
  if (!isHttpUrl(row.zoom_url || cfg.zoomUrl)) out.add("고정 Zoom 링크가 설정되지 않았습니다");
  for (const t of tpls) {
    if (!t.enabled) out.add(`${t.stage === "notice" ? "안내" : "후속"} 문구가 아직 초안(비활성)입니다`);
  }
  // 보낸 내용을 남길 수 없으면 아예 보내지 않는다 — 화면에서도 이유가 보이게 한다.
  const log = await attemptsSchemaState();
  if (!log.ready) out.add(`${log.error ?? `마이그레이션 ${SEMINAR_ATTEMPTS_MIGRATION} 미적용`} — 기록을 남길 수 없어 보내지 않습니다`);
  return [...out];
}

// ── 발송 ────────────────────────────────────────────────────
export interface DispatchResult {
  ok: boolean; error?: string;
  due: number; sent: number; failed: number; skipped: number; retry: number;
  blocked?: string[];
}

interface DueRow {
  id: string; session_id: string; target_id: string; stage: SeminarStage; channel: SeminarChannel;
  due_at: string; attempts: number;
  brand_name: string; contact_name: string; email: string; phone: string;
  brand_id: string; target_status: string;
  starts_at: string; followup_at: string; zoom_url: string; session_title: string;
  msg_opt_out: boolean;
}

/**
 * 예정 시각이 지난 예약을 보낸다.
 *   · 동시 실행: seminar_runs 의 부분 유니크 인덱스로 같은 종류의 실행이 겹치지 않는다.
 *   · 중복 전송: 행을 'sending' 으로 원자적으로 선점한 뒤에만 실제로 보낸다.
 *   · 마스터 스위치가 꺼져 있으면 아무것도 보내지 않고 예약을 그대로 둔다.
 */
export async function dispatchDue(limit = 200, now = new Date(), triggeredBy = "cron"): Promise<DispatchResult> {
  const zero: DispatchResult = { ok: true, due: 0, sent: 0, failed: 0, skipped: 0, retry: 0 };
  const schema = await seminarSchemaState();
  if (!schema.ready) {
    return { ...zero, ok: false, error: `마이그레이션 ${SEMINAR_SCHEMA_MIGRATION} 미적용 — 없는 표: ${schema.missing.join(", ")}` };
  }
  await releaseStale(now);

  const cfg = await getSeminarConfig();
  if (!cfg.enabled) {
    // 예약은 그대로 둔다 — 나중에 켜도 묵은 건은 staleHours 가드에 걸려 나가지 않는다.
    return { ...zero, blocked: ["자동발송 마스터 스위치가 꺼져 있습니다"] };
  }
  if (!isHttpUrl(cfg.zoomUrl)) {
    return { ...zero, blocked: ["고정 Zoom 링크가 설정되지 않았습니다 — 링크 없이 보내지 않습니다"] };
  }

  // 보낸 내용을 남길 수 없으면 보내지 않는다 — 기록 없는 발송을 만들지 않기 위해 먼저 막는다.
  const logSchema = await attemptsSchemaState();
  if (!logSchema.ready) {
    return { ...zero, blocked: [`${logSchema.error ?? `마이그레이션 ${SEMINAR_ATTEMPTS_MIGRATION} 미적용`} — 기록을 남길 수 없어 보내지 않습니다`] };
  }

  const run = await startRun("dispatch", triggeredBy);
  if (!run) return { ...zero, blocked: ["다른 발송 실행이 진행 중입니다"] };

  const res: DispatchResult = { ...zero };
  try {
    // 원자적 선점 — 같은 행을 두 실행이 동시에 집지 못한다.
    //   claimed_by 에 이 실행 id 를 적어 둔다. 중간에 멈출 때 "내가 잡은 것"만 돌려놓기 위해서다.
    const claimed = await query<{ id: string }>(
      `UPDATE seminar_sends SET status='sending', claimed_at=now(), claimed_by=$3::uuid,
              attempts=attempts+1, updated_at=now()
        WHERE id IN (
          SELECT id FROM seminar_sends
           WHERE status='queued' AND due_at <= $1
           ORDER BY due_at
           LIMIT $2
           FOR UPDATE SKIP LOCKED)
        RETURNING id`, [now.toISOString(), limit, run]);
    res.due = claimed.length;
    if (claimed.length === 0) { await finishRun(run, "done", "보낼 예약 없음"); return res; }

    const rows = await query<DueRow>(
      `SELECT s.id, s.session_id, s.target_id, s.stage, s.channel, s.due_at::text AS due_at, s.attempts,
              t.brand_name, t.contact_name, t.email, t.phone, t.brand_id, t.status AS target_status,
              ses.starts_at::text AS starts_at, ses.followup_at::text AS followup_at,
              ses.zoom_url, ses.session_title,
              coalesce(b.msg_opt_out,false) AS msg_opt_out
         FROM seminar_sends s
         JOIN seminar_targets t ON t.id = s.target_id
         JOIN seminar_sessions ses ON ses.id = s.session_id
         JOIN brands b ON b.id = t.brand_id
        WHERE s.id = ANY($1::uuid[])`, [claimed.map((c) => c.id)]);

    const tpls = new Map((await listSeminarTemplates()).map((t) => [t.stage, t]));
    const staleMs = cfg.staleHours * 3600_000;
    // 이 실행에서 손을 댄 예약. 중간에 멈추면 "손대지 않은 것"만 되돌린다.
    const handled = new Set<string>();
    let abort = "";

    for (const r of rows) {
      const tpl = tpls.get(r.stage);
      const skip = async (reason: string) => {
        await query(
          "UPDATE seminar_sends SET status='skipped', skip_reason=$2, updated_at=now() WHERE id=$1",
          [r.id, reason.slice(0, 300)]);
        handled.add(r.id);
        res.skipped += 1;
      };
      /** 보내지 않고 결과만 남긴다(전송 시도 없음). 재시도 여지가 있으면 예약으로 되돌린다. */
      const noSend = async (reason: string) => {
        if (r.attempts >= cfg.maxAttempts) {
          await query("UPDATE seminar_sends SET status='failed', error=$2, updated_at=now() WHERE id=$1",
            [r.id, reason.slice(0, 300)]);
          res.failed += 1;
        } else {
          const backoff = Math.min(r.attempts, 6) * 5 * 60_000;
          await query(
            "UPDATE seminar_sends SET status='queued', error=$2, due_at=$3, updated_at=now() WHERE id=$1",
            [r.id, reason.slice(0, 300), new Date(now.getTime() + backoff).toISOString()]);
          res.retry += 1;
        }
        handled.add(r.id);
      };

      if (!tpl) { await skip("문구가 없습니다"); continue; }
      if (r.target_status !== "eligible") { await skip(`대상 아님(${r.target_status})`); continue; }
      if (r.msg_opt_out) { await skip("전체 수신거부(msg_opt_out)"); continue; }
      if (now.getTime() - new Date(r.due_at).getTime() > staleMs) {
        await skip(`예정 시각이 ${cfg.staleHours}시간 넘게 지나 보내지 않았습니다`); continue;
      }
      const zoom = r.zoom_url || cfg.zoomUrl;
      const blockers = sendBlockers({
        enabled: cfg.enabled, zoomUrl: zoom,
        masterChannel: r.channel === "email" ? cfg.sendEmail : cfg.sendSms,
        template: {
          enabled: tpl.enabled,
          body: r.channel === "email" ? tpl.emailBody : tpl.smsBody,
          subject: tpl.emailSubject,
          channelOn: r.channel === "email" ? tpl.sendEmail : tpl.sendSms,
        },
        stage: r.stage, channel: r.channel,
      });
      if (blockers.length) { await skip(blockers.join(" · ")); continue; }

      // 광고성 단계면 기존 광고 수신거부 규칙을 그대로 적용한다.
      //   세미나 참가 안내(service)는 신청한 사람에게 보내는 거래·서비스 안내이므로
      //   광고 수신거부를 적용하지 않는다 — 대신 전체 수신거부(msg_opt_out)는 위에서 이미 막았다.
      let optoutUrl = "";
      if (tpl.purpose === "ad") {
        const { adGate, ensureRecipient, optoutUrlFor } = await import("./ad-optout");
        const gate = await adGate({ phone: r.phone, email: r.email, brandOptOut: r.msg_opt_out });
        // 확인 실패면 광고를 내보내지 않는다(fail closed).
        if (gate.error) { await skip(`광고 수신거부 확인 실패 — 보내지 않았습니다(${gate.error.slice(0, 80)})`); continue; }
        const allowed = r.channel === "sms" ? gate.smsAllowed : gate.emailAllowed;
        if (!allowed) { await skip(gate.reason ?? "광고 수신거부 대상"); continue; }
        // 수신거부 수단 없는 광고를 만들지 않는다.
        const rcpt = await ensureRecipient({ email: r.email, phone: r.phone, brandId: r.brand_id }).catch(() => null);
        if (!rcpt) { await skip("수신거부 링크 발급 실패 — 광고 보류"); continue; }
        optoutUrl = optoutUrlFor(rcpt.token);
      }

      const at = r.stage === "notice" ? new Date(r.starts_at) : new Date(r.followup_at);
      // 미리보기·테스트 발송과 같은 함수로 치환한다(제목 기준: 지금 설정값).
      const vars = seminarVars({
        brandName: r.brand_name, contactName: r.contact_name, at,
        configTitle: cfg.sessionTitle, sessionTitle: r.session_title,
        configZoomUrl: cfg.zoomUrl, sessionZoomUrl: r.zoom_url,
      });
      // 실제로 나갈 최종 제목·본문(수신거부 꼬리말까지 포함). 기록도 이 값을 그대로 남긴다.
      const msg = composeSeminarMessage({
        channel: r.channel, purpose: tpl.purpose, vars, optoutUrl,
        template: { emailSubject: tpl.emailSubject, emailBody: tpl.emailBody, smsBody: tpl.smsBody },
      });
      const to = r.channel === "sms" ? normPhone(r.phone) : normEmail(r.email);
      // 예약을 만든 뒤에 연락처가 지워졌을 수 있다 — 빈 주소로는 보내지 않는다.
      if (!to) { await skip("수신 연락처가 없습니다"); continue; }

      // ── 전송 직전 마스터 스위치 재확인 ──
      //   실행 시작 때 읽어 둔 값이 아니라 DB 를 다시 본다. 조회가 안 되면 보내지 않는다(fail closed).
      //   이미 외부 provider 로 넘어간 요청은 여기서 취소할 수 없다 — 다음 건부터 멈춘다.
      const live = await liveSendEnabled();
      if (!live.ok) { abort = `마스터 스위치 확인 실패 — 보내지 않고 중단했습니다(${(live.error ?? "").slice(0, 80)})`; break; }
      if (!live.enabled) { abort = "실행 중 자동발송 마스터 스위치가 꺼져 중단했습니다"; break; }

      // ── 보낼 내용을 먼저 남긴다 ──
      //   기록을 남기지 못하면 전송하지 않는다(기록 없는 발송을 만들지 않는다).
      const logId = await beginAttempt({
        sendId: r.id, sessionId: r.session_id, targetId: r.target_id, runId: run,
        stage: r.stage, channel: r.channel, attemptNo: r.attempts,
        toMasked: maskTo(r.channel, to), subject: msg.subject, body: msg.body, purpose: tpl.purpose,
      });
      if (!logId) { await noSend("발송 기록을 남기지 못해 보내지 않았습니다"); continue; }

      const outcome = await transmit(r.channel, to, msg);
      await finishAttempt(logId, outcome);
      handled.add(r.id);
      if (outcome.ok) {
        await query(
          `UPDATE seminar_sends SET status='sent', sent_at=now(), provider=$2, provider_id=$3,
                  error='', updated_at=now() WHERE id=$1`,
          [r.id, outcome.provider.slice(0, 40), (outcome.providerId ?? "").slice(0, 200)]);
        res.sent += 1;
      } else if (r.attempts >= cfg.maxAttempts) {
        await query(
          "UPDATE seminar_sends SET status='failed', error=$2, updated_at=now() WHERE id=$1",
          [r.id, (outcome.error ?? "발송 실패").slice(0, 300)]);
        res.failed += 1;
      } else {
        // 재시도 — 다음 시도까지 시도 횟수만큼 뒤로 민다(5·10·15분).
        const backoff = Math.min(r.attempts, 6) * 5 * 60_000;
        await query(
          `UPDATE seminar_sends SET status='queued', error=$2, due_at=$3, updated_at=now() WHERE id=$1`,
          [r.id, (outcome.error ?? "발송 실패").slice(0, 300), new Date(now.getTime() + backoff).toISOString()]);
        res.retry += 1;
      }
    }
    if (abort) {
      // 아직 손대지 않은 선점 건만 예약으로 되돌린다.
      //   · claimed_by 로 "이 실행이 잡은 것"만 고른다 — 다른 실행의 선점은 건드리지 않는다.
      //   · 이미 시도한 건(handled)은 제외하고, attempts·기록도 되돌리지 않는다.
      const pending = claimed.map((c) => c.id).filter((id) => !handled.has(id));
      let released = 0;
      if (pending.length) {
        const back = await query<{ id: string }>(
          `UPDATE seminar_sends SET status='queued', updated_at=now()
            WHERE id = ANY($1::uuid[]) AND status='sending' AND claimed_by = $2::uuid
            RETURNING id`, [pending, run]).catch(() => []);
        released = back.length;
      }
      const summary = `${abort} · 발송 ${res.sent} · 실패 ${res.failed} · 제외 ${res.skipped} · 재시도 ${res.retry} · 미처리 반환 ${released}`;
      await finishRun(run, "done", summary);
      return { ...res, blocked: [abort] };
    }

    await finishRun(run, "done",
      `대상 ${res.due} · 발송 ${res.sent} · 실패 ${res.failed} · 제외 ${res.skipped} · 재시도 ${res.retry}`);
    return res;
  } catch (e) {
    await finishRun(run, "error", "", (e as Error).message.slice(0, 300));
    return { ...res, ok: false, error: (e as Error).message.slice(0, 300) };
  }
}

interface Outcome { ok: boolean; provider: string; providerId?: string; error?: string }

/**
 * 전송 직전에 보는 "지금의" 마스터 스위치.
 *   실행 시작 때 읽어 둔 설정이 아니라 DB 를 다시 읽는다.
 *   조회가 실패하면 켜져 있다고 보지 않는다(fail closed) — 호출부가 중단한다.
 */
async function liveSendEnabled(): Promise<{ ok: boolean; enabled: boolean; error?: string }> {
  try {
    const r = await queryOne<{ enabled: boolean }>("SELECT enabled FROM seminar_config WHERE id=1");
    if (!r) return { ok: false, enabled: false, error: "설정 행이 없습니다" };
    return { ok: true, enabled: Boolean(r.enabled) };
  } catch (e) {
    return { ok: false, enabled: false, error: (e as Error).message.slice(0, 160) };
  }
}

/**
 * 실제 전송. 조립은 composeSeminarMessage 가 이미 끝냈고, 여기서는 보내기만 한다.
 *   provider 와 메시지 id 를 그대로 돌려준다(원장·시도 기록에 남긴다).
 */
async function transmit(channel: SeminarChannel, to: string, msg: ComposedMessage): Promise<Outcome> {
  if (channel === "sms") {
    const { sendSms } = await import("./sms");
    const out = await sendSms({ receiver: to, msg: msg.body, title: "GloveK 세미나" })
      .catch((e) => ({ ok: false, message: (e as Error).message } as { ok: boolean; message: string; msgId?: string }));
    return { ok: out.ok, provider: "aligo", providerId: out.msgId, error: out.ok ? undefined : out.message };
  }
  const { sendEmail } = await import("./mailer");
  const out = await sendEmail({ to, subject: msg.subject, text: msg.body })
    .catch((e) => ({ ok: false, error: (e as Error).message } as { ok: boolean; error?: string; id?: string; via?: string }));
  return { ok: out.ok, provider: out.via ?? "mail", providerId: out.id, error: out.ok ? undefined : (out.error ?? "발송 실패") };
}

/** 멈춘 선점·실행 잠금을 되돌린다(프로세스가 중간에 죽어도 다음 실행이 이어받게). */
export async function releaseStale(now = new Date()): Promise<{ sends: number; runs: number }> {
  const sends = await query<{ id: string }>(
    `UPDATE seminar_sends SET status='queued', updated_at=now()
      WHERE status='sending' AND claimed_at < $1 RETURNING id`,
    [new Date(now.getTime() - SEND_CLAIM_STALE_MIN * 60_000).toISOString()]).catch(() => []);
  const runs = await query<{ id: string }>(
    `UPDATE seminar_runs SET status='error', finished_at=now(), error='실행이 끝나지 않아 회수됨'
      WHERE status='running' AND started_at < $1 RETURNING id`,
    [new Date(now.getTime() - RUN_STALE_MIN * 60_000).toISOString()]).catch(() => []);
  return { sends: sends.length, runs: runs.length };
}

async function startRun(kind: "build" | "dispatch", by: string): Promise<string | null> {
  try {
    const r = await queryOne<{ id: string }>(
      "INSERT INTO seminar_runs (kind, triggered_by) VALUES ($1,$2) RETURNING id", [kind, by]);
    return r?.id ?? null;
  } catch (e) {
    if (/seminar_runs_one_running/.test((e as Error).message)) return null;  // 이미 실행 중
    throw e;
  }
}
async function finishRun(id: string, status: "done" | "error", summary: string, error?: string): Promise<void> {
  await query(
    "UPDATE seminar_runs SET status=$2, finished_at=now(), summary=$3, error=$4 WHERE id=$1",
    [id, status, summary, error ?? null]).catch(() => {});
}

// ── 조회(어드민 화면) ───────────────────────────────────────
export interface SendRow {
  id: string; stage: SeminarStage; channel: SeminarChannel; status: string;
  due_at: string; sent_at: string | null; attempts: number;
  provider: string; provider_id: string; error: string; skip_reason: string;
  brand_name: string; contact_name: string; email: string; phone: string;
  /** 보낸 내용 기록 수. 0 이면 기록 없음(0111 적용 전 발송). */
  log_count: number;
}
export async function listSessionSends(sessionId: string, limit = 500): Promise<SendRow[]> {
  // log_count = 보낸 내용 기록 수. 0 이면 화면에 "기록 없음"으로 보인다
  //   (0111 적용 전에 나간 건은 소급 생성하지 않는다).
  return query<SendRow>(
    `SELECT s.id, s.stage, s.channel, s.status, s.due_at::text AS due_at, s.sent_at::text AS sent_at,
            s.attempts, s.provider, s.provider_id, s.error, s.skip_reason,
            t.brand_name, t.contact_name, t.email, t.phone,
            (SELECT count(*) FROM seminar_send_attempts a WHERE a.send_id = s.id)::int AS log_count
       FROM seminar_sends s JOIN seminar_targets t ON t.id = s.target_id
      WHERE s.session_id=$1
      ORDER BY s.stage DESC, s.due_at, t.brand_name
      LIMIT $2`, [sessionId, limit])
    .catch(async () => query<SendRow>(
      // 0111 미적용 DB 에서도 목록이 깨지지 않게.
      `SELECT s.id, s.stage, s.channel, s.status, s.due_at::text AS due_at, s.sent_at::text AS sent_at,
              s.attempts, s.provider, s.provider_id, s.error, s.skip_reason,
              t.brand_name, t.contact_name, t.email, t.phone, 0 AS log_count
         FROM seminar_sends s JOIN seminar_targets t ON t.id = s.target_id
        WHERE s.session_id=$1
        ORDER BY s.stage DESC, s.due_at, t.brand_name
        LIMIT $2`, [sessionId, limit]));
}

export interface TargetRow {
  id: string; brand_id: string; brand_name: string; contact_name: string;
  email: string; phone: string; applied_at: string; source_key: string;
  status: TargetStatus; exclude_reason: string; late: boolean;
}
export async function listSessionTargets(sessionId: string, limit = 500): Promise<TargetRow[]> {
  return query<TargetRow>(
    `SELECT id, brand_id, brand_name, contact_name, email, phone,
            applied_at::text AS applied_at, source_key, status, exclude_reason, late
       FROM seminar_targets WHERE session_id=$1
      ORDER BY status, applied_at LIMIT $2`, [sessionId, limit]);
}

export async function listRuns(limit = 10): Promise<{ id: string; kind: string; status: string; started_at: string; finished_at: string | null; summary: string; error: string | null; triggered_by: string }[]> {
  return query(`SELECT id, kind, status, started_at::text AS started_at, finished_at::text AS finished_at,
                       summary, error, triggered_by
                  FROM seminar_runs ORDER BY started_at DESC LIMIT $1`, [limit]);
}

/** 다음 회차 날짜(KST). 첫 회차 이전으로는 내려가지 않는다. 화면 기본값·크론이 함께 쓴다. */
export function upcomingSessionDate(cfg: SeminarConfig, now = new Date()): string {
  const next = nextSessionDate(now, cfg);
  return cfg.firstSessionDate && next < cfg.firstSessionDate ? cfg.firstSessionDate : next;
}

/** 발송 없이 대상만 계산해 보여준다(미리보기). DB 를 바꾸지 않는다. */
export interface PreviewResult {
  sessionDate: string;
  startsAt: string; followupAt: string; noticeDueAt: string;
  windowFrom: string; windowTo: string;
  targets: PlannedTarget[];
  unclassified: number;
  blockers: string[];
}
export async function previewSession(sessionDate: string, now = new Date()): Promise<PreviewResult> {
  const cfg = await getSeminarConfig();
  const saved = await queryOne<SessionRow>(`SELECT ${SESSION_COLS} FROM seminar_sessions WHERE session_date=$1`, [sessionDate]);
  const s = saved ? sessionOf(saved) : buildSession(sessionDate, cfg);
  const keys = saved?.source_keys ?? cfg.sourceKeys;
  const applicants = await applicantsInWindow(keys, s.windowFrom, s.windowTo);
  const targets = planTargets(applicants, s, { ...cfg, dedupeScope: saved?.dedupe_scope ?? cfg.dedupeScope }, now);
  const unclassified = await unclassifiedLeadCount(s.windowFrom, s.windowTo).catch(() => 0);
  const tpls = await listSeminarTemplates();
  const blockers = new Set<string>();
  if (!cfg.enabled) blockers.add("자동발송 마스터 스위치가 꺼져 있습니다");
  if (!isHttpUrl(saved?.zoom_url || cfg.zoomUrl)) blockers.add("고정 Zoom 링크가 설정되지 않았습니다");
  for (const t of tpls) if (!t.enabled) blockers.add(`${t.stage === "notice" ? "안내" : "후속"} 문구가 아직 초안(비활성)입니다`);
  return {
    sessionDate,
    startsAt: s.startsAt.toISOString(), followupAt: s.followupAt.toISOString(),
    noticeDueAt: s.noticeDueAt.toISOString(),
    windowFrom: s.windowFrom.toISOString(), windowTo: s.windowTo.toISOString(),
    targets, unclassified, blockers: [...blockers],
  };
}

export { shiftDay, atKst };
