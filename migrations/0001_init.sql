-- ─────────────────────────────────────────────────────────────
-- 01 · DB 스키마 — 공유 Postgres 신규 테이블 (어드민 소유)
--
-- 소유권 규칙:
--   · 어드민이 쓰는 테이블: 이 파일의 모든 테이블
--   · 읽기전용 참조(glovek 기존): users, orders, payments, subscriptions,
--     mall_subscriptions, onboarding_applications, onboarding_files,
--     consult_requests, consult_progress, inquiries, referrers, utm_events,
--     brand_stats, brand_shop_stats, products, videos, creators
--   · glovek 테이블로의 INSERT/UPDATE/DELETE 금지 (lib/db.ts 가드로 강제)
-- ─────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1) 원장: 브랜드 마스터
CREATE TABLE IF NOT EXISTS brands (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_name    text NOT NULL,
  brand_name_en text DEFAULT '',
  biz_no        text UNIQUE,             -- 숫자만 정규화, NULL 허용
  email         text UNIQUE,             -- 소문자 정규화, dedup 1차키
  phone         text,                    -- 숫자만 정규화
  contact_name  text DEFAULT '',
  category      text DEFAULT '',
  brand_url     text DEFAULT '',         -- 대표 판매채널(스마트스토어 등)
  -- 퍼널
  state text NOT NULL DEFAULT 'lead_new'
    CHECK (state IN ('lead_new','seminar','meeting','contact','contract_review',
      'contract_done','docs','setup','live_mall','live_onboarding','settling',
      'dropped','churned')),
  contract_type text CHECK (contract_type IN ('mall','onboarding')),
  source text NOT NULL DEFAULT 'etc',    -- glovek_consult|glovek_inquiry|glovek_signup|apply_consult|apply_seminar|apply_qna|apply_smr|tp_seminar|tp_ebook|referrer|expo|etc
  plan text CHECK (plan IN ('live_focus_490k','guarantee_1m','onboarding_onetime','pro_89k')),
  pay_status text NOT NULL DEFAULT 'none'
    CHECK (pay_status IN ('none','once_paid','subscribed','past_due','canceled')),
  countries text[] DEFAULT '{}',
  -- 진단(사전분석)
  grade text CHECK (grade IN ('S','A','B','C')),
  rec_track text CHECK (rec_track IN ('onboarding','live')),
  churn_risk text NOT NULL DEFAULT 'low' CHECK (churn_risk IN ('low','mid','high')),
  brief_md text,                         -- 사전분석 브리프(마크다운)
  -- 담당/액션
  owner_intake text, owner_sales text, owner_onboard text, owner_ads text,  -- admin_users.id
  next_action text DEFAULT '',
  due_date date,
  last_contact_at timestamptz,
  stage_entered_at timestamptz NOT NULL DEFAULT now(),
  -- 소스 연결(읽기전용 참조 키)
  glovek_user_id text,                   -- glovek users.id
  glovek_onb_id text,                    -- onboarding_applications.id (onb_{user_id})
  apply_customer_id int,                 -- apply customers.id
  apply_app_id int,                      -- apply tiktok_shop_applications.id
  tp_registration_id int,                -- tpartners seminar_registrations.id
  referral_code text,                    -- glovek referrers.code
  memo text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS brands_state_idx        ON brands (state);
CREATE INDEX IF NOT EXISTS brands_due_date_idx      ON brands (due_date);
CREATE INDEX IF NOT EXISTS brands_last_contact_idx  ON brands (last_contact_at);
CREATE INDEX IF NOT EXISTS brands_phone_idx         ON brands (phone);

-- 2) 소스 이력: 한 브랜드에 여러 유입/이벤트 원본을 남김 (원본 링크 포함)
CREATE TABLE IF NOT EXISTS brand_sources (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id   uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  site       text NOT NULL CHECK (site IN ('glovek','apply','tpartners','manual')),
  event      text NOT NULL,              -- lead|diagnosis|payment|doc_progress ...
  source_ref text,                       -- 원본 PK/주문번호 등
  source_url text,                       -- 각 사이트 어드민 딥링크
  payload    jsonb NOT NULL DEFAULT '{}',-- 정규화 payload 원본
  occurred_at timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site, event, source_ref)       -- 멱등
);
CREATE INDEX IF NOT EXISTS brand_sources_brand_idx ON brand_sources (brand_id, occurred_at);

