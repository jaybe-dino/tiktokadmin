-- Read/display storage only. Does not enqueue or execute AI estimation.
ALTER TABLE brands ADD COLUMN IF NOT EXISTS revenue_estimate jsonb;
COMMENT ON COLUMN brands.revenue_estimate IS
  'AI annual revenue estimate, not verified revenue. estimated requires lower/upper/currency/year/scope/entity/confidence/estimated_at/rationale/sources. Other states: pending/running/insufficient/failed. Null means not yet estimated.';
