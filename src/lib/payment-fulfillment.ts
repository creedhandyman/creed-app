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
  /** The job's status right now. A payment that covers the total only flips
   *  the job to "paid" once the work is done (complete / invoiced / paid);
   *  before that it is a prepayment and the job keeps its place in the
   *  pipeline. Absent = unknown, treated as work done (the old behavior). */
  jobStatus?: string | null;
  /** The owner chose the Paid status by hand: flip it whatever the status. */
  forcePaid?: boolean;
  sessionId: string;             // Stripe Checkout session id — the idempotency key
  paymentIntentId: string | null;
  paidNow: number;               // dollars charged in this session
  platformFeeCents: number;
  kind: string;                  // deposit | balance | payment
  /** Tip on this charge, in cents. Stored in payments.tip_cents and kept OUT
   *  of `amount` / paidNow, so it never pays down the job balance. */
  tipCents?: number;
}

export interface RecordPaymentResult {
  amountPaid: number;
  total: number;
  balance: number;
  fullyPaid: boolean;
  /** The job is now "paid": fully paid AND its work is done (or the owner
   *  marked it Paid by hand). A job paid in full up front is fullyPaid but
   *  not settled; it settles when it is completed (lib/job-transition). */
  settled: boolean;
  alreadyRecorded: boolean;
  /** Dollars refunded right away because this charge overpaid the job. */
  refundedExcess?: number;
}

