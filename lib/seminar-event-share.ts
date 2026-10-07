// 행사별 외부 열람 링크 — 발급·비밀번호·세션·읽기전용 조회.
//
//   이 파일도 sev_* 표 밖으로 나가지 않는다. 외부 열람자는 자기 행사 하나만 볼 수 있다.
//   일부러 하지 않는 것
//     · 비밀번호를 만들어 넣거나 공유를 켜지 않는다 — 둘 다 관리자가 직접 해야 한다.
//     · 외부 요청이 보낸 행사 id · 공유 id 를 믿지 않는다. 세션이 가리키는 행사만 읽는다.
//     · 외부 경로에서 수정·삭제를 하지 않는다(쓰기 쿼리는 세션 기록과 시도 기록뿐).
//     · 접속자 IP 를 저장하지 않는다 — 시도 횟수만 센다.
import { excludeOptedOut } from "@/lib/export-privacy";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { query, queryOne, tx } from "./db";
import { hashPassword, verifyPassword } from "./auth";
import {
  cleanText as clean, sanitizeShareFields, shareEnableBlockers, shareLive, sharePwError,
  maskEmail, maskPhone, fmtKstDateTime, parseTs, SHARE_FIELDS,
  REG_STATUS_LABEL, SHARE_ATTEMPT_MAX, SHARE_ATTEMPT_WINDOW_MIN, SHARE_SESSION_HOURS,
  SHARE_TOKEN_BYTES, isRegStatus,
  type RegStatus,
} from "./seminar-events-model";

export const ROSTER_COOKIE = "sev_roster";

function newToken(): string { return randomBytes(SHARE_TOKEN_BYTES).toString("hex"); }

// ── 관리자: 공유 링크 관리 ───────────────────────────────────
export interface SevShare {
  id: string; event_id: string; token: string; label: string;
  /** 비밀번호 해시는 내보내지 않는다 — 설정 여부만 알려준다. */
  has_password: boolean; password_set_at: string | null;
  enabled: boolean; enabled_at: string | null; enabled_by: string;
  fields: string[]; allow_download: boolean;
  expires_at: string | null; revoked_at: string | null; rotated_at: string | null;
  created_by: string; created_at: string; updated_at: string;
  /** 지금 외부에서 열 수 있는 상태인지. */
  live: boolean;
  active_sessions: number;
}
const SHARE_COLS = `s.id::text AS id, s.event_id::text AS event_id, s.token, s.label,
  (s.password_hash IS NOT NULL) AS has_password, s.password_set_at::text AS password_set_at,
  s.enabled, s.enabled_at::text AS enabled_at, s.enabled_by, s.fields, s.allow_download,
  s.expires_at::text AS expires_at, s.revoked_at::text AS revoked_at, s.rotated_at::text AS rotated_at,
  s.created_by, s.created_at::text AS created_at, s.updated_at::text AS updated_at,
  (SELECT count(*) FROM sev_share_sessions ss
     WHERE ss.share_id = s.id AND ss.revoked_at IS NULL AND ss.expires_at > now())::int AS active_sessions`;

export async function listShares(eventId: string): Promise<SevShare[]> {
  const rows = await query<SevShare & { password_hash?: string | null }>(
    `SELECT ${SHARE_COLS} FROM sev_shares s WHERE s.event_id=$1::uuid ORDER BY s.created_at DESC LIMIT 50`,
    [eventId]);
  return rows.map((r) => ({
    ...r,
    live: shareLive({
      enabled: r.enabled, password_hash: r.has_password ? "set" : null,
      revoked_at: r.revoked_at, expires_at: r.expires_at,
    }),
  }));
}

/** 새 링크 발급 — 비밀번호 없음·비활성 상태로 만든다. 이 상태로는 외부에서 열리지 않는다. */
export async function createShare(eventId: string, label: string, actor: string):
  Promise<{ ok: boolean; error?: string; id?: string; token?: string }> {
  const ev = await queryOne<{ id: string }>("SELECT id::text AS id FROM sev_events WHERE id=$1::uuid", [eventId]);
  if (!ev) return { ok: false, error: "행사를 찾지 못했습니다." };
  const token = newToken();
  const r = await queryOne<{ id: string }>(
    `INSERT INTO sev_shares (event_id, token, label, created_by)
     VALUES ($1::uuid,$2,$3,$4) RETURNING id::text AS id`,
    [eventId, token, clean(label, 120), clean(actor, 120)]);
  return r ? { ok: true, id: r.id, token } : { ok: false, error: "링크를 만들지 못했습니다." };
}

