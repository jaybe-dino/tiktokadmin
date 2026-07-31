# 01 · DB 스키마 — 공유 Postgres 신규 테이블 (어드민 소유)

> Claude Code 지시: 아래 DDL을 `migrations/` 순번 파일로 만들고 적용 스크립트를 작성해줘. glovek 기존 테이블은 **절대 수정하지 않는다**(읽기전용 참조만).

## 0. 소유권 규칙

- **어드민이 쓰는 테이블**: 이 문서의 신규 테이블 전부 (`brands`, `brand_sources`, `stage_history`, `doc_items`, `payments_manual`, `brand_signals`, `alerts`, `insights`, `admin_users`, `ingest_events`, `sla_policies`).
- **읽기전용 참조(glovek 기존)**: `users, orders, payments, subscriptions, mall_subscriptions, onboarding_applications, onboarding_files, consult_requests, consult_progress, inquiries, referrers, utm_events, brand_stats, brand_shop_stats, products, videos, creators`.
- 어드민 코드에서 glovek 테이블로의 INSERT/UPDATE/DELETE는 금지. 필요하면 ingest 이벤트로 우회하거나 glovek 쪽에 기능 요청.

## 1. DDL (전체)

```sql
-- 1) 원장: 브랜드 마스터
CREATE TABLE brands (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_name    text NOT NULL,
  brand_name_en text DEFAULT '',
  biz_no        text UNIQUE,                    -- 숫자만 정규화, NULL 허용
  email         text UNIQUE,                    -- 소문자 정규화, dedup 1차키
  phone         text,                           -- 숫자만 정규화
  contact_name  text DEFAULT '',
  category      text DEFAULT '',
  brand_url     text DEFAULT '',                -- 대표 판매채널(스마트스토어 등)
  -- 퍼널
  state         text NOT NULL DEFAULT 'lead_new'
    CHECK (state IN ('lead_new','seminar','meeting','contact','contract_review',
      'contract_done','docs','setup','live_mall','live_onboarding','settling',
      'dropped','churned')),
  contract_type text CHECK (contract_type IN ('mall','onboarding')),
  source        text NOT NULL DEFAULT 'etc',    -- glovek_consult|glovek_inquiry|glovek_signup|apply_consult|apply_seminar|apply_qna|apply_smr|tp_seminar|tp_ebook|referrer|expo|etc
  plan          text CHECK (plan IN ('live_focus_490k','guarantee_1m','onboarding_onetime','pro_89k')),
  pay_status    text NOT NULL DEFAULT 'none'
    CHECK (pay_status IN ('none','once_paid','subscribed','past_due','canceled')),
  countries     text[] DEFAULT '{}',
  -- 진단(사전분석)
  grade         text CHECK (grade IN ('S','A','B','C')),
  rec_track     text CHECK (rec_track IN ('onboarding','live')),
  churn_risk    text NOT NULL DEFAULT 'low' CHECK (churn_risk IN ('low','mid','high')),
  brief_md      text,                           -- 사전분석 브리프(마크다운)
  -- 담당/액션
  owner_intake  text, owner_sales text, owner_onboard text, owner_ads text,  -- admin_users.id
  next_action   text DEFAULT '',
  due_date      date,
  last_contact_at  timestamptz,
  stage_entered_at timestamptz NOT NULL DEFAULT now(),
  -- 소스 연결(읽기전용 참조 키)
  glovek_user_id     text,                      -- glovek users.id
  glovek_onb_id      text,                      -- onboarding_applications.id (onb_{user_id})
  apply_customer_id  int,                       -- apply customers.id
  apply_app_id       int,                       -- apply tiktok_shop_applications.id
  tp_registration_id int,                       -- tpartners seminar_registrations.id
  referral_code      text,                      -- glovek referrers.code
  memo          text DEFAULT '',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON brands (state); CREATE INDEX ON brands (due_date);
CREATE INDEX ON brands (last_contact_at); CREATE INDEX ON brands (phone);

-- 2) 소스 이력: 한 브랜드에 여러 유입/이벤트 원본을 남김 (원본 링크 포함)
CREATE TABLE brand_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  site text NOT NULL CHECK (site IN ('glovek','apply','tpartners','manual')),
  event text NOT NULL,                          -- lead|diagnosis|payment|doc_progress ...
  source_ref text,                              -- 원본 PK/주문번호 등
  source_url text,                              -- 각 사이트 어드민 딥링크
  payload jsonb NOT NULL DEFAULT '{}',          -- 정규화 payload 원본
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site, event, source_ref)              -- 멱등
);

-- 3) 상태 이력(이벤트 소싱) — 전환율·체류일·감사로그의 원천
CREATE TABLE stage_history (
  id bigserial PRIMARY KEY,
  brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  from_state text, to_state text NOT NULL,
  actor text NOT NULL,                          -- admin:{id}|slack:{user}|mcp:{agent}|ingest:{site}
  gate_passed boolean NOT NULL DEFAULT true,
  reason text DEFAULT '',
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON stage_history (brand_id, at);

-- 4) 서류 체크리스트 (apply application_steps와 동기화 + 자체 항목)
CREATE TABLE doc_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  template text NOT NULL CHECK (template IN ('mall','onboarding')),
  item_key text NOT NULL,                       -- biz_reg|trademark|gmail|signup_form|logistics|step1..step5|product_info|detail_translation
  label text NOT NULL,
  done boolean NOT NULL DEFAULT false,
  source text DEFAULT 'admin',                  -- admin|apply_step (apply와 동기화 항목 표시)
  apply_step_no int,                            -- apply application_steps.step_no 매핑 시
  done_at timestamptz, done_by text,
  UNIQUE (brand_id, item_key)
);

-- 5) 수기 결제 기록 (Guarantee 100만 등 코드상 결제 없는 건)
CREATE TABLE payments_manual (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  plan text NOT NULL, amount int NOT NULL, method text DEFAULT '계좌이체',
  paid_at date NOT NULL, next_due date, note text DEFAULT '',
  created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);

-- 6) 사전분석 신호 (크롤러·국내신호 수집 결과)
CREATE TABLE brand_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  source text NOT NULL,                         -- glovek_crawler|smartstore|coupang|instagram|tiktok|declared
  metric text NOT NULL,                         -- reviews|rating|followers|est_gmv|price_band|monthly_rev_declared
  value_num numeric, value_text text,
  confidence text NOT NULL DEFAULT 'mid' CHECK (confidence IN ('low','mid','high')),
  collected_at timestamptz NOT NULL DEFAULT now()
);

-- 7) 알림/에스컬레이션 상태
CREATE TABLE alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  kind text NOT NULL,                           -- sla_breach|gate_violation|doc_missing|pay_overdue|stale
  tier int NOT NULL DEFAULT 0,                  -- 0,1,2,3
  message text NOT NULL,
  slack_ts text, channel text,
  snoozed_until timestamptz,
  resolved_at timestamptz, resolved_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (brand_id, kind)                       -- 브랜드당 같은 종류 1개 활성(해결 시 resolved 후 재생성)
);

-- 8) 자가학습 인사이트
CREATE TABLE insights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  week date NOT NULL,                           -- 해당 주 월요일
  metric text NOT NULL, value jsonb NOT NULL,
  finding text DEFAULT '', proposed_action text DEFAULT '',
  approved boolean, created_at timestamptz NOT NULL DEFAULT now()
);

-- 9) 어드민 사용자/역할
CREATE TABLE admin_users (
  id text PRIMARY KEY,                          -- 이메일
  name text NOT NULL, role text NOT NULL
    CHECK (role IN ('intake','sales','onboard','ads','settle','lead','exec')),
  slack_user_id text, active boolean NOT NULL DEFAULT true
);

-- 10) ingest 원본 로그(디버그·재처리)
CREATE TABLE ingest_events (
  id bigserial PRIMARY KEY,
  site text NOT NULL, event text NOT NULL, idem_key text NOT NULL,
  payload jsonb NOT NULL, status text NOT NULL DEFAULT 'ok',  -- ok|dup|error
  error text, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site, event, idem_key)
);

-- 11) SLA 정책(편집 가능 — 자가학습이 제안, 사람이 승인)
CREATE TABLE sla_policies (
  state text PRIMARY KEY, max_days int NOT NULL, note text DEFAULT ''
);
INSERT INTO sla_policies VALUES
 ('lead_new',2,'2일 내 1차 컨택'),('meeting',5,''),('contact',10,''),
 ('contract_done',2,'서류 착수'),('docs',7,'서류 100%'),('setup',10,''),
 ('live_mall',14,'접촉 공백'),('live_onboarding',14,'접촉 공백');
```

