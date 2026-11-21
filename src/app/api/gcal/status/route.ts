import { NextRequest, NextResponse } from "next/server";
import { requireOwner, serviceClient } from "@/lib/api-auth";
import { googleConfigured } from "@/lib/gcal/google";

export const dynamic = "force-dynamic";

/** Settings card: is Google Calendar connected, healthy, or waiting for a reconnect? */
export async function GET(req: NextRequest) {
  const prof = await requireOwner(req);
  if (prof instanceof NextResponse) return prof;
  const { data, error } = await serviceClient().from("google_calendar_links")
    .select("google_email, status, last_synced_at, last_error, channel_expires_at")
    .eq("org_id", prof.orgId).maybeSingle();
  if (error) return NextResponse.json({ configured: googleConfigured(), setup: false, connected: false });
  return NextResponse.json({
    configured: googleConfigured(),
    setup: true,
    connected: !!data,
    status: data?.status || null,
    email: data?.google_email || null,
    lastSyncedAt: data?.last_synced_at || null,
    lastError: data?.last_error || null,
    live: !!data?.channel_expires_at && Date.parse(data.channel_expires_at) > Date.now(),
  });
}
