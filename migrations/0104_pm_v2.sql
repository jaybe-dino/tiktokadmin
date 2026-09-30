-- ═════════════════════════════════════════════════════════════
-- 104 · 브랜드360 PM 1차 확장 (추가만 — 기존 표/컬럼/값을 바꾸지 않는다)
--   의존: 0099_pm_agent.sql (pm_kpis · pm_tasks · pm_task_events)
--
--   역할은 "내부 틱톡샵 PM" 이다 — 이 표들로 브랜드사에 직접 발송하지 않는다.
--   추가하는 것
--     · KPI 분류(계약 의무 / 브랜드 기대 / 내부 실행)와 합의 상태, 근거 원문, 변경이력
--     · 계약 조건 관리(범위·수량·기간·제외·협조사항)
--     · 대화 맥락 추출(질문·요청·약속·결정·미해결) + 계약 대조 + 내부 답변 초안
--     · 업무의 KPI/추출 연결 · 대기 주체(고객/내부) · 실행결과와 완료 근거
--     · 담당자별 내부 알림 설정과 발송 원장(수신자 확정 전 OFF)
--   ※ 미확인 실적을 0 으로 적지 않기 위해 수치 컬럼은 모두 NULL 허용이다.
-- ═════════════════════════════════════════════════════════════

