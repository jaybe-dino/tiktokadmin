-- ═════════════════════════════════════════════════════════════
-- 23 · 지정 메일함 발송 + Gmail 임시저장
--   수집(gmail.readonly)에 더해, 회신을 "고객이 보낸 그 공용 메일함"(예: cs@glovek.space)
--   으로 발송하거나 그 메일함의 Gmail 임시보관함에 저장한다(gmail.compose 위임).
--   from_mailbox 미설정 초안은 기존대로 Resend 발신주소로 발송(하위호환).
-- ═════════════════════════════════════════════════════════════

-- 이 초안을 어느 공용 메일함으로 발송/임시저장할지. NULL 이면 Resend 폴백.
ALTER TABLE email_drafts ADD COLUMN IF NOT EXISTS from_mailbox text;
-- Gmail 임시보관함에 저장했을 때의 draft id (담당자가 Gmail 에서 마저 발송·수정).
ALTER TABLE email_drafts ADD COLUMN IF NOT EXISTS gmail_draft_id text;
-- 발송 채널 기록 — 'gmail' | 'resend' (감사/대조용).
ALTER TABLE email_drafts ADD COLUMN IF NOT EXISTS sent_via text;

-- status 에 'gmail_drafted'(임시저장 완료, 담당자가 Gmail 에서 발송 예정) 허용.
--   기존 status 는 free text(체크제약 없음)라 값만 추가로 사용 — DDL 변경 불필요.
