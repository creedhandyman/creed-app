import { type SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import { notifyJobPaid } from "@/lib/notify-server";

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
    const sums = await sumLedger(supabase, jobId);
    if (sums) {
      amountPaid = sums.amountPaid;
      ledgerFeeCents = sums.feeCents;
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
  const fullyPaid = coversTotal(amountPaid, total);
  const balance = Math.round(Math.max(0, total - amountPaid) * 100) / 100;

  const patch: Record<string, unknown> = {
    amount_paid: amountPaid,
    // A cash/check payment (no intent) must not wipe a card payment's id —
    // the refund webhook relies on it.
    ...(paymentIntentId ? { stripe_payment_intent_id: paymentIntentId } : {}),
    platform_fee_cents:
      ledgerFeeCents ?? (Number(p.jobFeeCents) || 0) + (alreadyRecorded ? 0 : platformFeeCents),
  };
  if (fullyPaid) {
    patch.status = "paid";
    patch.paid_at = p.jobPaidAt || new Date().toISOString();
  }

  const error = await patchJob(supabase, jobId, orgId, patch);
  if (error) throw new Error(error);

  return { amountPaid, total, balance, fullyPaid, alreadyRecorded };
}

// ── Shared ledger plumbing (payments AND refunds) ───────────────────────────

/** SUM of a job's ledger rows (amount, platform fee). null = the read failed. */
async function sumLedger(
  supabase: SupabaseClient,
  jobId: string,
): Promise<{ amountPaid: number; feeCents: number } | null> {
  const { data: rows, error } = await supabase
    .from("payments").select("amount, platform_fee_cents").eq("job_id", jobId);
  if (error || !rows) return null;
  return {
    amountPaid: Math.round(rows.reduce((s, r) => s + (Number(r.amount) || 0), 0) * 100) / 100,
    feeCents: rows.reduce((s, r) => s + (Number(r.platform_fee_cents) || 0), 0),
  };
}

/** A paid-to-date that covers the total (1¢ slack) — the ONLY thing that makes a job "paid". */
function coversTotal(amountPaid: number, total: number): boolean {
  return total > 0 && amountPaid >= total - 0.01;
}

/** Org-scoped jobs update. Pre-migration (no amount_paid column) it retries
 *  without that field so the status still lands. Returns the error message. */
async function patchJob(
  supabase: SupabaseClient,
  jobId: string,
  orgId: string,
  patch: Record<string, unknown>,
): Promise<string | null> {
  let { error } = await supabase.from("jobs").update(patch).eq("id", jobId).eq("org_id", orgId);
  if (error && /amount_paid/i.test(error.message) && "amount_paid" in patch) {
    // Pre-migration: no amount_paid column. Still record the correct status.
    const rest = { ...patch };
    delete rest.amount_paid;
    ({ error } = await supabase.from("jobs").update(rest).eq("id", jobId).eq("org_id", orgId));
  }
  return error ? error.message : null;
}

// ── One call per payment: load → record → review → alert ────────────────────

export interface FulfillPaymentInput {
  jobId: string;
  /** The org the payment must belong to (session metadata / the caller's own
   *  org). Absent = not checked (older sessions carried no org_id). */
  expectOrgId?: string | null;
  sessionId: string;              // idempotency key (Stripe session id | manual_<uuid>)
  paymentIntentId: string | null;
  paidNow: number;                // dollars
  platformFeeCents: number;
  kind: string;
  /** Don't schedule the review-request text even if this settles the job. */
  skipReview?: boolean;
  /** Owner/manager alert: default on. `false` = none (bulk cleanups);
   *  `{excludeUserId}` = everyone but the person who recorded it. */
  notify?: boolean | { excludeUserId: string };
  /** Log prefix, e.g. "verify-payment". */
  source: string;
}

export type FulfillPaymentResult =
  | { ok: true; orgId: string; result: RecordPaymentResult }
  | { ok: false; reason: "job_not_found" | "org_mismatch" };

/**
 * The whole job-payment fulfillment, shared by /api/verify-payment, the
 * Stripe webhook and /api/payments/record: load the job, record the charge
 * (idempotent on sessionId — see recordJobPayment), schedule the review
 * request once the job is FULLY paid, and alert owners/managers. The alert
 * fires only for the call that actually inserted the ledger row
 * (!alreadyRecorded), so the redirect + webhook racing on one session alert
 * once. Review-scheduling errors are logged, never fail the payment.
 * recordJobPayment errors propagate (the caller decides the response).
 */
export async function fulfillJobPayment(
  supabase: SupabaseClient,
  p: FulfillPaymentInput,
): Promise<FulfillPaymentResult> {
  const { data: job, error: jobErr } = await supabase
    .from("jobs")
    .select("id, org_id, total, platform_fee_cents, paid_at")
    .eq("id", p.jobId)
    .maybeSingle();
  if (jobErr || !job) return { ok: false, reason: "job_not_found" };
  if (p.expectOrgId && p.expectOrgId !== job.org_id) return { ok: false, reason: "org_mismatch" };

  const result = await recordJobPayment(supabase, {
    jobId: job.id,
    orgId: job.org_id,
    jobTotal: Number(job.total) || 0,
    jobFeeCents: Number(job.platform_fee_cents) || 0,
    jobPaidAt: job.paid_at ?? null,
    sessionId: p.sessionId,
    paymentIntentId: p.paymentIntentId,
    paidNow: p.paidNow,
    platformFeeCents: p.platformFeeCents,
    kind: p.kind,
  });

  // Only ask for a review once the job is actually settled — never after a
  // deposit. Best-effort; the cron at /api/reviews/dispatch sends it later.
  if (result.fullyPaid && !p.skipReview) {
    await scheduleReviewRequest(supabase, job.id).catch((e) => {
      console.error(`[${p.source}] review-request schedule failed:`, e);
    });
  }

  if (!result.alreadyRecorded && p.paidNow > 0 && p.notify !== false) {
    await notifyJobPaid(supabase, {
      excludeUserId: typeof p.notify === "object" ? p.notify.excludeUserId : null,
      jobId: job.id,
      orgId: job.org_id,
      paidNow: p.paidNow,
      amountPaid: result.amountPaid,
      total: result.total,
      fullyPaid: result.fullyPaid,
    });
  }

  return { ok: true, orgId: job.org_id, result };
}

/** What a paid Stripe Checkout session says about a job payment. */
export interface CheckoutPayment {
  jobId: string | null;           // metadata.job_id (we stamp it at checkout)
  orgId: string | null;           // metadata.org_id (older sessions: absent)
  sessionId: string;
  paymentIntentId: string | null;
  paidNow: number;                // dollars ACTUALLY charged
  platformFeeCents: number;
  kind: string;
}

export function paymentFromCheckoutSession(session: Stripe.Checkout.Session): CheckoutPayment {
  const meta = (session.metadata as Record<string, string> | null) || {};
  const pi = session.payment_intent;
  return {
    jobId: meta.job_id || null,
    orgId: meta.org_id || null,
    sessionId: session.id,
    paymentIntentId: typeof pi === "string" ? pi : pi?.id ?? null,
    // Stripe's amount_total is authoritative; the checkout metadata is a
    // fallback for sessions created before it existed.
    paidNow: Math.max(0, Number(session.amount_total ?? meta.amount_cents ?? 0)) / 100,
    platformFeeCents: Math.max(0, Number(meta.platform_fee_cents) || 0),
    kind: meta.kind || "payment",
  };
}

// ── Refunds ─────────────────────────────────────────────────────────────────

export interface RefundInput {
  paymentIntentId: string;
  chargeCents: number;            // charge.amount
  refundedCents: number;          // charge.amount_refunded (CUMULATIVE)
  fullyRefunded: boolean;         // charge.refunded
}

export type RefundResult =
  | { ok: false; reason: "no_job" }
  | { ok: true; jobId: string; orgId: string; amountPaid: number | null; reverted: boolean };

/**
 * charge.refunded: reverse the charge's platform fee pro rata (restores the
 * fee-cap headroom; full refund → 0), write ONE negative ledger row per
 * PaymentIntent carrying the CUMULATIVE amount_refunded (upserted on a
 * synthetic key → webhook retries and partial→full refunds are idempotent),
 * then recompute paid-to-date and pull a `paid` job back to `invoiced` when it
 * no longer covers the total. Job reads/writes are scoped to the job's org.
 * The ledger part is best-effort — never fail the webhook.
 */
export async function recordJobRefund(
  supabase: SupabaseClient,
  r: RefundInput,
): Promise<RefundResult> {
  const piId = r.paymentIntentId;
  const isFullRefund = r.fullyRefunded && r.refundedCents >= r.chargeCents;
  const keptFraction = r.chargeCents > 0 ? (r.chargeCents - r.refundedCents) / r.chargeCents : 0;
  const refunded = Math.round(r.refundedCents) / 100;

  // Resolve the job from the PAYMENTS LEDGER first: it records every
  // charge's PaymentIntent, so refunding a DEPOSIT still finds its job.
  // `jobs.stripe_payment_intent_id` only ever holds the LATEST payment,
  // so relying on it alone silently drops deposit refunds.
  let jobId: string | null = null;
  let orgId: string | null = null;
  let chargeRow: { id: string; platform_fee_cents: number } | null = null;
  {
    const { data: pay } = await supabase
      .from("payments")
      .select("id, job_id, org_id, platform_fee_cents")
      .eq("stripe_payment_intent_id", piId)
      .neq("kind", "refund")
      .limit(1)
      .maybeSingle();
    if (pay) {
      jobId = pay.job_id;
      orgId = pay.org_id;
      chargeRow = { id: pay.id, platform_fee_cents: Number(pay.platform_fee_cents) || 0 };
    }
  }
  // Legacy fallback: job paid before the ledger existed.
  let legacyFee: number | null = null;
  if (!jobId) {
    const { data: j } = await supabase
      .from("jobs")
      .select("id, org_id, platform_fee_cents")
      .eq("stripe_payment_intent_id", piId)
      .maybeSingle();
    if (j) {
      jobId = j.id;
      orgId = j.org_id;
      legacyFee = Number(j.platform_fee_cents) || 0;
    }
  }
  if (!jobId || !orgId) return { ok: false, reason: "no_job" };

  // Prorate THIS charge's own fee — never the job's cumulative fee,
  // which on a multi-payment job also contains other charges' fees.
  if (chargeRow) {
    const netFee = isFullRefund ? 0 : Math.round(chargeRow.platform_fee_cents * keptFraction);
    await supabase.from("payments").update({ platform_fee_cents: netFee }).eq("id", chargeRow.id);
  } else if (legacyFee !== null) {
    const netFee = isFullRefund ? 0 : Math.round(legacyFee * keptFraction);
    await supabase.from("jobs").update({ platform_fee_cents: netFee }).eq("id", jobId).eq("org_id", orgId);
  }

  let amountPaid: number | null = null;
  let reverted = false;
  try {
    await supabase.from("payments").upsert(
      {
        org_id: orgId,
        job_id: jobId,
        amount: -refunded,
        kind: "refund",
        stripe_session_id: `refund_${piId}`,
        stripe_payment_intent_id: piId,
        platform_fee_cents: 0,
      },
      { onConflict: "stripe_session_id" },
    );
    const sums = await sumLedger(supabase, jobId);
    const { data: j2 } = await supabase
      .from("jobs")
      .select("total, status")
      .eq("id", jobId)
      .eq("org_id", orgId)
      .maybeSingle();
    if (!sums) {
      // Can't read the ledger — don't guess a paid-to-date (writing 0 would
      // pull a settled job back to owing). Logged; nothing written.
      console.error("[refund] ledger sum failed for job", jobId);
    } else {
      amountPaid = sums.amountPaid;
      const total = Math.round((Number(j2?.total) || 0) * 100) / 100;
      const patch: Record<string, unknown> = { amount_paid: amountPaid };
      // Job fee = sum of its charges' (post-refund) fees.
      if (chargeRow) patch.platform_fee_cents = sums.feeCents;
      if (j2?.status === "paid" && !coversTotal(amountPaid, total)) {
        patch.status = "invoiced";
        patch.paid_at = null;
        reverted = true;
      }
      const err = await patchJob(supabase, jobId, orgId, patch);
      if (err) {
        console.error("[refund] job update failed:", err);
        reverted = false;
      }
    }
  } catch (e) {
    console.error("[refund] ledger update failed:", e);
  }
  return { ok: true, jobId, orgId, amountPaid, reverted };
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
    .from("jobs").select("id, org_id, customer_id, review_requested_at").eq("id", jobId).limit(1);
  const job = jobRows?.[0];
  if (!job?.org_id) return;
  // Already asked by hand (the tech's post-completion prompt or "Request
  // review") — don't text the customer a second time.
  if (job.review_requested_at) return;

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
