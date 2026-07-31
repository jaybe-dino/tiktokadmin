# 17 · 라이프사이클 엣지 & 거버넌스 — 해지·환불·갱신·업셀·컴플라이언스·장애·백업

> Claude Code 지시: 그동안 설계가 "행복 경로" 중심이었다 — 이 문서가 예외·종료·확장 경로와 운영 거버넌스를 채운다. 구현은 각 연관 모듈(03·10·15·16)에 병합.

## 1. 해지·이탈 (churn 오프보딩)

트리거: 정기결제 해지(glovek cancel 이벤트) / 계약 만료 미갱신 / 브랜드 요청.
```
churn_requested(수동/이벤트) → [승인: 파트장(12 결재선)] → churned 전이 시 자동 연쇄:
  ① ops_cycles 당월 status='paused' → 정산 마감분만 진행(잔여 수수료 정산)
  ② 최종 정산 run(15 §4) 생성 + "해지 정산" 플래그
  ③ 스토어 처리 체크리스트 발행(doc_items template='offboard'): 상품 내리기/이관·계정 권한 회수·재고 반출 or 소진 협의
  ④ 데이터 보존 타이머: retention_until = 해지+1년(assets·email·녹취) → 파기 cron
  ⑤ 해지 사유 필수 기록(churn_reason: 가격|성과불만|자체운영전환|폐업|기타) → 주간 자가학습 분석
  ⑥ 90일 후 윈백 후보 큐: 성과 있었던 브랜드 → 재제안 초안(M4) 자동
```
```sql
-- migrations/007_lifecycle.sql
ALTER TABLE brands ADD COLUMN churn_reason text;
ALTER TABLE brands ADD COLUMN churned_at timestamptz;
```

## 2. 환불·분쟁

| 유형 | 처리 |
|---|---|
| 구독 환불(LF 49만) | glovek 결제 취소는 glovek admin에서 — 어드민엔 `payment(cancel/refund)` ingest 이벤트 추가 → pay_status 조정 + 정산 차감 반영 |
| 일회 결제 환불(온보딩) | apply 수동 처리 → payments_manual 음수 기록(-금액, note 필수) + exec 승인(12) |
| 정산 이의 | settlements.disputed(15) → 재계산은 파트장 승인 → 차액은 익월 정산 조정 라인 |
- 모든 환불은 approval_requests(kind='refund' 추가) 경유. 월 환불 합계가 경영 대시보드 KPI.

## 3. 갱신·업셀·국가 추가 (성장 경로)

- **갱신**: contracts.end_date-30일(기존 알림) → 갱신 제안 자동 초안(M4, 성과 리포트 요약 삽입) → 갱신 계약 version+1.
- **업셀 후보 자동 감지**(주간 자가학습): LF 브랜드 중 [사이클 이행률 90%+ & views 상위 & 문의 적음] → "Guarantee/Onboarding 업셀 후보" 큐 → 영업담당 카드.
- **국가 추가**: 360 [국가 추가] 액션 → computeQuote 재견적 → 제안(M4) → 수락 시: brands.countries 갱신 + 해당 국가 인증 케이스 자동 생성(M6) + 물류 계약 항목(14-D) + 다음 사이클부터 워크아이템 반영. 상태 전이 없음(운영 중 확장).

## 4. 휴면 재활성화 (실측: 세미나 미전환 ~400건)

- 분기 1회 캠페인: 세그먼트(M1) "seminar/lead_new & 90일 무접촉 & is_test=false" → AI 재접촉 초안(그간 성과 사례 삽입) → 담당 승인 일괄 발송(수신동의자만) → 반응 시 state 재진입(lead_new→, 이력 보존).
- 12개월 무반응 → `archived` 플래그(별도 상태 아님 — 뷰 필터)로 목록 소음 제거.

## 5. 마케팅 수신동의 컴플라이언스 (정보통신망법)

```sql
ALTER TABLE brand_contacts ADD COLUMN marketing_consent boolean;      -- null=미확인
ALTER TABLE brand_contacts ADD COLUMN consent_at timestamptz;
```
- 동의 수집: 설문(14-A)·폼 체크박스·수동 기록. **거래 관련 메일(서류·정산·리포트)은 동의 무관, 광고성(재활성화·업셀·뉴스레터)은 동의자만** — email_drafts 발송 시 kind로 자동 분기·차단.
- 모든 광고성 메일 하단 수신거부 링크(원클릭 → consent=false 기록).

## 6. 장애 대응 runbook (시스템)

| 장애 | 감지 | 대응 |
|---|---|---|
| ingest 실패 누적 | ingest_events status='error' 10건+/시간 | Slack #시스템 경보 → 원인 후 replay 스크립트(ingest_events 재처리) |
| PULL sync 중단 | sync_state.last_ok_at 2주기 초과 | 자동 경보(기존) + runbook: 커서 확인→수동 1회 실행→사이트 상태 확인 |
| Slack 다운/토큰 만료 | slackApi 실패율 | notify 폴백(webhook→콘솔) 유지, 알림은 인앱 워크큐가 최종 보루(Slack 없이도 운영 가능해야 함) |
| DB 마이그레이션 실패 | migrate.ts 롤백 | 트랜잭션 단위 롤백(구현됨) + 스테이징 선적용 원칙 |
| 대량 오적재(잘못된 backfill) | — | brand_sources·stage_history로 특정 시점 이후 소급 식별 → 격리 스크립트. **원장 hard delete 금지 원칙**(is_test/archived 플래그만) |

## 7. 백업·DR·환경

- DB: 관리형 Postgres 일일 스냅샷 + PITR 활성(Neon/Supabase 설정) — 분기 1회 복구 리허설(스테이징에 복원해 로그인까지 확인).
- 파일: 어드민 스토리지(Blob/S3) 버저닝 활성. 사이트 원본(apply 볼륨)은 apply 쪽 백업 확인 항목.
- 환경 3단: local → **staging(시드: brands_master_v0 익명화본)** → production. 마이그레이션·연동 변경은 staging 선적용.
- 시크릿: 분기 로테이션(INGEST_SECRET·FILE_API_TOKEN·CRON_SECRET), 퇴사 시 즉시.

## 8. 성능 SLO (동시 40명·300 브랜드 기준)

| 항목 | 목표 |
|---|---|
| 목록/보드 로드 | p95 < 1.5s (인덱스: 이미 반영 + pg_trgm 검색은 5천 행 초과 시) |
| ops API 응답 | p95 < 500ms |
| ingest 수신 | p95 < 300ms (부수효과는 비동기) |
| 무거운 작업(리포트 200부·정산 런·전사) | 큐 워커(Inngest/QStash) — 요청 경로에서 실행 금지 |
| 커넥션 | 풀러 필수(Neon pooled/pgBouncer), 어드민 max 10·워커 별도 |
- 관측: Sentry(에러) + Vercel Analytics + `/api/health`(DB·sync_state·큐 상태) 1분 업타임 체크.

## 9. 완료 기준
- [ ] 해지 전이 시 5연쇄(정산·체크리스트·보존타이머·사유·윈백큐) 자동 발동
- [ ] 광고성 메일이 미동의자에게 발송 차단됨(테스트)
- [ ] ingest replay 스크립트로 오류 이벤트 재처리 가능
- [ ] staging 복구 리허설 절차 문서화·1회 실행
- [ ] /api/health 가 DB·sync·큐 상태 반환