async function shareRow(id: string) {
  return queryOne<{
    id: string; event_id: string; password_hash: string | null; enabled: boolean;
    fields: string[]; revoked_at: string | null; expires_at: string | null;
  }>(`SELECT id::text AS id, event_id::text AS event_id, password_hash, enabled, fields,
        revoked_at::text AS revoked_at, expires_at::text AS expires_at
      FROM sev_shares WHERE id=$1::uuid`, [id]);
}

export async function setSharePassword(id: string, pw: string, actor: string): Promise<{ ok: boolean; error?: string }> {
  const bad = sharePwError(pw);
  if (bad) return { ok: false, error: bad };
  const s = await shareRow(id);
  if (!s) return { ok: false, error: "링크를 찾지 못했습니다." };
  if (s.revoked_at) return { ok: false, error: "철회된 링크입니다 — 새로 발급하세요." };
  // 비밀번호를 바꾸면 기존 열람 세션은 모두 끊는다.
  await tx(async (c) => {
    await c.query(
      "UPDATE sev_shares SET password_hash=$2, password_set_at=now(), updated_at=now() WHERE id=$1::uuid",
      [id, hashPassword(pw)]);
    await c.query(
      "UPDATE sev_share_sessions SET revoked_at=now() WHERE share_id=$1::uuid AND revoked_at IS NULL", [id]);
  });
  void actor; // 공유 설정 이력은 신청자 이력 표(sev_reg_events)에 섞지 않는다.
  return { ok: true };
}

export async function setShareFields(id: string, fields: unknown, allowDownload: boolean):
  Promise<{ ok: boolean; error?: string; fields?: string[] }> {
  const s = await shareRow(id);
  if (!s) return { ok: false, error: "링크를 찾지 못했습니다." };
  const safe = sanitizeShareFields(fields);
  await query(
    "UPDATE sev_shares SET fields=$2::text[], allow_download=$3, updated_at=now() WHERE id=$1::uuid",
    [id, safe, Boolean(allowDownload)]);
  return { ok: true, fields: safe };
}

export async function setShareExpiry(id: string, iso: string | null): Promise<{ ok: boolean; error?: string }> {
  if (iso) {
    const d = parseTs(iso);
    if (!d) return { ok: false, error: "만료 일시 형식을 확인해주세요." };
    if (d.getTime() <= Date.now()) return { ok: false, error: "만료 일시는 현재보다 뒤여야 합니다." };
  }
  const r = await query<{ id: string }>(
    "UPDATE sev_shares SET expires_at=$2::timestamptz, updated_at=now() WHERE id=$1::uuid RETURNING id::text AS id",
    [id, iso]);
  return r.length ? { ok: true } : { ok: false, error: "링크를 찾지 못했습니다." };
}

/** 켜기/끄기. 비밀번호·노출항목이 준비되지 않았으면 켜지지 않는다. */
export async function setShareEnabled(id: string, enabled: boolean, actor: string):
  Promise<{ ok: boolean; error?: string }> {
  const s = await shareRow(id);
  if (!s) return { ok: false, error: "링크를 찾지 못했습니다." };
  if (enabled) {
    const blockers = shareEnableBlockers(s);
    if (blockers.length) return { ok: false, error: blockers.join(" ") };
  }
  await query(
    `UPDATE sev_shares SET enabled=$2,
       enabled_at = CASE WHEN $2 THEN now() ELSE enabled_at END,
       enabled_by = CASE WHEN $2 THEN $3 ELSE enabled_by END,
       updated_at = now()
     WHERE id=$1::uuid`, [id, enabled, clean(actor, 120)]);
  if (!enabled) await revokeShareSessions(id);
  return { ok: true };
}

/** 주소 회전 — 기존 URL 은 즉시 죽고 열람 세션도 끊긴다. 비밀번호는 유지된다. */
export async function rotateShareToken(id: string): Promise<{ ok: boolean; error?: string; token?: string }> {
  const s = await shareRow(id);
  if (!s) return { ok: false, error: "링크를 찾지 못했습니다." };
  const token = newToken();
  await tx(async (c) => {
    await c.query("UPDATE sev_shares SET token=$2, rotated_at=now(), updated_at=now() WHERE id=$1::uuid", [id, token]);
    await c.query("UPDATE sev_share_sessions SET revoked_at=now() WHERE share_id=$1::uuid AND revoked_at IS NULL", [id]);
  });
  return { ok: true, token };
}

