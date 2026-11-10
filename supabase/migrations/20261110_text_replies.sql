-- Customer text replies (Twilio) saved in Creed: build 1 of "receiving Twilio
-- replies". Run once in the Supabase SQL editor after merging. Safe to re-run
-- (IF NOT EXISTS / OR REPLACE everywhere). Until it runs, replies still raise a
-- bell notification exactly as before; they just aren't saved.

-- 1. One log for both sides of every conversation. Existing rows are texts we
--    sent, so direction defaults to 'out'.
ALTER TABLE sms_messages ADD COLUMN IF NOT EXISTS direction     TEXT NOT NULL DEFAULT 'out'; -- out | in
ALTER TABLE sms_messages ADD COLUMN IF NOT EXISTS from_phone    TEXT;         -- sender (E.164); the customer on an incoming text
ALTER TABLE sms_messages ADD COLUMN IF NOT EXISTS contact_phone TEXT;         -- the customer's number, both directions: the conversation key
ALTER TABLE sms_messages ADD COLUMN IF NOT EXISTS customer_id   UUID;
ALTER TABLE sms_messages ADD COLUMN IF NOT EXISTS match_status  TEXT;         -- incoming only: thread | customer | resident | several | unknown | held
ALTER TABLE sms_messages ADD COLUMN IF NOT EXISTS read_at       TIMESTAMPTZ;  -- incoming only: when someone opened it (Texts screen, build 2)
ALTER TABLE sms_messages ADD COLUMN IF NOT EXISTS media         JSONB;        -- incoming photos: [{ url, type }] copied into storage

UPDATE sms_messages SET contact_phone = to_phone WHERE contact_phone IS NULL AND direction = 'out';

-- Twilio can deliver the same incoming text twice: one row per Twilio id.
-- (NULLs don't collide, so failed/skipped sends without an id are fine.)
CREATE UNIQUE INDEX IF NOT EXISTS uq_sms_messages_twilio_sid ON sms_messages(twilio_sid);
CREATE INDEX IF NOT EXISTS idx_sms_messages_contact ON sms_messages(org_id, contact_phone, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sms_messages_contact_any ON sms_messages(contact_phone, created_at DESC);

-- 2. Find customers by phone whatever format it was typed in: last 10 digits.
--    An expression index plus a lookup function, not a new column, so nothing
--    the app writes to customers changes.
CREATE INDEX IF NOT EXISTS idx_customers_phone_last10
  ON customers ((right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10)));

CREATE OR REPLACE FUNCTION sms_customers_by_phone(p_last10 TEXT)
RETURNS TABLE (id UUID, org_id UUID, name TEXT)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
  SELECT c.id, c.org_id, c.name
  FROM customers c
  WHERE length(p_last10) = 10
    AND right(regexp_replace(coalesce(c.phone, ''), '\D', '', 'g'), 10) = p_last10
  LIMIT 20;
$$;
-- Server (service role) only: the webhook calls it, the app never does.
REVOKE ALL ON FUNCTION sms_customers_by_phone(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION sms_customers_by_phone(TEXT) TO service_role;

-- 3. Photos a customer texts go on the matched job's photos. One atomic
--    append inside the database, so it can't overwrite an app save that lands
--    at the same moment. A job blob that isn't readable JSON is left alone.
CREATE OR REPLACE FUNCTION sms_add_job_photos(p_job UUID, p_org UUID, p_urls TEXT[])
RETURNS INTEGER
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE
  blob   JSONB;
  photos JSONB;
  added  INTEGER := 0;
  u      TEXT;
BEGIN
  SELECT CASE WHEN coalesce(rooms, '') = '' THEN '{}'::jsonb ELSE rooms::jsonb END
    INTO blob
    FROM jobs WHERE id = p_job AND org_id = p_org
    FOR UPDATE;
  IF NOT FOUND OR jsonb_typeof(blob) <> 'object' THEN RETURN 0; END IF;
  photos := CASE WHEN jsonb_typeof(blob -> 'photos') = 'array' THEN blob -> 'photos' ELSE '[]'::jsonb END;
  FOREACH u IN ARRAY coalesce(p_urls, ARRAY[]::TEXT[]) LOOP
    IF coalesce(u, '') <> '' AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(photos) e WHERE e ->> 'url' = u) THEN
      photos := photos || jsonb_build_array(jsonb_build_object('url', u, 'type', 'before', 'label', 'Customer text'));
      added := added + 1;
    END IF;
  END LOOP;
  IF added > 0 THEN
    UPDATE jobs SET rooms = jsonb_set(blob, '{photos}', photos)::text WHERE id = p_job AND org_id = p_org;
  END IF;
  RETURN added;
EXCEPTION WHEN invalid_text_representation THEN
  RETURN 0;
END;
$$;
REVOKE ALL ON FUNCTION sms_add_job_photos(UUID, UUID, TEXT[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION sms_add_job_photos(UUID, UUID, TEXT[]) TO service_role;
