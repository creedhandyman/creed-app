import { NextRequest, NextResponse, after } from "next/server";
import { getAuthedProfile, serviceClient } from "@/lib/api-auth";
import { syncSoon } from "@/lib/gcal/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The app calls this (debounced) after a schedule write so the change reaches
 * Google within seconds instead of at the next 10-minute cron. Any member of
 * the business; does nothing when Google Calendar isn't connected.
 */
export async function POST(req: NextRequest) {
  const prof = await getAuthedProfile(req);
  if (!prof?.orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data } = await serviceClient().from("google_calendar_links").select("status").eq("org_id", prof.orgId).maybeSingle();
  if (data?.status !== "active") return NextResponse.json({ ok: true, connected: !!data });
  const orgId = prof.orgId;
  after(() => syncSoon(orgId));
  return NextResponse.json({ ok: true, connected: true });
}
