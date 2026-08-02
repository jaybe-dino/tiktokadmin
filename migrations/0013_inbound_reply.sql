-- ═════════════════════════════════════════════════════════════
-- 13 · 인바운드 자동 회신 초안 — 고객 메일 수신 시 AI 요약 + 근거기반 회신 초안
--   원칙: 에이전트는 "초안"까지만 생성. 발송은 담당자 승인(초안함) 후.
-- ═════════════════════════════════════════════════════════════

-- ── 수신 메일에 회신 처리 상태·AI 요약 부여 ────────────────────
ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS reply_state text NOT NULL DEFAULT 'none'
  CHECK (reply_state IN ('none','drafted','replied','ignored'));
ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS ai_summary text;
CREATE INDEX IF NOT EXISTS email_messages_reply_state_idx
  ON email_messages (reply_state) WHERE direction='in';

-- ── 초안에 원본 메일 연결·인바운드 요약·출처 부여 ─────────────
ALTER TABLE email_drafts ADD COLUMN IF NOT EXISTS in_reply_to uuid
  REFERENCES email_messages(id) ON DELETE SET NULL;
ALTER TABLE email_drafts ADD COLUMN IF NOT EXISTS context_summary text;  -- AI 인바운드 요약(담당 검토용)
ALTER TABLE email_drafts ADD COLUMN IF NOT EXISTS source text DEFAULT 'manual';  -- inbound_agent|meeting|manual|contextual