## 2. dedup 알고리즘 (`lib/dedup.ts`)

```
normalize: email→lower/trim, phone→숫자만, biz_no→숫자만
find(payload):
  1. email 있으면 brands WHERE email=norm → hit 시 반환
  2. phone 매칭 → 3. biz_no 매칭 → 4. brand_name(정확) AND brand_url(호스트 동일)
upsert(payload):
  hit → UPDATE(비어있는 필드만 채움; state는 규칙에 따라 전진만, 후퇴 금지) + brand_sources INSERT
  miss → INSERT + brand_sources INSERT
※ state 전진 규칙: ingest가 계산한 후보 state가 현재보다 퍼널상 뒤면 무시(사람/게이트만 후퇴 가능)
```

## 3. 초기 적재(backfill) — `scripts/backfill.ts`

1. glovek: `consult_requests`, `inquiries`, `users`(+referred_by), `onboarding_applications`(grade·track·status), `orders/payments/mall_subscriptions` → 시간순 재생하여 brands 구성.
2. apply: `consultation_requests`, `seminar_applicants`, `qna_leads`, `smr_leads`, `onboarding_orders(paid)`, `tiktok_shop_applications`+`application_steps` → dedup 병합. (SQLite 덤프 CSV를 입력으로 받는 스크립트로: apply에는 외부 API가 없음)
3. tpartners: `seminar_registrations`, `ebook_leads` CSV → 병합. (UTC→KST 변환, brandName 컬럼의 폼별 의미 차이 처리: fasttrack=brandLink, marketing=inquiry)
4. 결과 리포트 출력: 총 브랜드 수, 병합 건수, 충돌(같은 이메일·다른 브랜드명) 목록 → 사람 검수.

