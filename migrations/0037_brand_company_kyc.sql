-- ═════════════════════════════════════════════════════════════
-- 37 · 온보딩(0036) → 브랜드 원장 완전 매핑을 위한 brand_company 확장.
--   고객이 /apply 에서 제출한 KYC 를 하나도 빠짐없이 원장에서 관리하도록
--   scalar 필드·서류 URL·UBO·권한대리인·PEP·Payoneer·서명·이사(JSON)를 추가.
--   (창고→logistics_contracts, 담당자→brand_contacts, 제품→products_master/product_certs 로 별도 매핑)
-- ═════════════════════════════════════════════════════════════

ALTER TABLE brand_company
  -- 회사(추가)
  ADD COLUMN IF NOT EXISTS company_country text,
  ADD COLUMN IF NOT EXISTS company_reg_number text,
  ADD COLUMN IF NOT EXISTS contact_name text,
  ADD COLUMN IF NOT EXISTS contact_email text,
  ADD COLUMN IF NOT EXISTS contact_phone text,
  ADD COLUMN IF NOT EXISTS op_address_en text,
  ADD COLUMN IF NOT EXISTS shop_name_kr text,
  ADD COLUMN IF NOT EXISTS shop_name_en text,
  ADD COLUMN IF NOT EXISTS product_category text,
  ADD COLUMN IF NOT EXISTS sales_channel_url text,
  ADD COLUMN IF NOT EXISTS brand_logo_url text,
  -- 서류(드라이브 URL)
  ADD COLUMN IF NOT EXISTS doc_biz_reg_en_url text,
  ADD COLUMN IF NOT EXISTS doc_biz_reg_kr_url text,
  ADD COLUMN IF NOT EXISTS doc_corp_reg_kr_url text,
  ADD COLUMN IF NOT EXISTS doc_ownership_url text,
  ADD COLUMN IF NOT EXISTS doc_logistics_url text,
  -- UBO
  ADD COLUMN IF NOT EXISTS ubo_full_name text,
  ADD COLUMN IF NOT EXISTS ubo_title text,
  ADD COLUMN IF NOT EXISTS ubo_birth text,
  ADD COLUMN IF NOT EXISTS ubo_country text,
  ADD COLUMN IF NOT EXISTS ubo_id_type text,
  ADD COLUMN IF NOT EXISTS ubo_id_number text,
  ADD COLUMN IF NOT EXISTS ubo_id_front_url text,
  ADD COLUMN IF NOT EXISTS ubo_id_back_url text,
  ADD COLUMN IF NOT EXISTS ubo_address_proof_url text,
  ADD COLUMN IF NOT EXISTS ownership_structure text,
  -- 권한대리인 / 서명
  ADD COLUMN IF NOT EXISTS auth_type text,
  ADD COLUMN IF NOT EXISTS auth_name text,
  ADD COLUMN IF NOT EXISTS auth_birth text,
  ADD COLUMN IF NOT EXISTS auth_country text,
  ADD COLUMN IF NOT EXISTS auth_id_type text,
  ADD COLUMN IF NOT EXISTS auth_id_number text,
  ADD COLUMN IF NOT EXISTS auth_email text,
  ADD COLUMN IF NOT EXISTS auth_id_front_url text,
  ADD COLUMN IF NOT EXISTS auth_id_back_url text,
  ADD COLUMN IF NOT EXISTS auth_address_proof_url text,
  ADD COLUMN IF NOT EXISTS auth_loa_url text,
  ADD COLUMN IF NOT EXISTS pep_q1 text,
  ADD COLUMN IF NOT EXISTS pep_q2 text,
  ADD COLUMN IF NOT EXISTS ubo_signature_data text,
  ADD COLUMN IF NOT EXISTS ubo_signed_at timestamptz,
  -- Payoneer
  ADD COLUMN IF NOT EXISTS payoneer_status text,
  ADD COLUMN IF NOT EXISTS payoneer_email text,
  ADD COLUMN IF NOT EXISTS payoneer_note text,
  -- 이사(무손실 JSON) + 온보딩 연결
  ADD COLUMN IF NOT EXISTS directors_json jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS onb_application_id uuid,
  ADD COLUMN IF NOT EXISTS onb_synced_at timestamptz;
