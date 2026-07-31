-- ═════════════════════════════════════════════════════════════
-- 07 · 고객카드 완성 — Phase 2 (문서 10 데이터·자산 + 14 카드갭)
--   회사정보·제품·인증·제안v2·계약·자산·마케팅프로젝트
--   + 설문·브랜드측 인물·재고입고·물류계약·QnA
--   ⚠️ 어드민 소유 테이블만. glovek 실서비스 테이블 미접근.
--   원칙: 원본(apply 서류·glovek 파일)은 복제 금지 → external_url 참조.
-- ═════════════════════════════════════════════════════════════

-- ── 10-E. 통합 자산 저장소 (모든 자료의 단일 색인) ──────────────
CREATE TABLE IF NOT EXISTS assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid REFERENCES brands(id) ON DELETE CASCADE,
  kind text NOT NULL,        -- proposal|contract|cert|doc|report|meeting_rec|brand_intro|etc
  filename text NOT NULL, mime text, size_bytes bigint,
  storage_url text,          -- 어드민 스토리지(어드민 생성물만 실물 저장)
  external_url text,         -- 원본이 apply/glovek/드라이브 → 링크만(복제 금지)
  source text NOT NULL DEFAULT 'admin',   -- admin|apply|glovek|zoom|drive
  source_ref text, uploaded_by text,
  retention_until date,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS assets_brand_kind_idx ON assets (brand_id, kind);

-- ── 10-A. 회사 요약 캐시 (원본: apply SC-01 / 수기) ─────────────
CREATE TABLE IF NOT EXISTS brand_company (
  brand_id uuid PRIMARY KEY REFERENCES brands(id) ON DELETE CASCADE,
  company_name_kr text, company_name_en text,
  company_type text,                   -- company|individual
  rep_name text, reg_date text,
  biz_category text,                   -- 업태·종목
  address_kr text, address_en text,
  biz_cert_asset_id uuid REFERENCES assets(id),
  biz_verified boolean DEFAULT false,
  -- 세금계산서
  tax_email text, tax_contact_name text, tax_contact_phone text,
  tax_cycle text DEFAULT 'monthly',    -- monthly|per_case
  tax_note text,
  -- 정산 계좌 (예금주=상호 일치 검증)
  bank_name text, bank_holder text, bank_account text,
  bank_cert_asset_id uuid REFERENCES assets(id),
  bank_verified boolean DEFAULT false,
  -- 브랜드 정보
  brand_name_en text, logo_asset_id uuid REFERENCES assets(id),
  channel_urls jsonb DEFAULT '{}',     -- {own_mall, smartstore, instagram, tiktok, ...}
  source text DEFAULT 'manual',        -- apply|manual
  source_url text, updated_at timestamptz NOT NULL DEFAULT now()
);

-- ── 10-B. 제품 마스터 + 국가별 인증 ────────────────────────────
CREATE TABLE IF NOT EXISTS products_master (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  name_kr text NOT NULL, name_en text DEFAULT '',
  category text DEFAULT '', sku text DEFAULT '',
  price_band text DEFAULT '',
  main_image_url text DEFAULT '',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','discontinued')),
  source text NOT NULL DEFAULT 'manual',      -- apply_step4|glovek_onb|manual
  source_ref text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS products_master_brand_idx ON products_master (brand_id);

CREATE TABLE IF NOT EXISTS product_certs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products_master(id) ON DELETE CASCADE,
  country text NOT NULL,                       -- US|VN|TH|MY|SG
  cert_type text NOT NULL,                     -- FDA등록|보건부신고|태국FDA|할랄|HSA|영문라벨|원산지증명|기타
  status text NOT NULL DEFAULT 'none'
    CHECK (status IN ('none','preparing','submitted','ready','rejected','expired')),
  cert_number text DEFAULT '',
  issued_at date, expires_at date,
  asset_id uuid REFERENCES assets(id),
  note text DEFAULT '', updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, country, cert_type)
);
CREATE INDEX IF NOT EXISTS product_certs_expires_idx ON product_certs (expires_at);

-- ── 10-I-2. 제품별 인증 서류 (자료 단위) ────────────────────────
CREATE TABLE IF NOT EXISTS product_cert_docs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products_master(id) ON DELETE CASCADE,
  country text,                                -- NULL=공통 자료
  doc_type text NOT NULL,                      -- fda_facility|fda_listing|test_report|ingredients|label_draft|halal|origin|기타
  title text NOT NULL, asset_id uuid REFERENCES assets(id),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','review','valid','rejected','expired')),
  expires_at date, owner_admin_id uuid, note text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS product_cert_docs_product_idx ON product_cert_docs (product_id, country);

