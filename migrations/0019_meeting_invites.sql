-- ═════════════════════════════════════════════════════════════
-- 19 · 미팅 초대 (PLAN-기획확정 §8 미팅)
--   브랜드360 "1:1 미팅 잡기" + 미팅캘린더 참석자/일정 수정 + ICS 이메일 초대.
--   meetings 확장 — attendees 는 어드민이 초대한 참석자([{name,email}]),
--   zoom webhook 이 채우는 participants(실참가자)와 별개로 유지.
-- ═════════════════════════════════════════════════════════════

ALTER TABLE meetings ADD COLUMN IF NOT EXISTS attendees jsonb DEFAULT '[]';  -- [{name,email}]
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS zoom_join_url text;            -- 참가 링크(초대 메일 본문·ICS LOCATION)
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS created_by text;               -- 등록한 어드민(admin_users.id)
