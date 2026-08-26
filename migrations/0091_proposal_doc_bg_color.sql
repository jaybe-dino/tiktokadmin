-- BUG-21: 운영 제안서 배경색(accent2) — 표지 다크 그라디언트·페이지 틴트 계열을 강조색과 별도로 지정.
--   NULL 이면 기존 기본(핑크·보라 계열) 그대로.
ALTER TABLE proposal_docs ADD COLUMN IF NOT EXISTS accent2 text;
