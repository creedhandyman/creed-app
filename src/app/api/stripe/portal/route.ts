import { NextRequest, NextResponse } from "next/server";
import { requireOwner, serviceClient } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

/**
 * POST /api/stripe/portal
 *
 * Mints a Stripe Customer Portal session for the caller's OWN org (owner or
 * manager only). The org is resolved from the authenticated session — it is no
 * longer taken from the request body, which previously let anyone open another
 * org's billing portal (view invoices, cancel the subscription) by passing an
 * arbitrary orgId.
 *
 * Body: { returnUrl?: string }   Returns: { url: string }
 */
export async function POST(req: NextRequest) {
  const prof = await requireOwner(req);
  if (prof instanceof NextResponse) return prof;

  try {
    const { returnUrl } = (await req.json().catch(() => ({}))) as { returnUrl?: string };

    const supabase = serviceClient();
    const { data: org, error: orgErr } = await supabase
      .from("organizations")
      .select("stripe_customer_id")
      .eq("id", prof.orgId!)
      .single();

    if (orgErr || !org) {
      return NextResponse.json({ error: "Org not found" }, { status: 404 });
    }
    if (!org.stripe_customer_id) {
      return NextResponse.json(
        { error: "No billing account on file — subscribe first to enable the portal." },
        { status: 400 },
      );
    }

    const Stripe = (await import("stripe")).default;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
    const origin = returnUrl || req.headers.get("origin") || "https://www.creedhm.com";

    const portal = await stripe.billingPortal.sessions.create({
      customer: org.stripe_customer_id,
      return_url: origin,
    });

    return NextResponse.json({ url: portal.url });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
