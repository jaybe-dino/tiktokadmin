# 메뉴 로딩 속도 — 원인과 해결

## 왜 느린가
1. **모든 페이지 `force-dynamic`** — 메뉴 클릭마다 서버 렌더 + DB 조회(캐시 없음).
2. **Neon + Vercel 콜드스타트** — 특히 **비풀드(non-pooled) 연결**이면 요청마다 TLS+Postgres 접속 핸드셰이크(수백 ms).
3. **일부 페이지 순차 쿼리** + keepAlive 미설정으로 연결 재사용이 약함.

## 적용한 해결 (코드)
- `lib/db.ts`: `keepAlive` + `keepAliveInitialDelayMillis`(연결 재사용), `statement_timeout`/`query_timeout`(느린 쿼리가 UI 를 붙잡지 않게), `max` 3→5, `idleTimeout` 30s.
- `app/(dash)/loading.tsx` + `app/(dash)/brand/[id]/loading.tsx`: 라우트 전환 즉시 스켈레톤 → 빈 화면 대기 제거(체감 속도↑).

## 가장 큰 레버 (env — 운영자 1회 설정) ★
Vercel + Neon 에서 **풀드 연결 문자열**을 쓰면 콜드스타트 접속 지연이 크게 줄어듭니다.
- Neon 대시보드 → Connection string → **"Pooled connection"** 선택(호스트에 `-pooler` 포함).
- Vercel 환경변수 `DATABASE_URL` 을 이 **pooled** 값으로 교체(끝에 `?sslmode=require`).
  - 예: `postgres://user:pass@ep-xxx-pooler.<region>.aws.neon.tech/db?sslmode=require`
- Vercel 프로젝트 리전을 Neon DB 리전과 **동일**하게(예: 둘 다 `ap-northeast` / `us-east`) 맞추면 왕복 지연이 더 줄어듭니다.

## 추가 최적화(선택, 후속)
- 페이지별 다중 조회를 `Promise.all` 로 병렬화(순차 await 제거).
- 읽기 위주 목록 페이지는 `export const revalidate = 30`(ISR) 으로 30초 캐시 — 실시간성이 덜 중요한 화면 한정.
- 핫 경로 인덱스 점검: `brands(state)`, `brands(created_at)`, `alerts(resolved_at, kind)`, `email_messages(brand_id, sent_at)`(대부분 이미 존재).
