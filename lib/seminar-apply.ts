// 「브랜드 해외매출 실행전략 세미나」 공개 신청 — DB.
//   같은 세미나를 4회 운영하고 신청자는 1개 회차를 고른다.
//
//   일부러 하지 않는 것
//     · 전체 신청에 상한을 두지 않는다. 30명 상한은 "선정"에만 적용한다
//       (기존 세미나 모집 허브의 REG_OCCUPYING 정책과 별개이며 그쪽은 그대로 둔다).
//     · 선착순 자동선정을 하지 않는다 — 저장 기본 상태는 submitted 다.
//     · 신청 시 메일·문자를 보내지 않는다. 선정 안내·Zoom 링크도 초안까지만 만든다.
//     · ad_optouts(수신거부 명단)를 쓰거나 고치지 않는다 — 광고 동의는 이 표에만 기록한다.
//     · brands 원장을 만들거나 고치지 않는다. 연결은 관리자가 확인한 뒤에만 건다.
import { createHash } from "node:crypto";
import { query, queryOne, tx } from "./db";
import {
  CONSENT_VERSION, SAP_MIGRATION, SELECT_CAP_DEFAULT,
  formBlockers, toRow, normalizeEmail, clean,
  requiredExpiryIso, adsExpiryIso, RETENTION_DEFAULT, type RetentionPolicy,
  type SapFormInput, type SapStatus, isSapStatus,
} from "./seminar-apply-model";

export { SAP_MIGRATION };

// ── 스키마 확인 ──────────────────────────────────────────────
export interface SapSchemaState { ready: boolean; missing: string[]; error?: string }
export async function sapSchemaState(): Promise<SapSchemaState> {
  const need = ["sap_config", "sap_sessions", "sap_registrations", "sap_reg_events",
    "sap_consent_events", "sap_rate_hits"];
  try {
    const rows = await query<{ t: string; ok: boolean }>(
      `SELECT t, to_regclass('public.' || t) IS NOT NULL AS ok FROM unnest($1::text[]) AS t`, [need]);
    const missing = need.filter((t) => !rows.find((r) => r.t === t && r.ok));
    return { ready: missing.length === 0, missing };
  } catch (e) {
    return { ready: false, missing: need, error: (e as Error).message.slice(0, 160) };
  }
}

// ── 설정 ─────────────────────────────────────────────────────
export interface SapConfig {
  title: string; tagline: string; summary: string; curriculum_md: string;
  apply_open: boolean; send_enabled: boolean; auto_ack_enabled: boolean;
  org_legal_name: string; org_rep_name: string; org_address: string; org_biz_no: string;
  privacy_contact_email: string; privacy_contact_phone: string;
  retention_required: string; retention_ads: string;
  retention_base_date: string; retention_required_months: number; retention_ads_months: number;
  consent_version: string;
}
const CFG_COLS = `title, tagline, summary, curriculum_md, apply_open, send_enabled, auto_ack_enabled,
  org_legal_name, org_rep_name, org_address, org_biz_no, privacy_contact_email, privacy_contact_phone,
  retention_required, retention_ads, retention_base_date::text AS retention_base_date,
  retention_required_months, retention_ads_months, consent_version`;

/** 설정을 읽는다. 조회 실패를 기본값으로 숨기지 않고 던진다. */
export async function getSapConfig(): Promise<SapConfig> {
  const r = await queryOne<SapConfig>(`SELECT ${CFG_COLS} FROM sap_config WHERE id=1`);
  if (!r) throw new Error("세미나 신청 설정(sap_config)이 없습니다.");
  return r;
}
function policyOf(c: SapConfig): RetentionPolicy {
  return {
    baseDate: c.retention_base_date || RETENTION_DEFAULT.baseDate,
    requiredMonths: c.retention_required_months || RETENTION_DEFAULT.requiredMonths,
    adsMonths: c.retention_ads_months || RETENTION_DEFAULT.adsMonths,
  };
}

