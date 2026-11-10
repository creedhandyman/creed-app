import { NextRequest, NextResponse } from "next/server";
import { serviceClient } from "@/lib/api-auth";
import { platformFeeFor } from "@/lib/payments/fee-cap";
import { CARD_CONSENT_VERSION } from "@/lib/payments/saved-card";
import {
  checkoutCancelUrl,
  checkoutExpiresAt,
  expireOpenJobSessions,
  type CheckoutSessionsApi,
} from "@/lib/checkout-sessions";
import { buildJobCheckoutParams } from "@/lib/payments/stripe-checkout";
import { cleanTipPct, tipAllowed, tipCentsFor } from "@/lib/tips";

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
 *   - a tip is accepted only as a PERCENT from the picker (lib/tips.ts), only
 *     when the business turned tips on and the customer pays the whole balance
 *     of finished work; the cents are worked out here. The fee is never taken
 *     on the tip.
 *   - bank transfer (ACH) is offered only when the business turned it on.
 */
export async function POST(req: NextRequest) {
  try {
    const { jobId, amount, tipPct, saveCard } = await req.json();
    if (!jobId) {
      return NextResponse.json({ error: "Missing jobId" }, { status: 400 });
    }

    const supabase = serviceClient();
    const { data: job, error: jobErr } = await supabase
      .from("jobs")
      .select("id, total, property, client, org_id, status, customer_id")
      .eq("id", jobId)
      .single();
    if (jobErr || !job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    const invoiceTotal = Number(job.total) || 0;
    // Paid-to-date. Queried separately + best-effort so a pre-migration org
    // (no amount_paid column) still checks out instead of 404-ing.
    const { data: paidRow, error: paidErr } = await supabase
      .from("jobs")
      .select("amount_paid")
      .eq("id", jobId)
      .maybeSingle();
    const alreadyPaid = paidErr ? 0 : Number(paidRow?.amount_paid) || 0;

    // Only the OUTSTANDING BALANCE is chargeable. A client-supplied amount
    // (a deposit) is clamped to it, so deposit + balance can never over-collect.
    const balance = Math.round(Math.max(0, invoiceTotal - alreadyPaid) * 100) / 100;
    const requested = Number(amount);
    const payAmount =
      Number.isFinite(requested) && requested > 0 ? Math.min(requested, balance) : balance;
    if (payAmount <= 0) {
      return NextResponse.json({ error: "Nothing left to charge on this job" }, { status: 400 });
    }
    const amountCents = Math.round(payAmount * 100);
    // Ledger classification, recorded in metadata and copied onto the payments row.
    const paymentKind =
      payAmount < balance ? "deposit" : alreadyPaid > 0 ? "balance" : "payment";

    // Payout destination + subscription plan come from the job's org, not the body.
    const { data: org } = await supabase
      .from("organizations")
      .select("name, stripe_account_id, subscription_plan")
      .eq("id", job.org_id)
      .single();
    // The bank-transfer / tip switches, read separately + best-effort so an org
    // whose database hasn't had the migration yet still checks out (card only,
    // no tip) instead of failing the payment.
    let achEnabled = false;
    let tipsEnabled = false;
    {
      const { data: sw, error: swErr } = await supabase
        .from("organizations")
        .select("ach_enabled, tips_enabled")
        .eq("id", job.org_id)
        .maybeSingle();
      if (!swErr && sw) {
        achEnabled = sw.ach_enabled === true;
        tipsEnabled = sw.tips_enabled === true;
      }
    }
    // Card on file: its own best-effort read (its own migration), and only for
    // a job linked to a customer record the card can be saved on.
    let saveCardFor: { customerId: string; stripeCustomerId: string | null; consentVersion: string } | null = null;
    if (saveCard === true && job.customer_id) {
      const { data: cof, error: cofErr } = await supabase
        .from("organizations").select("card_on_file_enabled").eq("id", job.org_id).maybeSingle();
      if (!cofErr && cof?.card_on_file_enabled === true) {
        const { data: cust, error: custErr } = await supabase
          .from("customers").select("id, stripe_customer_id")
          .eq("id", job.customer_id).eq("org_id", job.org_id).maybeSingle();
        if (!custErr && cust) {
          saveCardFor = {
            customerId: cust.id,
            stripeCustomerId: cust.stripe_customer_id || null,
            consentVersion: CARD_CONSENT_VERSION,
          };
        }
      }
    }
    const orgName = org?.name || "Service Provider";
    const stripeAccountId = org?.stripe_account_id || "";
    // No payout account = the charge would land on Creed's platform account,
    // not the business's. Refuse instead.
    if (!stripeAccountId) {
      return NextResponse.json(
        { error: `${orgName} isn't set up for card payments yet — please contact them to pay another way.` },
        { status: 400 },
      );
    }
    const plan = org?.subscription_plan ?? null;

    // Platform fee on the job amount, with the monthly cap (lib/payments/fee-cap.ts).
    const platformFeeCents = await platformFeeFor(supabase, job.org_id, plan, amountCents);

    // Tip: only a percent from the picker, only where lib/tips.ts allows it.
    const tipCents = tipAllowed({ tipsEnabled, jobStatus: job.status, payAmount, balance })
      ? tipCentsFor(amountCents, cleanTipPct(tipPct))
      : 0;

    const origin = req.headers.get("origin") || "https://www.creedhm.com";
    const referer = req.headers.get("referer") || "";
    const cancelUrl = checkoutCancelUrl(origin, referer);

    // The session itself (line items, ACH, fee routing, metadata) is built by
    // the payment layer — see lib/payments/stripe-checkout.ts.
    const sessionParams = buildJobCheckoutParams({
      job,
      orgName,
      destinationAccountId: stripeAccountId,
      amountCents,
      tipCents,
      platformFeeCents,
      kind: paymentKind,
      allowBankTransfer: achEnabled,
      saveCard: saveCardFor,
      // session_id lets /payment/success verify server-side before flipping status.
      successUrl: `${origin}/payment/success?job_id=${job.id}&session_id={CHECKOUT_SESSION_ID}`,
      // Cancelling returns the customer to the job page they paid from (the
      // /status link they were texted), not a dead-end "cancelled" page.
      cancelUrl,
      // An hour, not Stripe's default 24 h: an abandoned page can't be paid
      // later on top of a newer one (see lib/checkout-sessions.ts).
      expiresAt: checkoutExpiresAt(),
    });

    const Stripe = (await import("stripe")).default;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
    // One live checkout per job: close any page still open for this job (the
    // customer's other device, an earlier tap) so both can't be paid.
    await expireOpenJobSessions(stripe.checkout.sessions as unknown as CheckoutSessionsApi, job.id);
    const session = await stripe.checkout.sessions.create(sessionParams);

    return NextResponse.json({ url: session.url });
  } catch (error: unknown) {
    // The customer sees this — keep Stripe's raw text in the logs only.
    console.error("[checkout]", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Couldn't start the payment — please try again in a minute." }, { status: 500 });
  }
}
