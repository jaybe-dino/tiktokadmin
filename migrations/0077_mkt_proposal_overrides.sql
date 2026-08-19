-- ═════════════════════════════════════════════════════════════
-- 77 · 마케팅 제안서 배분 조정(그때그때 다르게)
--   · phase_ratios_json: 페이즈별 무가:유가 오버라이드({BUILD:{organic,paid},...})
--   · month_overrides_json: 월별 수동 오버라이드([{organic,paid,event,note}|null])
-- ═════════════════════════════════════════════════════════════

ALTER TABLE mkt_proposal_docs ADD COLUMN IF NOT EXISTS phase_ratios_json jsonb NOT NULL DEFAULT '{}';
ALTER TABLE mkt_proposal_docs ADD COLUMN IF NOT EXISTS month_overrides_json jsonb NOT NULL DEFAULT '[]';