// ── 회차 ─────────────────────────────────────────────────────
/** 공개 화면용 — Zoom 링크를 담지 않는다. */
export interface PublicSession {
  id: string; session_no: number; starts_at: string; ends_at: string;
  active: boolean; select_cap: number;
}
export async function listPublicSessions(): Promise<PublicSession[]> {
  return query<PublicSession>(
    `SELECT id::text AS id, session_no, starts_at::text AS starts_at, ends_at::text AS ends_at,
            active, select_cap
       FROM sap_sessions WHERE active = true ORDER BY starts_at`);
}

/** 관리자용 — Zoom 링크를 포함한다. 호출 전에 권한을 검사해야 한다. */
export interface AdminSession extends PublicSession {
  zoom_url: string; zoom_note: string;
  submitted: number; selected: number; waitlisted: number; not_selected: number; cancelled: number;
}
export async function listAdminSessions(): Promise<AdminSession[]> {
  return query<AdminSession>(
    `SELECT s.id::text AS id, s.session_no, s.starts_at::text AS starts_at, s.ends_at::text AS ends_at,
            s.active, s.select_cap, s.zoom_url, s.zoom_note,
            count(*) FILTER (WHERE r.status='submitted')::int    AS submitted,
            count(*) FILTER (WHERE r.status='selected')::int     AS selected,
            count(*) FILTER (WHERE r.status='waitlisted')::int   AS waitlisted,
            count(*) FILTER (WHERE r.status='not_selected')::int AS not_selected,
            count(*) FILTER (WHERE r.status='cancelled')::int    AS cancelled
       FROM sap_sessions s
       LEFT JOIN sap_registrations r ON r.session_id = s.id
      GROUP BY s.id ORDER BY s.starts_at`);
}

export async function setSessionZoom(sessionId: string, url: string, note: string, actor: string):
  Promise<{ ok: boolean; error?: string }> {
  const v = url.trim();
  if (v && !/^https?:\/\//i.test(v)) return { ok: false, error: "http(s) 로 시작하는 주소만 저장합니다." };
  try {
    // 링크 원문은 로그·이력에 남기지 않는다.
    await query(
      `UPDATE sap_sessions SET zoom_url=$2, zoom_note=$3, updated_at=now() WHERE id=$1::uuid`,
      [sessionId, v.slice(0, 500), clean(note, 300)]);
    void actor;
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `저장 실패 — ${(e as Error).message.slice(0, 160)}` };
  }
}

export async function setSessionActive(sessionId: string, active: boolean): Promise<void> {
  await query("UPDATE sap_sessions SET active=$2, updated_at=now() WHERE id=$1::uuid", [sessionId, active]);
}
export async function setSessionCap(sessionId: string, cap: number): Promise<{ ok: boolean; error?: string }> {
  const n = Math.floor(Number(cap));
  if (!Number.isInteger(n) || n < 1 || n > 1000) return { ok: false, error: "선정 상한은 1~1000 사이로 넣어 주세요." };
  await query("UPDATE sap_sessions SET select_cap=$2, updated_at=now() WHERE id=$1::uuid", [sessionId, n]);
  return { ok: true };
}

// ── 제출 속도 제한 ───────────────────────────────────────────
//   IP 원문을 저장하지 않는다 — 해시 + 분 단위 버킷만 둔다.
const RATE_MAX = 5;          // 같은 IP 에서 10분에 5건
const RATE_WINDOW_MIN = 10;

function rateBucket(ip: string): string {
  const h = createHash("sha256").update(`sap:${ip}`).digest("hex").slice(0, 24);
  const slot = Math.floor(Date.now() / (RATE_WINDOW_MIN * 60_000));
  return `${h}:${slot}`;
}
/** 한도를 넘으면 false. 조회·기록이 실패하면 통과시킨다(접수를 막는 쪽이 더 큰 손해다). */
export async function rateOk(ip: string): Promise<boolean> {
  if (!ip) return true;
  try {
    const r = await queryOne<{ n: number }>(
      `INSERT INTO sap_rate_hits (bucket) VALUES ($1)
       ON CONFLICT (bucket) DO UPDATE SET n = sap_rate_hits.n + 1, at = now()
       RETURNING n`, [rateBucket(ip)]);
    return (r?.n ?? 1) <= RATE_MAX;
  } catch { return true; }
}

