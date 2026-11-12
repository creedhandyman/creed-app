-- Email campaigns + customer referrals — NOT yet run in prod. Safe to re-run.
-- Everything is additive. Both features stay OFF for every business until the
-- owner turns them on in Ops → Business settings → Customer messages.
-- Writes to the three new tables go through the server (service role) only;
-- signed-in owners and managers can read their own business's rows.

-- ── Switches + the referral reward, per business ──────────────────────────
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS campaigns_enabled BOOLEAN DEFAULT FALSE;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS referrals_enabled BOOLEAN DEFAULT FALSE;
-- What a customer earns when someone they referred pays for their first job.
-- Taken off that customer's next job as a fixed discount.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS referral_reward_cents INTEGER DEFAULT 2500;
DO $$ BEGIN
  ALTER TABLE organizations ADD CONSTRAINT organizations_referral_reward_chk
    CHECK (referral_reward_cents IS NULL OR (referral_reward_cents >= 0 AND referral_reward_cents <= 100000));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Customers: email opt-out + each customer's own referral code ──────────
ALTER TABLE customers ADD COLUMN IF NOT EXISTS email_unsubscribed_at TIMESTAMPTZ;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS referral_code TEXT;
UPDATE customers
   SET referral_code = lower(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))
 WHERE referral_code IS NULL;
ALTER TABLE customers ALTER COLUMN referral_code
  SET DEFAULT lower(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
CREATE UNIQUE INDEX IF NOT EXISTS customers_referral_code_key ON customers (referral_code);

-- The app (anon / signed-in users) can mark a customer "don't email", but can
-- never take an unsubscribe back off, and can't pick or change a referral
-- code. Only the server (unsubscribe link, Resend webhook) writes these.
CREATE OR REPLACE FUNCTION customers_protect_marketing()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_user IN ('anon', 'authenticated') THEN
    IF TG_OP = 'INSERT' THEN
      NEW.email_unsubscribed_at := NULL;
      NEW.referral_code := lower(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
    ELSE
      IF OLD.email_unsubscribed_at IS NOT NULL THEN
        NEW.email_unsubscribed_at := OLD.email_unsubscribed_at;
      END IF;
      NEW.referral_code := OLD.referral_code;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS customers_protect_marketing ON customers;
CREATE TRIGGER customers_protect_marketing
  BEFORE INSERT OR UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION customers_protect_marketing();

-- ── Campaigns ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  audience TEXT NOT NULL DEFAULT 'all'
    CHECK (audience IN ('all', 'individual', 'business', 'property_manager', 'lapsed', 'members')),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'scheduled', 'sending', 'sent', 'cancelled')),
  scheduled_for TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  recipient_count INTEGER DEFAULT 0,
  last_error TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS campaigns_org_idx ON campaigns (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS campaigns_due_idx ON campaigns (scheduled_for)
  WHERE status IN ('scheduled', 'sending');

-- One row per customer per campaign. The cron claims 'queued' rows, sends,
-- then marks them sent / failed; Resend's webhook stamps delivered / opened /
-- clicked / bounced by resend_id.
CREATE TABLE IF NOT EXISTS campaign_sends (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL,
  email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'sending', 'sent', 'failed', 'skipped')),
  resend_id TEXT,
  error TEXT,
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  opened_at TIMESTAMPTZ,
  clicked_at TIMESTAMPTZ,
  bounced_at TIMESTAMPTZ,
  complained_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (campaign_id, customer_id)
);
CREATE INDEX IF NOT EXISTS campaign_sends_queue_idx ON campaign_sends (campaign_id, status);
CREATE INDEX IF NOT EXISTS campaign_sends_customer_idx ON campaign_sends (customer_id);
CREATE UNIQUE INDEX IF NOT EXISTS campaign_sends_resend_id_key ON campaign_sends (resend_id)
  WHERE resend_id IS NOT NULL;

-- ── Customer referrals ────────────────────────────────────────────────────
-- pending = the referred customer sent a request; earned = they paid for a
-- job, so the referrer has a credit; applied = the credit went on one of the
-- referrer's jobs as a discount; void = the owner cancelled it.
CREATE TABLE IF NOT EXISTS customer_referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  referrer_customer_id UUID NOT NULL,
  referred_customer_id UUID NOT NULL,
  lead_job_id UUID,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'earned', 'applied', 'void')),
  reward_cents INTEGER DEFAULT 0,
  earned_at TIMESTAMPTZ,
  earned_job_id UUID,
  applied_at TIMESTAMPTZ,
  applied_job_id UUID,
  created_at TIMESTAMPTZ DEFAULT now(),
  -- A new customer can only be credited to one referrer.
  UNIQUE (org_id, referred_customer_id),
  CHECK (referrer_customer_id <> referred_customer_id)
);
CREATE INDEX IF NOT EXISTS customer_referrals_referrer_idx ON customer_referrals (referrer_customer_id);

-- ── Row level security: owners/managers read their own business; the server
--    (service role) does every write. ──────────────────────────────────────
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_sends ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_referrals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS campaigns_select ON campaigns;
CREATE POLICY campaigns_select ON campaigns FOR SELECT TO authenticated
  USING (org_id = auth_org_id() AND auth_role() IN ('owner', 'manager'));

DROP POLICY IF EXISTS campaign_sends_select ON campaign_sends;
CREATE POLICY campaign_sends_select ON campaign_sends FOR SELECT TO authenticated
  USING (org_id = auth_org_id() AND auth_role() IN ('owner', 'manager'));

DROP POLICY IF EXISTS customer_referrals_select ON customer_referrals;
CREATE POLICY customer_referrals_select ON customer_referrals FOR SELECT TO authenticated
  USING (org_id = auth_org_id() AND auth_role() IN ('owner', 'manager'));
