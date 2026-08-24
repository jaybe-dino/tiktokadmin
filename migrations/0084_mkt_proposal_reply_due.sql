-- 마케팅 제안서 회신 예정일 — 제안 후 브랜드 회신을 기대하는 날짜(팔로업 관리용).
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS reply_due_date date;
