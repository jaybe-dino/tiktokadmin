-- ═════════════════════════════════════════════════════════════
-- 24 · 기본 발신 메일함 — 아웃바운드(팔로업·신규리드 안내·미팅초대 등
--   '받은 메일이 아닌' 발송)를 Resend 대신 지정 Gmail 공용 메일함에서 발송.
--   인바운드 회신은 기존대로 그 메일함(from_mailbox)으로 발송.
-- ═════════════════════════════════════════════════════════════

ALTER TABLE shared_mailboxes ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false;

-- 기본 발신 메일함은 최대 1개 — 부분 유니크 인덱스로 보장.
CREATE UNIQUE INDEX IF NOT EXISTS shared_mailboxes_one_default
  ON shared_mailboxes ((is_default)) WHERE is_default;
