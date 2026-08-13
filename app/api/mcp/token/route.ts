import { NextRequest, NextResponse } from "next/server";
import { queryOne } from "@/lib/db";
import { mcpRoleAllowed } from "@/lib/mcp-auth";
import type { Role } from "@/lib/types";
import {
  verifyCode, verifyPkce, mintAccess, mintRefresh, verifyRefresh, ACCESS_TTL,
} from "@/lib/mcp-oauth";

// OAuth 토큰 엔드포인트. authorization_code(PKCE) + refresh_token 그랜트.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "content-type, authorization" };
const err = (code: string, status = 400) => NextResponse.json({ error: code }, { status, headers: cors });

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: cors });
}

// 현재 역할 재확인(권한 회수 반영). 행 없으면 부트스트랩 대표(exec).
async function roleOf(email: string): Promise<Role | null> {
  const u = await queryOne<{ role: Role; active: boolean }>(
    "SELECT role, active FROM admin_users WHERE id=$1", [email],
  ).catch(() => null);
  if (!u) return "exec"; // env 화이트리스트 부트스트랩
  if (!u.active) return null;
  return u.role;
}

export async function POST(req: NextRequest) {
  let grantType = "", code = "", verifier = "", redirectUri = "", refreshToken = "";
  const ct = req.headers.get("content-type") ?? "";
  try {
    if (ct.includes("application/json")) {
      const b = await req.json();
      grantType = b.grant_type ?? ""; code = b.code ?? ""; verifier = b.code_verifier ?? "";
      redirectUri = b.redirect_uri ?? ""; refreshToken = b.refresh_token ?? "";
    } else {
      const f = await req.formData();
      grantType = String(f.get("grant_type") ?? ""); code = String(f.get("code") ?? "");
      verifier = String(f.get("code_verifier") ?? ""); redirectUri = String(f.get("redirect_uri") ?? "");
      refreshToken = String(f.get("refresh_token") ?? "");
    }
  } catch {
    return err("invalid_request");
  }

  if (grantType === "authorization_code") {
    const payload = verifyCode(code);
    if (!payload) return err("invalid_grant");
    if (redirectUri && redirectUri !== payload.ruri) return err("invalid_grant");
    if (!verifyPkce(verifier, payload.cc)) return err("invalid_grant");
    const role = await roleOf(payload.sub);
    if (!role || !mcpRoleAllowed(role)) return err("access_denied", 403);
    return NextResponse.json(
      {
        access_token: mintAccess(payload.sub, role),
        token_type: "Bearer",
        expires_in: ACCESS_TTL,
        refresh_token: mintRefresh(payload.sub, role),
        scope: "mcp",
      },
      { headers: cors },
    );
  }

  if (grantType === "refresh_token") {
    const r = verifyRefresh(refreshToken);
    if (!r) return err("invalid_grant");
    const role = await roleOf(r.email);
    if (!role || !mcpRoleAllowed(role)) return err("access_denied", 403);
    return NextResponse.json(
      {
        access_token: mintAccess(r.email, role),
        token_type: "Bearer",
        expires_in: ACCESS_TTL,
        refresh_token: mintRefresh(r.email, role),
        scope: "mcp",
      },
      { headers: cors },
    );
  }

  return err("unsupported_grant_type");
}
