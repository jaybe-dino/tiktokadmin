-- Separate immutable agreement snapshots; no provider credentials or card data.
CREATE TABLE IF NOT EXISTS recurring_contracts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 contract_id uuid NOT NULL UNIQUE REFERENCES contracts(id) ON DELETE CASCADE,
 brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
 title text NOT NULL,
 details text NOT NULL,
 monthly_amount bigint NOT NULL CHECK(monthly_amount > 0 AND monthly_amount <= 1000000000),
 vat_mode text NOT NULL CHECK(vat_mode IN ('included','excluded')),
 first_billing_date date NOT NULL,
 fee_details text NOT NULL DEFAULT '',
 cancellation_terms text NOT NULL,
 file_name text NOT NULL,
 file_bytes bytea NOT NULL CHECK(octet_length(file_bytes) BETWEEN 5 AND 2097152),
 file_sha256 text NOT NULL,
 token_hash text UNIQUE,
 link_expires_at timestamptz,
 link_revoked_at timestamptz,
 created_by text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS recurring_contracts_brand_idx ON recurring_contracts(brand_id, created_at DESC);
-- A link only grants read access; no subscription/paid status is inferred from opening it.
