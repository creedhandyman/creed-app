-- Automatic customer texts (Twilio): on my way, day-before reminders,
-- unpaid invoice reminders, STOP handling and a log of every text.
-- Run once in the Supabase SQL editor BEFORE turning any switch on.
-- Safe to re-run (IF NOT EXISTS / OR REPLACE everywhere).

-- 1. On/off switches per business. All OFF by default.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS auto_sms_enroute  BOOLEAN DEFAULT FALSE; -- On the way / Running late / Job done send from the business number
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS auto_sms_reminder BOOLEAN DEFAULT FALSE; -- day-before visit reminder (cron /api/sms/reminders)
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS auto_sms_invoice  BOOLEAN DEFAULT FALSE; -- unpaid invoice reminders (cron /api/invoices/reminders)

-- 2. Invoice reminder tracking on jobs.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS invoice_sent_at        TIMESTAMPTZ;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS invoice_reminder_count INTEGER DEFAULT 0;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS invoice_reminder_at    TIMESTAMPTZ;

-- Stamp invoice_sent_at whenever a job moves INTO "invoiced", from any path
-- (Send invoice, status dropdown, bulk bar), so the app needs no change and
-- nothing breaks before this runs. Re-invoicing restarts the reminders.
CREATE OR REPLACE FUNCTION jobs_stamp_invoice_sent() RETURNS trigger AS $$
BEGIN
  IF NEW.status = 'invoiced' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'invoiced') THEN
    NEW.invoice_sent_at := now();
    NEW.invoice_reminder_count := 0;
    NEW.invoice_reminder_at := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_jobs_stamp_invoice_sent ON jobs;
CREATE TRIGGER trg_jobs_stamp_invoice_sent
  BEFORE INSERT OR UPDATE OF status ON jobs
  FOR EACH ROW EXECUTE FUNCTION jobs_stamp_invoice_sent();

-- Jobs already sitting in "invoiced" start their clock today, so turning the
-- switch on never fires a burst of reminders about old invoices.
UPDATE jobs SET invoice_sent_at = now()
  WHERE status = 'invoiced' AND invoice_sent_at IS NULL;

-- 3. Day-before reminder: one per schedule row.
ALTER TABLE schedule ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ;

-- 4. Every automatic text, sent, failed or skipped. Service role only.
CREATE TABLE IF NOT EXISTS sms_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID,
  job_id UUID,
  to_phone TEXT NOT NULL,
  recipient_role TEXT,          -- customer | resident | property_manager
  kind TEXT,                    -- enroute | late | complete | reminder | invoice
  body TEXT,
  twilio_sid TEXT,
  status TEXT,                  -- sent | failed | skipped, then Twilio's delivered / undelivered
  error TEXT,
  sent_by UUID,                 -- profile that tapped send; NULL for the timers
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sms_messages_org_time ON sms_messages(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sms_messages_sid ON sms_messages(twilio_sid);
CREATE INDEX IF NOT EXISTS idx_sms_messages_phone ON sms_messages(to_phone, created_at DESC);
ALTER TABLE sms_messages ENABLE ROW LEVEL SECURITY;  -- no policies: service-role reads/writes only

-- 5. Numbers that replied STOP. One row per number (opt-outs apply to the
-- sending number, which every business on Creed shares for now).
CREATE TABLE IF NOT EXISTS sms_opt_outs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT NOT NULL UNIQUE,   -- E.164, e.g. +13165550123
  org_id UUID,                  -- business whose text they replied to, if known
  source TEXT,                  -- stop_reply | twilio_21610 | manual
  opted_out_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE sms_opt_outs ENABLE ROW LEVEL SECURITY;  -- service-role only

-- 6. New in-app notification types: a customer texted back, an invoice
-- reminder went out, a visit reminder couldn't go out.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (type = ANY (ARRAY[
  'job_assigned', 'new_lead', 'payment_received', 'payroll_alert', 'join_request',
  'quote_approved', 'job_scheduled', 'quote_viewed', 'quote_followup',
  'text_reply', 'invoice_reminder', 'visit_reminder'
]));

-- 7. One customer row has type 'homeowner', which the app doesn't know.
UPDATE customers SET type = 'individual' WHERE type = 'homeowner';
