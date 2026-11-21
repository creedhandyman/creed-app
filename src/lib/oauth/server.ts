/**
 * "Sign in with Creed" — the database side (service role). Clients register
 * themselves, an owner / manager approves on /oauth/authorize (which mints a
 * one-time code), the client trades the code + PKCE verifier for an access
 * token (1 h) and a refresh token (60 days, rotated on every use).
 *
 * The approved connection is an api_keys row with kind 'oauth' — the same
 * org + scopes model as a pasted key, so the agent runner, rate limits, the
 * activity log and the AI assistant connection page treat both alike, and
 * revoking that row ends every token it issued.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { cleanScopes, type AgentScope } from "../agent/scopes";
import {
  ACCESS_TTL_SEC, CODE_TTL_SEC, PREFIX, REFRESH_TTL_SEC, checkRegistration, clientAuthOk, clientCredentials,
  isAccessToken, pkceOk, randomToken, sha256, type RegError,
} from "./core";

export interface OAuthClient {
  client_id: string;
  client_secret_hash: string | null;
  client_name: string;
  redirect_uris: string[];
  token_endpoint_auth_method: string;
}

export type TokenError = { status: number; error: string; error_description: string };
export interface TokenSet { access_token: string; token_type: "Bearer"; expires_in: number; refresh_token: string; scope: string }

const iso = (secFromNow: number) => new Date(Date.now() + secFromNow * 1000).toISOString();

export async function registerClient(sb: SupabaseClient, body: unknown): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; err: RegError | { error: string; error_description: string } }> {
  const c = checkRegistration(body);
  if (!c.ok) return { ok: false, err: c.err };
  const m = c.value;
  const client_id = randomToken(PREFIX.client, 12);
  const secret = m.token_endpoint_auth_method === "none" ? "" : randomToken(PREFIX.secret);
  const { error } = await sb.from("oauth_clients").insert({
    client_id, client_secret_hash: secret ? sha256(secret) : null, client_name: m.client_name,
    redirect_uris: m.redirect_uris, token_endpoint_auth_method: m.token_endpoint_auth_method,
  });
  if (error) return { ok: false, err: { error: "server_error", error_description: "could not register" } };
  return {
    ok: true,
    data: {
      client_id, client_id_issued_at: Math.floor(Date.now() / 1000),
      ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
      client_name: m.client_name, redirect_uris: m.redirect_uris,
      token_endpoint_auth_method: m.token_endpoint_auth_method,
      grant_types: ["authorization_code", "refresh_token"], response_types: ["code"],
    },
  };
}

export async function getClient(sb: SupabaseClient, clientId: string | null | undefined): Promise<OAuthClient | null> {
  if (!clientId || clientId.length > 80) return null;
  const { data } = await sb.from("oauth_clients")
    .select("client_id, client_secret_hash, client_name, redirect_uris, token_endpoint_auth_method")
    .eq("client_id", clientId).maybeSingle();
  return (data as OAuthClient) || null;
}

/** The owner pressed Approve: a one-time code for this client + business. */
export async function createCode(sb: SupabaseClient, c: {
  clientId: string; orgId: string; userId: string; scopes: AgentScope[]; redirectUri: string; codeChallenge: string; resource: string;
}): Promise<string | null> {
  const code = randomToken(PREFIX.code);
  const { error } = await sb.from("oauth_codes").insert({
    code_hash: sha256(code), client_id: c.clientId, org_id: c.orgId, user_id: c.userId, scopes: c.scopes,
    redirect_uri: c.redirectUri, code_challenge: c.codeChallenge, resource: c.resource || null, expires_at: iso(CODE_TTL_SEC),
  });
  return error ? null : code;
}

async function issueTokens(sb: SupabaseClient, grantId: string, clientId: string, scopes: string[]): Promise<TokenSet | null> {
  const access = randomToken(PREFIX.access);
  const refresh = randomToken(PREFIX.refresh);
  const { error } = await sb.from("oauth_tokens").insert([
    { token_hash: sha256(access), kind: "access", grant_id: grantId, client_id: clientId, expires_at: iso(ACCESS_TTL_SEC) },
    { token_hash: sha256(refresh), kind: "refresh", grant_id: grantId, client_id: clientId, expires_at: iso(REFRESH_TTL_SEC) },
  ]);
  if (error) return null;
  return { access_token: access, token_type: "Bearer", expires_in: ACCESS_TTL_SEC, refresh_token: refresh, scope: scopes.join(" ") };
}

const bad = (error: string, error_description: string, status = 400): TokenError => ({ status, error, error_description });

