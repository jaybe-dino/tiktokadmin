-- 브랜드사 제품 관리 포털(/apply/products) — 제품별 승인 워크플로.
--   브랜드가 등록·수정한 제품을 어드민이 개별 승인/반려한다. 수정 시 승인은 대기로 되돌아간다.
ALTER TABLE onb_products ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'pending'; -- pending|approved|rejected
ALTER TABLE onb_products ADD COLUMN IF NOT EXISTS approval_note text NOT NULL DEFAULT '';
ALTER TABLE onb_products ADD COLUMN IF NOT EXISTS approved_at timestamptz;
ALTER TABLE onb_products ADD COLUMN IF NOT EXISTS approved_by text NOT NULL DEFAULT '';