// ── 신청 제출 ────────────────────────────────────────────────
export interface SubmitMeta {
  ip?: string;
  source?: string; utmSource?: string; utmMedium?: string; utmCampaign?: string; campaignId?: string;
  isTest?: boolean;
}
export interface SubmitResult {
  ok: boolean;
  error?: string;
  /** 같은 회차에 같은 이메일로 이미 접수된 경우. 기존 신청자의 개인정보는 돌려주지 않는다. */
  already?: boolean;
  /** 저장이 끝난 뒤에만 참을 돌려준다 — 화면은 이 값으로 성공을 표시한다. */
  saved?: boolean;
}

export async function submitApplication(input: SapFormInput, meta: SubmitMeta = {}): Promise<SubmitResult> {
  // 봇 미끼 — 사람이 채우지 않는 칸에 값이 있으면 저장하지 않는다.
  if (clean(input.trap, 200)) return { ok: false, error: "잠시 후 다시 시도해 주세요." };

  const blockers = formBlockers(input);
  if (blockers.length) return { ok: false, error: blockers[0] };

  let cfg: SapConfig;
  try { cfg = await getSapConfig(); }
  catch (e) { return { ok: false, error: `신청을 처리할 수 없습니다 — ${(e as Error).message.slice(0, 120)}` }; }
  if (!cfg.apply_open) return { ok: false, error: "현재 신청을 받지 않고 있습니다." };

  if (!(await rateOk(meta.ip ?? ""))) {
    return { ok: false, error: "요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요." };
  }

  const row = toRow(input);
  const pol = policyOf(cfg);
  const now = new Date();
  const reqExpiry = requiredExpiryIso(pol);
  const adsExpiry = row.consentAds ? adsExpiryIso(now, pol) : null;
  const version = cfg.consent_version || CONSENT_VERSION;

  try {
    return await tx(async (c) => {
      const ses = await c.query(
        "SELECT id::text AS id FROM sap_sessions WHERE session_no=$1 AND active=true", [row.sessionNo]);
      if (ses.rows.length === 0) return { ok: false, error: "선택하신 회차는 현재 신청을 받지 않습니다." };
      const sessionId = (ses.rows[0] as { id: string }).id;

      // 전체 접수에는 상한을 두지 않는다 — 정원 검사를 여기서 하지 않는다(선정 단계에만 있다).
      const ins = await c.query(
        `INSERT INTO sap_registrations (
           session_id, company_name, brand_name, no_brand, contact_name, job_role, job_role_etc,
           email, email_norm, product_category, overseas_stage, target_countries, question,
           phone, site_url, selling_countries, selling_channels, revenue_band, overseas_revenue_band,
           export_timing, support_areas, wants_consult, biz_no,
           consent_required, consent_required_at, consent_optional, consent_optional_at,
           consent_ads, consent_ads_at, consent_version,
           consent_required_expires_at, consent_ads_expires_at,
           source, utm_source, utm_medium, utm_campaign, campaign_id, is_test)
         VALUES ($1::uuid,$2,$3,$4,$5,$6,$7,
                 $8,$9,$10,$11,$12,$13,
                 $14,$15,$16,$17,$18,$19,
                 $20,$21,$22,$23,
                 true,$24::timestamptz,$25,CASE WHEN $25 THEN $24::timestamptz END,
                 $26,CASE WHEN $26 THEN $24::timestamptz END,$27,
                 $28::timestamptz,$29::timestamptz,
                 $30,$31,$32,$33,$34,$35)
         ON CONFLICT (session_id, email_norm) DO NOTHING
         RETURNING id::text AS id`,
        [sessionId, row.companyName, row.brandName, row.noBrand, row.contactName, row.jobRole, row.jobRoleEtc,
          row.email, row.emailNorm, row.productCategory, row.overseasStage, row.targetCountries, row.question,
          row.phone, row.siteUrl, row.sellingCountries, row.sellingChannels, row.revenueBand, row.overseasRevenueBand,
          row.exportTiming, row.supportAreas, row.wantsConsult, row.bizNo,
          now.toISOString(), row.consentOptional, row.consentAds, version,
          reqExpiry, adsExpiry,
          clean(meta.source, 60) || "seminar_apply", clean(meta.utmSource, 80), clean(meta.utmMedium, 80),
          clean(meta.utmCampaign, 120), clean(meta.campaignId, 120), Boolean(meta.isTest)]);

      if (ins.rows.length === 0) {
        // 같은 회차 + 같은 이메일 — 다시 저장하지 않고, 기존 신청자 정보도 돌려주지 않는다.
        return { ok: true, already: true, saved: false };
      }
      const id = (ins.rows[0] as { id: string }).id;

      // 동의 이력 — 셋 다 남긴다(동의하지 않은 것도 "거부"로 남아야 근거가 된다).
      for (const [kind, granted] of [
        ["required", true], ["optional", row.consentOptional], ["ads", row.consentAds],
      ] as [string, boolean][]) {
        await c.query(
          `INSERT INTO sap_consent_events (registration_id, kind, granted, consent_version, actor)
           VALUES ($1::uuid,$2,$3,$4,'applicant')`, [id, kind, granted, version]);
      }
      await c.query(
        `INSERT INTO sap_reg_events (registration_id, field, old_value, new_value, actor)
         VALUES ($1::uuid,'status','','submitted','applicant')`, [id]);

      return { ok: true, already: false, saved: true };
    });
  } catch (e) {
    // 저장이 끝나지 않았으면 성공으로 보여주지 않는다. 다시 시도할 수 있게 사유만 알린다.
    return { ok: false, error: `저장하지 못했습니다. 잠시 후 다시 시도해 주세요. (${(e as Error).message.slice(0, 120)})` };
  }
}

