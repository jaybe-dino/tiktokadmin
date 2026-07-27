/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // 어드민은 내부 전용 툴. 서버 액션/route가 pg를 직접 쓰므로 외부 패키지로 표시.
  serverExternalPackages: ["pg"],
  eslint: {
    // 내부 툴 — 빌드를 lint로 막지 않는다(CI에서 별도 lint).
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
