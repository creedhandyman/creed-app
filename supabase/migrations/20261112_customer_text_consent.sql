-- Per-customer text consent (2026-11-12). Run once in the Supabase SQL editor.
-- Safe to re-run (IF NOT EXISTS; the backfill only fills empty rows).
--
-- customers.sms_consent holds the customer's CURRENT answer about automatic
-- texts plus a short history (newest first). Shape (lib/sms-consent.ts
-- CustomerSmsConsent):
--   { granted: bool, at: ISO time, source: "website quote form" |
--     "quote approval page" | "online booking page" | "recorded by owner" |
--     "turned off by owner" | "replied STOP" | "replied START",
--     text?: exact wording shown, ip?: requester IP, by?: team member's name,
--     method?: in_person | phone_call | in_writing | text_message,
--     jobId?: job it came from, phone?: last 10 digits it covers,
--     history?: [ earlier answers ] }
--
-- Until this runs, automatic texts keep working off the per-job opt-in only
-- (exactly as before) and the customer page's "Automatic texts" buttons
-- show a save error.

ALTER TABLE customers ADD COLUMN IF NOT EXISTS sms_consent JSONB;

COMMENT ON COLUMN customers.sms_consent IS
  'Automatic-text consent: current answer + history (see lib/sms-consent.ts). Hand-sent texts from the phone''s own Messages app do not use it.';

-- Backfill: a customer who already said yes on a job (website form, approval
-- page or booking page) gets that answer on their customer row. The newest
-- yes per customer wins. Job blobs that aren't readable JSON are skipped.
CREATE OR REPLACE FUNCTION pg_temp.try_jsonb(t TEXT) RETURNS JSONB
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF t IS NULL OR btrim(t) = '' THEN RETURN NULL; END IF;
  RETURN t::jsonb;
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$;

WITH opted AS (
  SELECT DISTINCT ON (x.customer_id) x.customer_id, x.job_id, x.c
  FROM (
    SELECT j.customer_id, j.id AS job_id, pg_temp.try_jsonb(j.rooms) -> 'smsConsent' AS c
    FROM jobs j
    WHERE j.customer_id IS NOT NULL
      AND j.rooms LIKE '%smsConsent%'
  ) x
  WHERE jsonb_typeof(x.c) = 'object'
    AND x.c ->> 'granted' = 'true'
  ORDER BY x.customer_id, x.c ->> 'at' DESC NULLS LAST
)
UPDATE customers cu
SET sms_consent = jsonb_strip_nulls(jsonb_build_object(
      'granted', true,
      'at',      o.c ->> 'at',
      'source',  coalesce(o.c ->> 'source', 'job'),
      'text',    o.c ->> 'text',
      'ip',      o.c ->> 'ip',
      'jobId',   o.job_id::text))
FROM opted o
WHERE cu.id = o.customer_id
  AND cu.sms_consent IS NULL;

-- Check: how many customers have an answer on file now.
SELECT count(*) FILTER (WHERE (sms_consent ->> 'granted') = 'true')  AS opted_in,
       count(*) FILTER (WHERE (sms_consent ->> 'granted') = 'false') AS opted_out,
       count(*) FILTER (WHERE sms_consent IS NULL)                    AS no_answer
FROM customers;
