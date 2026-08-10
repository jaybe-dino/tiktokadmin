-- ═════════════════════════════════════════════════════════════
-- 56 · 회의록(직접 입력) — 브랜드360 회의록 탭. 텍스트 + 파일(DB 저장) 첨부.
--   자동 회의록(미팅 요약·전사)은 meetings 테이블에서 오고, 여기엔 수기 회의록을 날짜별로.
-- ═════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS meeting_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  note_date date NOT NULL DEFAULT current_date,   -- 회의 날짜
  title text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '',                   -- 회의록 본문(텍스트)
  file_url text,                                   -- 외부 링크(구글드라이브 등)
  file_name text,                                  -- 업로드 파일명
  file_mime text,                                  -- 업로드 MIME
  file_bytes bytea,                                -- 업로드 파일 바이트(DB 저장·스트리밍)
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS meeting_notes_brand_idx ON meeting_notes (brand_id, note_date DESC, created_at DESC);
