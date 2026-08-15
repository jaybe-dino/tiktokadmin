-- apply.tpartners.live 일회성 이관 — 멱등 매핑 + 파일 저장.
--   원천 무손실 이관: 원본 app id 로 재실행 시 중복 방지, 파일명으로 브랜드 서류 매칭.

-- 원본 신청(app) → 우리 브랜드 매핑(멱등키).
CREATE TABLE IF NOT EXISTS tp_import_apps (
  ext_app_id  integer PRIMARY KEY,      -- tiktok_shop_applications.id
  brand_id    uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  merged      boolean NOT NULL DEFAULT false,  -- 기존 브랜드 병합 여부
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- 업로드 파일명 → 브랜드·서류 필드 매핑(행 이관 시 *_path 로 채워짐 → 파일 이관 시 조회).
CREATE TABLE IF NOT EXISTS tp_import_files (
  filename    text PRIMARY KEY,         -- 예: app10_biz_reg_en_1b2fba93c936.pdf
  brand_id    uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  doc_field   text NOT NULL,            -- brand_company URL 컬럼명(또는 logistics/product 등 일반)
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- 이관된 파일 바이트(서빙: /api/brand/import-file/[id]).
CREATE TABLE IF NOT EXISTS import_files (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id   uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  doc_field  text NOT NULL,
  filename   text NOT NULL,
  mime       text,
  size       integer,
  sha256     text,
  bytes      bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (brand_id, filename)
);
CREATE INDEX IF NOT EXISTS import_files_brand_idx ON import_files (brand_id);
