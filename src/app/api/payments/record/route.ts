import { NextRequest, NextResponse } from "next/server";
import { requireOwner, serviceClient } from "@/lib/api-auth";
import { recordJobPayment, scheduleReviewRequest } from "@/lib/payment-fulfillment";

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
 * Body: { jobId, amount (dollars), method: cash|check|card|other, ref }
 *   ref = a client-generated uuid per tap → the idempotency key (a retried
 *   or double-tapped save can't record the payment twice).
 */
const METHODS = new Set(["cash", "check", "card", "other"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  const prof = await requireOwner(req);
  if (prof instanceof NextResponse) return prof;

  const body = (await req.json().catch(() => ({}))) as {
    jobId?: string; amount?: number; method?: string; ref?: string;
  };
  const amount = Math.round((Number(body.amount) || 0) * 100) / 100;
  const method = METHODS.has(String(body.method)) ? String(body.method) : "other";
  if (!body.jobId || !UUID.test(body.jobId)) return NextResponse.json({ error: "Missing job" }, { status: 400 });
  if (!body.ref || !UUID.test(body.ref)) return NextResponse.json({ error: "Missing reference" }, { status: 400 });
  if (!(amount > 0)) return NextResponse.json({ error: "Enter the amount received" }, { status: 400 });

  const supabase = serviceClient();
  const { data: job } = await supabase
    .from("jobs")
    .select("id, org_id, total, platform_fee_cents, paid_at")
    .eq("id", body.jobId)
    .maybeSingle();
  // Scope to the caller's own business — never record against another org.
  if (!job || job.org_id !== prof.orgId) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  try {
    const result = await recordJobPayment(supabase, {
      jobId: job.id,
      orgId: job.org_id,
      jobTotal: Number(job.total) || 0,
      jobFeeCents: Number(job.platform_fee_cents) || 0,
      jobPaidAt: job.paid_at ?? null,
      sessionId: `manual_${body.ref}`,
      paymentIntentId: null,
      paidNow: amount,
      platformFeeCents: 0,
      kind: method,
    });
    if (result.fullyPaid) {
      await scheduleReviewRequest(supabase, job.id).catch((e) => {
        console.error("[payments/record] review-request schedule failed:", e);
      });
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    console.error("[payments/record]", e);
    return NextResponse.json({ error: "Couldn't record that payment — please try again." }, { status: 500 });
  }
}
