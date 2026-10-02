// 세미나 모집 허브 — 행사·포스터·신청자 저장/조회.
//
//   이 파일은 sev_* 표와 admin_users(담당자 확인) 밖의 어떤 표도 읽거나 쓰지 않는다.
//   일부러 하지 않는 것
//     · brands · brand_sources · leads · intake_channels · lead_sequence 접근 금지.
//       세미나 신청은 브랜드를 만들거나 바꾸지 않고, 1~4일차 자동발송에 들어가지 않는다.
//     · 문자·메일을 보내지 않는다(sms · mailer · ingest 를 import 하지 않는다).
//     · 기존 seminar_*(주간 안내 발송) · weekly_onb_*(온보딩 사전신청) 을 건드리지 않는다.
//     · 정원이 차도 행사 상태를 자동으로 바꾸지 않는다 — 접수만 거절한다.
import { query, queryOne, tx } from "./db";
import {
  EVENT_STATUSES, REG_STATUSES, REG_OCCUPYING,
  EMAIL_RE, cleanText as clean, normEmail, normPhone, normSite, regDedupeKey,
  isEventMode, isEventStatus, isRegStatus, isSlug, normSlug,
  applyBlockers, parseTs, CONSENT_VERSION,
  type EventStatus, type RegStatus,
} from "./seminar-events-model";

export const SEV_MIGRATION = "0109_seminar_events.sql";
const SEV_TABLES = [
  "sev_events", "sev_files", "sev_registrations", "sev_reg_events",
  "sev_shares", "sev_share_sessions", "sev_share_attempts",
];

