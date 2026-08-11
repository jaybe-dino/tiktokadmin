-- 미팅 '매칭 필요' 목록에서 무시 처리 — 미팅 자체를 삭제하지 않고 목록에서만 제외.
--   별도 '매칭 무시 목록'에서 복원(다시 매칭 필요로)하거나 완전 삭제 가능.
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS match_dismissed boolean NOT NULL DEFAULT false;
