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
  res.cookies.set(portalCookieName(), sessionToken, {
    httpOnly: true, secure: true, sameSite: "lax", path: "/portal", maxAge: 60 * 60 * 24 * 14,
  });
  return res;
}
