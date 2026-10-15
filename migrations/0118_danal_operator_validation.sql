-- Operator verification is scoped to one 301-KRW contract; never enables ordinary customers.
ALTER TABLE brand_billing_control ADD COLUMN IF NOT EXISTS operator_test_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE brand_billing_control ADD COLUMN IF NOT EXISTS operator_test_contract_id uuid REFERENCES recurring_contracts(id);
ALTER TABLE brand_billing_subscriptions ADD COLUMN IF NOT EXISTS is_operator_test boolean NOT NULL DEFAULT false;
-- Test rows stay excluded even after validation is disabled or ordinary renewals are enabled.
