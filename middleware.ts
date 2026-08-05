import { NextRequest, NextResponse } from "next/server";

// 내부 전용 가드(UX 리다이렉트). 쿠키 "존재"만 확인 — 서명 검증은
// 서버(레이아웃 requireUser)에서 수행(edge 런타임엔 node:crypto 미지원).
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (
    pathname.startsWith("/login") ||
    pathname.startsWith("/api/") ||
    pathname.startsWith("/s/") ||       // 공개 설문 응답(로그인 불필요, 14-A)
    pathname.startsWith("/f/") ||       // 쇼트링크 리다이렉트(수신자 클릭, 로그인 불필요)
    pathname.startsWith("/proposal/") || // 공개 제안서 열람(고객 링크, 로그인 불필요)
    pathname.startsWith("/apply") ||    // 고객 온보딩 포털(자체 onb_session, 36)
    pathname.startsWith("/portal") ||   // 브랜드 포털(자체 gportal 세션, 16)
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico"
  ) {
    return NextResponse.next();
  }

  const cookie = req.cookies.get("glovek_admin")?.value;
  if (!cookie) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
