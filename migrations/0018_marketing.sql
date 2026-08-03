-- ═════════════════════════════════════════════════════════════
-- 18 · 마케팅 트랙 + 마케팅 제안서 (PLAN-기획확정 7절)
--   · brands.contract_type 에 'marketing' 허용 (CHECK 재생성)
--   · contracts.kind CHECK 는 0007 에서 이미 'marketing','marketing_retainer'
--     포함 — 변경 불필요(확인됨)
--   · proposals.kind ('sales'|'marketing') — /mkt 마케팅 제안서 분리 저장
--   · proposals 기간 컬럼 + email_drafts.proposal_id (초안함 발송 연결)
-- ═════════════════════════════════════════════════════════════

-- 1) brands.contract_type: mall|onboarding → + marketing
--    (제약 이름은 0001 생성 후 0006 에서 brands_contract_type_check 로 재확정)
ALTER TABLE brands DROP CONSTRAINT IF EXISTS brands_contract_type_check;
ALTER TABLE brands ADD CONSTRAINT brands_contract_type_check
  CHECK (contract_type IN ('mall','onboarding','marketing'));

-- 1-b) doc_items.template: 계약완료 전이 시 ensureDocTemplate(contract_type) 가
--      template='marketing' 으로 생성하므로 CHECK 에 marketing 허용 (0011 재생성분).
ALTER TABLE doc_items DROP CONSTRAINT IF EXISTS doc_items_template_check;
ALTER TABLE doc_items ADD CONSTRAINT doc_items_template_check
  CHECK (template IN ('mall','onboarding','offboard','marketing'));

-- 2) proposals.kind: sales(견적 기반 영업 제안) | marketing(마케팅 제안서)
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'sales';
ALTER TABLE proposals DROP CONSTRAINT IF EXISTS proposals_kind_check;
ALTER TABLE proposals ADD CONSTRAINT proposals_kind_check
  CHECK (kind IN ('sales','marketing'));
CREATE INDEX IF NOT EXISTS proposals_kind_idx ON proposals (kind, created_at);

-- 3) 마케팅 제안서 기간(계약 예정 기간). note 는 범위 메모로 사용(기존 컬럼).
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS period_start date;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS period_end date;

-- 4) 초안함 발송 연결 — 마케팅 제안서 발송은 email_drafts(담당 승인) 경유.
ALTER TABLE email_drafts ADD COLUMN IF NOT EXISTS proposal_id uuid REFERENCES proposals(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS email_drafts_proposal_idx ON email_drafts (proposal_id);
