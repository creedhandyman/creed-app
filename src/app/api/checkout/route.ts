import { NextRequest, NextResponse } from "next/server";
import { serviceClient } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

const PLATFORM_FEE_PERCENT = 2; // 2% platform fee

/**
 * Customer invoice / deposit payment. PUBLIC by design — the customer paying
 * from the /status page is not logged in. Everything that moves money is
 * derived SERVER-SIDE from the job record, never trusted from the request:
 *   - the payout destination (connected account) comes from the job's org, so
 *     a tampered body can't redirect funds to an attacker's account;
 *   - the amount is clamped to the job total (partial deposits ≤ total are
 *     allowed), so it can't exceed the invoice.
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

    // Payout destination + display fields come from the job's org, not the body.
    const { data: org } = await supabase
      .from("organizations")
      .select("name, stripe_account_id")
      .eq("id", job.org_id)
      .single();
    const orgName = org?.name || "Service Provider";
    const stripeAccountId = org?.stripe_account_id || "";

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
      },
    };

    // Route the payment to the org's connected account with the platform fee.
    if (stripeAccountId) {
      const feeAmount = Math.round(amountCents * (PLATFORM_FEE_PERCENT / 100));
      sessionParams.payment_intent_data = {
        application_fee_amount: feeAmount,
        transfer_data: { destination: stripeAccountId },
      };
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
