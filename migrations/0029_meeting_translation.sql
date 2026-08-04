-- ═════════════════════════════════════════════════════════════
-- 29 · 미팅 녹화 자동 번역 — 전사(transcript)를 한국어로 번역해 히스토리 보관.
--   해외 확장 미팅(영어/중국어 등)도 담당자가 한국어로 검토 가능.
--   요약(summary_md)은 이미 한국어. 여기선 전문 번역본 + 원문 언어 기록.
-- ═════════════════════════════════════════════════════════════

ALTER TABLE meetings ADD COLUMN IF NOT EXISTS transcript_ko text;      -- 한국어 번역 전문
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS transcript_lang text;    -- 감지된 원문 언어(ko/en/zh 등)
