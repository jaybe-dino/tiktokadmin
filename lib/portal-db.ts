// 브랜드 포털 격리 DB 헬퍼 (16 §1) — 모든 포털 쿼리는 pq(brandId,…)만 사용.
//   brand_id 를 항상 $1 로 강제 바인딩. 직접 query 호출 금지(코드리뷰 체크).
import { cookies } from "next/headers";
import crypto from "node:crypto";
import { query, queryOne } from "./db";

const PORTAL_COOKIE = "gportal";

export interface PortalSession { token: string; contact_id: string; brand_id: string; expires_at: string }

/** 세션 쿠키 → 유효 세션. 만료/무효면 null. */
export async function portalSession(): Promise<PortalSession | null> {
  const token = (await cookies()).get(PORTAL_COOKIE)?.value;
  if (!token) return null;
  const s = await queryOne<PortalSession>(
    "SELECT token, contact_id, brand_id::text, expires_at FROM portal_sessions WHERE token=$1 AND expires_at > now()",
    [token]).catch(() => null);
  return s;
}

/**
 * 격리 쿼리 — brand_id 를 항상 $1 로 강제. sql 의 첫 파라미터는 반드시 brand 스코프.
 * 예: pq(bid, "SELECT * FROM settlements WHERE brand_id=$1 ORDER BY month DESC")
 */
export async function pq<T extends Record<string, unknown> = Record<string, unknown>>(
  brandId: string, sql: string, extra: unknown[] = [],
): Promise<T[]> {
  if (!/where[\s\S]*brand_id\s*=\s*\$1/i.test(sql) && !/\$1/.test(sql)) {
    throw new Error("pq: brand_id=$1 격리 조건 누락");
  }
  return query<T>(sql, [brandId, ...extra]);
}

// ── 매직링크 발급·검증 ─────────────────────────────────────────
export function newToken(): string {
  return crypto.randomBytes(24).toString("hex");
}

/** 이메일 → brand_contacts 매칭 → invite 생성. 반환: {token, brandName} 또는 null. */
export async function createInvite(email: string): Promise<{ token: string; brandName: string } | null> {
  const c = await queryOne<{ id: string; brand_name: string }>(
    `SELECT bc.id, b.brand_name FROM brand_contacts bc JOIN brands b ON b.id=bc.brand_id
      WHERE lower(bc.email)=lower($1) LIMIT 1`, [email]);
  if (!c) return null;
  const token = newToken();
  await query(
    "INSERT INTO portal_invites (token, contact_id, email, expires_at) VALUES ($1,$2,$3, now() + interval '30 minutes')",
    [token, c.id, email]);
  return { token, brandName: c.brand_name };
}

/** invite 검증 → portal_session 생성 → 쿠키 세팅용 토큰 반환. */
export async function consumeInvite(inviteToken: string): Promise<string | null> {
  const inv = await queryOne<{ contact_id: string }>(
    "SELECT contact_id FROM portal_invites WHERE token=$1 AND used_at IS NULL AND expires_at > now()", [inviteToken]);
  if (!inv) return null;
  const contact = await queryOne<{ brand_id: string }>(
    "SELECT brand_id::text FROM brand_contacts WHERE id=$1", [inv.contact_id]);
  if (!contact) return null;
  await query("UPDATE portal_invites SET used_at=now() WHERE token=$1", [inviteToken]);
  const sessionToken = newToken();
  await query(
    "INSERT INTO portal_sessions (token, contact_id, brand_id, expires_at) VALUES ($1,$2,$3, now() + interval '14 days')",
    [sessionToken, inv.contact_id, contact.brand_id]);
  // 접근 로그
  await query("INSERT INTO access_log (actor, action, target) VALUES ($1,'portal_login',$2)",
    [`contact:${inv.contact_id}`, contact.brand_id]).catch(() => {});
  return sessionToken;
}

export function portalCookieName(): string { return PORTAL_COOKIE; }
