-- ═════════════════════════════════════════════════════════════
-- 96 · 신규 리드 연속 안내(드립) — 유입 후 N일간 정해진 시각에 문자·메일 발송.
--   기존 1회성 자동안내(intake_channels)의 확장.
--   설정 단위는 "유입 소스 키"(intake_channels.id) — 키마다 며칠까지·시각·회차별 문구를 따로 둔다.
--   회차는 day_no 로 센다: 0 = 유입 직후(즉시), 1 = 유입 1일차, 2 = 2일차 …
--     · lead_sequence_config : 키별 일정(몇 일차까지·기본 시각·옵션)
--     · lead_sequence_steps  : 키별 × 회차별 문구·채널·그 회차만의 발송 시각
--     · lead_sequence_sends  : 브랜드별 예약·발송 이력(브랜드×일차 1회 — 멱등)
-- ═════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS lead_sequence_config (
  channel_id uuid PRIMARY KEY REFERENCES intake_channels(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  days int NOT NULL DEFAULT 5 CHECK (days BETWEEN 1 AND 30),    -- 몇 일차까지(유입 직후는 별도 회차)
  hour int NOT NULL DEFAULT 10 CHECK (hour BETWEEN 0 AND 23),   -- 기본 발송 시각(KST 시)
  stop_on_progress boolean NOT NULL DEFAULT true,    -- 상담·미팅 등 단계 진전 시 중단
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lead_sequence_steps (
  channel_id uuid NOT NULL REFERENCES intake_channels(id) ON DELETE CASCADE,
  day_no int NOT NULL CHECK (day_no BETWEEN 0 AND 30),   -- 0 = 유입 직후
  enabled boolean NOT NULL DEFAULT true,
  send_sms boolean NOT NULL DEFAULT true,
  send_email boolean NOT NULL DEFAULT true,
  send_hour int CHECK (send_hour BETWEEN 0 AND 23),  -- NULL 이면 키 기본 시각(유입 직후 회차는 무시)
  sms_body text NOT NULL DEFAULT '',
  email_subject text NOT NULL DEFAULT '',
  email_body text NOT NULL DEFAULT '',
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_id, day_no)
);

CREATE TABLE IF NOT EXISTS lead_sequence_sends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  channel_id uuid REFERENCES intake_channels(id) ON DELETE SET NULL,  -- 어느 키의 일정인지
  day_no int NOT NULL,
  due_at timestamptz NOT NULL,                 -- 예정 시각
  sent_at timestamptz,
  channels text[] NOT NULL DEFAULT '{}',       -- 실제 나간 수단(sms/email)
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','sent','skipped','failed','canceled')),
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (brand_id, day_no)
);
CREATE INDEX IF NOT EXISTS lead_sequence_sends_due_idx ON lead_sequence_sends (status, due_at);
CREATE INDEX IF NOT EXISTS lead_sequence_sends_brand_idx ON lead_sequence_sends (brand_id);
CREATE INDEX IF NOT EXISTS lead_sequence_sends_channel_idx ON lead_sequence_sends (channel_id);

-- 수신거부 — 요청한 브랜드에는 자동 문자·메일을 보내지 않는다(법적 요구·재발송 방지).
ALTER TABLE brands ADD COLUMN IF NOT EXISTS msg_opt_out boolean NOT NULL DEFAULT false;
