import { NextRequest, NextResponse } from "next/server";
import { serviceClient } from "@/lib/api-auth";
import { recordJobPayment, scheduleReviewRequest } from "@/lib/payment-fulfillment";

export const dynamic = "force-dynamic";

// scheduleReviewRequest + the payment-ledger fulfillment logic live in
// src/lib/payment-fulfillment.ts so the Stripe webhook reuses them (a lost
// /payment/success redirect must not drop the payment).

// Server-side payment verification: the success page passes ?session_id=<stripe session>
// and we confirm with Stripe that the session is actually paid before flipping the job
// status. Previously the success page flipped status client-side from the URL's job_id,
// which meant any visitor to /payment/success?job_id=X could mark X as paid without paying.
export async function POST(req: NextRequest) {
  try {
    const { sessionId, jobId } = await req.json();
    if (!sessionId || !jobId) {
      return NextResponse.json({ error: "Missing sessionId or jobId" }, { status: 400 });
    }

    const Stripe = (await import("stripe")).default;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

    // Expand payment_intent so we can record its id for refund tracking.
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["payment_intent"],
    });

    if (session.payment_status !== "paid") {
      return NextResponse.json(
        { error: "Payment not completed", status: session.payment_status },
        { status: 402 }
      );
    }

    // The session MUST carry the job_id we created it with, and it must match
    // the job the caller claims. Requiring PRESENCE matters: without it, any
    // unrelated paid session (e.g. a subscription checkout) could be replayed
    // to mark an arbitrary job paid.
    const sessionJobId = session.metadata?.job_id;
    if (!sessionJobId || sessionJobId !== jobId) {
      return NextResponse.json({ error: "Session does not match this job" }, { status: 400 });
    }

    // Use service role so the update bypasses RLS (the customer isn't logged in).
    const supabase = serviceClient();

    // Confirm the job exists and, when the session carries an org_id, that it
    // matches the job's org — then scope the write by org too.
    const { data: job, error: jobErr } = await supabase
      .from("jobs")
      .select("id, org_id, total, platform_fee_cents, paid_at")
      .eq("id", jobId)
      .single();
    if (jobErr || !job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }
    const sessionOrgId = session.metadata?.org_id;
    if (sessionOrgId && sessionOrgId !== job.org_id) {
      return NextResponse.json({ error: "Session/job org mismatch" }, { status: 400 });
    }

    const platformFeeCents = Math.max(0, Number(session.metadata?.platform_fee_cents) || 0);
    const pi = session.payment_intent;
    const stripePaymentIntentId = typeof pi === "string" ? pi : pi?.id ?? null;
    // What was ACTUALLY charged. Stripe's amount_total is authoritative; the
    // checkout metadata is a fallback for sessions created before it existed.
    const paidNow = Math.max(0, Number(session.amount_total ?? session.metadata?.amount_cents ?? 0)) / 100;

    let result;
    try {
      result = await recordJobPayment(supabase, {
        jobId,
        orgId: job.org_id,
        jobTotal: Number(job.total) || 0,
        jobFeeCents: Number(job.platform_fee_cents) || 0,
        jobPaidAt: job.paid_at ?? null,
        sessionId,
        paymentIntentId: stripePaymentIntentId,
        paidNow,
        platformFeeCents,
        kind: session.metadata?.kind || "payment",
      });
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }

    // Only ask for a review once the job is actually settled — never after a
    // deposit. Best-effort; the cron at /api/reviews/dispatch sends it later.
    if (result.fullyPaid) {
      await scheduleReviewRequest(supabase, jobId).catch((e) => {
        console.error("[verify-payment] review-request schedule failed:", e);
      });
    }

    return NextResponse.json({ ok: true, ...result });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("verify-payment error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
