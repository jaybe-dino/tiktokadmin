-- ═════════════════════════════════════════════════════════════
-- 55 · 계약 ↔ 운영제안서 연결 — 계약이 어느 제안(견적)에서 나왔는지 맵핑.
--   브랜드360 계약 등록 시 해당 브랜드의 제안서를 선택해 연결 → 영업파트(계약·결제)에서 추적.
-- ═════════════════════════════════════════════════════════════

ALTER TABLE contracts
  ADD COLUMN IF NOT EXISTS proposal_id uuid REFERENCES proposals(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS contracts_proposal_idx ON contracts (proposal_id);
