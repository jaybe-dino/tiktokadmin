-- 영업 파이프라인 단순화: 계약완료 이후 '서류수급'/'입점셋업' 단계 폐지 — '운영 중'으로 직행.
--   레거시로 docs/setup 상태에 남아있던 브랜드는 계약형태 기준 운영중(live_mall/live_onboarding)으로 일괄 이관.
WITH snap AS (
  SELECT id, state AS from_state, contract_type FROM brands WHERE state IN ('docs', 'setup')
), moved AS (
  UPDATE brands b
     SET state = CASE WHEN s.contract_type = 'onboarding' THEN 'live_onboarding' ELSE 'live_mall' END,
         stage_entered_at = now()
    FROM snap s
   WHERE b.id = s.id
  RETURNING b.id, s.from_state, b.state AS to_state
)
INSERT INTO stage_history (brand_id, from_state, to_state, actor, gate_passed, reason)
SELECT id, from_state, to_state, 'migration:0085', true, '서류수급/입점셋업 단계 폐지 — 운영중으로 일괄 이관'
  FROM moved;
