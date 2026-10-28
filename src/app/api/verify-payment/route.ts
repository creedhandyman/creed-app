import { NextRequest, NextResponse } from "next/server";
import { serviceClient } from "@/lib/api-auth";
import { fulfillJobPayment, paymentFromCheckoutSession } from "@/lib/payment-fulfillment";
import { signJobToken } from "@/lib/job-token";
import { siteOrigin } from "@/lib/site-url";

export const dynamic = "force-dynamic";

// The fulfillment (ledger, review request, owner alert) lives in
// src/lib/payment-fulfillment.ts fulfillJobPayment so the Stripe webhook
// reuses it (a lost /payment/success redirect must not drop the payment).

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
    // matches the job's org — then record (scoped by org), schedule the review
    // once settled and alert owners once per charge (fulfillJobPayment).
    const pay = paymentFromCheckoutSession(session);
    let fulfilled;
    try {
      fulfilled = await fulfillJobPayment(supabase, {
        jobId,
        expectOrgId: pay.orgId,
        sessionId,
        paymentIntentId: pay.paymentIntentId,
        paidNow: pay.paidNow,
        platformFeeCents: pay.platformFeeCents,
        kind: pay.kind,
        source: "verify-payment",
      });
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
    if (!fulfilled.ok) {
      return fulfilled.reason === "org_mismatch"
        ? NextResponse.json({ error: "Session/job org mismatch" }, { status: 400 })
        : NextResponse.json({ error: "Job not found" }, { status: 404 });
    }
    const { result, orgId } = fulfilled;
    const paidNow = pay.paidNow;

    // For the success page: who was paid (their branding, not Creed's) and a
    // way back to the job page. Best-effort — never fail a verified payment.
    let business: { name?: string; logo_url?: string | null; brand_color?: string | null } | null = null;
    let statusUrl: string | null = null;
    try {
      const { data: org } = await supabase
        .from("organizations").select("name, logo_url, brand_color").eq("id", orgId).maybeSingle();
      business = org || null;
    } catch { /* */ }
    try {
      statusUrl = `${siteOrigin()}/status?job=${jobId}&t=${encodeURIComponent(signJobToken(jobId))}`;
    } catch { /* PORTAL_SESSION_SECRET unset */ }

    return NextResponse.json({ ok: true, ...result, paidNow, business, statusUrl });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("verify-payment error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
