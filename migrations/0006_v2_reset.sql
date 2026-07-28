-- ═════════════════════════════════════════════════════════════
-- 06 · v2 리셋 — 실제 운영 퍼널(Notion + 계약 이후)로 스키마 재정의
--
-- ⚠️ 어드민 소유 테이블만 DROP/재생성한다. glovek 실서비스 테이블
--    (users·orders·payments·videos·creators·brand_stats 등)은 절대 건드리지 않는다.
-- ═════════════════════════════════════════════════════════════

-- 1) 어드민 테이블만 제거 (glovek 테이블 목록에 없는 것들)
DROP TABLE IF EXISTS brand_emails      CASCADE;
DROP TABLE IF EXISTS brand_stage_checks CASCADE;
DROP TABLE IF EXISTS brand_files       CASCADE;
DROP TABLE IF EXISTS proposals         CASCADE;
DROP TABLE IF EXISTS brand_signals     CASCADE;
DROP TABLE IF EXISTS alerts            CASCADE;
DROP TABLE IF EXISTS insights          CASCADE;
DROP TABLE IF EXISTS stage_requirements CASCADE;
DROP TABLE IF EXISTS doc_items         CASCADE;
DROP TABLE IF EXISTS payments_manual   CASCADE;
DROP TABLE IF EXISTS brand_sources     CASCADE;
DROP TABLE IF EXISTS stage_history     CASCADE;
DROP TABLE IF EXISTS ingest_events     CASCADE;
DROP TABLE IF EXISTS admin_users       CASCADE;
DROP TABLE IF EXISTS sla_policies      CASCADE;
DROP TABLE IF EXISTS brands            CASCADE;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 2) 브랜드 마스터 (새 퍼널)
CREATE TABLE brands (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_name    text NOT NULL,
  brand_name_en text DEFAULT '',
  biz_no        text UNIQUE,
  email         text UNIQUE,
  phone         text,
  contact_name  text DEFAULT '',
  category      text DEFAULT '',
  brand_url     text DEFAULT '',
  state text NOT NULL DEFAULT 'inquiry'
    CHECK (state IN ('inquiry','seminar','expo','meeting','contact',
      'contract_review','contract_done','setup','live','settling',
      'dropped','churned')),
  contract_type text CHECK (contract_type IN ('glovek','onboarding')),
  source text NOT NULL DEFAULT 'etc',
  plan text CHECK (plan IN ('live_focus_490k','guarantee_1m','onboarding_onetime','pro_89k')),
  pay_status text NOT NULL DEFAULT 'none'
    CHECK (pay_status IN ('none','once_paid','subscribed','past_due','canceled')),
  countries text[] DEFAULT '{}',
  certified_countries text[] DEFAULT '{}',
  grade text CHECK (grade IN ('S','A','B','C')),
  rec_track text CHECK (rec_track IN ('onboarding','live')),
  churn_risk text NOT NULL DEFAULT 'low' CHECK (churn_risk IN ('low','mid','high')),
  brief_md text,
  owner_intake text, owner_sales text, owner_onboard text, owner_ads text,
  next_action text DEFAULT '',
  due_date date,
  last_contact_at timestamptz,
  stage_entered_at timestamptz NOT NULL DEFAULT now(),
  glovek_user_id text, glovek_onb_id text,
  apply_customer_id int, apply_app_id int, tp_registration_id int,
  referral_code text,
  memo text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX brands_state_idx       ON brands (state);
CREATE INDEX brands_due_date_idx     ON brands (due_date);
CREATE INDEX brands_last_contact_idx ON brands (last_contact_at);
CREATE INDEX brands_phone_idx        ON brands (phone);

-- 3) 소스 이력
CREATE TABLE brand_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  site text NOT NULL CHECK (site IN ('glovek','apply','tpartners','manual')),
  event text NOT NULL, source_ref text, source_url text,
  payload jsonb NOT NULL DEFAULT '{}', occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site, event, source_ref)
);
CREATE INDEX brand_sources_brand_idx ON brand_sources (brand_id, occurred_at);

-- 4) 상태 이력
CREATE TABLE stage_history (
  id bigserial PRIMARY KEY,
  brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  from_state text, to_state text NOT NULL, actor text NOT NULL,
  gate_passed boolean NOT NULL DEFAULT true, reason text DEFAULT '',
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX stage_history_brand_idx ON stage_history (brand_id, at);
CREATE INDEX stage_history_gate_idx  ON stage_history (gate_passed, at);

-- 5) 서류 체크리스트
CREATE TABLE doc_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  template text NOT NULL CHECK (template IN ('glovek','onboarding')),
  item_key text NOT NULL, label text NOT NULL,
  done boolean NOT NULL DEFAULT false, source text DEFAULT 'admin',
  apply_step_no int, done_at timestamptz, done_by text,
  UNIQUE (brand_id, item_key)
);

