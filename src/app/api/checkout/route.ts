import { NextRequest, NextResponse } from "next/server";
import { serviceClient } from "@/lib/api-auth";
import { computePlatformFee, currentPeriodStart } from "@/lib/platform-fee";

export const dynamic = "force-dynamic";

/**
 * Customer invoice / deposit payment. PUBLIC by design — the customer paying
 * from the /status page is not logged in. Everything that moves money is
 * derived SERVER-SIDE from the job record, never trusted from the request:
 *   - the payout destination (connected account) comes from the job's org, so
 *     a tampered body can't redirect funds to an attacker's account;
 *   - the amount is clamped to the job total (partial deposits ≤ total are
 *     allowed), so it can't exceed the invoice.
 *   - the platform fee is computed here from the org's subscription plan and
 *     their running monthly total — neither value is accepted from the caller.
 */
export async function POST(req: NextRequest) {
  try {
    const { jobId, amount } = await req.json();
    if (!jobId) {
      return NextResponse.json({ error: "Missing jobId" }, { status: 400 });
    }

    const supabase = serviceClient();
    const { data: job, error: jobErr } = await supabase
      .from("jobs")
      .select("id, total, property, client, org_id")
      .eq("id", jobId)
      .single();
    if (jobErr || !job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    const invoiceTotal = Number(job.total) || 0;
    // Amount is client-supplied so partial deposits work, but clamped to the
    // invoice total — it can never exceed what's owed, and must be positive.
    const requested = Number(amount);
    const payAmount =
      Number.isFinite(requested) && requested > 0 ? Math.min(requested, invoiceTotal) : invoiceTotal;
    if (payAmount <= 0) {
      return NextResponse.json({ error: "Nothing to charge for this job" }, { status: 400 });
    }
    const amountCents = Math.round(payAmount * 100);

    // Payout destination + subscription plan come from the job's org, not the body.
    const { data: org } = await supabase
      .from("organizations")
      .select("name, stripe_account_id, subscription_plan")
      .eq("id", job.org_id)
      .single();
    const orgName = org?.name || "Service Provider";
    const stripeAccountId = org?.stripe_account_id || "";
    const plan = org?.subscription_plan ?? null;

    // ── Platform fee (capped monthly sum, computed stateless) ────────────────
    // Sum platform fees already confirmed this calendar month. If the
    // platform_fee_cents / paid_at columns don't exist yet (migration pending),
    // we fall back to 0 — fee still applies, just without cap enforcement.
    let feesCollectedCents = 0;
    try {
      const periodStart = currentPeriodStart();
      const { data: capRows } = await supabase
        .from("jobs")
        .select("platform_fee_cents")
        .eq("org_id", job.org_id)
        .eq("status", "paid")
        .gte("paid_at", periodStart.toISOString())
        .not("platform_fee_cents", "is", null);
      feesCollectedCents = (capRows ?? []).reduce(
        (sum, r) => sum + (Number(r.platform_fee_cents) || 0),
        0,
      );
    } catch {
      // Migration hasn't run yet — proceed without cap enforcement.
    }

    const platformFeeCents = computePlatformFee(amountCents, plan, feesCollectedCents);
    // ────────────────────────────────────────────────────────────────────────

    const origin = req.headers.get("origin") || "https://www.creedhm.com";

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sessionParams: any = {
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: `Property Repairs — ${job.property || "Job"}`,
              description: `${orgName} · Invoice for ${job.client || "Client"}`,
            },
            unit_amount: amountCents,
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      // session_id lets /payment/success verify server-side before flipping status.
      success_url: `${origin}/payment/success?job_id=${job.id}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/payment/cancel`,
      metadata: {
        job_id: job.id,
        org_id: job.org_id,
        property: job.property || "",
        client: job.client || "",
        // Stored so verify-payment can record the fee without recomputing.
        platform_fee_cents: String(platformFeeCents),
      },
    };

    // Route payment to the org's connected account. application_fee_amount is
    // the capped Creed platform fee — omitted entirely when 0 (Pro or at-cap)
    // because Stripe rejects application_fee_amount: 0 on destination charges.
    if (stripeAccountId) {
      sessionParams.payment_intent_data = {
        transfer_data: { destination: stripeAccountId },
      };
      if (platformFeeCents > 0) {
        sessionParams.payment_intent_data.application_fee_amount = platformFeeCents;
      }
    }

    const Stripe = (await import("stripe")).default;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
    const session = await stripe.checkout.sessions.create(sessionParams);

    return NextResponse.json({ url: session.url });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