/** 철회 — 다시 켤 수 없다(새 링크를 발급해야 한다). */
export async function revokeShare(id: string): Promise<{ ok: boolean; error?: string }> {
  const r = await query<{ id: string }>(
    `UPDATE sev_shares SET revoked_at=now(), enabled=false, updated_at=now()
      WHERE id=$1::uuid AND revoked_at IS NULL RETURNING id::text AS id`, [id]);
  await revokeShareSessions(id);
  return r.length ? { ok: true } : { ok: false, error: "이미 철회되었거나 찾지 못했습니다." };
}

export async function revokeShareSessions(id: string): Promise<{ revoked: number }> {
  const r = await query<{ id: string }>(
    `UPDATE sev_share_sessions SET revoked_at=now()
      WHERE share_id=$1::uuid AND revoked_at IS NULL RETURNING id::text AS id`, [id]);
  return { revoked: r.length };
}

// ── 외부 열람: 인증 ──────────────────────────────────────────
export interface ShareAuthResult { ok: boolean; error?: string; session?: string }

/**
 * 비밀번호 확인 → 열람 세션 발급.
 *   링크가 없거나 꺼져 있거나 비밀번호가 틀린 경우를 같은 문구로 돌려준다
 *   (존재 여부를 밖에서 알아낼 수 없게).
 */
export async function loginShare(token: string, pw: string): Promise<ShareAuthResult> {
  const DENY = "열람 정보가 올바르지 않습니다.";
  const t = String(token ?? "").trim();
  if (!/^[a-f0-9]{16,128}$/i.test(t)) return { ok: false, error: DENY };

  const s = await queryOne<{
    id: string; password_hash: string | null; enabled: boolean;
    revoked_at: string | null; expires_at: string | null;
  }>(`SELECT id::text AS id, password_hash, enabled, revoked_at::text AS revoked_at,
        expires_at::text AS expires_at FROM sev_shares WHERE token=$1`, [t]).catch(() => null);
  if (!s) return { ok: false, error: DENY };

  // 시도 횟수 제한 — 링크 단위로 센다.
  const fails = await queryOne<{ n: string }>(
    `SELECT count(*)::text AS n FROM sev_share_attempts
      WHERE share_id=$1::uuid AND ok = false AND at > now() - ($2 || ' minutes')::interval`,
    [s.id, String(SHARE_ATTEMPT_WINDOW_MIN)]).catch(() => ({ n: "0" }));
  if (Number(fails?.n ?? "0") >= SHARE_ATTEMPT_MAX) {
    return { ok: false, error: `시도가 너무 많습니다 — ${SHARE_ATTEMPT_WINDOW_MIN}분 후 다시 시도해주세요.` };
  }

  const live = shareLive({
    enabled: s.enabled, password_hash: s.password_hash,
    revoked_at: s.revoked_at, expires_at: s.expires_at,
  });
  const pwOk = live && verifyPassword(String(pw ?? ""), s.password_hash);
  await query("INSERT INTO sev_share_attempts (share_id, ok) VALUES ($1::uuid,$2)", [s.id, pwOk]).catch(() => {});
  if (!pwOk) return { ok: false, error: DENY };

  const session = newToken();
  await query(
    `INSERT INTO sev_share_sessions (share_id, token, expires_at)
     VALUES ($1::uuid,$2, now() + ($3 || ' hours')::interval)`,
    [s.id, session, String(SHARE_SESSION_HOURS)]);
  return { ok: true, session };
}

export interface ShareView {
  shareId: string; eventId: string; eventTitle: string;
  fields: string[]; allowDownload: boolean; label: string; expiresAt: string | null;
}

/**
 * 쿠키의 열람 세션이 "이 링크"에 대한 것인지 확인한다.
 *   다른 행사 링크를 열면 세션이 맞지 않아 다시 인증해야 한다 — 링크를 바꿔 끼워
 *   남의 행사 명단을 보는 경로를 막는다.
 */
export async function shareViewFor(token: string): Promise<ShareView | null> {
  const sess = (await cookies()).get(ROSTER_COOKIE)?.value ?? "";
  return shareViewForSession(token, sess);
}

/**
 * 쿠키 없이 같은 검사를 하는 형태 — 링크 토큰과 세션 토큰을 짝으로 받는다.
 *   shareViewFor 가 이것을 쓰고, 테스트도 이 경로로 같은 쿼리를 검증한다.
 */
