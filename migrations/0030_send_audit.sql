-- ═════════════════════════════════════════════════════════════
-- 30 · 발송 내용 감사(오발송 관리) — 실제 발송된 문자·메일 내용 스냅샷 기록 +
--   채널 테스트 모드(실발송 없이 내용만 기록해 사전 검증).
--   민감정보(카드·신분증·비번)는 템플릿에 없으므로 저장 안전. 수신처는 마스킹.
-- ═════════════════════════════════════════════════════════════

ALTER TABLE channel_sends ADD COLUMN IF NOT EXISTS to_masked text;      -- 수신처(마스킹)
ALTER TABLE channel_sends ADD COLUMN IF NOT EXISTS sms_body text;       -- 실제 발송된 문자 본문
ALTER TABLE channel_sends ADD COLUMN IF NOT EXISTS email_subject text;  -- 실제 발송된 메일 제목
ALTER TABLE channel_sends ADD COLUMN IF NOT EXISTS email_body text;     -- 실제 발송된 메일 본문
ALTER TABLE channel_sends ADD COLUMN IF NOT EXISTS dry_run boolean NOT NULL DEFAULT false;  -- 테스트(미발송)

-- 채널 테스트 모드 — ON 이면 실발송 없이 '발송될 내용'만 기록(오발송 사전검증).
ALTER TABLE intake_channels ADD COLUMN IF NOT EXISTS test_mode boolean NOT NULL DEFAULT false;
