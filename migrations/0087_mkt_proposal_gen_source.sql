-- 마케팅 제안서 2번째 생성방식(설문 기반 자동생성) 구분 — 기존(수동) 방식과 목록 분리.
--   NULL = 기존 방식(수동, /mkt-proposals). 'survey_auto' = 신규 방식(설문 자동생성, /mkt-proposals2).
ALTER TABLE mkt_proposal_docs ADD COLUMN IF NOT EXISTS gen_source text;
