/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // 로딩 근본 개선: 방문한 동적 페이지를 클라이언트 라우터가 30초 캐시 —
  // 메뉴 재방문·뒤로가기가 서버 왕복 없이 즉시 표시(30초 후 재검증).
  experimental: {
    staleTimes: { dynamic: 30, static: 180 },
  },
  // 어드민은 내부 전용 툴. 서버 액션/route가 pg를 직접 쓰므로 외부 패키지로 표시.
  serverExternalPackages: ["pg"],
  eslint: {
    // 내부 툴 — 빌드를 lint로 막지 않는다(CI에서 별도 lint).
    ignoreDuringBuilds: true,
  },
  // 마이그레이션 SQL 을 /api/admin/migrate 서버리스 번들에 포함(런타임 fs 읽기용).
  outputFileTracingIncludes: {
    "/api/admin/migrate": ["./migrations/**"],
  },
};

export default nextConfig;
