-- ═════════════════════════════════════════════════════════════
-- 44 · 마케팅 개별 프로젝트 ↔ 마케팅 제안서 연동.
--   mkt_projects 에 proposals(kind='marketing') FK 추가 → 제안서 작성 시 파이프라인
--   프로젝트를 자동 생성·연결하고, 제안서 상태 변화를 프로젝트 보드에 반영한다.
-- ═════════════════════════════════════════════════════════════
ALTER TABLE mkt_projects
  ADD COLUMN IF NOT EXISTS proposal_id uuid REFERENCES proposals(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS mkt_projects_proposal_idx ON mkt_projects (proposal_id);
