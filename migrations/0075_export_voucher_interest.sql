-- ═════════════════════════════════════════════════════════════
-- 75 · 수출바우처 희망여부 (BUG-7)
--   · brand_company 에 담당자 수기 체크용 boolean 추가.
-- ═════════════════════════════════════════════════════════════

ALTER TABLE brand_company ADD COLUMN IF NOT EXISTS export_voucher_interest boolean;
