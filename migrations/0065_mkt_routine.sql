-- 마케팅 루틴 운영대행 — 계약 기간 + 매월 되돌이 회차(칸반) 관리.
--   루틴 프로젝트(mkt_projects kind='routine')에 계약 기간을 두고, 매월 '회차'를 칸반으로 관리한다.
ALTER TABLE mkt_projects ADD COLUMN IF NOT EXISTS contract_start date;
ALTER TABLE mkt_projects ADD COLUMN IF NOT EXISTS contract_end date;

-- 월별 회차(되돌이표) — 프로젝트당 (연월) 1건. 칸반 단계로 진행.
CREATE TABLE IF NOT EXISTS mkt_routine_cycles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES mkt_projects(id) ON DELETE CASCADE,
  ym text NOT NULL,                       -- 'YYYY-MM'
  stage text NOT NULL DEFAULT 'plan',     -- plan(기획) | running(진행:시딩/라방) | report(리포트) | done(완료·정산)
  note text NOT NULL DEFAULT '',
  report_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, ym)
);
CREATE INDEX IF NOT EXISTS mkt_routine_cycles_proj_idx ON mkt_routine_cycles (project_id, ym DESC);
