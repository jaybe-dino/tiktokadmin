-- ═════════════════════════════════════════════════════════════
-- 28 · 유입 소스(키)별 자동발송 히스토리 — 소스마다 어떤 리드에 문자·메일이
--   나갔는지 기록. 개인정보 최소화: 브랜드 참조 + 브랜드명 + 매체 여부만 저장(연락처 원문 X).
-- ═════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS channel_sends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id uuid NOT NULL REFERENCES intake_channels(id) ON DELETE CASCADE,
  brand_id uuid REFERENCES brands(id) ON DELETE SET NULL,
  brand_name text NOT NULL DEFAULT '',
  sms_sent boolean NOT NULL DEFAULT false,
  email_sent boolean NOT NULL DEFAULT false,
  sent_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS channel_sends_channel_idx ON channel_sends (channel_id, sent_at DESC);
