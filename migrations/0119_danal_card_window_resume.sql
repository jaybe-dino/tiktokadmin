-- Opaque provider start data is encrypted per attempt. No raw card data or BILLKEY.
ALTER TABLE brand_billing_attempts ADD COLUMN IF NOT EXISTS card_window_ciphertext text;
