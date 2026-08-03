-- ─────────────────────────────────────────────────────────────
-- 20 · 영업 제안서 고도화 (기획확정 8절 · 제안서)
--   · contract_file_url : 계약서 첨부 — 구글드라이브 링크 수기 입력
--   · contract_term     : 계약기간(자유 텍스트, 예: "12개월" / "2026-09~2027-08")
--   · billing_day       : 매월 결제일(1~31)
--   · followup_due      : 발송(sent) 후 미계약 팔로업 기한(sent_at + 3일)
-- ─────────────────────────────────────────────────────────────

ALTER TABLE proposals ADD COLUMN IF NOT EXISTS contract_file_url text;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS contract_term text;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS billing_day int;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS followup_due date;

-- 팔로업 점검(간이 크론) 조회용
CREATE INDEX IF NOT EXISTS proposals_followup_idx ON proposals (status, followup_due);
