-- "Sign in with Creed" for the MCP server (2026-11-21): OAuth 2.1 clients,
-- one-time authorization codes and access / refresh tokens. Safe to re-run;
-- run AFTER 20261120_agent_api_keys.sql.
--
-- How it fits the agent API:
--  * An approved connection is an api_keys row with kind = 'oauth' (the
--    "grant"): same org_id + scopes as a pasted key, listed on the AI
--    assistant connection page, revoked the same way, and every call is
--    logged to api_activity under its id. It has no key_hash (no pasted key).
--  * Codes and tokens are stored as SHA-256 hashes only.
--  * RLS is ON with NO client policies: only the server routes (service
--    role) touch these tables.

ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'key';
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS oauth_client_id TEXT;
ALTER TABLE api_keys ALTER COLUMN key_hash DROP NOT NULL;
ALTER TABLE api_keys ALTER COLUMN key_prefix DROP NOT NULL;

-- Apps that registered themselves (dynamic client registration, RFC 7591).
CREATE TABLE IF NOT EXISTS oauth_clients (
  client_id                  TEXT PRIMARY KEY,
  client_secret_hash         TEXT,             -- NULL = public client (PKCE only)
  client_name                TEXT NOT NULL,
  redirect_uris              TEXT[] NOT NULL,
  token_endpoint_auth_method TEXT NOT NULL DEFAULT 'none',
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at               TIMESTAMPTZ
);

-- One-time authorization codes (10 minutes, PKCE S256).
CREATE TABLE IF NOT EXISTS oauth_codes (
  code_hash      TEXT PRIMARY KEY,
  client_id      TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  org_id         UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id        UUID NOT NULL,
  scopes         TEXT[] NOT NULL DEFAULT '{}',
  redirect_uri   TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  resource       TEXT,
  expires_at     TIMESTAMPTZ NOT NULL,
  used_at        TIMESTAMPTZ,
  grant_id       UUID,                          -- the connection it became
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Access tokens (1 hour) and refresh tokens (60 days, rotated on use).
CREATE TABLE IF NOT EXISTS oauth_tokens (
  token_hash  TEXT PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN ('access', 'refresh')),
  grant_id    UUID NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  client_id   TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS oauth_tokens_grant_idx ON oauth_tokens (grant_id);

ALTER TABLE oauth_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE oauth_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE oauth_tokens ENABLE ROW LEVEL SECURITY;
