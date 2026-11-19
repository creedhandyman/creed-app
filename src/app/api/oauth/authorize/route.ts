import { NextRequest, NextResponse } from "next/server";
import { getAuthedProfile, serviceClient } from "@/lib/api-auth";
import { checkAuthorize, redirectWith, trustedOrigin } from "@/lib/oauth/core";
import { createCode, getClient } from "@/lib/oauth/server";
import { cleanScopes } from "@/lib/agent/scopes";
import { siteOrigin } from "@/lib/site-url";

export const dynamic = "force-dynamic";

/**
 * Backs the consent screen at /oauth/authorize (the browser page holds the
 * owner's Creed session and sends it as a Bearer JWT).
 *   {action:"check",   query}                → who's asking, what for, and
 *                                               the businesses this person
 *                                               can connect (owner/manager)
 *   {action:"approve", query, org_id, scopes} → one-time code, redirect URL
 *   {action:"deny",    query}                → access_denied redirect URL
 * The browser only ever goes back to a redirect URI the client registered.
 */
type Q = Record<string, string>;

export async function POST(req: NextRequest) {
  let body: { action?: string; query?: Q; org_id?: string; scopes?: unknown } = {};
  try { body = await req.json(); } catch { /* */ }
  const q: Q = body.query && typeof body.query === "object" ? body.query : {};
  const site = siteOrigin();
  const iss = trustedOrigin(req.headers.get("host"), site);
  const sb = serviceClient();
  const client = await getClient(sb, q.client_id);
  const chk = checkAuthorize(q, client, site);
  if (!chk.ok) {
    const back = chk.redirect && client
      ? redirectWith(q.redirect_uri || client.redirect_uris[0], { error: chk.error, error_description: chk.description, state: q.state || "", iss })
      : null;
    return NextResponse.json({ error: chk.error, description: chk.description, redirect: back }, { status: 400 });
  }
  const p = chk.value;

  if (body.action === "deny") {
    return NextResponse.json({ redirect: redirectWith(p.redirect_uri, { error: "access_denied", state: p.state, iss }) });
  }

  const prof = await getAuthedProfile(req);
  const canConnect = !!prof?.orgId && (prof.role === "owner" || prof.role === "manager");
  let businesses: { id: string; name: string; role: string }[] = [];
  if (canConnect) {
    const { data: org } = await sb.from("organizations").select("id, name").eq("id", prof!.orgId).maybeSingle();
    if (org) businesses = [{ id: String(org.id), name: String(org.name || "My business"), role: String(prof!.role) }];
  }

  if (body.action === "check") {
    return NextResponse.json({
      client_name: client!.client_name,
      redirect_host: new URL(p.redirect_uri).host,
      scopes: p.scopes,
      scopes_open: p.scopesOpen,
      signed_in: !!prof,
      businesses,
    });
  }

  if (body.action === "approve") {
    if (!prof) return NextResponse.json({ error: "sign_in", description: "Sign in to Creed first." }, { status: 401 });
    const biz = businesses.find((b) => b.id === body.org_id);
    if (!biz) return NextResponse.json({ error: "forbidden", description: "Only an owner or manager of that business can connect it." }, { status: 403 });
    // Only scopes the app asked for (or any of ours when it asked for none).
    const picked = cleanScopes(body.scopes).filter((s) => p.scopes.includes(s));
    if (!picked.length) return NextResponse.json({ error: "scopes", description: "Pick at least one thing it can do." }, { status: 400 });
    const code = await createCode(sb, {
      clientId: client!.client_id, orgId: biz.id, userId: prof.userId, scopes: picked,
      redirectUri: p.redirect_uri, codeChallenge: p.code_challenge, resource: p.resource,
    });
    if (!code) return NextResponse.json({ error: "server_error", description: "Couldn't finish connecting. Try again." }, { status: 500 });
    return NextResponse.json({ redirect: redirectWith(p.redirect_uri, { code, state: p.state, iss }) });
  }

  return NextResponse.json({ error: "bad_action" }, { status: 400 });
}