## 4. 완료 기준
- [ ] 마이그레이션 1회 실행으로 전체 스키마 생성
- [ ] dedup 단위테스트(이메일/전화/사업자/URL 4경로 + state 후퇴 금지)
- [ ] backfill 드라이런 모드(--dry)에서 병합 리포트 출력
- [ ] glovek 테이블 쓰기 시도 시 코드 레벨 가드(금지 목록) 동작


---
## 5. 〔v3 부록〕 이 문서 이후 확정된 스키마 변경 — 코드(migrations/001·002)가 정본

- **brands 추가 컬럼**: `is_test`(테스트 격리) · `version`(낙관적 잠금, 13) · `owner_backup`(09-B) · `notion_page_url`
- **source enum 확정(실측)**: tp_seminar·tp_ebook·apply_seminar·apply_consult·apply_qna·apply_smr·apply_onboarding·glovek_consult·glovek_inquiry·glovek_signup·**expo·meta_ads**·referrer·manual·etc
- **신규 테이블**: `brand_aliases`(표기충돌 261건 대응) · `brand_emails`(복수 주소) · `sync_state`(PULL 커서) + 002: teams·approval_requests·access_log·comments·presence
- **SLA 실측값**: meeting 7일 · docs 10일 (002에서 UPDATE)
- **dedup 확장**: 4단계 + brand_aliases·brand_contacts(14-B) 매칭
- 이후 마이그레이션: 003 card_gaps(14) · 004 communications(08·09) · 005 operations(15) · 006 portal(16) · 007 lifecycle(17)
