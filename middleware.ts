import { NextRequest, NextResponse } from "next/server";

// 내부 전용 가드(UX 리다이렉트). 쿠키 "존재"만 확인 — 서명 검증은
// 서버(레이아웃 requireUser)에서 수행(edge 런타임엔 node:crypto 미지원).
// 고객 포털 도메인(tiktok.glovek.space) — 이 호스트에선 /apply(온보딩)만 노출.
//   env NEXT_PUBLIC_PORTAL_URL 의 호스트와 일치할 때만 발동(미설정/미연결이면 무동작).
function portalHost(): string {
  try { return new URL(process.env.NEXT_PUBLIC_PORTAL_URL || "").hostname; } catch { return ""; }
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // ── 고객 포털 호스트 가드 ──
  const ph = portalHost();
  const host = (req.headers.get("host") || "").split(":")[0];
  if (ph && host === ph) {
    const allowed = pathname.startsWith("/apply") || pathname.startsWith("/api/apply") ||
      pathname.startsWith("/_next") || pathname.startsWith("/proposal/") || pathname.startsWith("/mkt-proposal/") || pathname === "/favicon.ico" ||
      pathname.startsWith("/faq") ||   // 외부 공개 FAQ(QnA) — 포털 호스트에서 열람 허용
      // 토큰(CRON_SECRET) 보호 마이그레이션 엔드포인트 — 포털 호스트에서도 접근 허용(스키마 반영용).
      pathname.startsWith("/api/admin/migrate");
    if (!allowed) {
      const url = req.nextUrl.clone();
      url.pathname = "/apply";
      url.search = "";
      return NextResponse.redirect(url);
    }
    return NextResponse.next();  // /apply·/api/apply 는 자체 onb_session 으로 처리
  }

  if (
    pathname.startsWith("/login") ||
    pathname.startsWith("/api/") ||
    pathname.startsWith("/.well-known/") || // OAuth 디스커버리(MCP 커넥터) — 쿠키 없이 공개 접근
    pathname.startsWith("/s/") ||       // 공개 설문 응답(로그인 불필요, 14-A)
    pathname.startsWith("/f/") ||       // 쇼트링크 리다이렉트(수신자 클릭, 로그인 불필요)
    pathname.startsWith("/proposal/") || // 공개 제안서 열람(고객 링크, 로그인 불필요)
    pathname.startsWith("/mkt-proposal/") || // 공개 마케팅 제안서 열람(고객 링크, 로그인 불필요)
    pathname.startsWith("/faq") ||      // 외부 공개 FAQ(QnA, 로그인 불필요)
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
