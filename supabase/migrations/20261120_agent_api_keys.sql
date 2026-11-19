-- Agent API (2026-11-20): per-business API keys for AI assistants + a log of
-- every call. Safe to re-run.
--
-- Rules the code relies on:
--  * Only a SHA-256 hash of each key is stored (key_hash). The key itself is
--    shown once, when it is made, and never again.
--  * The business always comes from the key's org_id, never from the request.
--  * RLS is ON with NO client policies: the app reads and writes these tables
--    only through server routes (service role) that check the caller is an
--    owner / manager of the same business.

CREATE TABLE IF NOT EXISTS api_keys (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  scopes       TEXT[] NOT NULL DEFAULT '{}',
  key_hash     TEXT NOT NULL UNIQUE,
  key_prefix   TEXT NOT NULL,              -- first characters, to tell keys apart
  created_by   UUID,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ,
  replaced_by  UUID                        -- the key "Replace key" issued for it
);
CREATE INDEX IF NOT EXISTS api_keys_org_idx ON api_keys (org_id, created_at DESC);

CREATE TABLE IF NOT EXISTS api_activity (
  id          BIGSERIAL PRIMARY KEY,
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  key_id      UUID REFERENCES api_keys(id) ON DELETE SET NULL,
  tool        TEXT NOT NULL,               -- find_customer, draft_quote, key.replace, ...
  via         TEXT,                        -- rest | mcp | app
  ok          BOOLEAN NOT NULL,
  status      INT,
  summary     TEXT,                        -- short, no secrets
  job_id      UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS api_activity_org_idx ON api_activity (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS api_activity_key_idx ON api_activity (key_id, created_at DESC);

ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_activity ENABLE ROW LEVEL SECURITY;

-- Where a work order came from (AppFolio, Angi, Buildium, email) and its id
-- there, so the same work order sent twice lands on the same lead.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS source TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS external_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS jobs_org_source_external_uidx
  ON jobs (org_id, source, external_id)
  WHERE source IS NOT NULL AND external_id IS NOT NULL;
