import { NextRequest, NextResponse } from "next/server";
import { getAuthedProfile, serviceClient } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

/**
 * POST /api/push/unsubscribe  { endpoint }
 *
 * Forgets a device's push subscription. Scoped to the caller's own user_id so
 * one user can't delete another's subscription by guessing an endpoint.
 */
export async function POST(req: NextRequest) {
  const prof = await getAuthedProfile(req);
  if (!prof) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { endpoint } = (await req.json().catch(() => ({}))) as { endpoint?: string };
  if (!endpoint) return NextResponse.json({ error: "Missing endpoint" }, { status: 400 });

  await serviceClient()
    .from("push_subscriptions")
    .delete()
    .eq("endpoint", endpoint)
    .eq("user_id", prof.userId);
  return NextResponse.json({ ok: true });
}
