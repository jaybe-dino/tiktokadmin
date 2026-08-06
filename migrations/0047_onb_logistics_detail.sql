-- ═════════════════════════════════════════════════════════════
-- 47 · 온보딩 물류 상세 — FBA/현지창고/크로스보더 + 국가별 현지주소 + 계약정보.
--   logistics_option 값 확장: fba / local_warehouse / cross_border (기존 self_delivery·flash_intro 는
--   레거시로 라벨만 유지). 국가별 현지 주소·계약 정보 컬럼 추가(계약 첨부는 logistics_contract_url 재사용).
-- ═════════════════════════════════════════════════════════════
ALTER TABLE onb_countries
  ADD COLUMN IF NOT EXISTS logistics_local_address text DEFAULT '',   -- 국가별 현지 주소(FBA/창고 입고지 등)
  ADD COLUMN IF NOT EXISTS logistics_contract_info text DEFAULT '';   -- 현지창고/FBA 계약 정보(업체·조건 메모)
