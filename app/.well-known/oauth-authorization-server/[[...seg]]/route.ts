import { NextRequest, NextResponse } from "next/server";
import { externalOrigin } from "@/lib/mcp-oauth";

// RFC 8414 — Authorization Server Metadata. 공개 클라이언트(PKCE)·동적등록 지원.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(req: NextRequest) {
  const origin = externalOrigin(req);
  return NextResponse.json(
    {
      issuer: origin,
      authorization_endpoint: `${origin}/api/mcp/authorize`,
      token_endpoint: `${origin}/api/mcp/token`,
      registration_endpoint: `${origin}/api/mcp/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: ["mcp"],
    },
    { headers: { "Access-Control-Allow-Origin": "*" } },
  );
}