export async function recordJobPayment(
  supabase: SupabaseClient,
  p: RecordPaymentInput,
): Promise<RecordPaymentResult> {
  const { jobId, orgId, sessionId, paymentIntentId, paidNow, platformFeeCents, kind } = p;
  const tipCents = Math.max(0, Math.round(Number(p.tipCents) || 0));

  // Ledger insert. UNIQUE stripe_session_id makes this idempotent across the
  // redirect + the webhook + a page refresh. A duplicate => no-op. A missing
  // table (org hasn't run the migration) => degrade to a single-payment check.
  let ledgerOk = true;
  let alreadyRecorded = false;
  {
    const row: Record<string, unknown> = {
      org_id: orgId,
      job_id: jobId,
      amount: paidNow,
      kind,
      stripe_session_id: sessionId,
      stripe_payment_intent_id: paymentIntentId,
      platform_fee_cents: platformFeeCents,
    };
    // Only write tip_cents when there IS a tip, so a database that hasn't had
    // the tips migration yet keeps recording ordinary payments untouched.
    if (tipCents > 0) row.tip_cents = tipCents;
    let { error: payErr } = await supabase.from("payments").insert(row);
    if (payErr && tipCents > 0 && /tip_cents/i.test(payErr.message)) {
      // Pre-migration: no tip_cents column. Record the payment without it
      // rather than lose it (the tip still reached the business in Stripe).
      console.error("[payments] tip_cents column missing; tip not recorded:", payErr.message);
      delete row.tip_cents;
      ({ error: payErr } = await supabase.from("payments").insert(row));
    }
    if (payErr) {
      if (payErr.code === "23505" || /duplicate key|unique/i.test(payErr.message)) alreadyRecorded = true;
      else if (isMissingTable(payErr)) ledgerOk = false;
      // Any other failure (a timeout, a dropped connection) must NOT be papered
      // over: recording "this charge only" would wipe an earlier deposit off
      // amount_paid, and swallowing it lets the webhook ack Stripe with nothing
      // saved. Throw so the webhook answers 500 and Stripe retries (the insert
      // is idempotent on stripe_session_id, so a retry is safe).
      else throw new Error(`payments ledger insert failed: ${payErr.message}`);
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
  // Paid in full BEFORE the work is done is a prepayment, not a finished job:
  // flipping it to "paid" took it off the Active tab and the crew's lists and
  // queued the review request before anyone had shown up. It stays where it
  // is and settles when the job is completed (lib/job-transition).
  const settled = fullyPaid && (!!p.forcePaid || p.jobStatus == null || workIsDone(p.jobStatus));
  if (settled) {
    patch.status = "paid";
    patch.paid_at = p.jobPaidAt || new Date().toISOString();
  }

  const error = await patchJob(supabase, jobId, orgId, patch);
  if (error) throw new Error(error);

  return { amountPaid, total, balance, fullyPaid, settled, alreadyRecorded };
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

/** The payments table doesn't exist yet (pre-migration org) — the one ledger
 *  error we degrade on instead of failing the payment. */
function isMissingTable(e: { code?: string; message: string }): boolean {
  return e.code === "42P01" || /relation .* does not exist/i.test(e.message);
}

/** A paid-to-date that covers the total (1¢ slack) — the ONLY thing that makes a job "paid". */
function coversTotal(amountPaid: number, total: number): boolean {
  return total > 0 && amountPaid >= total - 0.01;
}

/** Statuses where the work itself is finished, so full payment closes the job. */
function workIsDone(status: string): boolean {
  return status === "complete" || status === "invoiced" || status === "paid";
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
  /** Tip on this charge in cents (0/absent = none). Never part of paidNow. */
  tipCents?: number;
  /** Don't schedule the review-request text even if this settles the job. */
  skipReview?: boolean;
  /** The owner chose the Paid status by hand (Jobs → Paid → record the
   *  payment): the job becomes "paid" even if it was never marked complete. */
  forcePaid?: boolean;
  /** Owner/manager alert: default on. `false` = none (bulk cleanups);
   *  `{excludeUserId}` = everyone but the person who recorded it. */
  notify?: boolean | { excludeUserId: string };
  /** Log prefix, e.g. "verify-payment". */
  source: string;
  /** Refunds part of a card charge (Stripe). When given, a card charge that
   *  takes paid-to-date OVER the job total (two checkout pages both paid, or
   *  cash recorded while the customer was mid-checkout) has the extra refunded
   *  automatically. Resolves true when the refund was created. Manual payments
   *  never pass it. */
  refundExcess?: (args: { paymentIntentId: string; amountCents: number; idempotencyKey: string; jobId: string }) => Promise<boolean>;
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
    .select("id, org_id, total, platform_fee_cents, paid_at, status")
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
    jobStatus: job.status ?? null,
    forcePaid: p.forcePaid,
    sessionId: p.sessionId,
    paymentIntentId: p.paymentIntentId,
    paidNow: p.paidNow,
    platformFeeCents: p.platformFeeCents,
    kind: p.kind,
    tipCents: p.tipCents,
  });

  // Only ask for a review once the job is actually settled — never after a
  // deposit, and never for a job paid up front whose work isn't done yet.
  // Best-effort; the cron at /api/reviews/dispatch sends it later.
  if (result.settled && !p.skipReview) {
    await scheduleReviewRequest(supabase, job.id).catch((e) => {
      console.error(`[${p.source}] review-request schedule failed:`, e);
    });
  }

  // Overpayment backstop. Checkout clamps each charge to the balance when the
  // page opens, but two pages opened before either was paid can both go
  // through. Refund only THIS charge's share of the extra, and only from the
  // call that recorded it (so the redirect + webhook race can't refund twice;
  // the Stripe idempotency key backs that up). The charge.refunded webhook then
  // writes the negative ledger row, bringing amount_paid back to the total.
  let refundedExcess = 0;
  const excess = Math.round((result.amountPaid - result.total) * 100) / 100;
  if (!result.alreadyRecorded && p.refundExcess && p.paymentIntentId && result.total > 0 && excess > 0.01) {
    const amountCents = Math.round(Math.min(excess, p.paidNow) * 100);
    if (amountCents > 0) {
      try {
        const ok = await p.refundExcess({
          paymentIntentId: p.paymentIntentId,
          amountCents,
          idempotencyKey: `overpay_${p.sessionId}`,
          jobId: job.id,
        });
        if (ok) refundedExcess = amountCents / 100;
      } catch (e) {
        // Owners are still alerted below (with the overpaid amount), so a
        // person can refund by hand. Never fail the payment over it.
        console.error(`[${p.source}] overpayment refund failed:`, e);
      }
    }
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
      overpaid: excess > 0.01 ? excess : 0,
      refunded: refundedExcess,
    });
  }

  return { ok: true, orgId: job.org_id, result: { ...result, refundedExcess } };
}