-- 3) 상태 이력(이벤트 소싱) — 전환율·체류일·감사로그의 원천
CREATE TABLE IF NOT EXISTS stage_history (
  id         bigserial PRIMARY KEY,
  brand_id   uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  from_state text, to_state text NOT NULL,
  actor      text NOT NULL,              -- admin:{id}|slack:{user}|mcp:{agent}|ingest:{site}
  gate_passed boolean NOT NULL DEFAULT true,
  reason     text DEFAULT '',
  at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS stage_history_brand_idx ON stage_history (brand_id, at);
CREATE INDEX IF NOT EXISTS stage_history_gate_idx  ON stage_history (gate_passed, at);

-- 4) 서류 체크리스트 (apply application_steps와 동기화 + 자체 항목)
CREATE TABLE IF NOT EXISTS doc_items (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id  uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  template  text NOT NULL CHECK (template IN ('mall','onboarding')),
  item_key  text NOT NULL,               -- biz_reg|trademark|gmail|signup_form|logistics|step1..step5|product_info|detail_translation
  label     text NOT NULL,
  done      boolean NOT NULL DEFAULT false,
  source    text DEFAULT 'admin',        -- admin|apply_step (apply와 동기화 항목 표시)
  apply_step_no int,                      -- apply application_steps.step_no 매핑 시
  done_at   timestamptz, done_by text,
  UNIQUE (brand_id, item_key)
);

-- 5) 수기 결제 기록 (Guarantee 100만 등 코드상 결제 없는 건)
CREATE TABLE IF NOT EXISTS payments_manual (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id  uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  plan      text NOT NULL, amount int NOT NULL, method text DEFAULT '계좌이체',
  paid_at   date NOT NULL, next_due date, note text DEFAULT '',
  created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payments_manual_brand_idx ON payments_manual (brand_id, paid_at);

-- 6) 사전분석 신호 (크롤러·국내신호 수집 결과)
CREATE TABLE IF NOT EXISTS brand_signals (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id  uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  source    text NOT NULL,               -- glovek_crawler|smartstore|coupang|instagram|tiktok|declared
  metric    text NOT NULL,               -- reviews|rating|followers|est_gmv|price_band|monthly_rev_declared|first_gmv
  value_num numeric, value_text text,
  confidence text NOT NULL DEFAULT 'mid' CHECK (confidence IN ('low','mid','high')),
  collected_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS brand_signals_brand_idx ON brand_signals (brand_id, metric);

-- 7) 알림/에스컬레이션 상태
CREATE TABLE IF NOT EXISTS alerts (
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  kind     text NOT NULL,                -- sla_breach|gate_violation|doc_missing|pay_overdue|stale
  tier     int NOT NULL DEFAULT 0,       -- 0,1,2,3
  message  text NOT NULL,
  slack_ts text, channel text,
  snoozed_until timestamptz,
  resolved_at timestamptz, resolved_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- 브랜드당 같은 종류 1개만 활성 (해결 시 resolved 후 재생성). 부분 유니크 인덱스로 구현.
  UNIQUE (brand_id, kind)
);
CREATE INDEX IF NOT EXISTS alerts_active_idx ON alerts (resolved_at, tier);

-- 8) 자가학습 인사이트
CREATE TABLE IF NOT EXISTS insights (
  id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  week   date NOT NULL,                  -- 해당 주 월요일
  metric text NOT NULL, value jsonb NOT NULL,
  finding text DEFAULT '', proposed_action text DEFAULT '',
  approved boolean, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS insights_week_idx ON insights (week);

-- 9) 어드민 사용자/역할
CREATE TABLE IF NOT EXISTS admin_users (
  id   text PRIMARY KEY,                 -- 이메일
  name text NOT NULL, role text NOT NULL
    CHECK (role IN ('intake','sales','onboard','ads','settle','lead','exec')),
  slack_user_id text, active boolean NOT NULL DEFAULT true
);

-- 10) ingest 원본 로그(디버그·재처리)
CREATE TABLE IF NOT EXISTS ingest_events (
  id      bigserial PRIMARY KEY,
  site    text NOT NULL, event text NOT NULL, idem_key text NOT NULL,
  payload jsonb NOT NULL, status text NOT NULL DEFAULT 'ok',  -- ok|dup|error
  error   text, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site, event, idem_key)
);

-- 11) SLA 정책(편집 가능 — 자가학습이 제안, 사람이 승인)
CREATE TABLE IF NOT EXISTS sla_policies (
  state text PRIMARY KEY, max_days int NOT NULL, note text DEFAULT ''
);
INSERT INTO sla_policies (state, max_days, note) VALUES
  ('lead_new',2,'2일 내 1차 컨택'),('meeting',5,''),('contact',10,''),
  ('contract_done',2,'서류 착수'),('docs',7,'서류 100%'),('setup',10,''),
  ('live_mall',14,'접촉 공백'),('live_onboarding',14,'접촉 공백')
ON CONFLICT (state) DO NOTHING;

-- updated_at 자동 갱신 트리거
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS brands_set_updated_at ON brands;
CREATE TRIGGER brands_set_updated_at BEFORE UPDATE ON brands
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