export interface SevSchemaState { ready: boolean; missing: string[]; error?: string; migration: string }
export async function sevSchemaState(): Promise<SevSchemaState> {
  try {
    const rows = await query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema='public' AND table_name = ANY($1::text[])`, [SEV_TABLES]);
    const have = new Set(rows.map((r) => r.table_name));
    const missing = SEV_TABLES.filter((t) => !have.has(t));
    return { ready: missing.length === 0, missing, migration: SEV_MIGRATION };
  } catch (e) {
    return { ready: false, missing: SEV_TABLES, error: (e as Error).message.slice(0, 200), migration: SEV_MIGRATION };
  }
}

// ── 행사 ─────────────────────────────────────────────────────
export interface SevEvent {
  id: string; slug: string; title: string; summary: string; detail_md: string;
  mode: string; venue: string; address: string; venue_note: string; hosts: string;
  starts_at: string | null; ends_at: string | null; time_tbd: boolean; recurring_note: string;
  online_url: string; show_online_url: boolean;
  capacity: number | null; countries: string;
  status: EventStatus; publish: boolean; apply_open: boolean;
  poster_file_id: string | null;
  created_by: string; created_at: string; updated_at: string;
}
const EVENT_COLS = `id::text AS id, slug, title, summary, detail_md, mode, venue, address, venue_note, hosts,
  starts_at::text AS starts_at, ends_at::text AS ends_at, time_tbd, recurring_note,
  online_url, show_online_url, capacity, countries, status, publish, apply_open,
  poster_file_id::text AS poster_file_id, created_by,
  created_at::text AS created_at, updated_at::text AS updated_at`;

/** 공개 허브에 띄울 행사 — 게시(publish)된 것만. 초안은 절대 나가지 않는다. */
export async function listPublicEvents(): Promise<SevEvent[]> {
  return query<SevEvent>(
    `SELECT ${EVENT_COLS} FROM sev_events
      WHERE publish = true AND status <> 'draft'
      ORDER BY (status IN ('done','cancelled')), starts_at NULLS LAST, title
      LIMIT 200`);
}

/** 공개 상세 — 게시된 것만. 초안 slug 로 들어와도 찾지 못한 것으로 본다. */
export async function getPublicEvent(slug: string): Promise<SevEvent | null> {
  const s = normSlug(slug);
  if (!s) return null;
  return queryOne<SevEvent>(
    `SELECT ${EVENT_COLS} FROM sev_events WHERE slug=$1 AND publish = true AND status <> 'draft'`, [s]);
}

/** 관리자용 — 초안까지 전부. */
export async function listAllEvents(): Promise<SevEvent[]> {
  return query<SevEvent>(
    `SELECT ${EVENT_COLS} FROM sev_events
      ORDER BY (status IN ('done','cancelled')), starts_at DESC NULLS LAST, created_at DESC LIMIT 300`);
}
export async function getEvent(id: string): Promise<SevEvent | null> {
  return queryOne<SevEvent>(`SELECT ${EVENT_COLS} FROM sev_events WHERE id=$1::uuid`, [id]);
}
export async function getEventBySlug(slug: string): Promise<SevEvent | null> {
  return queryOne<SevEvent>(`SELECT ${EVENT_COLS} FROM sev_events WHERE slug=$1`, [normSlug(slug)]);
}

export interface EventInput {
  id?: string;
  slug: string; title: string; summary?: string; detail_md?: string;
  mode: string; venue?: string; address?: string; venue_note?: string; hosts?: string;
  startsAtLocal?: string | null; endsAtLocal?: string | null;
  time_tbd?: boolean; recurring_note?: string;
  online_url?: string; show_online_url?: boolean;
  capacity?: number | null; countries?: string;
  status: string; publish?: boolean; apply_open?: boolean;
}

/** 화면에서 온 값을 저장 가능한 형태로 거른다. 통과하지 못하면 이유를 돌려준다. */
function validateEvent(i: EventInput): { ok: false; error: string } | { ok: true; v: Record<string, unknown> } {
  const slug = normSlug(i.slug);
  if (!isSlug(slug)) return { ok: false, error: "주소 조각(slug)은 영문 소문자·숫자·하이픈 3자 이상이어야 합니다." };
  const title = clean(i.title, 160);
  if (!title) return { ok: false, error: "행사 제목을 입력해주세요." };
  if (!isEventMode(i.mode)) return { ok: false, error: "진행 방식을 고르세요." };
  if (!isEventStatus(i.status)) return { ok: false, error: "모집 상태를 고르세요." };

  const starts = i.startsAtLocal ? parseTs(i.startsAtLocal) : null;
  const ends = i.endsAtLocal ? parseTs(i.endsAtLocal) : null;
  if (i.startsAtLocal && !starts) return { ok: false, error: "시작 일시 형식을 확인해주세요." };
  if (i.endsAtLocal && !ends) return { ok: false, error: "종료 일시 형식을 확인해주세요." };
  if (starts && ends && ends.getTime() < starts.getTime()) {
    return { ok: false, error: "종료 일시가 시작보다 앞설 수 없습니다." };
  }
  const cap = i.capacity == null || i.capacity === ("" as unknown) ? null : Number(i.capacity);
  if (cap != null && (!Number.isInteger(cap) || cap <= 0 || cap > 100000)) {
    return { ok: false, error: "정원은 1 이상의 정수로 적어주세요(비우면 미설정)." };
  }
  const url = clean(i.online_url, 500);
  if (url && !/^https?:\/\/\S+$/i.test(url)) return { ok: false, error: "참가 링크는 http(s) 주소여야 합니다." };
  // 링크가 없는데 공개로 켜 두면 빈 링크를 내보내게 된다 — 허위 안내를 막는다.
  if (!url && i.show_online_url) return { ok: false, error: "참가 링크가 없으면 링크 공개를 켤 수 없습니다." };
  // 게시는 제목·일정 또는 사정 설명이 있을 때만 허용한다(빈 카드가 공개되지 않게).
  if (i.publish && i.status === "draft") return { ok: false, error: "초안 상태로는 공개할 수 없습니다 — 상태를 먼저 바꾸세요." };

  return {
    ok: true,
    v: {
      slug, title,
      summary: clean(i.summary, 400), detail_md: String(i.detail_md ?? "").slice(0, 8000),
      mode: i.mode, venue: clean(i.venue, 160), address: clean(i.address, 200),
      venue_note: clean(i.venue_note, 200), hosts: clean(i.hosts, 200),
      starts_at: starts ? starts.toISOString() : null,
      ends_at: ends ? ends.toISOString() : null,
      time_tbd: Boolean(i.time_tbd), recurring_note: clean(i.recurring_note, 160),
      online_url: url, show_online_url: Boolean(i.show_online_url),
      capacity: cap, countries: clean(i.countries, 200),
      status: i.status, publish: Boolean(i.publish), apply_open: Boolean(i.apply_open),
    },
  };
}

const EVENT_FIELDS = ["slug", "title", "summary", "detail_md", "mode", "venue", "address", "venue_note",
  "hosts", "starts_at", "ends_at", "time_tbd", "recurring_note", "online_url", "show_online_url",
  "capacity", "countries", "status", "publish", "apply_open"];

export async function saveEvent(i: EventInput, actor: string): Promise<{ ok: boolean; error?: string; id?: string }> {
  const v = validateEvent(i);
  if (!v.ok) return v;
  const vals = EVENT_FIELDS.map((f) => v.v[f]);
  try {
    if (i.id) {
      const sets = EVENT_FIELDS.map((f, n) => `${f}=$${n + 2}`).join(", ");
      const r = await query<{ id: string }>(
        `UPDATE sev_events SET ${sets}, updated_at=now() WHERE id=$1::uuid RETURNING id::text AS id`,
        [i.id, ...vals]);
      if (r.length === 0) return { ok: false, error: "행사를 찾지 못했습니다." };
      return { ok: true, id: r[0].id };
    }
    const ph = EVENT_FIELDS.map((_, n) => `$${n + 1}`).join(", ");
    const r = await queryOne<{ id: string }>(
      `INSERT INTO sev_events (${EVENT_FIELDS.join(", ")}, created_by)
       VALUES (${ph}, $${EVENT_FIELDS.length + 1}) RETURNING id::text AS id`,
      [...vals, clean(actor, 120)]);
    return r ? { ok: true, id: r.id } : { ok: false, error: "행사를 만들지 못했습니다." };
  } catch (e) {
    const msg = (e as Error).message ?? "";
    if (/sev_events_slug_key|duplicate key/.test(msg)) return { ok: false, error: "같은 주소 조각(slug)의 행사가 이미 있습니다." };
    if (/does not exist/.test(msg)) return { ok: false, error: `마이그레이션 ${SEV_MIGRATION} 이 아직 적용되지 않았습니다.` };
    return { ok: false, error: `저장 실패 — ${msg.slice(0, 160)}` };
  }
}

/** 상태·게시·접수 토글만 바꾼다(본문 수정과 분리해 실수로 공개되지 않게). */
export async function setEventFlags(
  id: string, patch: { status?: string; publish?: boolean; apply_open?: boolean },
): Promise<{ ok: boolean; error?: string }> {
  const sets: string[] = [];
  const vals: unknown[] = [id];
  if (patch.status !== undefined) {
    if (!isEventStatus(patch.status)) return { ok: false, error: "모집 상태를 확인해주세요." };
    sets.push(`status=$${vals.length + 1}`); vals.push(patch.status);
  }
  if (patch.publish !== undefined) { sets.push(`publish=$${vals.length + 1}`); vals.push(Boolean(patch.publish)); }
  if (patch.apply_open !== undefined) { sets.push(`apply_open=$${vals.length + 1}`); vals.push(Boolean(patch.apply_open)); }
  if (!sets.length) return { ok: false, error: "바꿀 값이 없습니다." };
  const cur = await getEvent(id);
  if (!cur) return { ok: false, error: "행사를 찾지 못했습니다." };
  const nextStatus = patch.status ?? cur.status;
  // 공개로 켜 달라면서 초안이면 거절한다(초안을 공개 허브에 올리지 않는다).
  if (patch.publish === true && nextStatus === "draft") {
    return { ok: false, error: "초안 상태로는 공개할 수 없습니다 — 상태를 먼저 바꾸세요." };
  }
  // 반대로 초안으로 되돌리는 경우에는 공개를 함께 내린다 —
  //   "공개된 초안"이라는 어긋난 상태가 남지 않게 한다.
  if (nextStatus === "draft" && patch.publish === undefined && cur.publish) {
    sets.push(`publish=$${vals.length + 1}`); vals.push(false);
  }
  await query(`UPDATE sev_events SET ${sets.join(", ")}, updated_at=now() WHERE id=$1::uuid`, vals);
  return { ok: true };
}

// ── 포스터 ───────────────────────────────────────────────────
export interface SevFile { id: string; mime: string; bytes: Buffer; filename: string; size_bytes: number }

/** 올린 포스터를 저장하고 행사에 연결한다. 이전 파일은 지우지 않고 removed_at 만 찍는다. */
export async function savePoster(
  eventId: string, filename: string, mime: string, bytes: Buffer, actor: string,
): Promise<{ ok: boolean; error?: string; fileId?: string }> {
  try {
    return await tx(async (c) => {
      const ev = await c.query<{ poster_file_id: string | null }>(
        "SELECT poster_file_id::text AS poster_file_id FROM sev_events WHERE id=$1::uuid FOR UPDATE", [eventId]);
      if (ev.rows.length === 0) return { ok: false, error: "행사를 찾지 못했습니다." };
      const ins = await c.query<{ id: string }>(
        `INSERT INTO sev_files (kind, filename, mime, size_bytes, bytes, uploaded_by)
         VALUES ('poster',$1,$2,$3,$4,$5) RETURNING id::text AS id`,
        [clean(filename, 200) || "poster", mime, bytes.length, bytes, clean(actor, 120)]);
      const fileId = ins.rows[0].id;
      await c.query("UPDATE sev_events SET poster_file_id=$2::uuid, updated_at=now() WHERE id=$1::uuid", [eventId, fileId]);
      const prev = ev.rows[0].poster_file_id;
      if (prev && prev !== fileId) {
        await c.query("UPDATE sev_files SET removed_at=now() WHERE id=$1::uuid AND removed_at IS NULL", [prev]);
      }
      return { ok: true, fileId };
    });
  } catch (e) {
    return { ok: false, error: `포스터 저장 실패 — ${(e as Error).message.slice(0, 160)}` };
  }
}

/** 행사에서 포스터 연결만 뗀다(파일 행은 남긴다). */
export async function clearPoster(eventId: string): Promise<{ ok: boolean; error?: string }> {
  const cur = await getEvent(eventId);
  if (!cur) return { ok: false, error: "행사를 찾지 못했습니다." };
  await query("UPDATE sev_events SET poster_file_id=NULL, updated_at=now() WHERE id=$1::uuid", [eventId]);
  if (cur.poster_file_id) {
    await query("UPDATE sev_files SET removed_at=now() WHERE id=$1::uuid AND removed_at IS NULL", [cur.poster_file_id]);
  }
  return { ok: true };
}

/**
 * 포스터 바이트. 공개 허브에 쓰이므로 "게시된 행사의 현재 포스터"만 내준다 —
 * 파일 id 를 알아도 초안 행사의 이미지는 나가지 않는다.
 */
export async function getPublicPoster(fileId: string): Promise<SevFile | null> {
  return queryOne<SevFile>(
    `SELECT f.id::text AS id, f.mime, f.bytes, f.filename, f.size_bytes
       FROM sev_files f
       JOIN sev_events e ON e.poster_file_id = f.id
      WHERE f.id=$1::uuid AND f.removed_at IS NULL
        AND e.publish = true AND e.status <> 'draft'`, [fileId]);
}
/** 관리자 미리보기 — 초안 행사의 포스터도 볼 수 있다(관리자 인가는 호출부에서 한다). */
export async function getAdminPoster(fileId: string): Promise<SevFile | null> {
  return queryOne<SevFile>(
    "SELECT id::text AS id, mime, bytes, filename, size_bytes FROM sev_files WHERE id=$1::uuid", [fileId]);
}

// ── 신청(접수) ───────────────────────────────────────────────
export interface RegInput {
  companyName: string; brandName?: string;
  contactName: string; contactTitle?: string;
  phone: string; email: string; siteUrl?: string;
  countries?: string; note?: string;
  privacyAgreed?: boolean; marketingAgreed?: boolean;
  isTest?: boolean;
}
export interface RegResult {
  ok: boolean; error?: string; id?: string;
  /** 같은 행사에 같은 연락처로 이미 접수된 건이면 true — 새로 만들지 않는다. */
  already?: boolean;
}

/** 행사별 신청 저장. 정원·마감·취소를 서버에서 다시 확인한다. */
export async function submitRegistration(slug: string, i: RegInput): Promise<RegResult> {
  const companyName = clean(i.companyName, 160);
  const brandName = clean(i.brandName, 160);
  const contactName = clean(i.contactName, 60);
  const contactTitle = clean(i.contactTitle, 60);
  const email = normEmail(i.email);
  const phone = normPhone(i.phone);
  const site = normSite(i.siteUrl);

  if (!companyName) return { ok: false, error: "회사명을 입력해주세요." };
  if (!contactName) return { ok: false, error: "담당자명을 입력해주세요." };
  if (!EMAIL_RE.test(email)) return { ok: false, error: "이메일 형식을 확인해주세요." };
  if (phone.length < 9) return { ok: false, error: "연락처를 정확히 입력해주세요." };
  if (!site.ok) return { ok: false, error: "회사 사이트 주소 형식을 확인해주세요(예: brand.co.kr)." };
  if (!i.privacyAgreed) return { ok: false, error: "개인정보 수집·이용 동의가 필요합니다." };

  const dedupe = regDedupeKey(email, phone);
  try {
    return await tx<RegResult>(async (c) => {
      // 행사 행을 잠그고 정원을 센다 — 동시에 들어와도 정원을 넘기지 않게.
      const ev = await c.query<{
        id: string; status: string; publish: boolean; apply_open: boolean; capacity: number | null;
      }>(`SELECT id::text AS id, status, publish, apply_open, capacity
            FROM sev_events WHERE slug=$1 FOR UPDATE`, [normSlug(slug)]);
      if (ev.rows.length === 0) return { ok: false, error: "행사를 찾지 못했습니다." };
      const e = ev.rows[0];

      const taken = await c.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM sev_registrations
          WHERE event_id=$1::uuid AND is_test = false AND status = ANY($2::text[])`,
        [e.id, [...REG_OCCUPYING]]);
      const blockers = applyBlockers({
        status: e.status, publish: e.publish, apply_open: e.apply_open,
        capacity: e.capacity, taken: Number(taken.rows[0]?.n ?? "0"),
      });
      if (blockers.length) return { ok: false, error: blockers[0] };

      const r = await c.query<{ id: string; inserted: boolean }>(
        `INSERT INTO sev_registrations
           (event_id, company_name, brand_name, contact_name, contact_title, phone, email,
            site_url, countries, note, privacy_agreed, privacy_agreed_at,
            marketing_agreed, marketing_agreed_at, consent_version, dedupe_key, is_test)
         VALUES ($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9,$10,
                 true, now(), $11, CASE WHEN $11 THEN now() ELSE NULL END, $12, $13, $14)
         ON CONFLICT (event_id, dedupe_key) DO UPDATE SET updated_at = now()
         RETURNING id::text AS id, (xmax = 0) AS inserted`,
        [e.id, companyName, brandName, contactName, contactTitle, phone, email,
          site.value, clean(i.countries, 200), clean(i.note, 1000),
          Boolean(i.marketingAgreed), CONSENT_VERSION, dedupe, Boolean(i.isTest)]);
      const row = r.rows[0];
      if (!row) return { ok: false, error: "접수에 실패했습니다. 잠시 후 다시 시도해주세요." };
      return { ok: true, id: row.id, already: !row.inserted };
    });
  } catch (e) {
    const msg = (e as Error).message ?? "";
    if (/sev_registrations|sev_events/.test(msg) && /does not exist/.test(msg)) {
      return { ok: false, error: "접수 준비가 아직 끝나지 않았습니다. 잠시 후 다시 시도해주세요." };
    }
    return { ok: false, error: "접수 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요." };
  }
}

