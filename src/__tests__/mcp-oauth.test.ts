/**
 * "Sign in with Creed" for the MCP server (2026-11-21): metadata, client
 * registration, the consent API, PKCE code exchange, refresh rotation,
 * revocation, and that an OAuth token acts exactly like an API key for the
 * agent runner (its org + scopes, and revoking the connection ends it).
 * Uses a small in-memory Supabase.
 */
type Row = Record<string, unknown>;
const T: Record<string, Row[]> = {};

function fakeDb() {
  const from = (table: string) => {
    T[table] ||= [];
    const filters: ((r: Row) => boolean)[] = [];
    let op: { kind: "select" | "insert" | "update"; rows?: Row[]; patch?: Row } = { kind: "select" };
    let returning = false;
    const b: Record<string, unknown> = {};
    b.select = () => { if (op.kind !== "select") returning = true; return b; };
    b.eq = (c: string, v: unknown) => { filters.push((r) => r[c] === v); return b; };
    b.is = (c: string, v: unknown) => { filters.push((r) => (r[c] ?? null) === v); return b; };
    b.in = (c: string, v: unknown[]) => { filters.push((r) => v.includes(r[c])); return b; };
    for (const m of ["order", "limit", "gte"]) b[m] = () => b;
    b.insert = (rows: Row | Row[]) => { op = { kind: "insert", rows: (Array.isArray(rows) ? rows : [rows]).map((r) => ({ id: r.id ?? `id-${Math.random().toString(16).slice(2)}`, ...r })) }; return b; };
    b.update = (patch: Row) => { op = { kind: "update", patch }; return b; };
    const run = (): Row[] => {
      if (op.kind === "insert") { T[table].push(...op.rows!); return op.rows!; }
      const hit = T[table].filter((r) => filters.every((f) => f(r)));
      if (op.kind === "update") { for (const r of hit) Object.assign(r, op.patch); return returning ? hit : []; }
      return hit;
    };
    b.maybeSingle = async () => ({ data: run()[0] ?? null, error: null });
    b.single = async () => { const r = run()[0]; return r ? { data: r, error: null } : { data: null, error: { message: "none" } }; };
    b.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: run(), error: null, count: 0 }).then(res);
    return b;
  };
  return { from } as never;
}

let profile: { userId: string; email: null; orgId: string | null; role: string | null } | null = null;
jest.mock("@/lib/api-auth", () => ({
  serviceClient: () => fakeDb(),
  getAuthedProfile: async () => profile,
}));
jest.mock("@/lib/notify-server", () => ({ dispatchNotifications: jest.fn(), resolveRecipients: jest.fn(async () => []) }));
jest.mock("@/lib/anthropic-server", () => ({ callClaude: jest.fn() }));
jest.mock("@/lib/supabase", () => ({ db: {}, supabase: {} }));

import {
  authServerMetadata, protectedResourceMetadata, trustedOrigin, resourceOk, redirectUriOk, checkRegistration,
  checkAuthorize, parseScope, s256, pkceOk, clientCredentials,
} from "@/lib/oauth/core";
import { registerClient, createCode, tokenRequest, revokeToken, accessTokenGrant } from "@/lib/oauth/server";
import { authenticateKey } from "@/lib/agent/server";
import { POST as authorizePOST } from "@/app/api/oauth/authorize/route";
import { POST as mcpPOST } from "@/app/api/mcp/route";
import { AGENT_SCOPES } from "@/lib/agent/scopes";
import type { NextRequest } from "next/server";

const SITE = "https://www.creedhm.com";
const CLAUDE_CB = "https://claude.ai/api/mcp/auth_callback";
const VERIFIER = "dBjftJeZ4CVP-mJ92K9mCDsF5I8bc4m3BSCjF3T6ntE";
const ORG = "0rg00000-0000-4000-8000-000000000001";
const form = (o: Record<string, string>) => new URLSearchParams(o);

beforeEach(() => { for (const k of Object.keys(T)) delete T[k]; profile = null; });