// ── 선정 ─────────────────────────────────────────────────────
export interface SelectResult { ok: boolean; error?: string; note?: string; selected?: number; cap?: number }

/**
 * 상태 변경. 선정(selected)은 회차 상한을 서버 트랜잭션으로 강제한다.
 *   회차 행을 FOR UPDATE 로 잠그고 현재 선정 수를 다시 센 뒤에 올린다 —
 *   동시에 두 명을 선정해도 31번째는 거부된다.
 */
export async function setRegStatus(
  regId: string, next: string, reason: string, actor: string,
): Promise<SelectResult> {
  if (!isSapStatus(next)) return { ok: false, error: "상태값을 확인해 주세요." };
  try {
    return await tx(async (c) => {
      const cur = await c.query(
        `SELECT r.id::text AS id, r.status, r.session_id::text AS session_id
           FROM sap_registrations r WHERE r.id=$1::uuid FOR UPDATE`, [regId]);
      if (cur.rows.length === 0) return { ok: false, error: "신청을 찾지 못했습니다." };
      const row = cur.rows[0] as { status: SapStatus; session_id: string };
      if (row.status === next) return { ok: true, note: "이미 같은 상태입니다." };

      // 회차 행을 잠그고 센다 — 상한 검사와 상태 변경이 같은 트랜잭션에 있어야 한다.
      const ses = await c.query(
        "SELECT select_cap FROM sap_sessions WHERE id=$1::uuid FOR UPDATE", [row.session_id]);
      if (ses.rows.length === 0) return { ok: false, error: "회차를 찾지 못했습니다." };
      const cap = (ses.rows[0] as { select_cap: number }).select_cap ?? SELECT_CAP_DEFAULT;

      const cnt = await c.query(
        "SELECT count(*)::int AS n FROM sap_registrations WHERE session_id=$1::uuid AND status='selected'",
        [row.session_id]);
      const selected = (cnt.rows[0] as { n: number }).n;

      if (next === "selected" && selected >= cap) {
        return {
          ok: false, selected, cap,
          error: `이 회차의 선정 상한(${cap}명)이 이미 찼습니다. 대기로 두거나 다른 선정을 내려 주세요.`,
        };
      }

      await c.query(
        `UPDATE sap_registrations
            SET status=$2, status_reason=$3, updated_at=now(),
                selected_at = CASE WHEN $2='selected' THEN now() ELSE selected_at END
          WHERE id=$1::uuid`, [regId, next, clean(reason, 300)]);
      await c.query(
        `INSERT INTO sap_reg_events (registration_id, field, old_value, new_value, reason, actor)
         VALUES ($1::uuid,'status',$2,$3,$4,$5)`, [regId, row.status, next, clean(reason, 300), actor]);

      const after = next === "selected" ? selected + 1 : (row.status === "selected" ? selected - 1 : selected);
      return { ok: true, selected: after, cap, note: `상태를 ${next} 로 바꿨습니다.` };
    });
  } catch (e) {
    return { ok: false, error: `변경 실패 — ${(e as Error).message.slice(0, 160)}` };
  }
}

