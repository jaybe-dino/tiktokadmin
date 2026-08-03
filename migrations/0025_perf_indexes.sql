-- ═════════════════════════════════════════════════════════════
-- 25 · 성능 인덱스 — 홈/검색 seq scan 제거
--   · brands.created_at: 홈 최근리드·KPI 범위필터 정렬
--   · owner_* : 워크큐/홈 담당 필터
--   · pg_trgm(brand_name/email/phone): 고객검색 ILIKE '%q%' 가속(선행 와일드카드)
-- ═════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS brands_created_at_idx ON brands (created_at DESC);

CREATE INDEX IF NOT EXISTS brands_owner_intake_idx  ON brands (owner_intake)  WHERE owner_intake  IS NOT NULL;
CREATE INDEX IF NOT EXISTS brands_owner_sales_idx   ON brands (owner_sales)   WHERE owner_sales   IS NOT NULL;
CREATE INDEX IF NOT EXISTS brands_owner_onboard_idx ON brands (owner_onboard) WHERE owner_onboard IS NOT NULL;
CREATE INDEX IF NOT EXISTS brands_owner_ads_idx     ON brands (owner_ads)     WHERE owner_ads     IS NOT NULL;

-- 트라이그램 검색(확장 사용 가능 시). 확장 미가용 환경에서도 마이그레이션이 실패하지 않도록 DO 블록 가드.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
  CREATE INDEX IF NOT EXISTS brands_name_trgm ON brands USING gin (brand_name gin_trgm_ops);
  CREATE INDEX IF NOT EXISTS brands_email_trgm ON brands USING gin (email gin_trgm_ops);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_trgm 미가용 — ILIKE 검색은 seq scan 유지 (기능 영향 없음)';
END $$;
