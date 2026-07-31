import { type SupabaseClient } from "@supabase/supabase-js";

/**
 * Shared job-payment fulfillment — used by BOTH /api/verify-payment (the
 * browser redirect from /payment/success) AND the Stripe webhook's
 * checkout.session.completed handler. Fulfilling in the webhook too means a
 * customer who closes the tab before the redirect completes still gets their
 * payment recorded. Both paths key the ledger insert on the UNIQUE
 * `stripe_session_id`, so whichever lands first records the charge and the
 * other is a safe no-op (no double-count).
 */

export interface RecordPaymentInput {
  jobId: string;
  orgId: string;
  jobTotal: number;              // dollars
  jobFeeCents: number;           // existing jobs.platform_fee_cents (fallback only)
  jobPaidAt: string | null;      // preserve an already-set paid_at
  sessionId: string;             // Stripe Checkout session id — the idempotency key
  paymentIntentId: string | null;
  paidNow: number;               // dollars charged in this session
  platformFeeCents: number;
  kind: string;                  // deposit | balance | payment
}

export interface RecordPaymentResult {
  amountPaid: number;
  total: number;
  balance: number;
  fullyPaid: boolean;
  alreadyRecorded: boolean;
}

export async function recordJobPayment(
  supabase: SupabaseClient,
  p: RecordPaymentInput,
): Promise<RecordPaymentResult> {
  const { jobId, orgId, sessionId, paymentIntentId, paidNow, platformFeeCents, kind } = p;

  // Ledger insert. UNIQUE stripe_session_id makes this idempotent across the
  // redirect + the webhook + a page refresh. A duplicate => no-op. A missing
  // table (org hasn't run the migration) => degrade to a single-payment check.
  let ledgerOk = true;
  let alreadyRecorded = false;
  {
    const { error: payErr } = await supabase.from("payments").insert({
      org_id: orgId,
      job_id: jobId,
      amount: paidNow,
      kind,
      stripe_session_id: sessionId,
      stripe_payment_intent_id: paymentIntentId,
      platform_fee_cents: platformFeeCents,
    });
    if (payErr) {
      if (payErr.code === "23505" || /duplicate key|unique/i.test(payErr.message)) alreadyRecorded = true;
      else ledgerOk = false;
    }
  }

  // Prior paid-to-date — best-effort so a pre-migration job (no amount_paid
  // column) doesn't error out a real customer payment.
  const { data: paidRow, error: paidErr } = await supabase
    .from("jobs").select("amount_paid").eq("id", jobId).maybeSingle();
  const priorPaid = paidErr ? 0 : Number(paidRow?.amount_paid) || 0;

  // Paid-to-date = SUM(ledger). Fees likewise, so refund proration stays honest.
  let amountPaid: number;
  let ledgerFeeCents: number | null = null;
  if (ledgerOk) {
    const { data: rows, error: sumErr } = await supabase
      .from("payments").select("amount, platform_fee_cents").eq("job_id", jobId);
    if (!sumErr && rows) {
      amountPaid = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
      ledgerFeeCents = rows.reduce((s, r) => s + (Number(r.platform_fee_cents) || 0), 0);
    } else {
      // SUM failed after a successful insert — accumulate onto the prior total
      // rather than clobbering it with just this charge (would lose a deposit).
      amountPaid = priorPaid + (alreadyRecorded ? 0 : paidNow);
    }
  } else {
    amountPaid = paidNow;
  }
  amountPaid = Math.round(amountPaid * 100) / 100;

  const total = Math.round((Number(p.jobTotal) || 0) * 100) / 100;
  // A deposit records against the job but must NOT mark it paid — only a
  // paid-to-date that covers the total flips the status.
  const fullyPaid = total > 0 && amountPaid >= total - 0.01;
  const balance = Math.round(Math.max(0, total - amountPaid) * 100) / 100;

  const patch: Record<string, unknown> = {
    amount_paid: amountPaid,
    stripe_payment_intent_id: paymentIntentId,
    platform_fee_cents:
      ledgerFeeCents ?? (Number(p.jobFeeCents) || 0) + (alreadyRecorded ? 0 : platformFeeCents),
  };
  if (fullyPaid) {
    patch.status = "paid";
    patch.paid_at = p.jobPaidAt || new Date().toISOString();
  }

  let { error } = await supabase.from("jobs").update(patch).eq("id", jobId).eq("org_id", orgId);
  if (error && /amount_paid/i.test(error.message)) {
    // Pre-migration: no amount_paid column. Still record the correct status.
    delete patch.amount_paid;
    ({ error } = await supabase.from("jobs").update(patch).eq("id", jobId).eq("org_id", orgId));
  }
  if (error) throw new Error(error.message);

  return { amountPaid, total, balance, fullyPaid, alreadyRecorded };
}

/**
 * Enqueue a review request for a settled job, gated on the org's
 * review_request_enabled flag. Idempotent — skips if any row already exists for
 * the job. The cron at /api/reviews/dispatch actually sends it later. Only call
 * this once a job is FULLY paid (never after a deposit).
 */
export async function scheduleReviewRequest(
  supabase: SupabaseClient,
  jobId: string,
): Promise<void> {
  const { data: existing } = await supabase
    .from("review_requests").select("id").eq("job_id", jobId).limit(1);
  if (existing && existing.length) return;

  const { data: jobRows } = await supabase
    .from("jobs").select("id, org_id, customer_id").eq("id", jobId).limit(1);
  const job = jobRows?.[0];
  if (!job?.org_id) return;

  const { data: orgRows } = await supabase
    .from("organizations")
    .select("review_request_enabled, review_request_delay_hours, review_request_channel")
    .eq("id", job.org_id).limit(1);
  const org = orgRows?.[0];
  if (org && org.review_request_enabled === false) return;

  const delayHours = Number.isFinite(org?.review_request_delay_hours)
    ? Number(org!.review_request_delay_hours)
    : 24;
  const channel: "sms" | "email" | "both" = (() => {
    const v = org?.review_request_channel;
    return v === "email" || v === "both" ? v : "sms";
  })();

  await supabase.from("review_requests").insert({
    org_id: job.org_id,
    job_id: jobId,
    customer_id: job.customer_id || null,
    scheduled_for: new Date(Date.now() + delayHours * 3600 * 1000).toISOString(),
    channel,
    status: "scheduled",
  });
}
