-- ═════════════════════════════════════════════════════════════
-- 102 · 브랜드 해외 소개자료 (추가만)
--   브랜드가 올린 회사자료·신청서를 근거로 영문/일문/태국어/베트남어/말레이시아어
--   소개 제안서를 만들고 공개 링크(/intro/<token>)로 공유한다.
--   의존: brands(0001) · onb_files(0038) · onb_applications(0036)
--   · 브랜드 × 언어 1건(재생성하면 같은 행·같은 토큰을 갱신 → 배포된 링크가 안 깨진다)
--   · 기본 draft. 발행(published)해야 링크가 열린다.
--   · mode 는 실제 AI 호출 성공 여부다 — 규칙 기반 결과를 AI 라고 적지 않는다.
-- ═════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS brand_intro_docs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  lang text NOT NULL CHECK (lang IN ('en','ja','th','vi','ms')),
  token text UNIQUE NOT NULL,                      -- 공개 링크 /intro/<token>
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  mode text NOT NULL DEFAULT 'rules' CHECK (mode IN ('ai','rules')),
  brand_name text NOT NULL DEFAULT '',             -- 렌더 일관성용 스냅샷
  title text NOT NULL DEFAULT '',
  subtitle text NOT NULL DEFAULT '',
  sections jsonb NOT NULL DEFAULT '[]',            -- [{key,heading,body,refs[]}]
  evidence jsonb NOT NULL DEFAULT '[]',            -- [{ref,label}] 근거 표기(본문은 저장하지 않음)
  skipped_files jsonb NOT NULL DEFAULT '[]',       -- AI 가 읽지 못한 첨부(형식·용량) — 있는 그대로 알린다
  note text NOT NULL DEFAULT '',                   -- 생성 결과 안내(실패 사유 포함)
  contact_email text NOT NULL DEFAULT '',          -- 유통 문의(글로브K)
  generated_by text,
  generated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 브랜드 × 언어 1건 — 재생성이 새 행·새 링크를 만들지 않게 한다.
CREATE UNIQUE INDEX IF NOT EXISTS brand_intro_docs_brand_lang_uniq ON brand_intro_docs (brand_id, lang);
CREATE INDEX IF NOT EXISTS brand_intro_docs_brand_idx ON brand_intro_docs (brand_id, updated_at DESC);
