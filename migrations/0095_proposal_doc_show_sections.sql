-- 0095 제안서 문서 — 섹션 표시 옵션(담당자가 직접 켜고 끈다)
--   show_sections : {"ops": false, "features": true, ...} 형태의 표시 여부 맵.
--                   NULL 이거나 키가 없으면 코드 기본값(lib/proposal-sections.ts)을 따른다.
ALTER TABLE proposal_docs ADD COLUMN IF NOT EXISTS show_sections jsonb;
