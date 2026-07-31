# 16 · 브랜드 포털 — 200~300 브랜드사 셀프서비스

> Claude Code 지시: 어드민과 같은 레포(라우트 그룹 분리 `/portal/*`) 또는 별도 앱. 브랜드사가 **자기 것만** 본다 — CS 부하("리포트 주세요·어디까지 됐어요")를 구조적으로 제거.

## 1. 인증·격리 (스키마: migrations/006_portal.sql)

- 로그인: **이메일 매직링크**(brand_contacts.email 대상 — 비밀번호 없음). 세션 쿠키 `gportal`.
- 격리: 모든 쿼리에 `brand_id = 세션.brand_id` 강제 — `lib/portal-db.ts`의 `pq(brandId, sql, args)` 헬퍼만 사용(직접 q 호출 금지, 코드 리뷰 체크).
- 한 인물이 여러 브랜드 담당(에이전시) → 로그인 후 브랜드 선택기.
- 접근 로그: 포털 열람도 access_log 기록.

```sql
CREATE TABLE portal_sessions (
  token text PRIMARY KEY, contact_id uuid NOT NULL, brand_id uuid NOT NULL,
  expires_at timestamptz NOT NULL, created_at timestamptz DEFAULT now()
);
CREATE TABLE portal_invites (
  token text PRIMARY KEY, contact_id uuid NOT NULL,
  used_at timestamptz, expires_at timestamptz NOT NULL
);
```

## 2. 화면 (모바일 우선)

| 경로 | 내용 | 데이터 소스 |
|---|---|---|
| `/portal` 홈 | 진행 상태 스테퍼(온보딩이면 스텝 1~5, 운영이면 이번 달 사이클 요약) + 다음에 할 일 | brands·doc_items·ops_cycles |
| `/portal/onboarding` | 서류 체크리스트(제출/미제출)·반려 사유·**필요서류 업로드**(→assets, 담당 알림) | doc_items·assets |
| `/portal/reports` | 월간 리포트 목록·열람(PDF) — 시딩 결과·조회수·GMV·T레벨 | ops_cycles.report_asset_id |
| `/portal/settlement` | 정산 명세·상태, 이의 제기 버튼(→settlements disputed + CS 티켓) | settlements |
| `/portal/products` | 내 제품·국가별 인증 현황(읽기) + 인증서 만료 안내 | products_master·product_certs |
| `/portal/inquiry` | 문의 작성(→cs_tickets) + 내 문의 이력 + FAQ(qna_entries approved) | cs_tickets·qna_entries |

## 3. 알림 (브랜드 방향)
- 서류 요청·반려, 리포트 발행, 정산 확정, 인증 만료 임박 → 포털 알림 + 이메일(수신동의 체크, 17 문서 §5).
- 어드민→포털 발송물은 전부 email_drafts 경유(기록 일원화).

## 4. 비노출 원칙 (강제)
- 내부 정보 절대 비노출: 담당자 개인 연락처(회사 대표 채널만), 내부 코멘트, 다른 브랜드 존재, 원가·수수료 계산 내역(명세 합계만), 등급·이탈위험.
- 파일: 브랜드 본인이 올린 것 + 발행 리포트·명세만. apply 신원서류 접근 불가.

## 5. 완료 기준
- [ ] 매직링크 로그인→자기 브랜드만 조회(타 brand_id 조작 시 404)
- [ ] 서류 업로드 → 담당 Slack + doc_items 연동
- [ ] 리포트·명세 열람이 어드민 발행과 동시 반영
- [ ] 이의 제기 → disputed + CS 티켓 생성
- [ ] 포털 도입 후 "진행 문의" CS 건수 감소 측정(경영 KPI)
