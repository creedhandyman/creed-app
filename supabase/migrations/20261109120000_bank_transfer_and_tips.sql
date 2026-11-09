-- Bank transfer (ACH) and tips at checkout.
-- Safe to run more than once. Everything defaults OFF / zero, so nothing
-- changes for customers until an owner turns the switches on in
-- Operations > Billing.

-- Per-business switches (both off by default).
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS ach_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS tips_enabled BOOLEAN NOT NULL DEFAULT false;

-- The tip on a customer payment, kept OUT of payments.amount so it never pays
-- down the job balance and never carries Creed's platform fee.
ALTER TABLE payments ADD COLUMN IF NOT EXISTS tip_cents INTEGER NOT NULL DEFAULT 0;

-- Which processor took the payment. Every row today is Stripe; a second
-- processor (for example Banccard) can be added later without a backfill.
ALTER TABLE payments ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'stripe';