describe("metadata", () => {
  it("protected resource + authorization server documents point at each other", () => {
    const pr = protectedResourceMetadata(SITE);
    expect(pr).toMatchObject({ resource: `${SITE}/api/mcp`, authorization_servers: [SITE], scopes_supported: [...AGENT_SCOPES] });
    const as = authServerMetadata(SITE);
    expect(as).toMatchObject({
      issuer: SITE, authorization_endpoint: `${SITE}/oauth/authorize`, token_endpoint: `${SITE}/api/oauth/token`,
      registration_endpoint: `${SITE}/api/oauth/register`, code_challenge_methods_supported: ["S256"],
      grant_types_supported: ["authorization_code", "refresh_token"], response_types_supported: ["code"],
    });
    expect(as.token_endpoint_auth_methods_supported).toContain("none");
  });
  it("describes itself with the host asked (www or apex), never a spoofed one", () => {
    expect(trustedOrigin("creedhm.com", SITE)).toBe("https://creedhm.com");
    expect(trustedOrigin("www.creedhm.com", SITE)).toBe(SITE);
    expect(trustedOrigin("evil.com", SITE)).toBe(SITE);
    expect(trustedOrigin(null, SITE)).toBe(SITE);
  });
  it("resource indicator must be this MCP server", () => {
    for (const r of ["", null, `${SITE}/api/mcp`, "https://creedhm.com/api/mcp/", `${SITE}/api/mcp/`]) expect(resourceOk(r, SITE)).toBe(true);
    for (const r of ["https://evil.com/api/mcp", `${SITE}/api/other`, "http://www.creedhm.com/api/mcp", "nonsense"]) expect(resourceOk(r, SITE)).toBe(false);
  });
});

describe("registration + authorize checks", () => {
  it("redirect URIs: https, or http on localhost; no fragments", () => {
    expect(redirectUriOk(CLAUDE_CB)).toBe(true);
    expect(redirectUriOk("http://localhost:6274/cb")).toBe(true);
    expect(redirectUriOk("http://example.com/cb")).toBe(false);
    expect(redirectUriOk("https://x.com/cb#frag")).toBe(false);
    expect(redirectUriOk("javascript:alert(1)")).toBe(false);
  });
  it("registration defaults to a public client and refuses odd grants", () => {
    const r = checkRegistration({ redirect_uris: [CLAUDE_CB], client_name: "Claude<script>" });
    expect(r.ok && r.value).toEqual({ client_name: "Claudescript", redirect_uris: [CLAUDE_CB], token_endpoint_auth_method: "none" });
    expect(checkRegistration({ redirect_uris: [CLAUDE_CB], grant_types: ["client_credentials"] }).ok).toBe(false);
    expect(checkRegistration({ redirect_uris: [] }).ok).toBe(false);
  });
  it("scope param: ours only; none asked = owner picks from all", () => {
    expect(parseScope("customers:read payments:write")).toEqual({ scopes: ["customers:read"], open: false });
    expect(parseScope(undefined)).toEqual({ scopes: [...AGENT_SCOPES], open: true });
  });
  it("authorize: unknown client / unregistered redirect never redirect; missing PKCE does", () => {
    const client = { redirect_uris: [CLAUDE_CB] };
    const good = { client_id: "c", redirect_uri: CLAUDE_CB, response_type: "code", code_challenge: s256(VERIFIER), code_challenge_method: "S256", state: "xyz" };
    expect(checkAuthorize(good, client, SITE).ok).toBe(true);
    expect(checkAuthorize(good, null, SITE)).toMatchObject({ ok: false, redirect: false });
    expect(checkAuthorize({ ...good, redirect_uri: "https://evil.com/cb" }, client, SITE)).toMatchObject({ ok: false, redirect: false });
    expect(checkAuthorize({ ...good, code_challenge: "" }, client, SITE)).toMatchObject({ ok: false, redirect: true, error: "invalid_request" });
    expect(checkAuthorize({ ...good, code_challenge_method: "plain" }, client, SITE)).toMatchObject({ ok: false, redirect: true });
    expect(checkAuthorize({ ...good, resource: "https://evil.com/api/mcp" }, client, SITE)).toMatchObject({ ok: false, error: "invalid_target" });
  });
  it("PKCE S256 = base64url(SHA-256), no padding", () => {
    expect(s256("abc")).toBe("ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0");
    expect(pkceOk(VERIFIER, s256(VERIFIER))).toBe(true);
    expect(pkceOk(VERIFIER + "x", s256(VERIFIER))).toBe(false);
    expect(pkceOk("short", s256("short"))).toBe(false);
  });
  it("client credentials from Basic auth or the form", () => {
    const basic = `Basic ${Buffer.from("cid:sec").toString("base64")}`;
    expect(clientCredentials(basic, form({}))).toEqual({ id: "cid", secret: "sec", via: "client_secret_basic" });
    expect(clientCredentials(null, form({ client_id: "cid" }))).toEqual({ id: "cid", secret: "", via: "none" });
  });
});

// ── The whole flow, against the fake DB ─────────────────────────────────────

