-- ═════════════════════════════════════════════════════════════
-- 81 · 온보딩 파이프라인 수동 단계 이동(드래그앤드롭) 오버라이드
--   자동 파생 단계 위에 담당자가 수동으로 지정한 단계를 우선 적용.
-- ═════════════════════════════════════════════════════════════
ALTER TABLE brands ADD COLUMN IF NOT EXISTS onb_stage_override text;
ALTER TABLE brands ADD COLUMN IF NOT EXISTS onb_stage_override_at timestamptz;
