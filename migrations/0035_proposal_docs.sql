-- ═════════════════════════════════════════════════════════════
-- 35 · 제안서 자동생성 — 어드민 조건세팅 + 제품·크리에이터 레퍼런스로
--   PDF 디자인과 동일한 제안서를 공개 링크(token)로 렌더.
--   proposal_docs = 브랜드별 스냅샷(렌더 일관성) · proposal_templates = 전역 디자인 기본값.
-- ═════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS proposal_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  accent text NOT NULL DEFAULT '#1f7a4d',              -- 강조색(포레스트 그린)
  agency_name text NOT NULL DEFAULT 'DINO STUDIO',
  agency_logo_url text,                                 -- 대행사 로고(우리쪽)
  default_title text NOT NULL DEFAULT '틱톡샵 온보딩 및 마케팅 협업 제안서',
  default_subtitle text NOT NULL DEFAULT '크리에이터 커머스를 통한 브랜드 성장',
  sections jsonb NOT NULL DEFAULT '["cover","product","pricing","operations","kpi","creators","closing"]',
  updated_by text, updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS proposal_docs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid REFERENCES brands(id) ON DELETE SET NULL,
  token text UNIQUE NOT NULL,                           -- 공개 링크 /proposal/{token}
  title text NOT NULL DEFAULT '틱톡샵 온보딩 및 마케팅 협업 제안서',
  subtitle text NOT NULL DEFAULT '크리에이터 커머스를 통한 브랜드 성장',
  brand_name text NOT NULL DEFAULT '',
  brand_logo_url text,                                  -- 브랜드 로고(학습·업로드)
  track text NOT NULL DEFAULT 'onboarding',             -- onboarding|mall|marketing
  -- 가격(어드민 조건세팅: 계약금액·할인·수수료·약정)
  list_amount int, monthly_amount int, fee_pct numeric, term_months int, term_discount_pct int,
  features jsonb NOT NULL DEFAULT '[]',                 -- 기능 체크리스트 ["시딩 20건·라이브 4건", ...]
  -- 운영 & 콘텐츠(무가시딩양·라이브양)
  seeding_qty int, live_qty int, op_tags jsonb NOT NULL DEFAULT '[]',
  -- 6개월 KPI(티어·단계·크리에이터 콘텐츠수·광고비)
  kpi_tier text, kpi_stage text, kpi_creator_content int, kpi_ad_spend text,
  -- 레퍼런스(우리가 등록 · glovek 추후연동)
  products jsonb NOT NULL DEFAULT '[]',                 -- [{name, image_url, desc}]
  creators jsonb NOT NULL DEFAULT '[]',                 -- [{handle, product, revenue, roas, fee_rate, engagement, thumb_url, caption}]
  -- 디자인 브랜드별 오버라이드
  accent text,                                          -- 없으면 템플릿 기본색
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  created_by text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS proposal_docs_brand_idx ON proposal_docs (brand_id, created_at DESC);

-- 전역 기본 템플릿 1개 시드(멱등).
INSERT INTO proposal_templates (name, is_default)
  SELECT '기본 템플릿 (DINO STUDIO)', true
  WHERE NOT EXISTS (SELECT 1 FROM proposal_templates WHERE is_default);
