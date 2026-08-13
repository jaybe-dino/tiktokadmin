-- 브랜드 카테고리 목록 — 브랜드360 카테고리 셀렉트 + 설정에서 관리(추가/삭제).
CREATE TABLE IF NOT EXISTS brand_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  sort_order int NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 기본 카테고리 시드(스킨케어·색조·더마). 이미 있으면 무시.
INSERT INTO brand_categories (name, sort_order) VALUES
  ('스킨케어', 1), ('색조', 2), ('더마', 3)
ON CONFLICT (name) DO NOTHING;