-- ── 10-C. 제안·견적 (proposals v2 — 기존 v1 컬럼 확장) ──────────
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS version int NOT NULL DEFAULT 1;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS plan text;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS countries text[] DEFAULT '{}';
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS term text DEFAULT 'monthly';   -- monthly|6month
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS quote_amount int;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS discount_note text DEFAULT '';
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS sent_at timestamptz;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS decided_at timestamptz;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS asset_id uuid REFERENCES assets(id);
-- status 확대: draft|sent|accepted|rejected|superseded
ALTER TABLE proposals DROP CONSTRAINT IF EXISTS proposals_status_check;
ALTER TABLE proposals ADD CONSTRAINT proposals_status_check
  CHECK (status IN ('draft','sent','accepted','rejected','superseded'));
-- title 은 이제 선택(자동 생성) — NOT NULL 완화
ALTER TABLE proposals ALTER COLUMN title DROP NOT NULL;

-- ── 10-D. 계약서 (조건 jsonb) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('mall','onboarding','guarantee','marketing','marketing_retainer')),
  version int NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','review','sent','signed','expired','terminated')),
  start_date date, end_date date, signed_at timestamptz,
  terms jsonb NOT NULL DEFAULT '{}',           -- {fee_pct, term_months, guarantee:{...}, countries:[...]}
  asset_id uuid REFERENCES assets(id),
  esign_ref text DEFAULT '',
  note text DEFAULT '', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS contracts_brand_idx ON contracts (brand_id, status);
CREATE INDEX IF NOT EXISTS contracts_end_date_idx ON contracts (end_date);

-- ── 10-I-1. 마케팅 프로젝트 (브랜드 ↔ 프로젝트 제안) ────────────
CREATE TABLE IF NOT EXISTS mkt_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'project' CHECK (kind IN ('project','routine')),
  title text NOT NULL,
  rfp_asset_id uuid REFERENCES assets(id),
  rfp_summary text,
  proposal_asset_id uuid REFERENCES assets(id),
  proposal_status text NOT NULL DEFAULT 'draft'
    CHECK (proposal_status IN ('draft','sent','negotiating','won','dropped')),
  contract_id uuid REFERENCES contracts(id),
  owner_admin_id uuid, note text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mkt_projects_brand_idx ON mkt_projects (brand_id);

-- ── 14-A. 미팅 후 마케팅 설문 ──────────────────────────────────
CREATE TABLE IF NOT EXISTS surveys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'post_meeting',      -- post_meeting|onboarding_intake|nps
  token text UNIQUE NOT NULL,                     -- 공개 응답 링크
  sent_at timestamptz, responded_at timestamptz,
  answers jsonb DEFAULT '{}',                     -- {budget_band, seeding_capacity, target_countries[], timeline, concerns, marketing_consent}
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS surveys_brand_idx ON surveys (brand_id, created_at);

-- ── 14-B. 브랜드측 담당자 인물 관리 ────────────────────────────
CREATE TABLE IF NOT EXISTS brand_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  name text NOT NULL, title text DEFAULT '',
  email text, phone text,
  role text DEFAULT 'main' CHECK (role IN ('main','marketing','logistics','settlement','etc')),
  is_primary boolean DEFAULT false,
  note text DEFAULT '', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS brand_contacts_brand_idx ON brand_contacts (brand_id);
CREATE INDEX IF NOT EXISTS brand_contacts_email_idx ON brand_contacts (lower(email));
CREATE INDEX IF NOT EXISTS brand_contacts_phone_idx ON brand_contacts (phone);

-- ── 14-D. 물류 계약 현황 (먼저 — inventory_intakes 가 참조) ─────
CREATE TABLE IF NOT EXISTS logistics_contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  country text NOT NULL,                          -- US|VN|TH|MY|SG (+CN/HK/KR)
  provider text DEFAULT '',
  warehouse_region text DEFAULT '', contact text DEFAULT '', phone text DEFAULT '',
  address text DEFAULT '',
  status text NOT NULL DEFAULT 'none'
    CHECK (status IN ('none','negotiating','contracted','active','expired')),
  contract_asset_id uuid REFERENCES assets(id),
  start_date date, end_date date,
  apply_warehouse_id int,
  note text DEFAULT '', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS logistics_contracts_brand_idx ON logistics_contracts (brand_id);

-- ── 14-C. 재고 초기 투입·입고 ──────────────────────────────────
CREATE TABLE IF NOT EXISTS inventory_intakes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  product_id uuid REFERENCES products_master(id) ON DELETE SET NULL,
  country text NOT NULL,
  warehouse_id uuid REFERENCES logistics_contracts(id) ON DELETE SET NULL,
  qty int NOT NULL, unit_cost int,
  status text NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned','shipped','arrived','stocked','issue')),
  tracking_no text DEFAULT '', shipped_at date, arrived_at date,
  note text DEFAULT '', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inventory_intakes_brand_idx ON inventory_intakes (brand_id, country);

-- ── 14-E. QnA 지식화 ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS qna_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question text NOT NULL, answer text NOT NULL,
  category text DEFAULT '',                        -- 인증/물류/정산/플랜/운영
  source_brand_id uuid, source_ref text,
  usage_count int DEFAULT 0, approved boolean DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS qna_entries_category_idx ON qna_entries (category, approved);