/** 광고 동의 철회 — 앞선 동의 기록을 고치지 않고 철회 시각만 남긴다. */
export async function withdrawAdsConsent(regId: string, actor: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const cfg = await getSapConfig();
    const r = await queryOne<{ id: string }>(
      `UPDATE sap_registrations
          SET consent_ads=false, consent_ads_withdrawn_at=now(), updated_at=now()
        WHERE id=$1::uuid AND consent_ads = true
        RETURNING id::text AS id`, [regId]);
    if (!r) return { ok: false, error: "광고 수신에 동의한 신청이 아닙니다." };
    await query(
      `INSERT INTO sap_consent_events (registration_id, kind, granted, consent_version, actor)
       VALUES ($1::uuid,'ads',false,$2,$3)`, [regId, cfg.consent_version || CONSENT_VERSION, actor]);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `철회 처리 실패 — ${(e as Error).message.slice(0, 160)}` };
  }
}

// ── 관리자 목록 ──────────────────────────────────────────────
export interface RegRow {
  id: string; session_no: number; session_starts_at: string;
  company_name: string; brand_name: string; no_brand: boolean;
  contact_name: string; job_role: string; job_role_etc: string;
  email: string; phone: string; site_url: string;
  product_category: string; overseas_stage: string; target_countries: string; question: string;
  selling_countries: string; selling_channels: string;
  revenue_band: string; overseas_revenue_band: string; export_timing: string; support_areas: string;
  wants_consult: boolean; biz_no: string;
  consent_optional: boolean; consent_ads: boolean; consent_version: string;
  consent_required_expires_at: string | null; consent_ads_expires_at: string | null;
  consent_ads_withdrawn_at: string | null;
  status: SapStatus; status_reason: string; admin_note: string;
  source: string; utm_source: string; utm_campaign: string; campaign_id: string;
  brand_id: string | null; is_test: boolean; created_at: string;
}
export interface RegList { rows: RegRow[]; total: number; page: number; pageSize: number; pages: number }

