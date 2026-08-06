-- ═════════════════════════════════════════════════════════════
-- 43 · 제안서 금액 컬럼 정수 오버플로 방지 — integer(±21.4억) → bigint.
--   list_amount·monthly_amount(0035) · value_total(0042) 는 원 단위라 21.4억↑ 계약이면
--   "integer out of range" 로 저장 실패했음. bigint 로 확장(값·의미 불변, 안전).
-- ═════════════════════════════════════════════════════════════
ALTER TABLE proposal_docs
  ALTER COLUMN list_amount    TYPE bigint,
  ALTER COLUMN monthly_amount TYPE bigint,
  ALTER COLUMN value_total    TYPE bigint;
