import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifySession, PORTAL_COOKIE_NAME } from "@/lib/portal-session";

export const dynamic = "force-dynamic";

/**
 * POST /api/portal/membership-cancel  { membershipId }
 *
 * Customer self-serve cancellation from the portal (click-to-cancel). Authed by
 * the portal session cookie — the membership must belong to the logged-in
 * customer. Cancels the Stripe subscription; the webhook also flips the row to
 * 'cancelled' (this update is the belt to that suspenders).
 */
export async function POST(req: NextRequest) {
  const session = verifySession(req.cookies.get(PORTAL_COOKIE_NAME)?.value);
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  try {
    const { membershipId } = (await req.json()) as { membershipId?: string };
    if (!membershipId) return NextResponse.json({ error: "Missing membershipId" }, { status: 400 });

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    // Scope to the session's customer + org — a portal session can only cancel
    // its OWN membership, never another customer's by guessing an id.
    const { data: row } = await supabase
      .from("customer_memberships")
      .select("id, stripe_subscription_id")
      .eq("id", membershipId)
      .eq("customer_id", session.customer_id)
      .eq("org_id", session.org_id)
      .maybeSingle();
    if (!row) return NextResponse.json({ error: "Membership not found" }, { status: 404 });
    const m = row as { id: string; stripe_subscription_id?: string | null };

    if (m.stripe_subscription_id) {
      try {
        const Stripe = (await import("stripe")).default;
        const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
        await stripe.subscriptions.cancel(m.stripe_subscription_id);
      } catch (e) {
        console.error("portal membership cancel (sub may already be gone):", e);
      }
    }
    await supabase.from("customer_memberships").update({ status: "cancelled" }).eq("id", m.id);
    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("portal/membership-cancel error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
