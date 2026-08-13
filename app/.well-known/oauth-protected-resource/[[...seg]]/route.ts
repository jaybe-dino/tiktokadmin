import { NextRequest, NextResponse } from "next/server";
import { externalOrigin } from "@/lib/mcp-oauth";

// RFC 9728 — Protected Resource Metadata. MCP 클라이언트가 인가서버를 발견하는 진입점.
//   /.well-known/oauth-protected-resource 및 접미(/api/mcp) 경로 모두 수용.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(req: NextRequest) {
  const origin = externalOrigin(req);
  return NextResponse.json(
    {
      resource: `${origin}/api/mcp`,
      authorization_servers: [origin],
      scopes_supported: ["mcp"],
      bearer_methods_supported: ["header"],
    },
    { headers: { "Access-Control-Allow-Origin": "*" } },
  );
}