-- 6) 수기 결제
CREATE TABLE payments_manual (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  plan text NOT NULL, amount int NOT NULL, method text DEFAULT '계좌이체',
  paid_at date NOT NULL, next_due date, note text DEFAULT '',
  ext_ref text,
  created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payments_manual_brand_idx ON payments_manual (brand_id, paid_at);
CREATE UNIQUE INDEX payments_manual_ext_ref_idx ON payments_manual (brand_id, ext_ref) WHERE ext_ref IS NOT NULL;

-- 7) 사전분석 신호
CREATE TABLE brand_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  source text NOT NULL, metric text NOT NULL,
  value_num numeric, value_text text,
  confidence text NOT NULL DEFAULT 'mid' CHECK (confidence IN ('low','mid','high')),
  collected_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX brand_signals_brand_idx ON brand_signals (brand_id, metric);

-- 8) 알림
CREATE TABLE alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  kind text NOT NULL, tier int NOT NULL DEFAULT 0, message text NOT NULL,
  slack_ts text, channel text, snoozed_until timestamptz,
  resolved_at timestamptz, resolved_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (brand_id, kind)
);
CREATE INDEX alerts_active_idx ON alerts (resolved_at, tier);

-- 9) 인사이트
CREATE TABLE insights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  week date NOT NULL, metric text NOT NULL, value jsonb NOT NULL,
  finding text DEFAULT '', proposed_action text DEFAULT '',
  approved boolean, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX insights_week_idx ON insights (week);

-- 10) 어드민 사용자
CREATE TABLE admin_users (
  id text PRIMARY KEY, name text NOT NULL,
  role text NOT NULL CHECK (role IN ('intake','sales','onboard','ads','settle','lead','exec')),
  slack_user_id text, active boolean NOT NULL DEFAULT true
);

-- 11) ingest 로그
CREATE TABLE ingest_events (
  id bigserial PRIMARY KEY,
  site text NOT NULL, event text NOT NULL, idem_key text NOT NULL,
  payload jsonb NOT NULL, status text NOT NULL DEFAULT 'ok', error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site, event, idem_key)
);

-- 12) SLA 정책 (새 상태)
CREATE TABLE sla_policies (state text PRIMARY KEY, max_days int NOT NULL, note text DEFAULT '');
INSERT INTO sla_policies (state, max_days, note) VALUES
  ('inquiry',3,'3일 내 1차 컨택'),('seminar',3,''),('expo',3,''),
  ('meeting',5,''),('contact',10,''),
  ('contract_done',2,'서류 착수'),('setup',10,'서류·입점'),
  ('live',14,'접촉 공백');

-- 13) 단계별 필수항목 (새 상태)
CREATE TABLE stage_requirements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  state text NOT NULL, kind text NOT NULL CHECK (kind IN ('check','field')),
  field_key text, label text NOT NULL,
  required boolean NOT NULL DEFAULT true, sort int NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX stage_requirements_state_idx ON stage_requirements (state, active);
INSERT INTO stage_requirements (state, kind, field_key, label, sort) VALUES
  ('meeting','field','category','카테고리 입력',1),
  ('meeting','check',NULL,'니즈·예산 파악',2),
  ('contact','check',NULL,'제안서 발송',1),
  ('contract_done','check',NULL,'계약서 서명본 수령',1),
  ('setup','check',NULL,'서류 원본 대조',1),
  ('setup','check',NULL,'입점 계정 생성 확인',2),
  ('live','check',NULL,'킥오프 미팅 완료',1);

CREATE TABLE brand_stage_checks (
  brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  req_id uuid NOT NULL REFERENCES stage_requirements(id) ON DELETE CASCADE,
  done boolean NOT NULL DEFAULT false, done_by text, done_at timestamptz,
  PRIMARY KEY (brand_id, req_id)
);

-- 14) 고객 자료(파일 링크)
CREATE TABLE brand_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('intro_deck','meeting_notes','meeting_recording','history','contract','etc')),
  label text NOT NULL, url text NOT NULL, note text DEFAULT '',
  uploaded_by text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX brand_files_brand_idx ON brand_files (brand_id, kind);

-- 15) 제안서
CREATE TABLE proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  title text NOT NULL, url text DEFAULT '', amount int,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','accepted','rejected')),
  note text DEFAULT '', created_by text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX proposals_brand_idx ON proposals (brand_id);

-- 16) 고객 이메일
CREATE TABLE brand_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  direction text NOT NULL DEFAULT 'unknown' CHECK (direction IN ('in','out','unknown')),
  from_addr text, to_addr text, subject text, snippet text,
  owner_part text, owner_id text, message_id text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  linked_by text, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (brand_id, message_id)
);
CREATE INDEX brand_emails_brand_idx ON brand_emails (brand_id, occurred_at DESC);

-- updated_at 트리거
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS brands_set_updated_at ON brands;
CREATE TRIGGER brands_set_updated_at BEFORE UPDATE ON brands
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
