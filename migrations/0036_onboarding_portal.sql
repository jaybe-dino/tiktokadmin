-- ═════════════════════════════════════════════════════════════
-- 36 · 고객 작성 온보딩 포털 (틱톡샵 KYC) — tpartners apply 서류를 이식.
--   고객: 이메일 + 발급코드 로그인 → 4스텝(회사·UBO·대리인/PEP·제품) 작성/제출.
--   승인 시 brand_company/products 로 자동 매핑. 파일은 URL(드라이브 링크·자산) 기준.
-- ═════════════════════════════════════════════════════════════

-- 고객 계정 (관리자 발급 이메일 + 8자리 코드)
CREATE TABLE IF NOT EXISTS onb_customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  access_code_hash text NOT NULL,                 -- scrypt(lib/auth) 재사용
  brand_id uuid REFERENCES brands(id) ON DELETE SET NULL,
  note text DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  last_login_at timestamptz,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS onb_customers_brand_idx ON onb_customers (brand_id);

-- 온보딩 신청서 (1 고객 : 1 신청서)
CREATE TABLE IF NOT EXISTS onb_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid REFERENCES onb_customers(id) ON DELETE CASCADE,
  brand_id uuid REFERENCES brands(id) ON DELETE SET NULL,
  -- ── SC-01 회사 정보 ──
  company_name_kr text, company_name_en text,
  company_type text DEFAULT 'company',            -- company|individual
  company_country text DEFAULT 'KR', company_reg_date text, company_reg_number text,
  contact_name text, contact_email text, contact_phone text,
  address_kr text, address_en text, op_address_en text,
  shop_name_kr text, shop_name_en text, brand_logo_url text,
  product_category text, sales_channel_url text,
  doc_biz_reg_en_url text, doc_biz_reg_kr_url text, doc_corp_reg_kr_url text,
  doc_ownership_url text, doc_logistics_url text,
  -- ── SC-02 UBO(수익소유자) ──
  ubo_full_name text, ubo_title text, ubo_birth text, ubo_country text,
  ubo_id_type text DEFAULT 'passport', ubo_id_number text,
  ubo_id_front_url text, ubo_id_back_url text, ubo_address_proof_url text,
  -- ── SC-03 권한대리인 · PEP · 전자서명 ──
  auth_type text DEFAULT 'ubo', auth_name text, auth_birth text, auth_country text,
  auth_id_type text DEFAULT 'passport', auth_id_number text, auth_email text,
  auth_id_front_url text, auth_id_back_url text, auth_address_proof_url text, auth_loa_url text,
  pep_q1 text DEFAULT 'no', pep_q2 text DEFAULT 'no',
  ubo_signature_data text, ubo_signed_at timestamptz, ubo_signer_ip text,
  -- ── 추가(지분·Payoneer) ──
  ownership_structure text,
  payoneer_status text DEFAULT 'none', payoneer_email text, payoneer_note text,
  loa_doc_url text, loa_download_token text,
  status text NOT NULL DEFAULT 'draft'            -- draft|submitted|approved|rejected
    CHECK (status IN ('draft','submitted','approved','rejected')),
  admin_memo text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS onb_applications_brand_idx ON onb_applications (brand_id);
CREATE INDEX IF NOT EXISTS onb_applications_customer_idx ON onb_applications (customer_id);

-- 스텝별 잠금/검토 상태 (1~4)
CREATE TABLE IF NOT EXISTS onb_steps (
  application_id uuid REFERENCES onb_applications(id) ON DELETE CASCADE,
  step_no int NOT NULL,
  status text NOT NULL DEFAULT 'locked'           -- locked|unlocked|submitted|approved|rejected
    CHECK (status IN ('locked','unlocked','submitted','approved','rejected')),
  admin_feedback text DEFAULT '',
  submitted_at timestamptz, reviewed_at timestamptz, unlocked_at timestamptz,
  PRIMARY KEY (application_id, step_no)
);

-- 이사(동적)
CREATE TABLE IF NOT EXISTS onb_directors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid REFERENCES onb_applications(id) ON DELETE CASCADE,
  is_ubo boolean DEFAULT false, name text, birth text, country text,
  id_type text DEFAULT 'passport', id_number text,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- 창고(동적, SC-04)
CREATE TABLE IF NOT EXISTS onb_warehouses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid REFERENCES onb_applications(id) ON DELETE CASCADE,
  country text, region text, contact text, phone text, address text, contract_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- 제품(Step4)
CREATE TABLE IF NOT EXISTS onb_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid REFERENCES onb_applications(id) ON DELETE CASCADE,
  name text, category text, sku text, description_kr text, main_image_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- 제품 × 국가 (단가·인증·번역)
CREATE TABLE IF NOT EXISTS onb_product_countries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid REFERENCES onb_products(id) ON DELETE CASCADE,
  country_code text NOT NULL,
  unit_price text, currency text DEFAULT 'USD',
  cert_status text DEFAULT 'none',                -- none|preparing|ready
  cert_note text, cert_file_url text,
  detail_page_kr text, detail_page_translated text,
  translation_status text DEFAULT 'draft',        -- draft|requested|done
  created_at timestamptz NOT NULL DEFAULT now()
);
