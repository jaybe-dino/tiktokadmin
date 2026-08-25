-- 마케팅 제안서 제품 카테고리("대분류 > 소분류") — 생성 시 선택, glovek 유사 콘텐츠 레퍼런스 조회 기준.
ALTER TABLE mkt_proposal_docs ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT '';
