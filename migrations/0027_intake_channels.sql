-- ═════════════════════════════════════════════════════════════
-- 27 · 유입 채널(주제별 키) — Zapier/외부 DB 가 주제별 키로 POST 하면
--   어드민에서 사전 등록한 채널로 매칭 → 채널별 문자·메일 내용/토글 적용.
--   /api/leadhook?key=<채널키> 로 들어오고, 채널마다 실시간 on/off.
-- ═════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS intake_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text UNIQUE NOT NULL,                 -- POST 인증/식별 키 (주제별, 랜덤)
  name text NOT NULL,                       -- 표시명/주제 (예: "메타 뷰티 리드", "9월 세미나")
  source text NOT NULL DEFAULT 'meta_ads',  -- 유입 소스 라벨 (lib/types SOURCES)
  enabled boolean NOT NULL DEFAULT true,     -- 자동발송 마스터 on/off (off=유입만, 발송 안 함)
  send_sms boolean NOT NULL DEFAULT true,    -- 문자 자동발송
  send_email boolean NOT NULL DEFAULT true,  -- 메일 자동발송
  sms_template text NOT NULL DEFAULT '',
  email_subject text NOT NULL DEFAULT '',
  email_body text NOT NULL DEFAULT '',
  note text NOT NULL DEFAULT '',
  lead_count int NOT NULL DEFAULT 0,
  last_lead_at timestamptz,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS intake_channels_key_idx ON intake_channels (key);