export async function shareViewForSession(token: string, sessionToken: string): Promise<ShareView | null> {
  const t = String(token ?? "").trim();
  if (!/^[a-f0-9]{16,128}$/i.test(t)) return null;
  const sess = String(sessionToken ?? "").trim();
  if (!/^[a-f0-9]{16,128}$/i.test(sess)) return null;
  const row = await queryOne<{
    share_id: string; event_id: string; title: string; fields: string[];
    allow_download: boolean; label: string; expires_at: string | null;
    enabled: boolean; password_hash: string | null; revoked_at: string | null; share_expires: string | null;
  }>(
    `SELECT s.id::text AS share_id, s.event_id::text AS event_id, e.title, s.fields,
            s.allow_download, s.label, ss.expires_at::text AS expires_at,
            s.enabled, s.password_hash, s.revoked_at::text AS revoked_at,
            s.expires_at::text AS share_expires
       FROM sev_share_sessions ss
       JOIN sev_shares s ON s.id = ss.share_id
       JOIN sev_events e ON e.id = s.event_id
      WHERE ss.token = $1 AND s.token = $2
        AND ss.revoked_at IS NULL AND ss.expires_at > now()`, [sess, t]).catch(() => null);
  if (!row) return null;
  // 세션이 살아 있어도 링크가 꺼졌거나 만료·철회되면 즉시 막는다.
  if (!shareLive({
    enabled: row.enabled, password_hash: row.password_hash,
    revoked_at: row.revoked_at, expires_at: row.share_expires,
  })) return null;
  await query("UPDATE sev_share_sessions SET last_seen_at=now() WHERE token=$1", [sess]).catch(() => {});
  return {
    shareId: row.share_id, eventId: row.event_id, eventTitle: row.title,
    fields: sanitizeShareFields(row.fields), allowDownload: Boolean(row.allow_download),
    label: row.label, expiresAt: row.expires_at,
  };
}

export async function logoutShare(): Promise<void> {
  const jar = await cookies();
  await revokeSessionToken(jar.get(ROSTER_COOKIE)?.value ?? "");
  jar.delete(ROSTER_COOKIE);
}

/** 열람 세션 하나를 끊는다(로그아웃). 없는 토큰이면 아무 일도 하지 않는다. */
export async function revokeSessionToken(sessionToken: string): Promise<void> {
  const sess = String(sessionToken ?? "").trim();
  if (!/^[a-f0-9]{16,128}$/i.test(sess)) return;
  await query("UPDATE sev_share_sessions SET revoked_at=now() WHERE token=$1 AND revoked_at IS NULL", [sess])
    .catch(() => {});
}

// ── 외부 열람: 명단 ──────────────────────────────────────────
export interface RosterCell { key: string; value: string }
export interface RosterRow { cells: RosterCell[] }
export interface RosterData { headers: { key: string; label: string }[]; rows: RosterRow[]; total: number }

/**
 * 세션이 가리키는 행사의 명단만 읽는다. 호출부가 행사 id 를 넘기지 않는다는 점이 중요하다.
 *   · 내부 메모·담당자·원문 연락처는 SELECT 하지 않는다.
 *   · 검수용 TEST 행과 취소 건은 내보내지 않는다.
 */
export async function readRoster(view: ShareView, limit = 500): Promise<RosterData> {
  const fetched = await query<{
    company_name: string; brand_name: string; contact_name: string; contact_title: string;
    phone: string; email: string; site_url: string; countries: string;
    status: string; created_at: string;
  }>(
    `SELECT company_name, brand_name, contact_name, contact_title, phone, email,
            site_url, countries, status, created_at::text AS created_at
       FROM sev_registrations
      WHERE event_id = $1::uuid AND is_test = false AND status <> 'cancelled'
      ORDER BY created_at
      LIMIT $2`, [view.eventId, Math.min(2000, Math.max(1, limit))]);

  const rows = await excludeOptedOut(fetched);
  const pick = (r: typeof rows[number], key: string): string => {
    switch (key) {
      case "company": return r.company_name;
      case "brand": return r.brand_name;
      case "status": return isRegStatus(r.status) ? REG_STATUS_LABEL[r.status as RegStatus] : "";
      case "contact_name": return r.contact_name;
      case "contact_title": return r.contact_title;
      case "phone_masked": return maskPhone(r.phone);
      case "email_masked": return maskEmail(r.email);
      case "site": return r.site_url;
      case "countries": return r.countries;
      case "applied_at": return fmtKstDateTime(r.created_at);
      default: return "";
    }
  };
  const headers = view.fields
    .map((k) => SHARE_FIELDS.find((f) => f.key === k))
    .filter((f): f is { key: string; label: string; masked?: boolean } => Boolean(f))
    .map((f) => ({ key: f.key, label: f.label }));
  return {
    headers,
    rows: rows.map((r) => ({ cells: headers.map((h) => ({ key: h.key, value: pick(r, h.key) })) })),
    total: rows.length,
  };
}
