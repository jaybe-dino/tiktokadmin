// Next.js instrumentation — 서버 시작 시 1회 실행.
//   Vercel 은 TZ 환경변수가 예약어라 대시보드에서 못 넣으므로, 런타임에서 KST 로 설정.
//   Node 는 process.env.TZ 재할당 시 tzset() 로 이후 Date/toLocaleString 에 반영(리눅스).
//   → 화면 표시 시간이 한국시간 기준. DB 저장은 timestamptz(UTC 절대시각) 그대로.
export function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    process.env.TZ = "Asia/Seoul";
  }
}