/** 공개 화면이 쓰는 정원 현황. 정원 미설정이면 capacity 가 null 이다. */
export async function eventTaken(eventId: string): Promise<number> {
  const r = await queryOne<{ n: string }>(
    `SELECT count(*)::text AS n FROM sev_registrations
      WHERE event_id=$1::uuid AND is_test = false AND status = ANY($2::text[])`,
    [eventId, [...REG_OCCUPYING]]);
  return Number(r?.n ?? "0");
}

// ── 관리자: 신청자 목록 ──────────────────────────────────────
export interface SevReg {
  id: string; event_id: string;
  company_name: string; brand_name: string; contact_name: string; contact_title: string;
  phone: string; email: string; site_url: string; countries: string; note: string;
  privacy_agreed: boolean; privacy_agreed_at: string | null;
  marketing_agreed: boolean; marketing_agreed_at: string | null; consent_version: string;
  status: RegStatus; admin_note: string; owner_admin_id: string | null;
  is_test: boolean; created_at: string; updated_at: string;
}
const REG_COLS = `id::text AS id, event_id::text AS event_id, company_name, brand_name, contact_name,
  contact_title, phone, email, site_url, countries, note,
  privacy_agreed, privacy_agreed_at::text AS privacy_agreed_at,
  marketing_agreed, marketing_agreed_at::text AS marketing_agreed_at, consent_version,
  status, admin_note, owner_admin_id, is_test,
  created_at::text AS created_at, updated_at::text AS updated_at`;

