import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifySession, PORTAL_COOKIE_NAME } from "@/lib/portal-session";

export const dynamic = "force-dynamic";

/**
 * POST /api/portal/membership-pause  { membershipId, action?: 'pause'|'resume' }
 *
 * Customer self-serve pause/resume from the portal. Same auth + scoping as
 * membership-cancel: portal-session cookie, and the membership must belong to
 * the session's customer (never a client-supplied id on its own). Pausing
 * voids Stripe collection (no invoices while paused) and sets
 * status='paused', which also stops the recurring cron from spawning visits
 * (it only fires status='active'). Resume reverses both.
 *
 * Unlike cancel, the Stripe call here is NOT best-effort: if Stripe fails we
 * return 500 without touching the row — showing "paused" while Stripe keeps
 * billing would be worse than surfacing the error.
 */
export async function POST(req: NextRequest) {
  const session = verifySession(req.cookies.get(PORTAL_COOKIE_NAME)?.value);
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  try {
    const { membershipId, action = "pause" } = (await req.json()) as { membershipId?: string; action?: string };
    if (!membershipId || !["pause", "resume"].includes(action)) {
      return NextResponse.json({ error: "Missing membershipId or invalid action" }, { status: 400 });
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    const { data: row } = await supabase
      .from("customer_memberships")
      .select("id, status, stripe_subscription_id")
      .eq("id", membershipId)
      .eq("customer_id", session.customer_id)
      .eq("org_id", session.org_id)
      .maybeSingle();
    if (!row) return NextResponse.json({ error: "Membership not found" }, { status: 404 });
    const m = row as { id: string; status: string; stripe_subscription_id?: string | null };
    if (m.status === "cancelled") {
      return NextResponse.json({ error: "This membership is cancelled" }, { status: 400 });
    }

    if (m.stripe_subscription_id) {
      const Stripe = (await import("stripe")).default;
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
      if (action === "pause") {
        await stripe.subscriptions.update(m.stripe_subscription_id, { pause_collection: { behavior: "void" } });
      } else {
        await stripe.subscriptions.update(m.stripe_subscription_id, { pause_collection: null });
      }
    }

    const status = action === "pause" ? "paused" : "active";
    await supabase.from("customer_memberships").update({ status }).eq("id", m.id);
    return NextResponse.json({ ok: true, status });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("portal/membership-pause error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
