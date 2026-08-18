-- ═════════════════════════════════════════════════════════════
-- 73 · 보류(hold) 단계 추가
--   · 영업 파이프라인 맨 앞의 파킹 단계. 어느 단계에서든 언제든 진입.
--   · SLA 3영업일 — 초과 시 기존 sla-check 크론이 breach 알림/에스컬레이션.
-- ═════════════════════════════════════════════════════════════

-- 1) state CHECK 재확정 (기존 값 + hold)
ALTER TABLE brands DROP CONSTRAINT IF EXISTS brands_state_check;
ALTER TABLE brands ADD CONSTRAINT brands_state_check CHECK (state IN (
  'lead_new','seminar','meeting','contact','contract_review','contract_done',
  'docs','setup','live_mall','live_onboarding','settling','dropped','churned','hold'));

-- 2) SLA 정책 — 보류는 최대 3영업일
INSERT INTO sla_policies (state, max_days, note)
VALUES ('hold', 3, '보류 최대 3일 — 초과 시 에스컬레이션')
ON CONFLICT (state) DO UPDATE SET max_days=EXCLUDED.max_days, note=EXCLUDED.note;
