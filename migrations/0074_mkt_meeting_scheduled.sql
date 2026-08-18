-- ═════════════════════════════════════════════════════════════
-- 74 · 마케팅 파이프라인 '미팅 예정' 단계 추가 (BUG-6)
--   · 협의 중(negotiating) → 미팅 예정(meeting_scheduled) → 수주·계약(won)
-- ═════════════════════════════════════════════════════════════

ALTER TABLE mkt_projects DROP CONSTRAINT IF EXISTS mkt_projects_proposal_status_check;
ALTER TABLE mkt_projects ADD CONSTRAINT mkt_projects_proposal_status_check
  CHECK (proposal_status IN ('draft','sent','negotiating','meeting_scheduled','won','dropped'));
