import { NextRequest, NextResponse } from "next/server";
import { getAuthedProfile, serviceClient } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

/**
 * POST /api/push/subscribe  { subscription, userAgent }
 *
 * Stores a logged-in user's Web Push subscription so dispatchNotifications()
 * can push to it. Upserts by endpoint, so re-subscribes / re-installs reuse
 * the same row. Auth required (the subscription is tied to the caller).
 */
export async function POST(req: NextRequest) {
  const prof = await getAuthedProfile(req);
  if (!prof) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { subscription, userAgent } = (await req.json().catch(() => ({}))) as {
    subscription?: { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
    userAgent?: string;
  };
  const endpoint = subscription?.endpoint;
  const p256dh = subscription?.keys?.p256dh;
  const auth = subscription?.keys?.auth;
  if (!endpoint || !p256dh || !auth) {
    return NextResponse.json({ error: "Invalid subscription" }, { status: 400 });
  }

  const { error } = await serviceClient()
    .from("push_subscriptions")
    .upsert(
      {
        user_id: prof.userId,
        org_id: prof.orgId,
        endpoint,
        p256dh,
        auth,
        user_agent: (userAgent || "").slice(0, 300),
      },
      { onConflict: "endpoint" },
    );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
