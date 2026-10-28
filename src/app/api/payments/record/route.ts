import { NextRequest, NextResponse } from "next/server";
import { requireOwner, serviceClient } from "@/lib/api-auth";
import { fulfillJobPayment } from "@/lib/payment-fulfillment";

export const dynamic = "force-dynamic";

/**
 * POST /api/payments/record — owner/manager logs a payment taken OUTSIDE
 * Stripe (cash, check, Zelle, card on their own terminal…).
 *
 * Replaces the old one-tap "Mark paid", which flipped the status without an
 * amount: a partial check couldn't be logged, amount_paid / the payments
 * ledger stayed at 0, and the review request (scheduled only on Stripe
 * payments) never went out for cash jobs. This goes through the SAME
 * recordJobPayment as Stripe charges, so paid-to-date, the balance and the
 * "paid only when covered" rule are identical either way.
 *
 * Body: { jobId, amount (dollars), method: cash|check|card|other, ref, skipReview? }
 *   ref = a client-generated uuid per tap → the idempotency key (a retried
 *   or double-tapped save can't record the payment twice).
 *   skipReview = true → don't schedule the automated review-request text
 *   when this payment covers the job. The Jobs bulk "Paid" cleanup sends it
 *   so marking a batch paid can't text every customer in it; the single-job
 *   Record payment sheet leaves it off (review request scheduled as usual).
 */
const METHODS = new Set(["cash", "check", "card", "other"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  const prof = await requireOwner(req);
  if (prof instanceof NextResponse) return prof;

  const body = (await req.json().catch(() => ({}))) as {
    jobId?: string; amount?: number; method?: string; ref?: string; skipReview?: boolean;
  };
  const skipReview = body.skipReview === true;
  const amount = Math.round((Number(body.amount) || 0) * 100) / 100;
  const method = METHODS.has(String(body.method)) ? String(body.method) : "other";
  if (!body.jobId || !UUID.test(body.jobId)) return NextResponse.json({ error: "Missing job" }, { status: 400 });
  if (!body.ref || !UUID.test(body.ref)) return NextResponse.json({ error: "Missing reference" }, { status: 400 });
  if (!(amount > 0)) return NextResponse.json({ error: "Enter the amount received" }, { status: 400 });

  // Scope to the caller's own business — never record against another org.
  if (!prof.orgId) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  const supabase = serviceClient();
  try {
    // Same fulfillment as a Stripe charge: ledger, review request once covered
    // (unless skipReview), and the owner "Payment received" alert — once per
    // ref, since a retried tap finds its manual_<ref> row already recorded.
    const fulfilled = await fulfillJobPayment(supabase, {
      jobId: body.jobId,
      expectOrgId: prof.orgId,
      sessionId: `manual_${body.ref}`,
      paymentIntentId: null,
      paidNow: amount,
      platformFeeCents: 0,
      kind: method,
      skipReview,
      source: "payments/record",
    });
    if (!fulfilled.ok) return NextResponse.json({ error: "Job not found" }, { status: 404 });
    return NextResponse.json({ ok: true, ...fulfilled.result });
  } catch (e) {
    console.error("[payments/record]", e);
    return NextResponse.json({ error: "Couldn't record that payment — please try again." }, { status: 500 });
  }
}
