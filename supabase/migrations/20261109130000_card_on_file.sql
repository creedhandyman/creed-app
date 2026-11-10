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

-- Only the server may set the saved-card columns. Charging uses the Stripe ids
-- stored here, so a signed-in user editing their own customer rows must not be
-- able to point them at another business's saved card. The app's own browser
-- writes (role anon / authenticated) keep the stored values; the service role
-- (webhook, charge and remove routes) and direct SQL are unaffected.
CREATE OR REPLACE FUNCTION customers_protect_saved_card()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_user IN ('anon', 'authenticated') THEN
    IF TG_OP = 'INSERT' THEN
      NEW.stripe_customer_id := NULL;
      NEW.card_payment_method_id := NULL;
      NEW.card_brand := NULL;
      NEW.card_last4 := NULL;
      NEW.card_exp := NULL;
      NEW.card_saved_at := NULL;
      NEW.card_consent := NULL;
    ELSE
      NEW.stripe_customer_id := OLD.stripe_customer_id;
      NEW.card_payment_method_id := OLD.card_payment_method_id;
      NEW.card_brand := OLD.card_brand;
      NEW.card_last4 := OLD.card_last4;
      NEW.card_exp := OLD.card_exp;
      NEW.card_saved_at := OLD.card_saved_at;
      NEW.card_consent := OLD.card_consent;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS customers_protect_saved_card ON customers;
CREATE TRIGGER customers_protect_saved_card
  BEFORE INSERT OR UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION customers_protect_saved_card();
