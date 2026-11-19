import { NextRequest, NextResponse, after } from "next/server";
import { serviceClient } from "@/lib/api-auth";
import { safeEqual, sha256 } from "@/lib/gcal/crypto";
import { syncSoon } from "@/lib/gcal/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Google push notification: "something changed on the Creed jobs calendar".
 * It carries no event data; it just starts an incremental pull. Trusted only
 * when the channel id is ours AND its secret token matches (stored hashed).
 * Always answers 200 quickly so Google doesn't retry.
 */
export async function POST(req: NextRequest) {
  const channelId = req.headers.get("x-goog-channel-id") || "";
  const token = req.headers.get("x-goog-channel-token") || "";
  const state = req.headers.get("x-goog-resource-state") || "";
  if (!channelId || !token) return new NextResponse(null, { status: 200 });
  const { data } = await serviceClient().from("google_calendar_links")
    .select("org_id, channel_token_hash, status").eq("channel_id", channelId).maybeSingle();
  if (!data?.channel_token_hash || !safeEqual(sha256(token), data.channel_token_hash)) return new NextResponse(null, { status: 200 });
  if (state !== "sync" && data.status === "active") {
    const orgId = data.org_id as string;
    after(() => syncSoon(orgId));
  }
  return new NextResponse(null, { status: 200 });
}
