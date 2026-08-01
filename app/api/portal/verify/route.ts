import { NextRequest, NextResponse } from "next/server";
import { consumeInvite, portalCookieName } from "@/lib/portal-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 매직링크 검증 → 세션 쿠키 세팅 → 포털 홈 리다이렉트.
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token") ?? "";
  const sessionToken = await consumeInvite(token).catch(() => null);
  if (!sessionToken) {
    return NextResponse.redirect(new URL("/portal/login?error=expired", req.url));
  }
  const res = NextResponse.redirect(new URL("/portal", req.url));
  // path:"/" 로 설정해야 /portal 페이지와 /api/portal/* 라우트 모두에 쿠키가 전송된다.
  res.cookies.set(portalCookieName(), sessionToken, {
    httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 14,
  });
  return res;
}
