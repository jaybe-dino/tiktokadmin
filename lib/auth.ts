import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { queryOne } from "./db";
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

export function isAllowed(email: string): boolean {
  return env.allowedEmails.includes(email.trim().toLowerCase());
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
  if (!email || !isAllowed(email)) return null;
  return email;
}

/** 현재 어드민 사용자(역할 포함). admin_users 에 없으면 exec 취급(화이트리스트 통과자). */
export async function currentUser(): Promise<AdminUser | null> {
  const email = await sessionEmail();
  if (!email) return null;
  const u = await queryOne<AdminUser>("SELECT * FROM admin_users WHERE id=$1 AND active", [email]);
  if (u) return u;
  return { id: email, name: email, role: "exec", slack_user_id: null, active: true };
}

export const AUTH_COOKIE = COOKIE;
