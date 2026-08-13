// MCP 커넥터 인증 — 사용자별 Bearer 토큰(scrypt 해시 저장). 대표/파트장(exec·lead)만 허용.
//   토큰 형식: mcp_<base64url(email)>_<secretHex>  — email 로 사용자 O(1) 조회 후 secret 검증.
//   해시/검증은 auth.ts 의 scrypt 와 동일 방식(평문 미저장).
import { randomBytes } from "node:crypto";
import { query, queryOne } from "./db";
import { hashPassword, verifyPassword } from "./auth";
import type { Role } from "./types";

// MCP 접근 허용 역할 — 대표(exec)·파트장(lead)만.
export const MCP_ALLOWED_ROLES: Role[] = ["exec", "lead"];
export function mcpRoleAllowed(role: Role): boolean {
  return MCP_ALLOWED_ROLES.includes(role);
}

const PREFIX = "mcp_";

/** 새 토큰 발급 → 평문 1회 반환(저장은 해시). 역할 미허용이면 null. */
export async function generateMcpToken(email: string): Promise<string | null> {
  const e = email.trim().toLowerCase();
  const u = await queryOne<{ role: Role; active: boolean }>(
    "SELECT role, active FROM admin_users WHERE id=$1", [e],
  ).catch(() => null);
  // admin_users 행이 없어도 env 화이트리스트 부트스트랩(대표)만은 허용.
  const role: Role | null = u ? u.role : "exec";
  const active = u ? u.active : true;
  if (!active || !role || !mcpRoleAllowed(role)) return null;

  const secret = randomBytes(24).toString("hex");
  const token = `${PREFIX}${Buffer.from(e).toString("base64url")}_${secret}`;
  const hint = secret.slice(-4);
  // 행이 없으면 만들지 않고(계정관리 UI 소관) 있을 때만 저장 — 부트스트랩 대표는 행 생성.
  await query(
    `INSERT INTO admin_users (id, name, role, active, mcp_token_hash, mcp_token_hint, mcp_token_set_at)
     VALUES ($1,$1,'exec',true,$2,$3,now())
     ON CONFLICT (id) DO UPDATE SET
       mcp_token_hash=$2, mcp_token_hint=$3, mcp_token_set_at=now()`,
    [e, hashPassword(secret), hint],
  );
  return token;
}

/** 토큰 폐기. */
export async function revokeMcpToken(email: string): Promise<void> {
  await query(
    "UPDATE admin_users SET mcp_token_hash=NULL, mcp_token_hint=NULL, mcp_token_set_at=NULL WHERE id=$1",
    [email.trim().toLowerCase()],
  );
}

export interface McpPrincipal { email: string; role: Role; }

/** 토큰 검증 → 주체(email·role). 무효/미허용이면 null. */
export async function verifyMcpToken(raw: string | null | undefined): Promise<McpPrincipal | null> {
  const token = (raw ?? "").trim();
  if (!token.startsWith(PREFIX)) return null;
  const rest = token.slice(PREFIX.length);
  const us = rest.indexOf("_");
  if (us <= 0) return null;
  let email: string;
  try {
    email = Buffer.from(rest.slice(0, us), "base64url").toString("utf8");
  } catch {
    return null;
  }
  const secret = rest.slice(us + 1);
  if (!email || !secret) return null;
  const u = await queryOne<{ role: Role; active: boolean; mcp_token_hash: string | null }>(
    "SELECT role, active, mcp_token_hash FROM admin_users WHERE id=$1", [email],
  ).catch(() => null);
  if (!u || !u.active || !u.mcp_token_hash) return null;
  if (!mcpRoleAllowed(u.role)) return null;
  if (!verifyPassword(secret, u.mcp_token_hash)) return null;
  return { email, role: u.role };
}

/** 현재 사용자 토큰 발급 상태(설정 UI 표시용). */
export async function mcpTokenStatus(email: string): Promise<{ set: boolean; hint: string | null; at: string | null }> {
  const u = await queryOne<{ mcp_token_hint: string | null; mcp_token_set_at: string | null }>(
    "SELECT mcp_token_hint, mcp_token_set_at::text AS mcp_token_set_at FROM admin_users WHERE id=$1",
    [email.trim().toLowerCase()],
  ).catch(() => null);
  return { set: !!u?.mcp_token_hint, hint: u?.mcp_token_hint ?? null, at: u?.mcp_token_set_at ?? null };
}
