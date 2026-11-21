/**
 * "Sign in with Creed" for the MCP server — the pure OAuth 2.1 rules (no
 * database): metadata documents, client registration checks, authorize
 * request checks, PKCE, token formats. Follows the MCP authorization spec:
 * RFC 9728 protected resource metadata, RFC 8414 authorization server
 * metadata, RFC 7591 dynamic client registration, PKCE S256 (required),
 * RFC 8707 resource indicators. Tested in src/__tests__/mcp-oauth.test.ts.
 */
import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { AGENT_SCOPES, cleanScopes, type AgentScope } from "../agent/scopes";

export const ACCESS_TTL_SEC = 3600;
export const REFRESH_TTL_SEC = 60 * 86400;
export const CODE_TTL_SEC = 600;

export const PREFIX = { access: "creed_at_", refresh: "creed_rt_", code: "creed_ac_", client: "creed_client_", secret: "creed_cs_" } as const;

export const sha256 = (v: string): string => createHash("sha256").update(v, "utf8").digest("hex");
export const randomToken = (prefix: string, bytes = 32): string => prefix + randomBytes(bytes).toString("hex");

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export const isAccessToken = (v: string): boolean => /^creed_at_[0-9a-f]{64}$/.test(v);

// ── Origins ─────────────────────────────────────────────────────────────────

/**
 * The origin to describe ourselves with. Clients check that metadata names
 * the same host they fetched it from, so a request to the apex gets apex
 * URLs — but only for our own hosts (www + apex of the site origin); any
 * other Host header falls back to the configured origin.
 */
export function trustedOrigin(hostHeader: string | null | undefined, site: string): string {
  const s = new URL(site);
  const bare = s.hostname.replace(/^www\./, "");
  const h = String(hostHeader || "").toLowerCase().split(":")[0];
  if (h === bare || h === `www.${bare}`) return `${s.protocol}//${h}`;
  return site.replace(/\/+$/, "");
}

export const mcpResource = (origin: string): string => `${origin}/api/mcp`;

/** A `resource` (RFC 8707) names our MCP server: www or apex, with or
 *  without a trailing slash. Absent is allowed (older clients). */
export function resourceOk(resource: string | null | undefined, site: string): boolean {
  if (resource == null || resource === "") return true;
  try {
    const r = new URL(resource);
    const s = new URL(site);
    const bare = (h: string) => h.toLowerCase().replace(/^www\./, "");
    return r.protocol === "https:" && bare(r.hostname) === bare(s.hostname) && !r.port
      && r.pathname.replace(/\/+$/, "") === "/api/mcp" && !r.search && !r.hash;
  } catch {
    return false;
  }
}

// ── Metadata ────────────────────────────────────────────────────────────────

export function protectedResourceMetadata(origin: string) {
  return {
    resource: mcpResource(origin),
    authorization_servers: [origin],
    scopes_supported: [...AGENT_SCOPES],
    bearer_methods_supported: ["header"],
    resource_name: "Creed Handy Manager",
    resource_documentation: `${origin}/api/agent/v1`,
  };
}

