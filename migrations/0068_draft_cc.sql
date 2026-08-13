-- 메일 초안 참조(CC) — 브랜드360 메일 작성에서 참조 수신자 지정.
--   발송 시 Resend cc 배열 / Gmail Cc 헤더로 전달(콤마 구분 다중).
ALTER TABLE email_drafts ADD COLUMN IF NOT EXISTS cc_email text;
