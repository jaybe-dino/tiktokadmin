-- ═════════════════════════════════════════════════════════════
-- 96 · 신규 리드 연속 안내(드립) — 유입 후 N일간 매일 정해진 시각에 문자·메일 발송.
--   기존 1회성 자동안내(welcome_config / intake_channels)의 확장.
--   설정 단위는 "유입 소스"(intake_sources.key) — 유입 루트마다 기간·시각·문구를 따로 둔다.
--     · lead_sequence_config : 소스별 일정(며칠·몇 시·옵션)
--     · lead_sequence_steps  : 소스별 × 일차별 문구·채널
--     · lead_sequence_sends  : 브랜드별 예약·발송 이력(브랜드×일차 1회 — 멱등)
-- ═════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS lead_sequence_config (
  source_key text PRIMARY KEY,                       -- intake_sources.key
  enabled boolean NOT NULL DEFAULT false,
  days int NOT NULL DEFAULT 7 CHECK (days BETWEEN 1 AND 30),
  hour int NOT NULL DEFAULT 10 CHECK (hour BETWEEN 0 AND 23),   -- 발송 시각(KST 시)
  day1_immediate boolean NOT NULL DEFAULT true,      -- 1일차는 유입 즉시(기존 자동안내와 동일)
  skip_weekend boolean NOT NULL DEFAULT false,
  stop_on_progress boolean NOT NULL DEFAULT true,    -- 상담·미팅 등 단계 진전 시 중단
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lead_sequence_steps (
  source_key text NOT NULL,
  day_no int NOT NULL CHECK (day_no BETWEEN 1 AND 30),
  enabled boolean NOT NULL DEFAULT true,
  send_sms boolean NOT NULL DEFAULT true,
  send_email boolean NOT NULL DEFAULT true,
  sms_body text NOT NULL DEFAULT '',
  email_subject text NOT NULL DEFAULT '',
  email_body text NOT NULL DEFAULT '',
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_key, day_no)
);

CREATE TABLE IF NOT EXISTS lead_sequence_sends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  source_key text NOT NULL DEFAULT '',         -- 어느 유입 루트의 일정으로 예약됐는지
  day_no int NOT NULL,
  due_at timestamptz NOT NULL,                 -- 예정 시각
  sent_at timestamptz,
  channels text[] NOT NULL DEFAULT '{}',       -- 실제 나간 채널(sms/email)
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','sent','skipped','failed','canceled')),
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (brand_id, day_no)
);
CREATE INDEX IF NOT EXISTS lead_sequence_sends_due_idx ON lead_sequence_sends (status, due_at);
CREATE INDEX IF NOT EXISTS lead_sequence_sends_brand_idx ON lead_sequence_sends (brand_id);

-- 수신거부 — 요청한 브랜드에는 자동 문자·메일을 보내지 않는다(법적 요구·재발송 방지).
ALTER TABLE brands ADD COLUMN IF NOT EXISTS msg_opt_out boolean NOT NULL DEFAULT false;