async function register(extra: Record<string, unknown> = {}) {
  const r = await registerClient(fakeDb(), { client_name: "Claude", redirect_uris: [CLAUDE_CB], ...extra });
  if (!r.ok) throw new Error("register failed");
  return r.data as { client_id: string; client_secret?: string };
}
async function codeFor(clientId: string, scopes = ["customers:read", "quotes:draft"] as never[]) {
  return (await createCode(fakeDb(), { clientId, orgId: ORG, userId: "u1", scopes, redirectUri: CLAUDE_CB, codeChallenge: s256(VERIFIER), resource: `${SITE}/api/mcp` }))!;
}
const exchange = (clientId: string, code: string, extra: Record<string, string> = {}) =>
  tokenRequest(fakeDb(), form({ grant_type: "authorization_code", code, code_verifier: VERIFIER, client_id: clientId, redirect_uri: CLAUDE_CB, resource: `${SITE}/api/mcp`, ...extra }), null);

describe("code → tokens → agent calls", () => {
  it("stores only hashes, issues tokens bound to the business + scopes, and the token works like a key", async () => {
    const c = await register();
    expect(c.client_secret).toBeUndefined();
    const code = await codeFor(c.client_id);
    expect(JSON.stringify(T.oauth_codes)).not.toContain(code);
    const r = await exchange(c.client_id, code);
    if (!r.ok) throw new Error(r.err.error_description);
    expect(r.tokens).toMatchObject({ token_type: "Bearer", expires_in: 3600, scope: "customers:read quotes:draft" });
    expect(JSON.stringify(T.oauth_tokens)).not.toContain(r.tokens.access_token);
    const grant = T.api_keys[0];
    expect(grant).toMatchObject({ org_id: ORG, kind: "oauth", name: "Claude", scopes: ["customers:read", "quotes:draft"], key_hash: null, created_by: "u1" });
    expect(T.api_activity[0]).toMatchObject({ tool: "oauth.connect", key_id: grant.id, org_id: ORG });

    const ctx = await authenticateKey(r.tokens.access_token);
    expect(ctx).toMatchObject({ orgId: ORG, keyId: grant.id, scopes: ["customers:read", "quotes:draft"] });
    // Revoked on the AI assistant connection page → the token is dead.
    grant.revoked_at = new Date().toISOString();
    expect(await authenticateKey(r.tokens.access_token)).toBeNull();
  });

  it("PKCE, client, redirect and expiry are all enforced", async () => {
    const c = await register();
    const other = await register();
    expect((await exchange(c.client_id, await codeFor(c.client_id), { code_verifier: "x".repeat(43) })).ok).toBe(false);
    expect((await exchange(other.client_id, await codeFor(c.client_id))).ok).toBe(false);
    expect((await exchange(c.client_id, await codeFor(c.client_id), { redirect_uri: "https://claude.ai/other" })).ok).toBe(false);
    const late = await codeFor(c.client_id);
    T.oauth_codes.at(-1)!.expires_at = new Date(Date.now() - 1000).toISOString();
    expect((await exchange(c.client_id, late)).ok).toBe(false);
    expect(T.api_keys || []).toHaveLength(0);
  });

  it("a code works once; replaying it ends the connection it made", async () => {
    const c = await register();
    const code = await codeFor(c.client_id);
    const first = await exchange(c.client_id, code);
    expect(first.ok).toBe(true);
    const again = await exchange(c.client_id, code);
    expect(!again.ok && again.err.error).toBe("invalid_grant");
    expect(T.api_keys[0].revoked_at).toEqual(expect.any(String));
  });

  it("refresh tokens rotate: the old one is spent, scopes carry over", async () => {
    const c = await register();
    const r = await exchange(c.client_id, await codeFor(c.client_id));
    if (!r.ok) throw new Error();
    const refresh = (rt: string) => tokenRequest(fakeDb(), form({ grant_type: "refresh_token", refresh_token: rt, client_id: c.client_id }), null);
    const r2 = await refresh(r.tokens.refresh_token);
    if (!r2.ok) throw new Error(r2.err.error_description);
    expect(r2.tokens.refresh_token).not.toBe(r.tokens.refresh_token);
    expect(r2.tokens.scope).toBe("customers:read quotes:draft");
    expect((await refresh(r.tokens.refresh_token)).ok).toBe(false);
    T.api_keys[0].revoked_at = "now";
    expect((await refresh(r2.tokens.refresh_token)).ok).toBe(false);
  });

  it("expired access tokens are refused", async () => {
    const c = await register();
    const r = await exchange(c.client_id, await codeFor(c.client_id));
    if (!r.ok) throw new Error();
    T.oauth_tokens.find((x) => x.kind === "access")!.expires_at = new Date(Date.now() - 1).toISOString();
    expect(await accessTokenGrant(fakeDb(), r.tokens.access_token)).toBeNull();
  });

  it("a confidential client must send its secret", async () => {
    const c = await register({ token_endpoint_auth_method: "client_secret_post" });
    expect(c.client_secret).toMatch(/^creed_cs_/);
    const code = await codeFor(c.client_id);
    const noSecret = await exchange(c.client_id, code);
    expect(!noSecret.ok && noSecret.err.status).toBe(401);
    expect((await exchange(c.client_id, code, { client_secret: c.client_secret! })).ok).toBe(true);
  });

  it("revoking the refresh token (RFC 7009) ends the connection", async () => {
    const c = await register();
    const r = await exchange(c.client_id, await codeFor(c.client_id));
    if (!r.ok) throw new Error();
    expect(await revokeToken(fakeDb(), form({ token: r.tokens.refresh_token, client_id: c.client_id }), null)).toBe(true);
    expect(await authenticateKey(r.tokens.access_token)).toBeNull();
  });

  it("pasted API keys still work next to OAuth", async () => {
    const { newKey } = await import("@/lib/agent/keys");
    const k = newKey();
    T.api_keys = [{ id: "k1", org_id: ORG, scopes: ["schedule:read"], key_hash: k.hash, revoked_at: null }];
    expect(await authenticateKey(k.key)).toMatchObject({ keyId: "k1", orgId: ORG, scopes: ["schedule:read"] });
  });
});