const REG_COLS = `r.id::text AS id, s.session_no, s.starts_at::text AS session_starts_at,
  r.company_name, r.brand_name, r.no_brand, r.contact_name, r.job_role, r.job_role_etc,
  r.email, r.phone, r.site_url, r.product_category, r.overseas_stage, r.target_countries, r.question,
  r.selling_countries, r.selling_channels, r.revenue_band, r.overseas_revenue_band,
  r.export_timing, r.support_areas, r.wants_consult, r.biz_no,
  r.consent_optional, r.consent_ads, r.consent_version,
  r.consent_required_expires_at::text AS consent_required_expires_at,
  r.consent_ads_expires_at::text AS consent_ads_expires_at,
  r.consent_ads_withdrawn_at::text AS consent_ads_withdrawn_at,
  r.status, r.status_reason, r.admin_note,
  r.source, r.utm_source, r.utm_campaign, r.campaign_id,
  r.brand_id::text AS brand_id, r.is_test, r.created_at::text AS created_at`;

export async function listRegistrations(
  opts: { sessionNo?: number; status?: string; q?: string; consult?: boolean; page?: number; pageSize?: number } = {},
): Promise<RegList> {
  const pageSize = Math.min(200, Math.max(10, opts.pageSize ?? 50));
  const page = Math.max(1, Math.floor(opts.page ?? 1));
  const where: string[] = ["true"];
  const vals: unknown[] = [];

  if (Number.isInteger(opts.sessionNo)) { vals.push(opts.sessionNo); where.push(`s.session_no = $${vals.length}`); }
  if (isSapStatus(opts.status)) { vals.push(opts.status); where.push(`r.status = $${vals.length}`); }
  if (opts.consult) where.push("r.wants_consult = true");
  const q = (opts.q ?? "").trim();
  if (q) {
    // 회사·브랜드·담당자는 부분 검색, 이메일은 정규화해 정확히 일치하는 건만.
    vals.push(`%${q.replace(/[%_]/g, (m) => `\\${m}`)}%`);
    const like = `$${vals.length}`;
    vals.push(normalizeEmail(q));
    const em = `$${vals.length}`;
    where.push(`(r.company_name ILIKE ${like} OR r.brand_name ILIKE ${like}
                 OR r.contact_name ILIKE ${like} OR r.email_norm = ${em})`);
  }
  const cond = `WHERE ${where.join(" AND ")}`;
  const cnt = await queryOne<{ n: string }>(
    `SELECT count(*)::text AS n FROM sap_registrations r
       JOIN sap_sessions s ON s.id = r.session_id ${cond}`, vals);
  const total = Number(cnt?.n ?? "0");
  const rows = await query<RegRow>(
    `SELECT ${REG_COLS} FROM sap_registrations r
       JOIN sap_sessions s ON s.id = r.session_id
       ${cond}
      ORDER BY r.created_at DESC
      LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`, vals);
  return { rows, total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)) };
}

export interface RegEventRow { id: string; field: string; old_value: string; new_value: string; reason: string; actor: string; at: string }
export async function listRegEvents(regId: string, limit = 50): Promise<RegEventRow[]> {
  return query<RegEventRow>(
    `SELECT id::text AS id, field, old_value, new_value, reason, actor, at::text AS at
       FROM sap_reg_events WHERE registration_id=$1::uuid ORDER BY at DESC LIMIT $2`,
    [regId, Math.min(200, Math.max(1, limit))]);
}

export async function setRegNote(regId: string, note: string, actor: string): Promise<void> {
  await query("UPDATE sap_registrations SET admin_note=$2, updated_at=now() WHERE id=$1::uuid",
    [regId, clean(note, 1000)]);
  await query(
    `INSERT INTO sap_reg_events (registration_id, field, new_value, actor)
     VALUES ($1::uuid,'admin_note','(변경)',$2)`, [regId, actor]).catch(() => {});
}

/**
 * 기존 고객 원장 연결 — 관리자가 확인한 뒤에만 건다.
 *   원장(brands)의 값을 고치지 않는다. 이 표의 brand_id 만 채운다(비파괴적).
 */
