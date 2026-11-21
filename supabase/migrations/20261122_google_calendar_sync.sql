-- Two-way Google Calendar sync (2026-11-22). Safe to re-run.
--
-- One Google connection per business: Creed makes its own "Creed jobs"
-- calendar in that Google account and keeps it and the schedule in step
-- (lib/gcal/*). RLS is ON with NO client policies on the new tables: only the
-- server routes (service role) read or write them. Google tokens are stored
-- AES-256-GCM encrypted (key from server env), never in client code.

CREATE TABLE IF NOT EXISTS google_calendar_links (
  org_id               UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  connected_by         UUID,
  google_email         TEXT,
  refresh_token_enc    TEXT,
  access_token_enc     TEXT,
  access_expires_at    TIMESTAMPTZ,
  calendar_id          TEXT,                       -- the "Creed jobs" calendar
  sync_token           TEXT,                       -- Google incremental sync token
  channel_id           TEXT,                       -- push notification channel
  channel_resource_id  TEXT,
  channel_token_hash   TEXT,                       -- SHA-256 of the channel's secret token
  channel_expires_at   TIMESTAMPTZ,
  status               TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'needs_reconnect')),
  last_error           TEXT,
  last_synced_at       TIMESTAMPTZ,
  sync_lock_until      TIMESTAMPTZ,                -- one sync at a time per business
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS google_calendar_links_channel_idx ON google_calendar_links (channel_id);

-- Schedule visit ↔ Google event. etag + creed_hash are the loop guard: an
-- incoming event with the etag we last saw is our own write coming back, and
-- a visit whose rendered event still hashes to creed_hash hasn't changed.
CREATE TABLE IF NOT EXISTS google_calendar_events (
  org_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  schedule_id  TEXT NOT NULL,
  event_id     TEXT NOT NULL,
  etag         TEXT,
  creed_hash   TEXT,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, schedule_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS google_calendar_events_event_uidx ON google_calendar_events (org_id, event_id);

ALTER TABLE google_calendar_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE google_calendar_events ENABLE ROW LEVEL SECURITY;

-- "Latest edit wins" needs to know when a visit last changed in Creed.
ALTER TABLE schedule ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE OR REPLACE FUNCTION schedule_touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS schedule_touch_updated_at ON schedule;
CREATE TRIGGER schedule_touch_updated_at
  BEFORE UPDATE ON schedule
  FOR EACH ROW EXECUTE FUNCTION schedule_touch_updated_at();
