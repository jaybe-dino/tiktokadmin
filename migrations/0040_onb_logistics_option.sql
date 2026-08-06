-- ═════════════════════════════════════════════════════════════
-- 40 · 온보딩 물류 방식 선택(회의 확정) — 국가별 배송 옵션 3종.
--   self_delivery(직배송) / local_warehouse(현지 물류창고) / flash_intro(플래시 소개)
-- ═════════════════════════════════════════════════════════════
ALTER TABLE onb_countries
  ADD COLUMN IF NOT EXISTS logistics_option text DEFAULT '';
