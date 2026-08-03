-- ═════════════════════════════════════════════════════════════
-- 26 · email_drafts.status 제약 확장
--   0008 의 CHECK (draft|approved|sent|discarded) 가
--   'sending'(발송 원자적 클레임)·'gmail_drafted'(Gmail 임시보관함 저장) 를 막아
--   발송/임시저장 시 제약 위반 예외 발생 → 상태값 추가 허용.
-- ═════════════════════════════════════════════════════════════

ALTER TABLE email_drafts DROP CONSTRAINT IF EXISTS email_drafts_status_check;
ALTER TABLE email_drafts ADD CONSTRAINT email_drafts_status_check
  CHECK (status IN ('draft','sending','approved','sent','discarded','gmail_drafted'));
