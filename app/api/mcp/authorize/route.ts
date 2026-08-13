import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { mcpRoleAllowed } from "@/lib/mcp-auth";
import { mintCode, redirectAllowed, externalOrigin } from "@/lib/mcp-oauth";

// OAuth 인가 엔드포인트. 신원 게이트 = 어드민 로그인(exec·lead).
//   미로그인 → /login?next=... 로 보내 로그인 후 복귀. 로그인+권한 확인 시 코드 발급·리다이렉트.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errRedirect(redirectUri: string, state: string | null, error: string, desc?: string): NextResponse {
  const u = new URL(redirectUri);
  u.searchParams.set("error", error);
  if (desc) u.searchParams.set("error_description", desc);
  if (state) u.searchParams.set("state", state);
  return NextResponse.redirect(u, { status: 302 });
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const responseType = sp.get("response_type");
  const clientId = sp.get("client_id") ?? "";
  const redirectUri = sp.get("redirect_uri") ?? "";
  const codeChallenge = sp.get("code_challenge") ?? "";
  const codeMethod = sp.get("code_challenge_method") ?? "";
  const state = sp.get("state");

  // 리다이렉트 URI 검증 — 이후 오류는 이 URI 로만 전달(오픈 리다이렉트 방지).
  if (!redirectUri || !redirectAllowed(redirectUri)) {
    return new NextResponse("허용되지 않은 redirect_uri 입니다.", { status: 400 });
  }
  if (responseType !== "code") return errRedirect(redirectUri, state, "unsupported_response_type");
  if (codeMethod !== "S256" || !codeChallenge) {
    return errRedirect(redirectUri, state, "invalid_request", "PKCE(S256)가 필요합니다.");
  }

  // 어드민 세션 확인 — 미로그인이면 로그인으로 보내고 이 인가요청으로 복귀.
  const user = await currentUser();
  if (!user) {
    const origin = externalOrigin(req);
    const backTo = `/api/mcp/authorize?${sp.toString()}`;
    const loginUrl = new URL("/login", origin);
    loginUrl.searchParams.set("next", backTo);
    return NextResponse.redirect(loginUrl, { status: 302 });
  }
  if (!mcpRoleAllowed(user.role)) {
    return errRedirect(redirectUri, state, "access_denied", "대표·파트장만 연결할 수 있습니다.");
  }

  const code = mintCode({ email: user.id, codeChallenge, redirectUri, clientId });
  const out = new URL(redirectUri);
  out.searchParams.set("code", code);
  if (state) out.searchParams.set("state", state);
  return NextResponse.redirect(out, { status: 302 });
}
