-- Card on file: a customer can save their card at checkout, and the owner or a
-- manager can later charge it for what the customer owes on a job.
--
-- Off by default. The business turns it on in Ops -> Billing & Payments ->
-- Checkout options. Until this runs, checkout works exactly as before (no
-- "save my card" box) and the Charge card button never shows: every read of
-- these columns is a separate best-effort query.
--
-- The card itself never touches Creed: Stripe keeps it on Creed's platform
-- account (a Stripe Customer with a saved PaymentMethod), and the charge is a
-- destination charge to the business's connected account, the same as a
-- checkout payment. Only the brand, last 4 and expiry are stored here, for
-- display.

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS card_on_file_enabled BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE customers ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS card_payment_method_id TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS card_brand TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS card_last4 TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS card_exp TEXT;          -- "04/28"
ALTER TABLE customers ADD COLUMN IF NOT EXISTS card_saved_at TIMESTAMPTZ;
-- What the customer agreed to when saving: {version, text, session_id, accepted_at}.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS card_consent JSONB;
