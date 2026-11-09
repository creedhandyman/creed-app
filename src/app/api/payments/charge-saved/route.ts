import { NextRequest, NextResponse } from "next/server";
import { requireOwner, serviceClient } from "@/lib/api-auth";
import { fulfillJobPayment } from "@/lib/payment-fulfillment";
import { stripeExcessRefunder } from "@/lib/stripe-refund";
import { platformFeeFor } from "@/lib/payments/fee-cap";
import {
  buildSavedCardChargeParams,
  savedCardChargeKey,
  savedCardFailureMessage,
} from "@/lib/payments/saved-card";

export const dynamic = "force-dynamic";

/**
 * POST /api/payments/charge-saved — owner/manager charges the customer's card
 * on file for what's owed on a job. Body: { jobId, amount? (dollars) }.
 *
 * Everything that moves money comes from the database, never the body: the
 * amount is clamped to the job's balance, the payout account is the job's org,
 * the card is the job's customer's, and the platform fee is worked out here.
 * The charge is idempotent per (job, amount, paid-to-date), so a double tap or
 * a retry after a save failure returns the same charge instead of a second one.
 *
 * Recorded through the same fulfillJobPayment as a checkout payment (ledger,
 * paid-to-date, review request once covered, owner alert). The ledger row's
 * session id is the PaymentIntent id. A decline, or a card that needs the
 * customer to confirm, comes back as a plain message suggesting a pay link.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  const prof = await requireOwner(req);
  if (prof instanceof NextResponse) return prof;
  const orgId = prof.orgId!;

  const body = (await req.json().catch(() => ({}))) as { jobId?: string; amount?: number };
  if (!body.jobId || !UUID.test(body.jobId)) return NextResponse.json({ error: "Missing job" }, { status: 400 });

  const supabase = serviceClient();

  const { data: job } = await supabase
    .from("jobs")
    .select("id, org_id, total, property, client, customer_id, status")
    .eq("id", body.jobId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  // The switch, the payout account and the plan, all from the caller's own org.
  const { data: cof, error: cofErr } = await supabase
    .from("organizations").select("card_on_file_enabled").eq("id", orgId).maybeSingle();
  if (cofErr || cof?.card_on_file_enabled !== true) {
    return NextResponse.json({ error: "Card on file is turned off in Billing & Payments." }, { status: 400 });
  }
  const { data: org } = await supabase
    .from("organizations").select("name, stripe_account_id, subscription_plan").eq("id", orgId).maybeSingle();
  if (!org?.stripe_account_id) {
    return NextResponse.json({ error: "Connect Stripe in Billing & Payments first." }, { status: 400 });
  }

  if (!job.customer_id) return NextResponse.json({ error: "This job has no customer with a saved card." }, { status: 400 });
  const { data: cust, error: custErr } = await supabase
    .from("customers")
    .select("id, stripe_customer_id, card_payment_method_id")
    .eq("id", job.customer_id)
    .eq("org_id", orgId)
    .maybeSingle();
  if (custErr || !cust?.stripe_customer_id || !cust?.card_payment_method_id) {
    return NextResponse.json({ error: "This customer has no saved card." }, { status: 400 });
  }

  // Only the outstanding balance is chargeable (same rule as checkout).
  const { data: paidRow, error: paidErr } = await supabase
    .from("jobs").select("amount_paid").eq("id", job.id).maybeSingle();
  const alreadyPaid = paidErr ? 0 : Number(paidRow?.amount_paid) || 0;
  const balance = Math.round(Math.max(0, (Number(job.total) || 0) - alreadyPaid) * 100) / 100;
  const requested = Number(body.amount);
  const payAmount = Number.isFinite(requested) && requested > 0 ? Math.min(requested, balance) : balance;
  if (payAmount <= 0) return NextResponse.json({ error: "Nothing left to charge on this job" }, { status: 400 });
  const amountCents = Math.round(payAmount * 100);
  const kind = payAmount < balance ? "deposit" : alreadyPaid > 0 ? "balance" : "payment";

  const platformFeeCents = await platformFeeFor(supabase, orgId, org.subscription_plan ?? null, amountCents);
  const params = buildSavedCardChargeParams({
    job,
    orgName: org.name || "Service Provider",
    destinationAccountId: org.stripe_account_id,
    stripeCustomerId: cust.stripe_customer_id,
    paymentMethodId: cust.card_payment_method_id,
    amountCents,
    platformFeeCents,
    kind,
  });

  const Stripe = (await import("stripe")).default;
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

  let intentId: string;
  try {
    const pi = await stripe.paymentIntents.create(params as Parameters<typeof stripe.paymentIntents.create>[0], {
      idempotencyKey: savedCardChargeKey(job.id, amountCents, Math.round(alreadyPaid * 100)),
    });
    if (pi.status !== "succeeded") {
      // Cards settle at once; anything else (needs the customer, processing)
      // isn't recorded here. Cancel what can be cancelled so it can't land later.
      if (pi.status === "requires_action" || pi.status === "requires_payment_method" || pi.status === "requires_confirmation") {
        await stripe.paymentIntents.cancel(pi.id).catch(() => { /* already final */ });
      }
      return NextResponse.json(
        { error: savedCardFailureMessage({ code: "authentication_required" }), declined: true },
        { status: 402 },
      );
    }
    intentId = pi.id;
  } catch (e) {
    console.error("[charge-saved] charge failed:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: savedCardFailureMessage(e), declined: true }, { status: 402 });
  }

  try {
    const fulfilled = await fulfillJobPayment(supabase, {
      jobId: job.id,
      expectOrgId: orgId,
      sessionId: intentId,
      paymentIntentId: intentId,
      paidNow: amountCents / 100,
      platformFeeCents,
      kind,
      notify: { excludeUserId: prof.userId },
      source: "charge-saved",
      refundExcess: stripeExcessRefunder(stripe),
    });
    if (!fulfilled.ok) throw new Error(fulfilled.reason);
    return NextResponse.json({
      ok: true,
      paidNow: amountCents / 100,
      balance: fulfilled.result.balance,
      fullyPaid: fulfilled.result.fullyPaid,
    });
  } catch (e) {
    // Charged but not saved. The idempotency key hasn't moved (paid-to-date is
    // unchanged), so tapping again returns this same charge and saves it.
    console.error("[charge-saved] charged but not recorded:", e);
    return NextResponse.json(
      { error: "The card was charged, but saving the payment failed. Tap Charge card again to finish; it won't charge twice." },
      { status: 500 },
    );
  }
}
