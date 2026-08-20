-- ═════════════════════════════════════════════════════════════
-- 79 · 마케팅 제안서: 메인컬러2 · 번들장표 토글 · 템플릿
-- ═════════════════════════════════════════════════════════════

-- 문서: 보조 강조색(그라디언트 2색) + 번들·세트 구성 장표 포함 여부
ALTER TABLE mkt_proposal_docs ADD COLUMN IF NOT EXISTS accent2 text NOT NULL DEFAULT '#0b1220';
ALTER TABLE mkt_proposal_docs ADD COLUMN IF NOT EXISTS show_bundle_slide boolean NOT NULL DEFAULT true;

-- 제안서 템플릿(디자인·예산·국가·비율 등 설정 저장 → 새 제안서에 불러오기)
CREATE TABLE IF NOT EXISTS mkt_proposal_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  config jsonb NOT NULL DEFAULT '{}',
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mkt_proposal_templates_created_idx ON mkt_proposal_templates (created_at DESC);
