# 02 · Ingest API — 사이트 → 어드민 이벤트 수신

> Claude Code 지시: `/app/api/ingest/[event]/route.ts`를 이 스펙대로 구현해줘. 01의 dedup·brands·brand_sources·ingest_events를 사용한다.

## 1. 엔드포인트 규격

```
POST {ADMIN_URL}/api/ingest/{event}
Headers:
  X-Ingest-Secret: <INGEST_SECRET>        # 불일치 시 401
  X-Idempotency-Key: <site별 유니크 키>    # 필수. 재수신 시 200 {dedup:true}
  Content-Type: application/json
응답: 200 {ok:true, brand_id, created:boolean} | 200 {ok:true, dedup:true}
     | 400 {error:'validation', fields:[...]} | 401 | 500 (사이트는 1회 재시도 후 포기+자체 로그)
```

- 모든 수신은 `ingest_events`에 원본 저장(status ok|dup|error). 실패 재처리는 어드민에서 이 테이블 replay.
- 처리: validate → normalize → dedup.upsert → brand_sources INSERT → (이벤트별 부수효과: state 후보 계산, doc_items 갱신, alerts 해제, 사전분석 트리거) → Slack 알림 큐.

## 2. 공통 payload 필드

```jsonc
{
  "site": "glovek|apply|tpartners",
  "occurred_at": "2026-07-27T02:00:00Z",   // UTC ISO
  "email": "", "phone": "", "biz_no": "",  // dedup 키(있는 것만)
  "brand_name": "", "brand_url": "",
  "contact_name": "", "category": "",
  "source_ref": "",                        // 원본 PK/주문번호
  "source_url": ""                         // 사이트 어드민 딥링크(있으면)
}
```

## 3. 이벤트 카탈로그 (event별 추가 필드 + 부수효과)

### 3-1. `lead` — 리드/상담/세미나/게이트 유입
추가 필드: `source`(brands.source enum), `message`, `plan_hint`(consult의 plan_tier/billing_cycle 등), `utm{source,medium,campaign,content,term}`, `referral_code`
| 소스 | site.source 값 | state 후보 |
|---|---|---|
| glovek /api/consult | glovek_consult | contact (상담=이미 컨택 의향) |
| glovek /api/inquiry | glovek_inquiry | lead_new |
| glovek signup | glovek_signup | lead_new |
| apply /consultation | apply_consult | contact |
| apply /seminar | apply_seminar | seminar |
| apply /qna/enter, /smr/enter | apply_qna, apply_smr | lead_new |
| tpartners seminar.register | tp_seminar | seminar |
| tpartners ebook.requestAccess | tp_ebook | lead_new |
부수효과: 신규 브랜드면 **사전분석 트리거**(06의 diagnose 큐에 push) + `#glovek-유입알림` 카드.

**광고·박람회 리드 유입 3경로 (v3 보강 — 사이트 폼을 거치지 않는 리드)**
실데이터 근거: meta_ads 15건·expo 158건은 사이트 폼이 아니라 광고 플랫폼/현장에서 들어온다. 아래 3경로를 모두 지원한다(모두 최종적으로 같은 dedup.upsert를 탄다):

| 경로 | 방법 | idem key | state 후보 |
|---|---|---|---|
| ① 자동(권장) | Meta Lead Ads → Make/Zapier webhook → `POST /api/ingest/lead` `site='admin'`, `source='meta_ads'`, utm 포함 | `meta:{leadgen_id}` | lead_new |
| ② CSV 업로드 | 어드민 화면 "리드 가져오기"(backfill 파서 재사용, source 선택: meta_ads/expo/기타) | `csv:{파일해시}:{행번호}` | lead_new |
| ③ 수동 등록 | 어드민 M1 리드 등록 폼(최소정보 강제: 브랜드명 + email/phone 중 1) | `manual:{admin_user}:{ts}` | lead_new |

- `site` enum에 `admin` 추가(광고·수동·CSV 유입 공통). 마케팅 담당자가 노션에 적던 것을 이 3경로로 대체한다.
- ①~③ 모두 신규 브랜드면 동일하게 사전분석 트리거 + 유입알림 카드 + 담당 배정 큐를 탄다 — **광고 리드라고 사이트 리드보다 대접이 달라지지 않는다.**

### 3-2. `diagnosis` — glovek 셀프 등급진단
추가 필드: `grade(S|A|B|C)`, `rec_track(onboarding|live)`, `countries[]`, `checks{q1..q5:boolean}`, `missing_certs[]`, `glovek_onb_id`
부수효과: brands.grade/rec_track/countries 갱신(진단이 더 최신이면 덮어씀), brand_signals에 declared 기록, 브리프 재생성 큐.