/** What a paid Stripe Checkout session says about a job payment. */
export interface CheckoutPayment {
  jobId: string | null;           // metadata.job_id (we stamp it at checkout)
  orgId: string | null;           // metadata.org_id (older sessions: absent)
  sessionId: string;
  paymentIntentId: string | null;
  /** Dollars charged for the JOB — Stripe's total minus any tip. */
  paidNow: number;
  platformFeeCents: number;
  kind: string;
  /** Tip in cents (metadata.tip_cents; 0 for sessions without one). */
  tipCents: number;
}

export function paymentFromCheckoutSession(session: Stripe.Checkout.Session): CheckoutPayment {
  const meta = (session.metadata as Record<string, string> | null) || {};
  const pi = session.payment_intent;
  const tipCents = Math.max(0, Math.round(Number(meta.tip_cents) || 0));
  // Stripe's amount_total is authoritative; the checkout metadata is a
  // fallback for sessions created before it existed. amount_total includes the
  // tip line, so the tip comes off before it can pay down the job balance.
  const totalCents = session.amount_total != null
    ? Math.max(0, Number(session.amount_total) - tipCents)
    : Math.max(0, Number(meta.amount_cents ?? 0));
  return {
    jobId: meta.job_id || null,
    orgId: meta.org_id || null,
    sessionId: session.id,
    paymentIntentId: typeof pi === "string" ? pi : pi?.id ?? null,
    paidNow: totalCents / 100,
    platformFeeCents: Math.max(0, Number(meta.platform_fee_cents) || 0),
    kind: meta.kind || "payment",
    tipCents,
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

  // A charge that carried a tip: only the JOB share of the refund comes off
  // paid-to-date (the tip was never counted toward it). Read separately and
  // best-effort so a database without the tip_cents column refunds exactly as
  // before.
  let tipOnCharge = 0;
  if (chargeRow) {
    const { data: tipRow, error: tipErr } = await supabase
      .from("payments").select("tip_cents").eq("id", chargeRow.id).maybeSingle();
    if (!tipErr) tipOnCharge = Math.max(0, Number(tipRow?.tip_cents) || 0);
  }
  const refunded = refundJobShareCents(r.refundedCents, r.chargeCents, tipOnCharge) / 100;

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
 * How much of a refund comes off the job's paid-to-date, in cents. With no tip
 * it's the whole refund. With a tip, the refund counts against the job part
 * first and is capped at it: a full refund removes exactly the job amount (the
 * tip was never counted toward paid-to-date), and the automatic overpayment
 * refund (always job money) comes off in full.
 */
export function refundJobShareCents(refundedCents: number, chargeCents: number, tipCents: number): number {
  const refunded = Math.max(0, Math.round(Number(refundedCents) || 0));
  const charge = Math.max(0, Math.round(Number(chargeCents) || 0));
  const tip = Math.max(0, Math.round(Number(tipCents) || 0));
  if (!tip || charge <= 0 || tip >= charge) return refunded;
  return Math.min(refunded, charge - tip);
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

/** A bank transfer (ACH) checkout that's finished but still clearing. Once the
 *  bank payment fails the session stays complete and unpaid, so the
 *  PaymentIntent's status decides: only "processing" is still on its way. An
 *  unexpanded intent (just its id) keeps the old reading. */
export function isBankPaymentPending(session: Stripe.Checkout.Session): boolean {
  if (session.status !== "complete" || session.payment_status !== "unpaid") return false;
  const pi = session.payment_intent;
  if (pi && typeof pi === "object") return pi.status === "processing";
  return true;
}
