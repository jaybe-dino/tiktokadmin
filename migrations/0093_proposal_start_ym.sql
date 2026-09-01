-- 제안서 시작 시점 지정 (마케팅·운영 공통).
--   마케팅: 기존 start_month(1~12)에 연도를 더해 연말·연초를 넘기는 일정도 정확히 표기.
--   운영:   시작 연월(YYYY-MM) 신규 — 제안서 표지·로드맵에 "언제부터"를 명시.
ALTER TABLE mkt_proposal_docs ADD COLUMN IF NOT EXISTS start_year integer;
ALTER TABLE proposal_docs     ADD COLUMN IF NOT EXISTS start_ym text;
