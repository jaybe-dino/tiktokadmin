-- ═════════════════════════════════════════════════════════════
-- 101 · 온보딩 — 에이전시명 · 회사자료 다중 첨부 (추가만)
--   의존: onb_customers(0036), onb_files(0038)
--   · 에이전시를 통해 들어온 고객은 발급 시 에이전시명을 적고, 신청서에 그대로 보인다.
--   · 회사자료(브랜드 소개서 등)는 여러 개 올릴 수 있어야 한다 —
--     onb_files 는 이미 (application_id, field) 여러 행을 담을 수 있어 표 추가는 없다.
--     목록·삭제를 위해 활성 여부만 더한다(지운 파일은 남겨두고 감춘다 — 실수 복구 가능).
-- ═════════════════════════════════════════════════════════════

-- 앞단 에이전시 이름(없으면 빈 값 = 직접 유입).
ALTER TABLE onb_customers ADD COLUMN IF NOT EXISTS agency_name text NOT NULL DEFAULT '';

-- 첨부 목록에서 감추기(하드 삭제하지 않는다).
ALTER TABLE onb_files ADD COLUMN IF NOT EXISTS removed_at timestamptz;
CREATE INDEX IF NOT EXISTS onb_files_field_idx ON onb_files (application_id, field, created_at DESC);
