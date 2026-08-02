-- ═════════════════════════════════════════════════════════════
-- 15 · 관리자 로그인 비밀번호 — 이메일만으로 로그인되던 구멍 차단.
--   해시(scrypt, node:crypto)만 저장. 평문·복호화 불가.
-- ═════════════════════════════════════════════════════════════
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS password_hash text;
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS password_set_at timestamptz;
