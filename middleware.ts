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

  // 외부 참석자 열람 화면·내려받기는 캐시와 검색엔진 수집을 모두 막는다.
  //   페이지 쪽 metadata 만으로는 중간 캐시를 막지 못하므로 응답 헤더로도 못을 박는다.
  if (pathname.startsWith("/roster/") || pathname.startsWith("/api/roster/")) {
    const res = NextResponse.next();
    res.headers.set("Cache-Control", "no-store, max-age=0, must-revalidate");
    res.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive, nosnippet");
    res.headers.set("Referrer-Policy", "no-referrer");
    return res;
  }

  // ── 고객 포털 호스트 가드 ──
  const ph = portalHost();
  const host = (req.headers.get("host") || "").split(":")[0];
  if (ph && host === ph) {
    const allowed = pathname.startsWith("/apply") || pathname.startsWith("/api/apply") ||
      pathname.startsWith("/_next") || pathname.startsWith("/proposal/") || pathname.startsWith("/mkt-proposal/") || pathname === "/favicon.ico" ||
      // 공개 제안서의 이미지 서빙 경로 — 제안서 페이지가 이 호스트로 발급되므로 함께 허용해야
      // 썸네일이 뜬다(각 라우트가 토큰→문서→브랜드 일치 + image/* MIME 만 자체 검증).
      pathname.startsWith("/api/proposal-asset/") || pathname.startsWith("/api/proposal-img/") ||
      pathname.startsWith("/weekly") || // 틱톡샵 주간 온보딩 신청(공개 폼)
      (pathname.startsWith("/seminar-apply") && !pathname.startsWith("/seminar-apply-admin")) || // 해외매출 세미나 공개 신청
      pathname === "/events" || pathname.startsWith("/events/") || // 공개 세미나 모집 허브·신청(관리 화면 /seminar-events 는 제외)
      pathname.startsWith("/roster/") || // 행사별 외부 참석자 열람(비밀번호로 보호)
      pathname.startsWith("/api/events/") || pathname.startsWith("/api/roster/") || // 포스터 이미지·외부 명단 내려받기
      pathname.startsWith("/intro/") || // 브랜드 해외 소개자료(유통사 열람 링크)
      pathname.startsWith("/jp") ||    // 일본 진출 사전 신청(공개 폼)
      pathname.startsWith("/u/") ||    // 광고 수신거부(고객이 여는 공개 링크)
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
    pathname.startsWith("/weekly") ||   // 틱톡샵 주간 온보딩 신청(공개 폼, 로그인 불필요)
    // 해외매출 세미나 공개 신청(로그인 불필요). 관리 화면 /seminar-apply-admin 은 제외한다.
    (pathname.startsWith("/seminar-apply") && !pathname.startsWith("/seminar-apply-admin")) ||
    pathname === "/events" || pathname.startsWith("/events/") || // 공개 세미나 모집 허브·신청(로그인 불필요)
    pathname.startsWith("/roster/") ||  // 행사별 외부 참석자 열람(자체 비밀번호 세션, 로그인 불필요)
    pathname.startsWith("/intro/") ||   // 브랜드 해외 소개자료(유통사 열람 링크, 로그인 불필요)
    pathname.startsWith("/jp") ||       // 일본 진출 사전 신청(공개 폼, 로그인 불필요)
    pathname.startsWith("/u/") ||       // 광고 수신거부(문자·메일 링크, 로그인 불필요)
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
