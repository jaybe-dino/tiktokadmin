-- ═════════════════════════════════════════════════════════════
-- 39 · 온보딩 v2 승인 매핑 대상 — brand_company 에 대표자 서류(rep_*) + 서명자 IP 추가.
--   (국가는 logistics_contracts / product_certs, 제품은 products_master 로 매핑)
-- ═════════════════════════════════════════════════════════════
ALTER TABLE brand_company
  ADD COLUMN IF NOT EXISTS rep_passport_front_url text,
  ADD COLUMN IF NOT EXISTS rep_passport_back_url text,
  ADD COLUMN IF NOT EXISTS rep_id_front_url text,
  ADD COLUMN IF NOT EXISTS rep_id_back_url text,
  ADD COLUMN IF NOT EXISTS rep_address_proof_url text,
  ADD COLUMN IF NOT EXISTS ubo_signer_ip text;
