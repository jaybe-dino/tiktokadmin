# 07 · 사이트별 연동 지시서 (요약 · 스펙 원문)

> 🔗 **정본(개발자 전달용)은 `docs/integration/{glovek.space,apply.tpartners.live,tpartners.live}.md`** 입니다.
> 이 문서는 스펙 요약이며, 값이 다를 경우 **integration/ 문서 + `docs/HANDOFF-연동가이드.md` 를 따릅니다.**
> URL 정본: `https://tiktokadmin.vercel.app` · 재시도: 1회(멱등키로 안전) · 공통 규격은 02 문서 기준.

> 전제: 어드민의 02(Ingest API)가 배포되어 `ADMIN_INGEST_URL`·`INGEST_SECRET`이 발급된 상태. 각 사이트 담당(또는 그 레포의 Claude Code)에 아래 해당 블록을 그대로 붙여넣는다. 공통 규격은 02 문서와 동일 — payload·멱등키를 임의 변경하지 말 것.

---

## A. glovek.space (Next.js/Postgres) — 붙여넣을 프롬프트

```
glovek.space에 운영 어드민 ingest 연동을 추가해줘. 서버 사이드에서만 호출한다.
env 추가: ADMIN_INGEST_URL, INGEST_SECRET.

공통: POST {ADMIN_INGEST_URL}/api/ingest/{event}
헤더 X-Ingest-Secret: {INGEST_SECRET}, X-Idempotency-Key: 아래 규칙.
body 공통 필드: site:"glovek", occurred_at(UTC ISO), email, phone, biz_no, brand_name,
brand_url, contact_name, category, source_ref, source_url(어드민 딥링크 가능하면).
실패 시 1회 재시도 후 자체 로그(사용자 응답은 블로킹하지 말고 비동기 fire-and-forget).
카드정보·비밀번호 등 민감정보는 절대 전송 금지.

연동 지점 4곳:
1) /api/consult (consult_requests INSERT 직후)
   → event=lead, source:"glovek_consult", message, plan_hint(있으면), utm(있으면)
   idem: "consult:{id}"
2) /api/inquiry (inquiries INSERT 직후)
   → event=lead, source:"glovek_inquiry", message=payload 요약(kind 포함)
   idem: "inq:{id}"
3) /api/onboarding/apply stage=self_check 저장 직후
   → event=diagnosis, grade, rec_track(recommended_track), countries, checks(q1~q5 불리언),
     missing_certs, glovek_onb_id(onboarding_applications.id)
   idem: "diag:{onb_id}:{updated_at epoch}"
4) /api/payment/subscribe-mall 승인 성공(_finalize 상당) 직후 + /api/cron/subscribe 갱신/실패 + 해지
   → event=payment,
     최초: pay_kind:"subscribe_first", plan:"live_focus_490k", amount, pg_ref=tid
     갱신: pay_kind:"subscribe_renew" 성공/실패(fail), 해지: pay_kind:"cancel", 환불: pay_kind:"refund"(금액 음수)
   idem: "pay:{tid}" (해지는 "cancel:{user_id}:{date}")
추가 1) 가입(signup)에 referral_code(ref)가 있으면 event=lead, source:"referrer",
   referral_code 포함. idem: "signup:{user_id}"

그리고 어드민이 읽기전용 조회할 수 있게 Postgres read-only 롤을 만들어
접속 문자열을 별도 전달해줘(테이블: users, orders, payments, subscriptions,
mall_subscriptions, onboarding_applications, consult_requests, consult_progress,
inquiries, referrers, utm_events, brand_stats, brand_shop_stats).
구현 후: 각 이벤트를 로컬에서 트리거하는 테스트 방법을 알려줘.
```

### glovek 할 일 체크
- [ ] read-only DB 롤 발급 → 어드민 env `GLOVEK_DB_URL_RO`
- [ ] 위 4+1 지점 ingest 발신 + 멱등키
- [ ] referral_code → 어드민 영업담당 매핑 표 전달(referrers.code ↔ 담당자)
- [ ] (보안) SLACK_WEBHOOK 등 하드코딩 값 env 정리

---

## B. apply.tpartners.live (FastAPI/SQLite) — 붙여넣을 프롬프트

