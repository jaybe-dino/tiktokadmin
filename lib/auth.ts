import { createHmac, timingSafeEqual, randomBytes, scryptSync } from "node:crypto";
import { cookies } from "next/headers";
import { queryOne, query } from "./db";
import { env } from "./env";
import type { Role } from "./types";

// 내부 전용 인증. 이메일 화이트리스트 + HMAC 서명 쿠키.
// (외부 SSO 도입 전 경량 세션. 00-MASTER-PLAN 4-5)

const COOKIE = "glovek_admin";

function sign(email: string): string {
  return createHmac("sha256", env.sessionSecret).update(email).digest("hex");
}

export function makeSessionValue(email: string): string {
  const e = email.trim().toLowerCase();
  return `${Buffer.from(e).toString("base64url")}.${sign(e)}`;
}

export function verifySessionValue(value: string): string | null {
  const [b64, sig] = value.split(".");
  if (!b64 || !sig) return null;
  let email: string;
  try {
    email = Buffer.from(b64, "base64url").toString("utf8");
  } catch {
    return null;
  }
  const expected = sign(email);
  if (sig.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  return email;
}

/** env 화이트리스트(부트스트랩·창업자용). */
export function isAllowed(email: string): boolean {
  return env.allowedEmails.includes(email.trim().toLowerCase());
}

/** 활성 admin_users 계정 존재 여부. */
async function isActiveAccount(email: string): Promise<boolean> {
  const u = await queryOne<{ active: boolean }>(
    "SELECT active FROM admin_users WHERE id=$1", [email.trim().toLowerCase()],
  ).catch(() => null);
  return !!u && u.active;
}

/**
 * 로그인·세션 허용 게이트: env 화이트리스트 "또는" 활성 계정.
 * 계정/권한 UI 에서 만든 계정(admin_users)이 env 목록에 없어도 로그인되도록 —
 * env 는 최초 부트스트랩용이고, 이후 계정 관리는 UI(admin_users)가 소스오브트루스.
 * (비밀번호 검증은 verifyLogin 이 별도로 수행하므로 게이트 통과만으로 로그인되지 않는다.)
 */
export async function canLogin(email: string): Promise<boolean> {
  return isAllowed(email) || isActiveAccount(email);
}

// ── 비밀번호 (scrypt) ─────────────────────────────────────────
// 저장 형식: scrypt$<saltHex>$<hashHex>. 평문·복호화 저장 없음.
export function hashPassword(pw: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(pw, salt, 64);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(pw: string, stored: string | null | undefined): boolean {
  if (!stored) return false;
  const [scheme, saltHex, hashHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  try {
    const expected = Buffer.from(hashHex, "hex");
    const actual = scryptSync(pw, Buffer.from(saltHex, "hex"), expected.length);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

/** 로그인 검증: admin_users 조회 + 활성 + 비밀번호 일치. 성공 시 이메일 반환. */
export async function verifyLogin(email: string, password: string): Promise<{ ok: boolean; reason?: string }> {
  const e = email.trim().toLowerCase();
  const u = await queryOne<{ password_hash: string | null; active: boolean }>(
    "SELECT password_hash, active FROM admin_users WHERE id=$1", [e]).catch(() => null);
  if (!u) return { ok: false, reason: "등록되지 않은 계정입니다." };
  if (!u.active) return { ok: false, reason: "비활성 계정입니다." };
  if (!u.password_hash) return { ok: false, reason: "비밀번호가 설정되지 않았습니다. 관리자에게 초기 비밀번호를 요청하세요." };
  if (!verifyPassword(password, u.password_hash)) return { ok: false, reason: "이메일 또는 비밀번호가 올바르지 않습니다." };
  return { ok: true };
}

/** 비밀번호 설정/변경 (해시 저장). */
export async function setPassword(email: string, password: string): Promise<void> {
  await query("UPDATE admin_users SET password_hash=$2, password_set_at=now() WHERE id=$1",
    [email.trim().toLowerCase(), hashPassword(password)]);
}

export interface AdminUser {
  id: string;
  name: string;
  role: Role;
  slack_user_id: string | null;
  active: boolean;
}

/** 현재 세션 이메일 (쿠키). 없거나 무효면 null. */
export async function sessionEmail(): Promise<string | null> {
  const c = (await cookies()).get(COOKIE)?.value;
  if (!c) return null;
  const email = verifySessionValue(c);
  if (!email || !(await canLogin(email))) return null;
  return email;
}

/** 현재 어드민 사용자(역할 포함). admin_users 에 없으면 exec 취급(화이트리스트 통과자). */
export async function currentUser(): Promise<AdminUser | null> {
  const email = await sessionEmail();
  if (!email) return null;
  // 행이 있으면 active 를 명시적으로 검사 — active=false 는 거부(null).
  // (AND active 로 거르면 비활성 사용자가 아래 exec 폴백으로 승격되는 취약점.)
  const u = await queryOne<AdminUser>("SELECT * FROM admin_users WHERE id=$1", [email]);
  if (u) {
    if (!u.active) return null;
    return u;
  }
  return { id: email, name: email, role: "exec", slack_user_id: null, active: true };
}

export const AUTH_COOKIE = COOKIE;
