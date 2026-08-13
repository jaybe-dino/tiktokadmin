// MCP OAuth 2.1 (PKCE) — claude.ai/데스크톱 커넥터용 최소 인가 서버.
//   저장소 없음: 인가코드·액세스토큰을 HMAC 서명(세션시크릿)으로 자체검증. 동적 클라이언트 등록 허용.
//   실제 신원 게이트는 '어드민 로그인(exec·lead)' — /authorize 가 세션을 확인해 코드 발급.
import { createHmac, createHash, timingSafeEqual } from "node:crypto";
import { env } from "./env";
import type { Role } from "./types";

const SECRET = env.sessionSecret;
const sign = (data: string): string => createHmac("sha256", SECRET).update(data).digest("base64url");

/** {payload}.{sig} 발급. */
export function mint(payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body)}`;
}
/** 서명·형식 검증 후 payload 반환(만료는 호출부에서 확인). */
export function unmint<T = Record<string, unknown>>(token: string): T | null {
  const [body, sig] = (token ?? "").split(".");
  if (!body || !sig) return null;
  const expect = sign(body);
  if (sig.length !== expect.length) return null;
  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}

const now = (): number => Math.floor(Date.now() / 1000);
export const CODE_TTL = 300; // 5분
export const ACCESS_TTL = 60 * 60 * 24 * 30; // 30일
export const REFRESH_TTL = 60 * 60 * 24 * 180; // 180일

export interface CodePayload { t: "code"; sub: string; cc: string; ruri: string; cid: string; exp: number; }
export interface AccessPayload { t: "at"; sub: string; role: Role; exp: number; }
export interface RefreshPayload { t: "rt"; sub: string; role: Role; exp: number; }

export function mintCode(p: { email: string; codeChallenge: string; redirectUri: string; clientId: string }): string {
  return mint({ t: "code", sub: p.email, cc: p.codeChallenge, ruri: p.redirectUri, cid: p.clientId, exp: now() + CODE_TTL });
}
export function mintAccess(email: string, role: Role): string {
  return mint({ t: "at", sub: email, role, exp: now() + ACCESS_TTL });
}
export function mintRefresh(email: string, role: Role): string {
  return mint({ t: "rt", sub: email, role, exp: now() + REFRESH_TTL });
}

export function verifyCode(token: string): CodePayload | null {
  const p = unmint<CodePayload>(token);
  if (!p || p.t !== "code" || p.exp < now()) return null;
  return p;
}
export function verifyAccess(token: string): { email: string; role: Role } | null {
  const p = unmint<AccessPayload>(token);
  if (!p || p.t !== "at" || p.exp < now()) return null;
  return { email: p.sub, role: p.role };
}
export function verifyRefresh(token: string): { email: string; role: Role } | null {
  const p = unmint<RefreshPayload>(token);
  if (!p || p.t !== "rt" || p.exp < now()) return null;
  return { email: p.sub, role: p.role };
}

/** PKCE S256 검증. */
export function verifyPkce(codeVerifier: string, codeChallenge: string): boolean {
  if (!codeVerifier || !codeChallenge) return false;
  const h = createHash("sha256").update(codeVerifier).digest("base64url");
  return h === codeChallenge;
}

/** 리다이렉트 URI 허용 여부(claude.ai/claude.com 및 로컬 데스크톱). */
export function redirectAllowed(uri: string): boolean {
  try {
    const u = new URL(uri);
    if (u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1")) return true;
    if (u.protocol !== "https:") return false;
    const host = u.hostname.toLowerCase();
    return host === "claude.ai" || host === "claude.com" || host.endsWith(".claude.ai") || host.endsWith(".claude.com");
  } catch {
    return false;
  }
}

/** 외부에서 접근되는 실제 오리진(프록시 헤더 우선). */
export function externalOrigin(req: { headers: Headers; nextUrl: { origin: string } }): string {
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const host = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || req.headers.get("host")?.trim();
  if (proto && host) return `${proto}://${host}`;
  return req.nextUrl.origin;
}
