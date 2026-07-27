# 07 · 사이트별 연동 지시서 (각 사이트 팀/Claude Code에 전달)

> 전제: 어드민의 Ingest API 가 배포되어 `ADMIN_INGEST_URL`·`INGEST_SECRET` 이 발급된 상태.
> 공통 규격은 [`docs/02-INGEST-API`](#) 및 `lib/ingest.ts` 와 동일 — payload·멱등키를 임의 변경하지 말 것.
>
> 이 세 사이트(glovek.space / apply.tpartners.live / tpartners.live)는 **별도 레포**라 이 어드민 레포에서 직접 수정할 수 없다.
> 아래 블록을 해당 사이트의 개발자(또는 그 레포의 Claude Code 세션)에 그대로 붙여넣는다.

공통 규격:

```
POST {ADMIN_INGEST_URL}/api/ingest/{event}
Headers:
  X-Ingest-Secret: {INGEST_SECRET}
  X-Idempotency-Key: <site별 유니크 키>
  Content-Type: application/json
Body 공통: { site, occurred_at(UTC ISO), email, phone, biz_no, brand_name,
             brand_url, contact_name, category, source_ref, source_url }
응답: 200 {ok,brand_id,created} | 200 {ok,dedup:true} | 400 | 401 | 500
실패 시 1회 재시도 후 자체 로그(사용자 응답 블로킹 금지, fire-and-forget).
카드정보·비밀번호·신분증 등 민감정보 전송 금지(요약 필드 + 원본 링크만).
```

이벤트: `lead` · `diagnosis` · `payment` · `doc_progress` · `contact_logged`

---

## A. glovek.space (Next.js/Postgres)

```
glovek.space에 운영 어드민 ingest 연동을 추가해줘. 서버 사이드에서만 호출한다.
env 추가: ADMIN_INGEST_URL, INGEST_SECRET.

연동 지점 4+1곳:
1) /api/consult (consult_requests INSERT 직후)
   → event=lead, source:"glovek_consult", message, plan_hint, utm.  idem: "consult:{id}"
2) /api/inquiry (inquiries INSERT 직후)
   → event=lead, source:"glovek_inquiry", message=요약(kind 포함).  idem: "inq:{id}"
3) /api/onboarding/apply stage=self_check 저장 직후
   → event=diagnosis, grade, rec_track(recommended_track), countries, checks(q1~q5),
     missing_certs, glovek_onb_id.  idem: "diag:{onb_id}:{updated_at epoch}"
4) /api/payment/subscribe-mall 승인 성공 + /api/cron/subscribe 갱신/실패 + 해지
   → event=payment.
     최초: pay_kind:"subscribe_first", plan:"live_focus_490k", amount, pg_ref=tid
     갱신: pay_kind:"subscribe_renew", result:"ok"|"fail"
     해지: pay_kind:"cancel"
   idem: "pay:{tid}" (해지는 "cancel:{user_id}:{date}")
+1) signup 에 referral_code(ref) 있으면 event=lead, source:"referrer", referral_code.  idem:"signup:{user_id}"

그리고 어드민이 읽기전용 조회할 수 있게 Postgres read-only 롤을 만들어 접속 문자열을
GLOVEK_DB_URL_RO 로 전달해줘(테이블: users, orders, payments, subscriptions,
mall_subscriptions, onboarding_applications, consult_requests, consult_progress,
inquiries, referrers, utm_events, brand_stats, brand_shop_stats).
구현 후: 각 이벤트를 로컬에서 트리거하는 테스트 방법을 알려줘.
```

할 일: read-only 롤 발급 · 4+1 ingest 발신 · referral_code↔영업담당 매핑표 · 하드코딩 시크릿 env 정리.

---

## B. apply.tpartners.live (FastAPI/SQLite)

```
apply.tpartners.live에 어드민 ingest 연동을 추가해줘(외부 아웃바운드 신규 구현).
env 추가: ADMIN_INGEST_URL, INGEST_SECRET. httpx 비동기, 1회 재시도, 로컬 로그.
site:"apply". biz_no=company_reg_number(숫자만), brand_url=sales_channel_url.

연동 지점 6곳:
1) POST /consultation → event=lead, source:"apply_consult",
   plan_hint:{plan_tier,country_option,billing_cycle,selected_countries}, message=main_inquiry.  idem:"consult:{id}"
2) _finalize_order_paid → event=payment, pay_kind:"once", plan:"onboarding_onetime",
   amount=total_amount_krw, pg_ref=order_no, apply_customer_id=customer_id.  idem:"order:{order_no}"
3) /apply/step/{n} status 변경 → event=doc_progress, apply_app_id, step_no, step_status,
   summary:{company,countries,warehouse_count}.  idem:"step:{app_id}:{step_no}:{status}"
   ※ 서류 파일·UBO 신분증 정보 전송 금지(요약만)
4) POST /seminar → event=lead, source:"apply_seminar".  idem:"seminar:{id}"
5) POST /qna/enter → event=lead, source:"apply_qna".  idem:"qna:{id}"
6) POST /smr/enter → event=lead, source:"apply_smr" (email 없으므로 phone 필수).  idem:"smr:{id}"

추가: Railway Persistent Volume(data/) 확인(미설정 시 데이터·서류 소실 — 최우선),
/docs·/redoc·/openapi.json 프로덕션 차단, 관리자 상세 URL 패턴(source_url용) 공유.
```

할 일: Railway 볼륨 확인 · 6지점 발신 · /docs 차단 · 하드코딩 시크릿 env · (중기)SQLite→Postgres.

---

## C. tpartners.live (Manus/tRPC/MySQL)

```
tpartners.live의 리드를 어드민 ingest로 보내줘. env: ADMIN_INGEST_URL, INGEST_SECRET. tRPC 핸들러에서만.
site:"tpartners". 타임스탬프는 UTC 그대로(어드민이 KST 변환).

연동 지점 2곳:
1) seminar.register 성공 → event=lead, source:"tp_seminar".
   brandName 주의: seminarSession=fasttrack이면 brandName=brandLink(URL)→brand_url,
   marketing이면 inquiry 텍스트→message 로 분리. category, utm5, ref, partner, seminarSession 포함.  idem:"sem:{id}"
2) ebook.requestAccess 성공 → event=lead, source:"tp_ebook", brand_url=brandLink.  idem:"ebook:{id}"
email 빈 문자열이면 phone만으로 전송(빈 email 필드 생략).

Manus 아웃바운드 제한 시 — 대안A: seminar.list/ebook.list(adminToken) 폴링 read 토큰 발급,
대안B: 세미나 탭 CSV export 추가. 겸사겸사 ADMIN 자격증명·Slack Webhook URL 하드코딩→env.
```

할 일: 아웃바운드 가능여부 확인 · brandName 폼별 분리 · 하드코딩 자격증명 env.

---

## D. E2E 검수 시나리오

1. tpartners 세미나 신청 → brands 생성(state=seminar) + 유입 Slack 카드 + 브리프.
2. 같은 이메일 glovek /consult → **새 행 아님**, 같은 brands 갱신(state 전진 contact), brand_sources 2건.
3. glovek 셀프진단 → 같은 행 grade/rec_track 반영.
4. glovek 멀티몰 결제 → pay_status=subscribed, state 후보 contract_done. 같은 tid 재전송 → dedup:true.
5. apply 온보딩 주문 paid → 같은 행 병합(사업자번호 키), doc 템플릿 생성.
6. apply step1 submitted→approved → doc_items 갱신, 100% 도달 시 docs→setup 게이트 통과 가능.
7. 서류 7일 방치(stage_entered_at 조작) → cron 후 T0 DM → 다음날 T1 → +2일 파트장 채널.
8. Slack 카드 [서류 수령 ✓]·[이동 승인] → DB 반영 + 카드 갱신.
