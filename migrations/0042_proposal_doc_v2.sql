-- ═════════════════════════════════════════════════════════════
-- 42 · 제안서 문서 v2 — 레퍼런스 데크(DINO STUDIO × Bollabo) 9섹션 정합.
--   기존 proposal_docs 에 히어로 제품 상세 / 상당 구성 가치표 / 실행 로드맵 /
--   기대 효과 / 1년 KPI / 별도 제안(애드온) 필드를 추가한다. 전부 담당자 편집 가능.
--   벤치마크 표(T1~Beyond)·KPI 주석은 업계 고정값이라 렌더러 상수로 유지(컬럼 없음).
-- ═════════════════════════════════════════════════════════════
ALTER TABLE proposal_docs
  ADD COLUMN IF NOT EXISTS product_en text,                          -- 핵심 SKU 영문명
  ADD COLUMN IF NOT EXISTS product_volume text,                      -- 용량/규격(예: 50ml)
  ADD COLUMN IF NOT EXISTS product_features jsonb DEFAULT '[]'::jsonb, -- [{title,desc}] 특징 카드
  ADD COLUMN IF NOT EXISTS product_tags jsonb DEFAULT '[]'::jsonb,   -- string[] 해시태그
  ADD COLUMN IF NOT EXISTS value_items jsonb DEFAULT '[]'::jsonb,    -- [{label,qty,amount}] 상당 구성 가치
  ADD COLUMN IF NOT EXISTS value_total integer,                      -- 합계(상당) 원
  ADD COLUMN IF NOT EXISTS roadmap_steps jsonb DEFAULT '[]'::jsonb,  -- [{title,desc}] STEP01~04
  ADD COLUMN IF NOT EXISTS impacts jsonb DEFAULT '[]'::jsonb,        -- [{title,desc}] 기대 효과
  ADD COLUMN IF NOT EXISTS impact_banner text,                       -- 실행 섹션 하단 배너 문구
  ADD COLUMN IF NOT EXISTS kpi_year_tier text,                       -- 1년 KPI 티어(예: T2)
  ADD COLUMN IF NOT EXISTS kpi_year_stage text,                      -- 1년 단계 설명
  ADD COLUMN IF NOT EXISTS kpi_year_creator_content integer,         -- 1년 크리에이터 콘텐츠 수
  ADD COLUMN IF NOT EXISTS kpi_year_ad_spend text,                   -- 1년 샵 광고비(참고)
  ADD COLUMN IF NOT EXISTS addons jsonb DEFAULT '[]'::jsonb;         -- [{label,title,desc}] 별도 제안 예정

-- 대행사 담당자 연락처(마무리 E.O.D. 섹션) — 템플릿 단위.
ALTER TABLE proposal_templates
  ADD COLUMN IF NOT EXISTS contact_name text,
  ADD COLUMN IF NOT EXISTS contact_title text,
  ADD COLUMN IF NOT EXISTS contact_phone text,
  ADD COLUMN IF NOT EXISTS contact_email text;

-- 기본 템플릿에 'addon' 섹션을 크리에이터 앞에 삽입(중복 방지) + 담당자 기본값.
UPDATE proposal_templates
   SET sections = CASE
         WHEN sections @> '["addon"]'::jsonb THEN sections
         ELSE '["cover","product","pricing","operations","kpi","addon","creators","closing"]'::jsonb
       END,
       contact_name  = COALESCE(contact_name, 'Sung Kyung Lee'),
       contact_title = COALESCE(contact_title, 'Marketing Team Lead'),
       contact_phone = COALESCE(contact_phone, '+82-10-8755-7380'),
       contact_email = COALESCE(contact_email, 'sklee@dinostudio.kr')
 WHERE is_default;
