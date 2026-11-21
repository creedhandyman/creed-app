-- Website quote requests held as possible spam (2026-11-23). Safe to re-run.
--
-- /api/leads runs a spam check (lib/lead-spam.ts) on every public quote
-- request. A vendor pitch (SEO, marketing, "we offer", link lists…) is held
-- here instead of becoming a lead, alerting or texting anyone. The owner
-- reviews them in Jobs → "Held as possible spam" and can restore one to a
-- normal lead (/api/leads/review). RLS ON with NO client policies: only the
-- server routes (service role) read or write it.

CREATE TABLE IF NOT EXISTS lead_review (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'flagged' CHECK (status IN ('flagged', 'restored', 'dismissed')),
  name         TEXT,
  phone        TEXT,
  email        TEXT,
  street       TEXT,
  city         TEXT,
  state        TEXT,
  zip          TEXT,
  description  TEXT,
  payload      JSONB NOT NULL DEFAULT '{}'::jsonb,  -- photos, referral, text consent: what a restore needs
  from_tag     TEXT,                                -- salted hash of the sender's address (rate limit)
  email_tag    TEXT,                                -- salted hash of the email (rate limit)
  score        INT,
  reasons      TEXT[] NOT NULL DEFAULT '{}',
  ai_verdict   TEXT,
  job_id       UUID REFERENCES jobs(id) ON DELETE SET NULL,  -- the lead a restore made
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at  TIMESTAMPTZ,
  reviewed_by  UUID
);

CREATE INDEX IF NOT EXISTS lead_review_org_status_idx ON lead_review (org_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS lead_review_from_idx ON lead_review (org_id, from_tag, created_at);
CREATE INDEX IF NOT EXISTS lead_review_email_idx ON lead_review (org_id, email_tag, created_at);

ALTER TABLE lead_review ENABLE ROW LEVEL SECURITY;
