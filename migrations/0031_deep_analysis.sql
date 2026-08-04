-- ═════════════════════════════════════════════════════════════
-- 31 · AI 기업·브랜드 심층 분석 저장 — 웹사이트 수집 + 다층 분석 결과 보관.
--   재실행 없이 카드에서 열람. 근거 URL·생성시각 기록.
-- ═════════════════════════════════════════════════════════════

ALTER TABLE brands ADD COLUMN IF NOT EXISTS deep_analysis_md text;       -- 심층 분석 결과(마크다운)
ALTER TABLE brands ADD COLUMN IF NOT EXISTS deep_analysis_at timestamptz; -- 생성 시각
ALTER TABLE brands ADD COLUMN IF NOT EXISTS deep_analysis_src text;       -- 수집 근거 URL(콤마)
