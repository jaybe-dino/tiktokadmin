-- GloveK-only billing ledger. Never writes the shared GloveK subscriptions/payments tables.
CREATE TABLE IF NOT EXISTS brand_billing_control (
 id boolean PRIMARY KEY DEFAULT true CHECK(id),
 enabled boolean NOT NULL DEFAULT false,
 renewals_enabled boolean NOT NULL DEFAULT false,
 updated_by text,
 updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO brand_billing_control(id) VALUES(true) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS brand_billing_subscriptions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 recurring_contract_id uuid NOT NULL UNIQUE REFERENCES recurring_contracts(id),
 billing_user_key text NOT NULL UNIQUE,
 status text NOT NULL DEFAULT 'awaiting_card' CHECK(status IN ('awaiting_card','active','paused','needs_review','ended')),
 billing_key_ciphertext text,
 billing_key_hash text UNIQUE,
 consent_at timestamptz NOT NULL,
 consent_version text NOT NULL,
 consent_snapshot_hash text NOT NULL,
 next_billing_date date,
 paused_by text,
 paused_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS brand_billing_attempts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 subscription_id uuid NOT NULL REFERENCES brand_billing_subscriptions(id),
 kind text NOT NULL CHECK(kind IN ('initial','renewal')),
 order_id text NOT NULL UNIQUE,
 due_date date NOT NULL,
 amount bigint NOT NULL CHECK(amount >= 100 AND amount <= 1100000000),
 is_bill boolean NOT NULL,
 status text NOT NULL CHECK(status IN ('preparing','ready','approving','paid','registered','failed','unknown','expired','blocked')),
 callback_state_hash text UNIQUE,
 contract_link_hash text,
 auth_tid text UNIQUE,
 provider_tid text UNIQUE,
 provider_code text,
 failure_code text,
 auth_expires_at timestamptz,
 completed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS brand_billing_initial_open_idx ON brand_billing_attempts(subscription_id)
 WHERE kind='initial' AND status IN ('preparing','ready','approving','paid','registered','unknown');
CREATE UNIQUE INDEX IF NOT EXISTS brand_billing_renewal_cycle_idx ON brand_billing_attempts(subscription_id,due_date) WHERE kind='renewal';
CREATE INDEX IF NOT EXISTS brand_billing_due_idx ON brand_billing_subscriptions(next_billing_date) WHERE status='active';
CREATE TABLE IF NOT EXISTS brand_billing_events (
 id bigserial PRIMARY KEY,
 subscription_id uuid REFERENCES brand_billing_subscriptions(id),
 attempt_id uuid REFERENCES brand_billing_attempts(id),
 event text NOT NULL,
 actor text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
