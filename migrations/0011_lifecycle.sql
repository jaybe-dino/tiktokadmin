-- ═════════════════════════════════════════════════════════════
-- 11 · 라이프사이클 & 거버넌스 — Phase 6 (문서 17)
--   해지 사유·수신동의·오프보딩 서류 템플릿·환불 승인 종류.
-- ═════════════════════════════════════════════════════════════

-- 1. 해지·이탈 (17 §1)
ALTER TABLE brands ADD COLUMN IF NOT EXISTS churn_reason text;   -- 가격|성과불만|자체운영전환|폐업|기타
ALTER TABLE brands ADD COLUMN IF NOT EXISTS churned_at timestamptz;
ALTER TABLE brands ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false;  -- 12개월 무반응(뷰 필터)

-- 5. 마케팅 수신동의 (17 §5, 정보통신망법)
ALTER TABLE brand_contacts ADD COLUMN IF NOT EXISTS marketing_consent boolean;  -- null=미확인
ALTER TABLE brand_contacts ADD COLUMN IF NOT EXISTS consent_at timestamptz;

-- 1-③ 오프보딩 서류 템플릿 허용
ALTER TABLE doc_items DROP CONSTRAINT IF EXISTS doc_items_template_check;
ALTER TABLE doc_items ADD CONSTRAINT doc_items_template_check
  CHECK (template IN ('mall','onboarding','offboard'));

-- 2. 환불 승인 (17 §2) — approval_requests.kind 는 자유 text(0006), 문서화만.
--    kind='refund' 사용. payments_manual 음수 기록으로 일회 환불 반영.

-- 데이터 보존 타이머 (17 §1-④) — assets.retention_until 는 0007 에 이미 존재.