export async function linkBrand(regId: string, brandId: string, actor: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const b = await queryOne<{ id: string }>("SELECT id::text AS id FROM brands WHERE id=$1::uuid", [brandId]);
    if (!b) return { ok: false, error: "해당 브랜드를 찾지 못했습니다." };
    await query(
      `UPDATE sap_registrations SET brand_id=$2::uuid, matched_at=now(), matched_by=$3, updated_at=now()
        WHERE id=$1::uuid`, [regId, brandId, clean(actor, 120)]);
    await query(
      `INSERT INTO sap_reg_events (registration_id, field, new_value, actor)
       VALUES ($1::uuid,'brand_id','(연결)',$2)`, [regId, actor]).catch(() => {});
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `연결 실패 — ${(e as Error).message.slice(0, 160)}` };
  }
}

/** 원장 연결 후보 — 이메일 정확일치 또는 회사명 일치. 자동으로 연결하지 않고 후보만 보여준다. */
export interface MatchCandidate { id: string; brand_name: string; company_name: string | null; why: string }
export async function matchCandidates(regId: string): Promise<MatchCandidate[]> {
  const r = await queryOne<{ email_norm: string; company_name: string; brand_name: string }>(
    "SELECT email_norm, company_name, brand_name FROM sap_registrations WHERE id=$1::uuid", [regId]);
  if (!r) return [];
  return query<MatchCandidate>(
    `SELECT b.id::text AS id, b.brand_name, NULL::text AS company_name,
            CASE WHEN lower(trim(b.email)) = $1 THEN '업무 이메일 일치' ELSE '회사·브랜드명 일치' END AS why
       FROM brands b
      WHERE (lower(trim(b.email)) = $1 AND $1 <> '')
         OR (b.brand_name <> '' AND ($2 <> '' AND b.brand_name = $2))
         OR (b.brand_name <> '' AND ($3 <> '' AND b.brand_name = $3))
      LIMIT 10`, [r.email_norm, r.company_name, r.brand_name]).catch(() => []);
}

// ── 보유기간 만료 현황 ───────────────────────────────────────
//   세어서 보여주기만 한다 — 이 함수는 아무것도 지우지 않는다.
export interface ExpiryState { requiredDue: number; adsDue: number; asOf: string }
export async function expiryState(now = new Date()): Promise<ExpiryState> {
  const r = await queryOne<{ req: number; ads: number }>(
    `SELECT count(*) FILTER (WHERE consent_required_expires_at IS NOT NULL
                               AND consent_required_expires_at <= $1::timestamptz)::int AS req,
            count(*) FILTER (WHERE consent_ads = true AND consent_ads_expires_at IS NOT NULL
                               AND consent_ads_expires_at <= $1::timestamptz)::int AS ads
       FROM sap_registrations`, [now.toISOString()]);
  return { requiredDue: r?.req ?? 0, adsDue: r?.ads ?? 0, asOf: now.toISOString() };
}

// ── 검수용 합성 신청 ─────────────────────────────────────────
/** 관리자가 화면·저장을 확인할 때 쓰는 테스트 표시 데이터. 공개 경로에서는 호출하지 않는다. */
export async function addTestRegistration(sessionNo: number, actor: string): Promise<SubmitResult> {
  const stamp = Date.now().toString(36);
  return submitApplication({
    sessionNo,
    companyName: "TEST 합성회사",
    brandName: "TEST 합성브랜드",
    contactName: "TEST 담당자",
    jobRole: "해외영업",
    email: `sap-test-${stamp}@example.invalid`,
    productCategory: "뷰티·화장품",
    overseasStage: "준비 중(상품·인증 점검)",
    targetCountries: ["일본"],
    question: `검수용 합성 데이터 — ${clean(actor, 60)}`,
    consentRequired: true,
  }, { isTest: true, source: "qa_admin" });
}

/** 합성 데이터만 지운다(is_test=true). 실제 신청은 건드리지 않는다. */
export async function deleteTestRegistrations(): Promise<number> {
  const r = await query<{ id: string }>(
    "DELETE FROM sap_registrations WHERE is_test = true RETURNING id::text AS id");
  return r.length;
}
