-- ═════════════════════════════════════════════════════════════
-- 53 · 채널별 수신 DB 칼럼 선택 — 리드 자동발송 채널 세팅 시 어떤 brands 칼럼을
--   받을지 선택하고, 그 칼럼을 POST URL 쿼리 파라미터로 담아 통합(Zapier 등)에 전달.
-- ═════════════════════════════════════════════════════════════

ALTER TABLE intake_channels
  ADD COLUMN IF NOT EXISTS capture_fields text[] NOT NULL DEFAULT '{}';
