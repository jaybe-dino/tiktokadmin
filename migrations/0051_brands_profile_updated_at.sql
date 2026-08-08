-- ═════════════════════════════════════════════════════════════
-- 51 · brands.profile_updated_at — 공유(양방향) 프로필 필드 전용 수정시각.
--   glovek 이 profile_updated_at 기준으로 last-write-wins 를 판정하므로 admin 도 대칭 도입.
--   전역 updated_at(0049)은 메모·단계 등 모든 변경에 반응 → 무관한 편집이 프로필 LWW 를
--   밀어내는 것을 방지하기 위해, 공유 필드가 실제로 바뀔 때만 갱신되는 별도 컬럼을 둔다.
--   (brand_name·contact_name·email·phone·biz_no·category·brand_url)
-- ═════════════════════════════════════════════════════════════
ALTER TABLE brands ADD COLUMN IF NOT EXISTS profile_updated_at timestamptz NOT NULL DEFAULT now();

CREATE OR REPLACE FUNCTION set_profile_updated_at() RETURNS trigger AS $$
BEGIN
  IF NEW.brand_name   IS DISTINCT FROM OLD.brand_name
  OR NEW.contact_name IS DISTINCT FROM OLD.contact_name
  OR NEW.email        IS DISTINCT FROM OLD.email
  OR NEW.phone        IS DISTINCT FROM OLD.phone
  OR NEW.biz_no       IS DISTINCT FROM OLD.biz_no
  OR NEW.category     IS DISTINCT FROM OLD.category
  OR NEW.brand_url    IS DISTINCT FROM OLD.brand_url THEN
    NEW.profile_updated_at = now();
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

-- BEFORE 트리거. 이름이 'brands_set_updated_at'(0049)보다 알파벳상 앞이라 먼저 실행되며,
--   서로 다른 컬럼만 건드리므로 순서 무관하게 안전하다.
DROP TRIGGER IF EXISTS brands_set_profile_updated_at ON brands;
CREATE TRIGGER brands_set_profile_updated_at BEFORE UPDATE ON brands
  FOR EACH ROW EXECUTE FUNCTION set_profile_updated_at();