export function authServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/api/oauth/token`,
    registration_endpoint: `${origin}/api/oauth/register`,
    revocation_endpoint: `${origin}/api/oauth/revoke`,
    scopes_supported: [...AGENT_SCOPES],
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    revocation_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
  };
}

// ── Client registration (RFC 7591) ──────────────────────────────────────────

/** https anywhere, or http only on this machine (native / dev clients). No
 *  fragments, no credentials in the URL. */
export function redirectUriOk(uri: unknown): uri is string {
  if (typeof uri !== "string" || uri.length > 500) return false;
  try {
    const u = new URL(uri);
    if (u.hash || u.username || u.password) return false;
    if (u.protocol === "https:") return true;
    return u.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
  } catch {
    return false;
  }
}

export type AuthMethod = "none" | "client_secret_post" | "client_secret_basic";

export interface ClientMeta {
  client_name: string;
  redirect_uris: string[];
  token_endpoint_auth_method: AuthMethod;
}

export type RegError = { error: "invalid_redirect_uri" | "invalid_client_metadata"; error_description: string };

export function checkRegistration(body: unknown): { ok: true; value: ClientMeta } | { ok: false; err: RegError } {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const uris = Array.isArray(b.redirect_uris) ? b.redirect_uris : [];
  if (!uris.length || uris.length > 5 || !uris.every(redirectUriOk)) {
    return { ok: false, err: { error: "invalid_redirect_uri", error_description: "1-5 redirect_uris, https (or http on localhost), no fragment" } };
  }
  const method = (b.token_endpoint_auth_method ?? "none") as string;
  if (!["none", "client_secret_post", "client_secret_basic"].includes(method)) {
    return { ok: false, err: { error: "invalid_client_metadata", error_description: "unsupported token_endpoint_auth_method" } };
  }
  const grants = Array.isArray(b.grant_types) ? b.grant_types : ["authorization_code"];
  if (!grants.every((g) => g === "authorization_code" || g === "refresh_token")) {
    return { ok: false, err: { error: "invalid_client_metadata", error_description: "only authorization_code and refresh_token" } };
  }
  const rts = Array.isArray(b.response_types) ? b.response_types : ["code"];
  if (!rts.every((r) => r === "code")) {
    return { ok: false, err: { error: "invalid_client_metadata", error_description: "only response_type code" } };
  }
  const name = typeof b.client_name === "string" ? b.client_name.replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 80) : "";
  return { ok: true, value: { client_name: name || "AI assistant", redirect_uris: [...new Set(uris as string[])], token_endpoint_auth_method: method as AuthMethod } };
}

// ── Authorize request ───────────────────────────────────────────────────────

export interface AuthorizeParams {
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  state: string;
  scopes: AgentScope[];
  /** True when the client asked for no scope: the owner picks from all. */
  scopesOpen: boolean;
  resource: string;
}

/** `scope` param → our scopes. Unknown ones are dropped (we only offer ours). */
export function parseScope(scope: unknown): { scopes: AgentScope[]; open: boolean } {
  const parts = typeof scope === "string" ? scope.split(/\s+/).filter(Boolean) : [];
  const scopes = cleanScopes(parts);
  return scopes.length ? { scopes, open: false } : { scopes: [...AGENT_SCOPES], open: true };
}

const CHALLENGE = /^[A-Za-z0-9_-]{43,128}$/;
const VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;

export type AuthorizeCheck =
  | { ok: true; value: AuthorizeParams }
  /** `redirect: false` = never send the browser back (bad client or redirect
   *  URI — RFC 6749 §4.1.2.1); show the error on our page instead. */
  | { ok: false; redirect: boolean; error: string; description: string };

export function checkAuthorize(
  q: Record<string, string | null | undefined>,
  client: { redirect_uris: string[] } | null,
  site: string,
): AuthorizeCheck {
  if (!client) return { ok: false, redirect: false, error: "invalid_client", description: "This app isn't registered with Creed." };
  const redirect = q.redirect_uri || (client.redirect_uris.length === 1 ? client.redirect_uris[0] : "");
  if (!redirect || !client.redirect_uris.includes(redirect)) {
    return { ok: false, redirect: false, error: "invalid_request", description: "The return address doesn't match what this app registered." };
  }
  if (q.response_type !== "code") return { ok: false, redirect: true, error: "unsupported_response_type", description: "response_type must be code" };
  if (!q.code_challenge || !CHALLENGE.test(q.code_challenge)) return { ok: false, redirect: true, error: "invalid_request", description: "PKCE code_challenge is required" };
  if (q.code_challenge_method !== "S256") return { ok: false, redirect: true, error: "invalid_request", description: "code_challenge_method must be S256" };
  if (!resourceOk(q.resource, site)) return { ok: false, redirect: true, error: "invalid_target", description: "resource is not this MCP server" };
  const sc = parseScope(q.scope);
  return {
    ok: true,
    value: {
      client_id: String(q.client_id), redirect_uri: redirect, code_challenge: q.code_challenge,
      state: q.state || "", scopes: sc.scopes, scopesOpen: sc.open, resource: q.resource || "",
    },
  };
}

/** Where the browser goes after Approve / Deny. `iss` per RFC 9207. */
export function redirectWith(redirectUri: string, params: Record<string, string>): string {
  const u = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) if (v !== "") u.searchParams.set(k, v);
  return u.toString();
}

// ── PKCE ────────────────────────────────────────────────────────────────────

export const s256 = (verifier: string): string => createHash("sha256").update(verifier).digest("base64url");

export function pkceOk(verifier: unknown, challenge: string): boolean {
  return typeof verifier === "string" && VERIFIER.test(verifier) && safeEqual(s256(verifier), challenge);
}

// ── Client authentication at the token endpoint ─────────────────────────────

/** client_id + client_secret from Basic auth or the form. */
export function clientCredentials(authHeader: string | null, form: URLSearchParams): { id: string; secret: string; via: AuthMethod } {
  const m = (authHeader || "").match(/^Basic\s+(.+)$/i);
  if (m) {
    try {
      const raw = Buffer.from(m[1], "base64").toString("utf8");
      const i = raw.indexOf(":");
      if (i > 0) return { id: decodeURIComponent(raw.slice(0, i)), secret: decodeURIComponent(raw.slice(i + 1)), via: "client_secret_basic" };
    } catch { /* fall through */ }
  }
  const secret = form.get("client_secret") || "";
  return { id: form.get("client_id") || "", secret, via: secret ? "client_secret_post" : "none" };
}

/** A public client sends no secret; a confidential one must send the right one. */
export function clientAuthOk(client: { client_secret_hash: string | null }, secret: string): boolean {
  if (!client.client_secret_hash) return true;
  return !!secret && safeEqual(sha256(secret), client.client_secret_hash);
}