/** POST /api/oauth/token — authorization_code and refresh_token grants. */
export async function tokenRequest(sb: SupabaseClient, form: URLSearchParams, authHeader: string | null): Promise<{ ok: true; tokens: TokenSet } | { ok: false; err: TokenError }> {
  const cred = clientCredentials(authHeader, form);
  const client = await getClient(sb, cred.id);
  if (!client || !clientAuthOk(client, cred.secret)) return { ok: false, err: bad("invalid_client", "unknown client or wrong secret", 401) };
  const grantType = form.get("grant_type");

  if (grantType === "authorization_code") {
    const code = form.get("code") || "";
    if (!code.startsWith(PREFIX.code)) return { ok: false, err: bad("invalid_grant", "bad code") };
    const hash = sha256(code);
    // Single use: only the first exchange flips used_at.
    const { data: row } = await sb.from("oauth_codes").update({ used_at: new Date().toISOString() })
      .eq("code_hash", hash).is("used_at", null).select("*").maybeSingle();
    if (!row) {
      // A replayed code: end whatever connection it already became.
      const { data: used } = await sb.from("oauth_codes").select("grant_id").eq("code_hash", hash).maybeSingle();
      if (used?.grant_id) await sb.from("api_keys").update({ revoked_at: new Date().toISOString() }).eq("id", used.grant_id).is("revoked_at", null);
      return { ok: false, err: bad("invalid_grant", "code already used or unknown") };
    }
    if (row.client_id !== client.client_id) return { ok: false, err: bad("invalid_grant", "code was issued to another client") };
    if (new Date(row.expires_at).getTime() < Date.now()) return { ok: false, err: bad("invalid_grant", "code expired") };
    if ((form.get("redirect_uri") || row.redirect_uri) !== row.redirect_uri) return { ok: false, err: bad("invalid_grant", "redirect_uri mismatch") };
    if (!pkceOk(form.get("code_verifier"), row.code_challenge)) return { ok: false, err: bad("invalid_grant", "PKCE verification failed") };
    const res = form.get("resource");
    if (res && row.resource && res.replace(/\/+$/, "") !== String(row.resource).replace(/\/+$/, "")) return { ok: false, err: bad("invalid_target", "resource mismatch") };

    const scopes = cleanScopes(row.scopes);
    const { data: grant, error } = await sb.from("api_keys").insert({
      org_id: row.org_id, name: client.client_name, scopes, kind: "oauth", oauth_client_id: client.client_id,
      key_hash: null, key_prefix: null, created_by: row.user_id,
    }).select("id").single();
    if (error || !grant) return { ok: false, err: bad("server_error", "could not save the connection", 500) };
    await sb.from("oauth_codes").update({ grant_id: grant.id }).eq("code_hash", hash);
    const tokens = await issueTokens(sb, grant.id, client.client_id, scopes);
    if (!tokens) return { ok: false, err: bad("server_error", "could not issue tokens", 500) };
    await sb.from("oauth_clients").update({ last_used_at: new Date().toISOString() }).eq("client_id", client.client_id);
    try {
      await sb.from("api_activity").insert({ org_id: row.org_id, key_id: grant.id, tool: "oauth.connect", via: "app", ok: true, status: 200, summary: `connected "${client.client_name}"` });
    } catch { /* best-effort */ }
    return { ok: true, tokens };
  }

  if (grantType === "refresh_token") {
    const rt = form.get("refresh_token") || "";
    if (!rt.startsWith(PREFIX.refresh)) return { ok: false, err: bad("invalid_grant", "bad refresh token") };
    // Rotation: the presented token is spent the moment it's used.
    const { data: row } = await sb.from("oauth_tokens").update({ revoked_at: new Date().toISOString() })
      .eq("token_hash", sha256(rt)).eq("kind", "refresh").is("revoked_at", null).select("grant_id, client_id, expires_at").maybeSingle();
    if (!row || row.client_id !== client.client_id || new Date(row.expires_at).getTime() < Date.now()) {
      return { ok: false, err: bad("invalid_grant", "refresh token expired, used or revoked") };
    }
    const { data: grant } = await sb.from("api_keys").select("id, scopes, revoked_at").eq("id", row.grant_id).maybeSingle();
    if (!grant || grant.revoked_at) return { ok: false, err: bad("invalid_grant", "this connection was revoked in Creed") };
    const tokens = await issueTokens(sb, grant.id, client.client_id, cleanScopes(grant.scopes));
    return tokens ? { ok: true, tokens } : { ok: false, err: bad("server_error", "could not issue tokens", 500) };
  }

  return { ok: false, err: bad("unsupported_grant_type", "authorization_code or refresh_token") };
}

/** RFC 7009: revoke a token. Revoking a refresh token ends the connection. */
export async function revokeToken(sb: SupabaseClient, form: URLSearchParams, authHeader: string | null): Promise<boolean> {
  const cred = clientCredentials(authHeader, form);
  const client = await getClient(sb, cred.id);
  if (!client || !clientAuthOk(client, cred.secret)) return false;
  const tok = form.get("token") || "";
  const { data: row } = await sb.from("oauth_tokens").select("grant_id, kind, client_id").eq("token_hash", sha256(tok)).maybeSingle();
  if (!row || row.client_id !== client.client_id) return true; // unknown token: still 200 per RFC 7009
  const now = new Date().toISOString();
  if (row.kind === "refresh") await sb.from("api_keys").update({ revoked_at: now }).eq("id", row.grant_id).is("revoked_at", null);
  else await sb.from("oauth_tokens").update({ revoked_at: now }).eq("token_hash", sha256(tok));
  return true;
}

/** An access token → its connection (grant) id, or null (unknown, expired,
 *  revoked). The caller then loads the grant like a pasted key. */
export async function accessTokenGrant(sb: SupabaseClient, token: string): Promise<string | null> {
  if (!isAccessToken(token)) return null;
  const { data } = await sb.from("oauth_tokens").select("grant_id, kind, expires_at, revoked_at")
    .eq("token_hash", sha256(token)).maybeSingle();
  if (!data || data.kind !== "access" || data.revoked_at || new Date(data.expires_at).getTime() < Date.now()) return null;
  return String(data.grant_id);
}
