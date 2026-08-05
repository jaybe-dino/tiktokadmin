-- ═════════════════════════════════════════════════════════════
-- 38 · 고객 온보딩 포털 v2 — tpartners 5스텝과 100% 정합.
--   추가: 입점 희망 국가 매트릭스(onb_countries) · DB 파일저장(onb_files)
--        대표자 서류(rep_*) · 서명 IP. 스텝은 5개(1·2·5 열림, 3·4 잠금).
-- ═════════════════════════════════════════════════════════════

-- 신청서 — 대표자 서류(Step3) + 서명자 IP 추가
ALTER TABLE onb_applications
  ADD COLUMN IF NOT EXISTS rep_passport_front_url text,
  ADD COLUMN IF NOT EXISTS rep_passport_back_url text,
  ADD COLUMN IF NOT EXISTS rep_id_front_url text,
  ADD COLUMN IF NOT EXISTS rep_id_back_url text,
  ADD COLUMN IF NOT EXISTS rep_address_proof_url text,
  ADD COLUMN IF NOT EXISTS ubo_signer_ip text;

-- 입점 희망 국가 (Step1 매트릭스 · 신청서 단위) — tpartners tiktok_shop_countries
CREATE TABLE IF NOT EXISTS onb_countries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid REFERENCES onb_applications(id) ON DELETE CASCADE,
  country_code text NOT NULL,
  country_name text DEFAULT '',
  has_existing_shop int DEFAULT 0,
  shop_type text DEFAULT 'none',                 -- none|online|offline|both
  shop_url text DEFAULT '',
  monthly_revenue text DEFAULT '',
  product_cert_status text DEFAULT 'none',        -- none|preparing|ready
  product_cert_note text DEFAULT '',
  logistics_status text DEFAULT 'none',           -- none|preparing|ready
  logistics_note text DEFAULT '',
  logistics_contract_url text DEFAULT '',         -- Step5 물류계약서(미국 FBA 캡처 가능)
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (application_id, country_code)
);
CREATE INDEX IF NOT EXISTS onb_countries_app_idx ON onb_countries (application_id);

-- 파일 저장 (Neon DB 직접 — Vercel 디스크 비영속 대응). URL: /api/apply/file/<id>
CREATE TABLE IF NOT EXISTS onb_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid REFERENCES onb_applications(id) ON DELETE CASCADE,
  field text DEFAULT '',                          -- 어떤 슬롯(예: doc_biz_reg_en, rep_passport_front)
  filename text DEFAULT '',
  mime text DEFAULT 'application/octet-stream',
  size int DEFAULT 0,
  bytes bytea NOT NULL,
  created_by text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS onb_files_app_idx ON onb_files (application_id);
