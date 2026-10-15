-- One explicit 301-KRW OTBILL test per test subscription. Never advances renewal dates.
ALTER TABLE brand_billing_attempts DROP CONSTRAINT IF EXISTS brand_billing_attempts_kind_check;
ALTER TABLE brand_billing_attempts ADD CONSTRAINT brand_billing_attempts_kind_check CHECK(kind IN ('initial','renewal','operator_test'));
ALTER TABLE brand_billing_attempts DROP CONSTRAINT IF EXISTS brand_billing_operator_test_amount_check;
ALTER TABLE brand_billing_attempts ADD CONSTRAINT brand_billing_operator_test_amount_check CHECK(kind <> 'operator_test' OR (amount=301 AND is_bill=true));
CREATE UNIQUE INDEX IF NOT EXISTS brand_billing_operator_test_once_idx ON brand_billing_attempts(subscription_id) WHERE kind='operator_test';