export interface RegListOpts {
  eventId: string; q?: string; status?: string;
  page?: number; pageSize?: number; includeTest?: boolean;
}
export interface RegListResult { rows: SevReg[]; total: number; page: number; pageSize: number; pages: number }

export async function listRegistrations(o: RegListOpts): Promise<RegListResult> {
  const pageSize = Math.min(200, Math.max(10, o.pageSize ?? 25));
  const page = Math.max(1, Math.floor(o.page ?? 1));
  const where = ["event_id = $1::uuid"];
  const vals: unknown[] = [o.eventId];
  if (!o.includeTest) where.push("is_test = false");
  if (o.status && isRegStatus(o.status)) { where.push(`status = $${vals.length + 1}`); vals.push(o.status); }
  const q = clean(o.q, 80);
  if (q) {
    // 회사·브랜드·담당자·이메일·전화 어디든 걸리게. 전화는 숫자만 비교한다.
    vals.push(`%${q.toLowerCase()}%`);
    const p = `$${vals.length}`;
    const digits = normPhone(q);
    let phoneCond = "";
    if (digits.length >= 4) {
      vals.push(`%${digits}%`);
      phoneCond = ` OR regexp_replace(phone, '\\D', '', 'g') LIKE $${vals.length}`;
    }
    where.push(`(lower(company_name) LIKE ${p} OR lower(brand_name) LIKE ${p}
      OR lower(contact_name) LIKE ${p} OR lower(email) LIKE ${p}${phoneCond})`);
  }
  const cond = `WHERE ${where.join(" AND ")}`;
  const cnt = await queryOne<{ n: string }>(`SELECT count(*)::text AS n FROM sev_registrations ${cond}`, vals);
  const total = Number(cnt?.n ?? "0");
  const rows = await query<SevReg>(
    `SELECT ${REG_COLS} FROM sev_registrations ${cond}
      ORDER BY created_at DESC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`, vals);
  return { rows, total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)) };
}

