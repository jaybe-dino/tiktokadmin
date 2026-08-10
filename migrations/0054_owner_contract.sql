-- ═════════════════════════════════════════════════════════════
-- 54 · 계약담당(owner_contract) 신설 — 계약 단계 전담자. 기존 owner_* 와 동일 text(admin id).
-- ═════════════════════════════════════════════════════════════

ALTER TABLE brands
  ADD COLUMN IF NOT EXISTS owner_contract text;