```
apply.tpartners.live에 어드민 ingest 연동을 추가해줘(외부 아웃바운드 신규 구현).
env 추가: ADMIN_INGEST_URL, INGEST_SECRET. httpx 비동기 클라이언트, 1회 재시도, 로컬 로그.
공통 규격은 위와 동일(site:"apply"). biz_no는 company_reg_number(숫자만),
brand_url은 sales_channel_url 사용.

연동 지점 6곳:
1) POST /consultation 저장 직후 → event=lead, source:"apply_consult",
   plan_hint:{plan_tier, country_option, billing_cycle, selected_countries}, message=main_inquiry
   idem: "consult:{id}"
2) _finalize_order_paid (onboarding_orders paid 확정) 직후
   → event=payment, pay_kind:"once", plan:"onboarding_onetime",
     amount=total_amount_krw, pg_ref=order_no, apply_customer_id=customer_id
   idem: "order:{order_no}"    ※ 가상계좌 웹훅 경유 확정도 동일 지점이라 중복 없음
3) /apply/step/{n}/... 로 step status 변경(submitted/approved/rejected) 시
   → event=doc_progress, apply_app_id, step_no, step_status,
     summary:{company:company_name_kr, countries:[country_code...], warehouse_count}
   idem: "step:{app_id}:{step_no}:{status}"
   ※ 서류 파일 자체·UBO 신분증 정보는 보내지 말 것(요약만)
4) POST /seminar → event=lead, source:"apply_seminar"  idem:"seminar:{id}"
5) POST /qna/enter → event=lead, source:"apply_qna"    idem:"qna:{id}"
6) POST /smr/enter → event=lead, source:"apply_smr"    idem:"smr:{id}"
   (smr은 email이 없으므로 phone을 반드시 포함)
7) Step4 제품 저장/번역 완료 시 → event=product_sync:
   products[{name_kr,name_en,cat,price(unit_price),sku}], certs[{product_name,country,cert_type,status}]
   idem: "psync:{app_id}:{updated_at epoch}"
8) 창고 정보(tiktok_shop_warehouses) 저장 시 → product_sync.warehouses[{country,region}]에 포함

추가 작업:
- Railway 볼륨이 data/에 마운트되어 있는지 확인하고 안 되어 있으면 설정 방법을 알려줘(필수).
- /docs, /redoc, /openapi.json 노출을 프로덕션에서 차단해줘.
- 관리자 화면의 각 신청 상세 URL 패턴을 알려줘(source_url로 쓸 것).
구현 후: 이벤트별 로컬 테스트 방법을 알려줘.
```

### apply 할 일 체크
- [ ] Railway Persistent Volume 확인(미설정 시 데이터·서류 소실 위험 — 최우선)
- [ ] ingest 6지점 발신 + 멱등키
- [ ] /docs 차단, 하드코딩 시크릿 env 이전
- [ ] 어드민 상세 URL 패턴 공유(딥링크)
- [ ] (중기) SQLite→공유 Postgres 이관 검토

---

## C. tpartners.live (Manus/tRPC/MySQL) — 붙여넣을 프롬프트

```
tpartners.live의 리드를 어드민 ingest로 보내줘.
env 추가: ADMIN_INGEST_URL, INGEST_SECRET. 서버(tRPC 핸들러)에서만 호출.
공통 규격 동일(site:"tpartners"). 타임스탬프는 UTC 그대로 보내라(어드민이 변환).

연동 지점 2곳:
1) seminar.register 성공 직후 → event=lead, source:"tp_seminar",
   brand_name 주의: seminarSession이 fasttrack이면 brandName 컬럼 값은 brandLink(URL)이고
   marketing이면 inquiry 텍스트다 — brand_url/message로 올바르게 분리해서 보내라.
   category, utm 5종, ref, partner, seminarSession 포함. idem: "sem:{id}"
2) ebook.requestAccess 성공 직후 → event=lead, source:"tp_ebook",
   brand_url=brandLink. idem: "ebook:{id}"
email이 빈 문자열일 수 있으니 그 경우 phone만으로 전송(빈 email 필드는 생략).

만약 Manus 환경에서 외부 HTTP 호출이 제한되면:
- 대안 A: seminar.list / ebook.list(adminToken)를 어드민이 주기 폴링할 수 있도록
  전용 read 토큰을 발급하는 방법을 알려줘.
- 대안 B: 세미나 신청 탭에도 CSV 내보내기를 추가해줘(현재 전자책 탭만 있음).
겸사겸사: ADMIN_USERNAME/PASSWORD/토큰과 Slack Webhook URL 하드코딩을 env로 이전해줘.
```

### tpartners 할 일 체크
- [ ] 아웃바운드 HTTP 가능 여부 확인 → 불가 시 폴링 토큰 or CSV export
- [ ] brandName 컬럼 폼별 의미 분리 로직
- [ ] 하드코딩 자격증명·웹훅 URL → env (보안)

---

## D. E2E 검수 시나리오 (연동 완료 판정)

1. tpartners 세미나 신청 → 어드민 brands 생성(state=seminar) + 유입 채널 Slack 카드 + 브리프 생성.
2. 같은 이메일로 glovek /consult 제출 → **새 행이 아니라 같은 brands 행** 갱신(state 전진 contact), brand_sources 2건.
3. glovek 셀프진단 → 같은 행에 grade/rec_track 반영.
4. glovek 멀티몰 결제(테스트) → pay_status=subscribed, state 후보 contract_done, 정산 채널 카드. 같은 tid 재전송 → dedup:true.
5. apply 온보딩 주문 paid → 같은 행 병합(사업자번호 키), doc 템플릿 생성.
6. apply step1 submitted→approved → doc_items 갱신, 100% 도달 시 docs→setup 게이트 통과 가능해짐.
7. 서류 7일 방치 시뮬레이션(stage_entered_at 조작) → cron 후 T0 DM → 다음날 T1 → +2일 파트장 채널.
8. Slack 카드에서 [서류 수령 ✓]·[이동 승인] → DB 반영 + 카드 갱신 확인.