export interface RegCounts { total: number; byStatus: Record<string, number>; marketing: number; taken: number }
export async function regCounts(eventId: string): Promise<RegCounts> {
  const rows = await query<{ status: string; n: string; mk: string }>(
    `SELECT status, count(*)::text AS n, count(*) FILTER (WHERE marketing_agreed)::text AS mk
       FROM sev_registrations WHERE event_id=$1::uuid AND is_test = false GROUP BY status`, [eventId]);
  const byStatus: Record<string, number> = {};
  let total = 0, marketing = 0, taken = 0;
  for (const r of rows) {
    const n = Number(r.n);
    byStatus[r.status] = n; total += n; marketing += Number(r.mk);
    if ((REG_OCCUPYING as readonly string[]).includes(r.status)) taken += n;
  }
  return { total, byStatus, marketing, taken };
}

async function logReg(id: string, field: string, from: string, to: string, actor: string): Promise<void> {
  await query(
    `INSERT INTO sev_reg_events (registration_id, field, old_value, new_value, actor)
     VALUES ($1::uuid,$2,$3,$4,$5)`, [id, field, from, to, actor]).catch(() => {});
}

export async function setRegStatus(id: string, status: string, actor: string): Promise<{ ok: boolean; error?: string }> {
  if (!isRegStatus(status)) return { ok: false, error: "알 수 없는 상태입니다." };
  const before = await queryOne<{ status: string }>("SELECT status FROM sev_registrations WHERE id=$1::uuid", [id]);
  if (!before) return { ok: false, error: "신청을 찾지 못했습니다." };
  await query("UPDATE sev_registrations SET status=$2, updated_at=now() WHERE id=$1::uuid", [id, status]);
  await logReg(id, "status", before.status, status, actor);
  return { ok: true };
}