// ── Consent API + MCP 401 ───────────────────────────────────────────────────

const jreq = (body: unknown, host = "www.creedhm.com") =>
  ({ json: async () => body, headers: new Headers({ host }) }) as unknown as NextRequest;

describe("consent API", () => {
  let clientId = "";
  let query: Record<string, string> = {};
  beforeEach(async () => {
    clientId = (await register()).client_id;
    T.organizations = [{ id: ORG, name: "Creed Handyman" }];
    query = { client_id: clientId, redirect_uri: CLAUDE_CB, response_type: "code", code_challenge: s256(VERIFIER), code_challenge_method: "S256", state: "st8", scope: "customers:read schedule:write" };
  });

  it("check: who's asking and which businesses this person can connect", async () => {
    profile = { userId: "u1", email: null, orgId: ORG, role: "owner" };
    const j = await (await authorizePOST(jreq({ action: "check", query }))).json();
    expect(j).toMatchObject({ client_name: "Claude", redirect_host: "claude.ai", scopes: ["customers:read", "schedule:write"], signed_in: true, businesses: [{ id: ORG, name: "Creed Handyman" }] });
  });

  it("a tech can't approve; nobody can approve another business", async () => {
    profile = { userId: "u2", email: null, orgId: ORG, role: "tech" };
    expect((await authorizePOST(jreq({ action: "approve", query, org_id: ORG, scopes: ["customers:read"] }))).status).toBe(403);
    profile = { userId: "u1", email: null, orgId: ORG, role: "owner" };
    expect((await authorizePOST(jreq({ action: "approve", query, org_id: "other-org", scopes: ["customers:read"] }))).status).toBe(403);
    expect(T.oauth_codes || []).toHaveLength(0);
  });

  it("approve: only scopes the app asked for, then back to the app with code + state + iss", async () => {
    profile = { userId: "u1", email: null, orgId: ORG, role: "manager" };
    const j = await (await authorizePOST(jreq({ action: "approve", query, org_id: ORG, scopes: ["customers:read", "quotes:draft"] }))).json();
    const u = new URL(j.redirect);
    expect(`${u.origin}${u.pathname}`).toBe(CLAUDE_CB);
    expect(u.searchParams.get("state")).toBe("st8");
    expect(u.searchParams.get("iss")).toBe(SITE);
    expect(T.oauth_codes[0].scopes).toEqual(["customers:read"]); // quotes:draft wasn't asked for
    const r = await exchange(clientId, u.searchParams.get("code")!);
    expect(r.ok && r.tokens.scope).toBe("customers:read");
  });

  it("deny goes back with access_denied; a bad return address never redirects", async () => {
    const d = await (await authorizePOST(jreq({ action: "deny", query }))).json();
    expect(new URL(d.redirect).searchParams.get("error")).toBe("access_denied");
    const bad = await authorizePOST(jreq({ action: "check", query: { ...query, redirect_uri: "https://evil.com/cb" } }));
    expect(bad.status).toBe(400);
    expect((await bad.json()).redirect).toBeNull();
  });
});

describe("MCP endpoint without credentials", () => {
  it("401 points the client at the protected resource metadata", async () => {
    const req = { headers: new Headers({ host: "www.creedhm.com" }), json: async () => ({}) } as unknown as NextRequest;
    const res = await mcpPOST(req);
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe(`Bearer realm="creed", resource_metadata="${SITE}/.well-known/oauth-protected-resource/api/mcp"`);
    const bad = await mcpPOST({ headers: new Headers({ host: "www.creedhm.com", authorization: "Bearer creed_at_nope" }), json: async () => ({}) } as unknown as NextRequest);
    expect(bad.headers.get("www-authenticate")).toContain('error="invalid_token"');
  });
});
