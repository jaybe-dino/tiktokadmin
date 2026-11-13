-- BUG-60: 온보딩 서류 사전 검수 결과.
--   브랜드가 서류를 올리는 그 자리에서 "이대로면 반려" 인지 알려 주고,
--   관리자 검토 화면에도 같은 판정을 띄운다.
--   서류에 적힌 값(이름·번호·주소)은 저장하지 않는다 — 판정과 정해진 사유 코드만 남긴다.
CREATE TABLE IF NOT EXISTS onb_doc_checks (
  file_id uuid PRIMARY KEY REFERENCES onb_files(id) ON DELETE CASCADE,
  application_id uuid REFERENCES onb_applications(id) ON DELETE CASCADE,
  field text NOT NULL DEFAULT '',
  verdict text NOT NULL DEFAULT 'warn'
    CHECK (verdict IN ('pass','warn','reject')),
  reasons jsonb NOT NULL DEFAULT '[]'::jsonb,   -- 사유 코드 배열(lib/onb-doc-rules.ts 의 REASON_CODES)
  ai_used boolean NOT NULL DEFAULT false,       -- AI 를 실제로 거쳤는지(기계 검사만이면 false)
  checked_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS onb_doc_checks_app_idx ON onb_doc_checks (application_id, checked_at DESC);
