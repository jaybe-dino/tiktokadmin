-- 온보딩 발급 코드 평문 보관 — 관리자 목록에서 코드를 재확인/재전달할 수 있도록.
--   로그인 검증은 여전히 해시(access_code_hash)로 수행하며, 평문은 관리자 표시 전용이다.
ALTER TABLE onb_customers ADD COLUMN IF NOT EXISTS access_code_plain text;
