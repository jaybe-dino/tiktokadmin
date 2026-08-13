import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";

// RFC 7591 — 동적 클라이언트 등록. 공개 클라이언트(PKCE)라 시크릿 없음.
//   저장하지 않고 client_id 만 발급(신원 게이트는 /authorize 의 어드민 로그인).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "content-type" };

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: cors });
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    /* 빈 본문 허용 */
  }
  const redirectUris = Array.isArray(body.redirect_uris) ? body.redirect_uris : [];
  const clientId = `mcpc_${randomBytes(16).toString("hex")}`;
  return NextResponse.json(
    {
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      redirect_uris: redirectUris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      client_name: typeof body.client_name === "string" ? body.client_name : "MCP Client",
    },
    { status: 201, headers: cors },
  );
}