-- ── ② KPI 분류·합의 상태·근거 원문 ─────────────────────────
--   kind      : contract(계약 의무) | expectation(브랜드 기대) | internal(내부 실행)
--   agreement : candidate(대화에서 뽑은 후보) | proposed(우리 제안) | expected(고객 기대)
--               | agreed(양측 합의) — 후보는 담당 확인을 거쳐야 합의가 된다.
ALTER TABLE pm_kpis ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'internal';
ALTER TABLE pm_kpis ADD COLUMN IF NOT EXISTS agreement text NOT NULL DEFAULT 'agreed';
ALTER TABLE pm_kpis ADD COLUMN IF NOT EXISTS confirmed_by text;
ALTER TABLE pm_kpis ADD COLUMN IF NOT EXISTS confirmed_at timestamptz;
ALTER TABLE pm_kpis ADD COLUMN IF NOT EXISTS evidence_kind text NOT NULL DEFAULT '';
ALTER TABLE pm_kpis ADD COLUMN IF NOT EXISTS evidence_id text NOT NULL DEFAULT '';
ALTER TABLE pm_kpis ADD COLUMN IF NOT EXISTS evidence_url text NOT NULL DEFAULT '';
-- 근거 원문을 그대로 보관한다(작성자·시각은 evidence_* 로 원문을 되짚는다).
ALTER TABLE pm_kpis ADD COLUMN IF NOT EXISTS source_quote text NOT NULL DEFAULT '';
ALTER TABLE pm_kpis ADD COLUMN IF NOT EXISTS source_author text NOT NULL DEFAULT '';
ALTER TABLE pm_kpis ADD COLUMN IF NOT EXISTS source_at timestamptz;
ALTER TABLE pm_kpis ADD COLUMN IF NOT EXISTS dedupe_key text;
ALTER TABLE pm_kpis ADD COLUMN IF NOT EXISTS edited_by_human boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pm_kpis_kind_check') THEN
    ALTER TABLE pm_kpis ADD CONSTRAINT pm_kpis_kind_check
      CHECK (kind IN ('contract','expectation','internal'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pm_kpis_agreement_check') THEN
    ALTER TABLE pm_kpis ADD CONSTRAINT pm_kpis_agreement_check
      CHECK (agreement IN ('candidate','proposed','expected','agreed'));
  END IF;
END $$;

-- 대화에서 뽑은 KPI 후보가 반복 실행마다 새로 생기지 않게.
CREATE UNIQUE INDEX IF NOT EXISTS pm_kpis_dedupe_uniq
  ON pm_kpis (brand_id, dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS pm_kpis_kind_idx ON pm_kpis (brand_id, kind, agreement, status);

-- KPI 변경이력(목표·현재값·기간·담당·합의 상태가 언제 누구에 의해 바뀌었는지).
--   향후 성과 학습의 "목표" 축이 된다. 성과 API 연동·인사이트는 이번 범위가 아니다.
CREATE TABLE IF NOT EXISTS pm_kpi_events (
  id bigserial PRIMARY KEY,
  kpi_id uuid NOT NULL REFERENCES pm_kpis(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  field text NOT NULL DEFAULT 'value',
  old_value text NOT NULL DEFAULT '',
  new_value text NOT NULL DEFAULT '',
  actor text NOT NULL DEFAULT '',
  note text NOT NULL DEFAULT '',
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pm_kpi_events_kpi_idx ON pm_kpi_events (kpi_id, at DESC);
CREATE INDEX IF NOT EXISTS pm_kpi_events_brand_idx ON pm_kpi_events (brand_id, at DESC);

-- ── ② 계약 조건(범위·수량·기간·제외·협조사항) ─────────────
CREATE TABLE IF NOT EXISTS pm_contract_terms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  kind text NOT NULL
    CHECK (kind IN ('scope','quantity','period','exclusion','cooperation')),
  label text NOT NULL,
  detail text NOT NULL DEFAULT '',
  -- 수량은 미입력(NULL)과 0 을 구분한다.
  quantity numeric,
  unit text NOT NULL DEFAULT '',
  period_start date,
  period_end date,
  -- candidate = 대화·문서에서 뽑은 후보(담당 확인 전) · agreed = 확정
  -- disputed  = 양측 인식이 다름 · void = 무효/해지
  status text NOT NULL DEFAULT 'candidate'
    CHECK (status IN ('candidate','agreed','disputed','void')),
  evidence_kind text NOT NULL DEFAULT '',
  evidence_id text NOT NULL DEFAULT '',
  evidence_url text NOT NULL DEFAULT '',
  evidence_label text NOT NULL DEFAULT '',
  source_quote text NOT NULL DEFAULT '',
  source_author text NOT NULL DEFAULT '',
  source_at timestamptz,
  confirmed_by text,
  confirmed_at timestamptz,
  dedupe_key text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pm_contract_terms_brand_idx ON pm_contract_terms (brand_id, kind, status);
CREATE UNIQUE INDEX IF NOT EXISTS pm_contract_terms_dedupe_uniq
  ON pm_contract_terms (brand_id, dedupe_key) WHERE dedupe_key IS NOT NULL;

-- ── ③ 대화 맥락 추출 + 계약 대조 ───────────────────────────
CREATE TABLE IF NOT EXISTS pm_extractions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  kind text NOT NULL
    CHECK (kind IN ('question','request','promise','decision','open')),
  title text NOT NULL,
  detail text NOT NULL DEFAULT '',
  -- 계약 대조 — unknown(대조 불가) | within(범위 안) | outside(범위 밖) | conflict(충돌)
  contract_check text NOT NULL DEFAULT 'unknown'
    CHECK (contract_check IN ('unknown','within','outside','conflict')),
  contract_term_id uuid REFERENCES pm_contract_terms(id) ON DELETE SET NULL,
  contract_note text NOT NULL DEFAULT '',
  -- 원문 보존: 출처·작성자·시각·인용
  evidence_kind text NOT NULL DEFAULT '',
  evidence_id text NOT NULL DEFAULT '',
  evidence_url text NOT NULL DEFAULT '',
  evidence_label text NOT NULL DEFAULT '',
  source_quote text NOT NULL DEFAULT '',
  source_author text NOT NULL DEFAULT '',
  occurred_at timestamptz,
  -- 내부 산출물 — 답변 초안은 담당자가 읽고 직접 보내는 것이며 자동 발송 대상이 아니다.
  reply_draft text NOT NULL DEFAULT '',
  internal_checks text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'new'
    CHECK (status IN ('new','confirmed','answered','dismissed')),
  origin text NOT NULL DEFAULT 'ai' CHECK (origin IN ('ai','rules','human')),
  confirmed_by text,
  confirmed_at timestamptz,
  answered_by text,
  answered_at timestamptz,
  edited_by_human boolean NOT NULL DEFAULT false,
  dedupe_key text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pm_extractions_brand_idx ON pm_extractions (brand_id, status, kind);
CREATE UNIQUE INDEX IF NOT EXISTS pm_extractions_dedupe_uniq
  ON pm_extractions (brand_id, dedupe_key) WHERE dedupe_key IS NOT NULL;

-- ── ④ 업무 ↔ KPI/추출 연결 · 대기 주체 · 실행결과 ──────────
ALTER TABLE pm_tasks ADD COLUMN IF NOT EXISTS kpi_id uuid REFERENCES pm_kpis(id) ON DELETE SET NULL;
ALTER TABLE pm_tasks ADD COLUMN IF NOT EXISTS extraction_id uuid REFERENCES pm_extractions(id) ON DELETE SET NULL;
-- none(우리가 진행) | customer(고객 회신 대기) | internal(내부 확인 대기)
ALTER TABLE pm_tasks ADD COLUMN IF NOT EXISTS waiting_on text NOT NULL DEFAULT 'none';
ALTER TABLE pm_tasks ADD COLUMN IF NOT EXISTS waiting_since timestamptz;
ALTER TABLE pm_tasks ADD COLUMN IF NOT EXISTS result_note text NOT NULL DEFAULT '';
-- 완료 근거 — 비어 있으면 완료로 넘기지 않는다(코드에서 막는다).
ALTER TABLE pm_tasks ADD COLUMN IF NOT EXISTS result_evidence text NOT NULL DEFAULT '';
ALTER TABLE pm_tasks ADD COLUMN IF NOT EXISTS result_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pm_tasks_waiting_on_check') THEN
    ALTER TABLE pm_tasks ADD CONSTRAINT pm_tasks_waiting_on_check
      CHECK (waiting_on IN ('none','customer','internal'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS pm_tasks_waiting_idx ON pm_tasks (brand_id, waiting_on, status);
CREATE INDEX IF NOT EXISTS pm_tasks_kpi_idx ON pm_tasks (kpi_id);

-- ── ⑤ 담당자별 내부 알림 ───────────────────────────────────
--   기본 OFF · 수신자 목록이 비면 어떤 경우에도 보내지 않는다.
--   브랜드사(고객)에게는 이 경로로 아무것도 나가지 않는다 — 수신자는 admin_users 뿐이다.
CREATE TABLE IF NOT EXISTS pm_notify_config (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled boolean NOT NULL DEFAULT false,
  urgent_enabled boolean NOT NULL DEFAULT false,
  daily_enabled boolean NOT NULL DEFAULT false,
  weekly_enabled boolean NOT NULL DEFAULT false,
  daily_hour int NOT NULL DEFAULT 9 CHECK (daily_hour BETWEEN 0 AND 23),
  daily_minute int NOT NULL DEFAULT 10 CHECK (daily_minute BETWEEN 0 AND 59),
  weekly_weekday int NOT NULL DEFAULT 1 CHECK (weekly_weekday BETWEEN 0 AND 6),
  weekly_hour int NOT NULL DEFAULT 9 CHECK (weekly_hour BETWEEN 0 AND 23),
  weekly_minute int NOT NULL DEFAULT 40 CHECK (weekly_minute BETWEEN 0 AND 59),
  -- 수신자는 admin_users.id 만 넣는다(고객 주소가 들어갈 자리가 없다).
  recipients text[] NOT NULL DEFAULT '{}',
  note text NOT NULL DEFAULT '',
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO pm_notify_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS pm_notify_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('urgent','daily','weekly')),
  recipient text NOT NULL,                      -- admin_users.id
  -- 중복 방지 키: 일간=날짜 · 주간=주차 · 긴급=업무 id
  period_key text NOT NULL,
  brand_count int NOT NULL DEFAULT 0,
  item_count int NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','sent','skipped','failed')),
  channel text NOT NULL DEFAULT 'slack',
  provider_id text NOT NULL DEFAULT '',
  error text NOT NULL DEFAULT '',
  skip_reason text NOT NULL DEFAULT '',
  body_preview text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  -- 같은 종류 · 같은 수신자 · 같은 기간은 1건.
  UNIQUE (kind, recipient, period_key)
);
CREATE INDEX IF NOT EXISTS pm_notify_log_created_idx ON pm_notify_log (created_at DESC);
