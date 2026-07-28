-- ─────────────────────────────────────────────────────────────
-- 04 · 고객 카드 고도화 (Notion 틱톡샵 DB 반영)
--   · 인증 국가 · 자료 파일(링크) · 제안서 카드
-- ─────────────────────────────────────────────────────────────

-- 인증 국가 (국가는 기존 countries 사용)
ALTER TABLE brands ADD COLUMN IF NOT EXISTS certified_countries text[] DEFAULT '{}';

-- 고객 자료(파일) — 원본은 어드민에 저장하지 않고 링크로 참조
--   kind: intro_deck(브랜드/제품 소개서) · meeting_notes(회의록) · meeting_recording(회의 녹음)
--         · history(히스토리) · contract(계약서) · etc
CREATE TABLE IF NOT EXISTS brand_files (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id    uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('intro_deck','meeting_notes','meeting_recording','history','contract','etc')),
  label       text NOT NULL,
  url         text NOT NULL,
  note        text DEFAULT '',
  uploaded_by text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS brand_files_brand_idx ON brand_files (brand_id, kind);

-- 제안서 카드
CREATE TABLE IF NOT EXISTS proposals (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id    uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  title       text NOT NULL,
  url         text DEFAULT '',
  amount      int,
  status      text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','accepted','rejected')),
  note        text DEFAULT '',
  created_by  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS proposals_brand_idx ON proposals (brand_id);
