import { NextRequest, NextResponse } from "next/server";
import { requireOwner, serviceClient } from "@/lib/api-auth";
import { cleanKeyName, cleanScopes, newKey, type AgentScope } from "@/lib/agent/keys";
import { logActivity } from "@/lib/agent/server";
import { isUuid } from "@/lib/agent/plan";

export const dynamic = "force-dynamic";

/**
 * Ops → Settings → AI assistant connection. Owners / managers only, and only
 * for their own business (org from the signed-in profile, never the body).
 *   GET                          → keys (no secrets) + recent activity
 *   POST {name, scopes}          → new key, shown ONCE in the response
 *   POST {action:"revoke", id}   → revoke
 *   POST {action:"replace", id}  → revoke + new key with the same name and
 *                                  scopes, shown once (how a lost key is
 *                                  recovered: a key can never be shown again)
 */
const MAX_ACTIVE_KEYS = 10;

export async function GET(req: NextRequest) {
  const prof = await requireOwner(req);
  if (prof instanceof NextResponse) return prof;
  const sb = serviceClient();
  const { data: keys, error } = await sb.from("api_keys")
    .select("id, name, scopes, key_prefix, created_at, last_used_at, revoked_at")
    .eq("org_id", prof.orgId).order("created_at", { ascending: false }).limit(50);
  if (error) return NextResponse.json({ error: "setup", detail: error.message }, { status: 503 });
  const { data: activity } = await sb.from("api_activity")
    .select("id, key_id, tool, via, ok, status, summary, job_id, created_at")
    .eq("org_id", prof.orgId).order("created_at", { ascending: false }).limit(30);
  return NextResponse.json({ keys: keys || [], activity: activity || [] });
}

export async function POST(req: NextRequest) {
  const prof = await requireOwner(req);
  if (prof instanceof NextResponse) return prof;
  const orgId = prof.orgId as string;
  const sb = serviceClient();
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* */ }

  const issue = async (name: string, scopes: AgentScope[]) => {
    const k = newKey();
    const { data, error } = await sb.from("api_keys").insert({
      org_id: orgId, name, scopes, key_hash: k.hash, key_prefix: k.prefix, created_by: prof.userId,
    }).select("id, name, scopes, key_prefix, created_at, last_used_at, revoked_at").single();
    return error ? { error: error.message } : { row: data, key: k.key };
  };

  if (body.action === "revoke" || body.action === "replace") {
    if (!isUuid(body.id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
    const { data: old } = await sb.from("api_keys").select("id, name, scopes, revoked_at")
      .eq("id", body.id).eq("org_id", orgId).maybeSingle();
    if (!old) return NextResponse.json({ error: "not found" }, { status: 404 });
    if (body.action === "revoke") {
      if (!old.revoked_at) await sb.from("api_keys").update({ revoked_at: new Date().toISOString() }).eq("id", old.id).eq("org_id", orgId);
      await logActivity(sb, { orgId, keyId: old.id, tool: "key.revoke", via: "app", ok: true, status: 200, summary: `revoked "${old.name}"` });
      return NextResponse.json({ ok: true });
    }
    // Replace: the old key stops working the moment the new one exists.
    const made = await issue(old.name, cleanScopes(old.scopes));
    if ("error" in made) return NextResponse.json({ error: made.error }, { status: 500 });
    await sb.from("api_keys").update({ revoked_at: old.revoked_at || new Date().toISOString(), replaced_by: made.row.id })
      .eq("id", old.id).eq("org_id", orgId);
    await logActivity(sb, { orgId, keyId: made.row.id, tool: "key.replace", via: "app", ok: true, status: 200, summary: `replaced "${old.name}" (old key revoked)` });
    return NextResponse.json({ ok: true, key: made.key, row: made.row });
  }

  const name = cleanKeyName(body.name);
  const scopes = cleanScopes(body.scopes);
  if (!name) return NextResponse.json({ error: "Give the key a name" }, { status: 400 });
  if (!scopes.length) return NextResponse.json({ error: "Pick at least one permission" }, { status: 400 });
  const { count } = await sb.from("api_keys").select("id", { count: "exact", head: true }).eq("org_id", orgId).is("revoked_at", null);
  if ((count || 0) >= MAX_ACTIVE_KEYS) return NextResponse.json({ error: `At most ${MAX_ACTIVE_KEYS} active keys` }, { status: 400 });
  const made = await issue(name, scopes);
  if ("error" in made) return NextResponse.json({ error: made.error }, { status: 500 });
  await logActivity(sb, { orgId, keyId: made.row.id, tool: "key.create", via: "app", ok: true, status: 200, summary: `created "${name}"` });
  return NextResponse.json({ ok: true, key: made.key, row: made.row });
}