### 3-3. `payment` — 결제 이벤트
추가 필드: `plan`, `amount`, `pay_kind(subscribe_first|subscribe_renew|once|fail|cancel)`, `pg_ref(tid|order_no)`, `glovek_user_id?`, `apply_customer_id?`
| 소스 | 매핑 |
|---|---|
| glovek subscribe-mall 최초성공 | plan=live_focus_490k, pay_status=subscribed, contract_type=mall, state 후보 contract_done |
| glovek 온보딩/개런티 카드결제 성공 (v3 결정 반영 — 어드민 "결제 안내" 발송 후 브랜드가 glovek 로그인·결제) | plan=onboarding_onetime 또는 guarantee_1m, pay_status=once_paid/subscribed, state 후보 contract_done, 결제 대기 추적 해제 |
| glovek cron 갱신성공/실패 | pay_status subscribed 유지 / past_due (state 불변) |
| glovek 해지 | pay_status=canceled + alerts(pay_overdue 해제, churn 후보 태그) |
| apply _finalize_order_paid | plan=onboarding_onetime, pay_status=once_paid, contract_type=onboarding, state 후보 contract_done, amount=총액 |
부수효과: `#glovek-정산알림` 카드. contract_done 도달 시 doc_items 템플릿 자동 생성(03 참조).

### 3-4. `doc_progress` — apply 온보딩 스텝 진행
추가 필드: `apply_app_id`, `step_no(1..5)`, `step_status(submitted|approved|rejected)`, `summary{company,countries,warehouse_count}`
부수효과: doc_items의 stepN 항목 done 갱신(approved=done). 전체 done → `docs→setup` 게이트 조건 충족 표시 + 담당 Slack. rejected → alerts(doc_missing) + 사유 카드.

### 3-5. `product_sync` — 제품·인증 동기 (10-F·14 연계)
추가 필드: `products:[{name_kr,name_en,cat,price,sku?}]`, `certs:[{product_name,country,cert_type,status}]`, `warehouses:[{country,region,provider?}]`(→14-D logistics_contracts 자동 생성)
부수효과: products_master·product_certs upsert(source_ref로 중복 방지), 창고 요약 → 물류 계약 행 생성.

### 3-6. `contact_logged` — (수동/메일러) 접촉 기록
추가 필드: `channel(email|sms|call|meeting)`, `note`
부수효과: brands.last_contact_at 갱신, stale alert 해제.

## 4. 멱등키 규칙 (사이트 지시서 07과 일치)
- glovek: `consult:{id}` / `inq:{id}` / `diag:{onb_id}:{updated_at}` / `pay:{tid}` / `signup:{user_id}`
- apply: `consult:{id}` / `order:{order_no}` / `step:{app_id}:{step_no}:{status}` / `seminar:{id}` / `qna:{id}` / `smr:{id}` / `psync:{app_id}:{updated_at}`
- tpartners: `sem:{id}` / `ebook:{id}`

## 5. 검증 규칙
- email/phone/biz_no 셋 다 없으면 400 (dedup 불가 이벤트 거부 — 사이트가 최소 하나를 보내도록 07에서 강제)
- occurred_at 미래값·1년 이전값 거부. amount 음수 거부. enum 외 값 400.

## 6. 테스트 (구현 시 함께 작성)
- [ ] 같은 idem_key 2회 → 두 번째 dedup:true, ingest_events 1건
- [ ] 같은 이메일 lead→payment→doc_progress 순서로 1개 brands 행에 누적
- [ ] payment(fail) 후 subscribe_renew 성공 시 pay_status 복구
- [ ] state 후퇴 시도(운영중 브랜드에 lead 수신) → state 불변, source 이력만 추가
- [ ] 시크릿 불일치 401, 필드 누락 400 케이스


---
## 7. v3 보강 (구현 반영됨 — v0.2 코드와 일치)
- **테스트 필터 내장**: dinostudio.kr·자모 이름 등 → brands.is_test=true 격리(거부 아님).
- **결제 금액 필터**: amount < 100,000 → pay_status 미갱신(이력만) — 실데이터 소액 테스트 결제 근거.
- **복수 이메일 분해**: 콤마 구분 → 1번째 brands.email, 나머지 brand_emails(+14-B brand_contacts로 인물화).
- **smr 규칙**: 이메일 없으면 phone 필수(400).
- **refund**: pay_kind에 'refund' 추가(17 §2) — 환불 시 pay_status 조정+정산 차감.
