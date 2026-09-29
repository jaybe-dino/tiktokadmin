-- ═════════════════════════════════════════════════════════════
-- 100 · 온보딩 신청 폼 항목 추가 (추가만 — 기존 컬럼을 바꾸지 않는다)
--   의존: onb_product_countries(0036), onb_countries(0036)
--   · BUG-44 상세페이지(영문) 칸
--   · BUG-45 FBT(Fulfilled by TikTok) 신청 희망 체크
--   ※ 기본값을 두어 기존 행은 그대로 유효하다.
-- ═════════════════════════════════════════════════════════════

-- BUG-44 · 국가별 상세페이지 영문본(있으면 영문 우선). 한글본(detail_page_kr)은 그대로 둔다.
ALTER TABLE onb_product_countries ADD COLUMN IF NOT EXISTS detail_page_en text;

-- BUG-45 · 추후 FBT(Fulfilled by TikTok) 신청 희망 여부.
ALTER TABLE onb_countries ADD COLUMN IF NOT EXISTS fbt_interest boolean NOT NULL DEFAULT false;
