-- ═════════════════════════════════════════════════════════════
-- 22 · 발송 템플릿 (기획 확정 9절) — 메일·문자 템플릿을 설정에서 CRUD.
--   {브랜드명} {담당자명} 치환변수 지원. 자동안내·리마인더·발송센터 공용.
-- ═════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS msg_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text UNIQUE NOT NULL,                 -- 예: welcome_sms, welcome_email, doc_reminder
  label text NOT NULL DEFAULT '',
  channel text NOT NULL DEFAULT 'email' CHECK (channel IN ('email','sms')),
  subject text NOT NULL DEFAULT '',         -- email 전용
  body text NOT NULL DEFAULT '',
  updated_by text, updated_at timestamptz NOT NULL DEFAULT now()
);
