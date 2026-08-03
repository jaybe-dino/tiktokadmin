-- ═════════════════════════════════════════════════════════════
-- 17 · 등급 5대 지표 보정 (기획 확정: 담당자가 보정, 미입력=입력 필요,
--   운영(live) 전이 전 5개 모두 입력 필수)
--   {"q1":true,"q2":false} — 키 없음 = 미입력. 등급은 gradeFromChecks 로 재계산.
-- ═════════════════════════════════════════════════════════════
ALTER TABLE brands ADD COLUMN IF NOT EXISTS grade_checks jsonb NOT NULL DEFAULT '{}';