export async function setRegNote(id: string, note: string, actor: string): Promise<{ ok: boolean; error?: string }> {
  const r = await query<{ id: string }>(
    "UPDATE sev_registrations SET admin_note=$2, updated_at=now() WHERE id=$1::uuid RETURNING id::text AS id",
    [id, clean(note, 2000)]);
  if (r.length === 0) return { ok: false, error: "신청을 찾지 못했습니다." };
  // 메모 본문은 이력에 남기지 않는다(개인정보가 섞일 수 있어 변경 사실만 남긴다).
  await logReg(id, "admin_note", "", "(변경)", actor);
  return { ok: true };
}

export async function setRegOwner(id: string, owner: string | null, actor: string): Promise<{ ok: boolean; error?: string }> {
  const who = (owner ?? "").trim().toLowerCase() || null;
  if (who) {
    const u = await queryOne<{ id: string }>("SELECT id FROM admin_users WHERE id=$1 AND active", [who]);
    if (!u) return { ok: false, error: "등록된 활성 담당자가 아닙니다." };
  }
  const r = await query<{ id: string }>(
    "UPDATE sev_registrations SET owner_admin_id=$2, updated_at=now() WHERE id=$1::uuid RETURNING id::text AS id",
    [id, who]);
  if (r.length === 0) return { ok: false, error: "신청을 찾지 못했습니다." };
  await logReg(id, "owner", "", who ?? "(해제)", actor);
  return { ok: true };
}

