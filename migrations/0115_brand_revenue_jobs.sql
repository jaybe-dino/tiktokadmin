ALTER TABLE brands ADD COLUMN IF NOT EXISTS revenue_estimate jsonb;
CREATE TABLE IF NOT EXISTS brand_revenue_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  activated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO brand_revenue_settings(singleton) VALUES(true) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS brand_revenue_jobs (
  brand_id uuid PRIMARY KEY REFERENCES brands(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','done','failed')),
  due_at timestamptz NOT NULL DEFAULT now() + interval '60 seconds',
  attempts int NOT NULL DEFAULT 0 CHECK(attempts>=0),
  claim_token uuid, lease_until timestamptz, last_error text,
  created_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz
);
CREATE INDEX IF NOT EXISTS brand_revenue_jobs_due ON brand_revenue_jobs(status,due_at);
