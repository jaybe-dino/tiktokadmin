-- 0094 제안서 문서 — 진행 국가 표기(BUG-36) + 시딩 벤치마크 표 국가별 편집(BUG-35)
--   countries : 이 제안서가 대상으로 하는 국가 라벨 목록. 비어 있으면 기존처럼 "(국가 당)" 표기.
--   bench     : 시딩 벤치마크 표({country, category, content[], adspend[]}).
--               NULL 이면 코드 기본값(베트남 · Beauty · 30일)을 그대로 사용한다.
ALTER TABLE proposal_docs ADD COLUMN IF NOT EXISTS countries jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE proposal_docs ADD COLUMN IF NOT EXISTS bench jsonb;
