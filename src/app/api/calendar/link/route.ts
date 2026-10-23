import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getAuthedProfile, serviceClient } from "@/lib/api-auth";
import { siteOrigin } from "@/lib/site-url";

export const dynamic = "force-dynamic";

/**
 * The signed-in person's private calendar-subscribe link (phone calendar ←
 * their schedule). One random token per person + scope, kept in
 * `calendar_feeds` (service-role only — the token IS the credential, so it's
 * never readable by coworkers). `reset: true` replaces it, which cuts off any
 * calendar already subscribed with the old link.
 *
 * Body: { scope?: "mine" | "team", reset?: boolean }  — "team" (the whole
 * crew's schedule) is owner/manager only.
 */
export async function POST(req: NextRequest) {
  const prof = await getAuthedProfile(req);
  if (!prof || !prof.orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const scope = body?.scope === "team" ? "team" : "mine";
  if (scope === "team" && prof.role !== "owner" && prof.role !== "manager") {
    return NextResponse.json({ error: "Only owners and managers can share the whole crew's schedule" }, { status: 403 });
  }
  const supabase = serviceClient();
  let token: string | null = null;
  if (!body?.reset) {
    const { data } = await supabase.from("calendar_feeds").select("token, org_id")
      .eq("user_id", prof.userId).eq("scope", scope).maybeSingle();
    // A link minted in a business you've since left doesn't carry over.
    if (data && data.org_id === prof.orgId) token = data.token;
  }
  if (!token) {
    token = crypto.randomBytes(24).toString("base64url");
    const { error } = await supabase.from("calendar_feeds").upsert(
      { token, user_id: prof.userId, org_id: prof.orgId, scope, created_at: new Date().toISOString(), last_fetched_at: null },
      { onConflict: "user_id,scope" },
    );
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const url = `${siteOrigin()}/api/calendar/feed/${token}.ics`;
  const webcal = url.replace(/^https?:/, "webcal:");
  return NextResponse.json({
    url,
    webcal,
    google: `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`,
  });
}
