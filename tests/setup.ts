// 테스트 환경 기본값 — 서명·해시에 쓰는 비밀키는 테스트용 고정값을 쓴다.
//   실제 운영 비밀과 무관하며, 여기 값으로 만든 토큰은 운영에서 통하지 않는다.
process.env.ADMIN_SESSION_SECRET ||= "test-session-secret-do-not-use-in-production";
process.env.ADMIN_URL ||= "https://admin.glovek.space";
process.env.NEXT_PUBLIC_ADMIN_URL ||= "https://admin.glovek.space";
