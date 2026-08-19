-- ═════════════════════════════════════════════════════════════
-- 76 · 마케팅 제안서 문서(운영 제안서와 별개)
--   · 예산 입력값을 저장하고, 렌더 시 mkt-proposal 엔진으로 월별 계획 재계산.
--   · 파이프라인(mkt_projects) 연동: mkt_project_id.
-- ═════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS mkt_proposal_docs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid REFERENCES brands(id) ON DELETE SET NULL,
  mkt_project_id uuid,
  token text UNIQUE NOT NULL,
  title text NOT NULL DEFAULT '',
  subtitle text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','accepted','rejected')),
  -- 제품(히어로): [{name,name_en,volume,image_url,features:[]}]
  products_json jsonb NOT NULL DEFAULT '[]',
  -- 목표/트랙
  track text NOT NULL DEFAULT 'standard',
  goal_first text NOT NULL DEFAULT '',
  goal_final text NOT NULL DEFAULT '',
  -- 예산 입력(엔진 입력값)
  countries text[] NOT NULL DEFAULT '{US}',
  start_month int NOT NULL DEFAULT 9,
  months int NOT NULL DEFAULT 6,
  monthly_budget bigint NOT NULL DEFAULT 5000000,
  operation_fee bigint NOT NULL DEFAULT 1500000,
  gmv_reserve_min bigint NOT NULL DEFAULT 1000000,
  gmv_reserve_max bigint NOT NULL DEFAULT 3000000,
  first_month_seeding boolean NOT NULL DEFAULT true,
  commission_pct numeric NOT NULL DEFAULT 10,
  -- 레퍼런스: [{creator,product,gmv,roas,commission,engagement,desc,image_url}]
  references_json jsonb NOT NULL DEFAULT '[]',
  intro_note text NOT NULL DEFAULT '',
  accent text NOT NULL DEFAULT '#111111',
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mkt_proposal_docs_brand_idx ON mkt_proposal_docs (brand_id, created_at DESC);
