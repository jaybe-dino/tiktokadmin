-- ─────────────────────────────────────────────────────────────
-- 03 · 외부 결제 참조키 (backfill 재실행 멱등성)
-- glovek orders 등 외부 결제를 payments_manual 에 적재할 때 중복 방지.
-- ─────────────────────────────────────────────────────────────

ALTER TABLE payments_manual ADD COLUMN IF NOT EXISTS ext_ref text;

CREATE UNIQUE INDEX IF NOT EXISTS payments_manual_ext_ref_idx
  ON payments_manual (brand_id, ext_ref) WHERE ext_ref IS NOT NULL;
