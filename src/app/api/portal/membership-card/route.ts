import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifySession, PORTAL_COOKIE_NAME } from "@/lib/portal-session";
import { siteOrigin } from "@/lib/site-url";

export const dynamic = "force-dynamic";

/**
 * POST /api/portal/membership-card  { membershipId }
 *
 * "Update card" — returns a Stripe-hosted Billing Portal URL where the
 * customer can change the payment method on their membership subscription.
 * Card data never touches the app (same posture as Checkout everywhere else).
 *
 * The membership sub is a DESTINATION charge living on the platform account,
 * so the Billing Portal session is created on the platform for the sub's
 * Stripe customer. Scoped exactly like cancel/pause: the membership row must
 * belong to the portal session's customer.
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

    const { data: row } = await supabase
      .from("customer_memberships")
      .select("id, status, stripe_subscription_id")
      .eq("id", membershipId)
      .eq("customer_id", session.customer_id)
      .eq("org_id", session.org_id)
      .maybeSingle();
    if (!row) return NextResponse.json({ error: "Membership not found" }, { status: 404 });
    const m = row as { id: string; stripe_subscription_id?: string | null };
    if (!m.stripe_subscription_id) {
      return NextResponse.json({ error: "No billing subscription on this membership" }, { status: 400 });
    }

    const Stripe = (await import("stripe")).default;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

    const sub = await stripe.subscriptions.retrieve(m.stripe_subscription_id);
    const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
    const returnUrl = `${siteOrigin()}/portal`;

    let url: string;
    try {
      const ps = await stripe.billingPortal.sessions.create({ customer: customerId, return_url: returnUrl });
      url = ps.url;
    } catch {
      // Live mode requires a saved Billing Portal configuration. Reuse an
      // existing one if the account has any; otherwise create a minimal
      // card-update config once and use it.
      const existing = await stripe.billingPortal.configurations.list({ limit: 1 });
      const cfg = existing.data[0] || await stripe.billingPortal.configurations.create({
        features: {
          payment_method_update: { enabled: true },
          invoice_history: { enabled: true },
        },
      });
      const ps = await stripe.billingPortal.sessions.create({
        customer: customerId,
        configuration: cfg.id,
        return_url: returnUrl,
      });
      url = ps.url;
    }

    return NextResponse.json({ url });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("portal/membership-card error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
