-- ═════════════════════════════════════════════════════════════
-- 96 · 신규 리드 연속 안내(드립) — 유입 후 N일간 매일 정해진 시각에 문자·메일 발송.
--   기존 1회성 자동안내(welcome_config)를 확장한다. 일차마다 다른 문구를 쓴다.
--   · lead_sequence_steps : 일차별 문구·채널 설정(전역 1벌)
--   · lead_sequence_sends : 브랜드별 예약·발송 이력(브랜드×일차 1회 — 멱등)
-- ═════════════════════════════════════════════════════════════

-- 전역 스위치·일정은 기존 자동안내 설정에 함께 둔다(화면이 하나이므로).
ALTER TABLE welcome_config ADD COLUMN IF NOT EXISTS seq_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE welcome_config ADD COLUMN IF NOT EXISTS seq_days int NOT NULL DEFAULT 7;      -- 며칠간
ALTER TABLE welcome_config ADD COLUMN IF NOT EXISTS seq_hour int NOT NULL DEFAULT 10;     -- 발송 시각(KST 시)
ALTER TABLE welcome_config ADD COLUMN IF NOT EXISTS seq_day1_immediate boolean NOT NULL DEFAULT true; -- 1일차는 유입 즉시(기존 동작)
ALTER TABLE welcome_config ADD COLUMN IF NOT EXISTS seq_skip_weekend boolean NOT NULL DEFAULT false;  -- 주말 건너뛰기
ALTER TABLE welcome_config ADD COLUMN IF NOT EXISTS seq_stop_on_progress boolean NOT NULL DEFAULT true; -- 단계 진전 시 중단

CREATE TABLE IF NOT EXISTS lead_sequence_steps (
  day_no int PRIMARY KEY CHECK (day_no BETWEEN 1 AND 30),
  enabled boolean NOT NULL DEFAULT true,
  send_sms boolean NOT NULL DEFAULT true,
  send_email boolean NOT NULL DEFAULT true,
  sms_body text NOT NULL DEFAULT '',
  email_subject text NOT NULL DEFAULT '',
  email_body text NOT NULL DEFAULT '',
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lead_sequence_sends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
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