/**
 * 검수용 합성 신청 1건을 넣는다(관리자 전용).
 *   · is_test=true 로만 넣고 이름·연락처에 TEST 를 박아 실제 신청과 섞이지 않게 한다.
 *   · 정원·마감 검사를 거치지 않는다 — 검수용이므로 실제 접수 흐름과 구분한다.
 *   · 실제 고객 연락처를 쓰지 않는다(호출부가 값을 넘기지 않는다).
 */
export async function addTestRegistration(eventId: string, actor: string):
  Promise<{ ok: boolean; error?: string; id?: string }> {
  const ev = await getEvent(eventId);
  if (!ev) return { ok: false, error: "행사를 찾지 못했습니다." };
  const n = Date.now().toString().slice(-6);
  const email = `test+${n}@example.invalid`;
  const phone = `0100000${n.slice(-4)}`;
  const r = await queryOne<{ id: string }>(
    `INSERT INTO sev_registrations
       (event_id, company_name, brand_name, contact_name, contact_title, phone, email,
        site_url, countries, note, privacy_agreed, privacy_agreed_at, consent_version,
        dedupe_key, is_test)
     VALUES ($1::uuid,$2,$3,$4,$5,$6,$7,'','', $8, true, now(), $9, $10, true)
     ON CONFLICT (event_id, dedupe_key) DO NOTHING
     RETURNING id::text AS id`,
    [eventId, `[TEST] 합성회사 ${n}`, `[TEST] 합성브랜드`, `[TEST] 검수자`, "검수",
      phone, email, `검수용 합성 데이터 — ${clean(actor, 60)}`, CONSENT_VERSION,
      regDedupeKey(email, phone)]);
  return r ? { ok: true, id: r.id } : { ok: false, error: "이미 같은 검수 데이터가 있습니다." };
}

/** 검수용 합성 데이터(TEST)만 지운다. 실제 신청은 이 경로로 지워지지 않는다. */
export async function deleteSevTestRegs(eventId?: string): Promise<{ deleted: number }> {
  const r = eventId
    ? await query<{ id: string }>(
      "DELETE FROM sev_registrations WHERE is_test = true AND event_id=$1::uuid RETURNING id::text AS id", [eventId])
    : await query<{ id: string }>("DELETE FROM sev_registrations WHERE is_test = true RETURNING id::text AS id");
  return { deleted: r.length };
}

export { EVENT_STATUSES, REG_STATUSES };
