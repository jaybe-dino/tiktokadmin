-- ═════════════════════════════════════════════════════════════
-- 16 · 신규 리드 자동 안내 — 안내 대상 소스로 유입된 리드에
--   기본 문자(SMS)+이메일 자동 발송(1회). (추후 메타/페북 광고 리드 확장)
-- ═════════════════════════════════════════════════════════════

-- 단일 행 설정(id=1 고정). enabled + 자동 대상 소스 + 템플릿.
CREATE TABLE IF NOT EXISTS welcome_config (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled boolean NOT NULL DEFAULT false,          -- 자동 발송 on/off
  sources text[] NOT NULL DEFAULT '{}',            -- 자동 대상 lead source(예: meta_ads, glovek_consult)
  send_sms boolean NOT NULL DEFAULT true,
  send_email boolean NOT NULL DEFAULT true,
  sms_template text NOT NULL DEFAULT '[GloveK] {브랜드명}님, 문의 감사합니다. 담당자가 곧 연락드리겠습니다. 궁금한 점은 회신주세요.',
  email_subject text NOT NULL DEFAULT '[GloveK] {브랜드명}님, 문의 감사합니다',
  email_body text NOT NULL DEFAULT '{브랜드명} 담당자님, 안녕하세요. GloveK입니다.\n\n문의 주셔서 감사합니다. 담당자가 확인 후 1영업일 내 연락드리겠습니다.\n틱톡샵 해외진출 관련 궁금한 점은 본 메일에 회신해 주세요.\n\n감사합니다.\nGloveK 드림',
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO welcome_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- 브랜드별 안내 발송 이력(멱등) + 수동 안내 대상 체크
ALTER TABLE brands ADD COLUMN IF NOT EXISTS welcome_opt boolean NOT NULL DEFAULT false;   -- 수동 '안내 필요' 체크
ALTER TABLE brands ADD COLUMN IF NOT EXISTS welcome_sent_at timestamptz;
ALTER TABLE brands ADD COLUMN IF NOT EXISTS welcome_channels text[] DEFAULT '{}';
