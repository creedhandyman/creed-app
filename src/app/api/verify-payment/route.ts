import { NextRequest, NextResponse } from "next/server";
import { type SupabaseClient } from "@supabase/supabase-js";
import { serviceClient } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

/**
 * Insert a scheduled review_requests row for this job, gated on the
 * org's review_request_enabled flag. Idempotent — if any review_request
 * row already exists for the job (any status), skip. The cron handler
 * is the one that actually sends the message; we only enqueue it here
 * with scheduled_for = now() + delay_hours.
 */
async function scheduleReviewRequest(
  supabase: SupabaseClient,
  jobId: string,
): Promise<void> {
  const { data: existing } = await supabase
    .from("review_requests")
    .select("id")
    .eq("job_id", jobId)
    .limit(1);
  if (existing && existing.length) return;

  const { data: jobRows } = await supabase
    .from("jobs")
    .select("id, org_id, customer_id")
    .eq("id", jobId)
    .limit(1);
  const job = jobRows?.[0];
  if (!job?.org_id) return;

  const { data: orgRows } = await supabase
    .from("organizations")
    .select("review_request_enabled, review_request_delay_hours, review_request_channel")
    .eq("id", job.org_id)
    .limit(1);
  const org = orgRows?.[0];
  // Default enabled=true so the automation works the moment the migration
  // runs, without every org having to flip a setting first. Owners turn it
  // off in Ops → Settings → Review Automation if they don't want it.
  if (org && org.review_request_enabled === false) return;

  const delayHours = Number.isFinite(org?.review_request_delay_hours)
    ? Number(org!.review_request_delay_hours)
    : 24;
  const channel: "sms" | "email" | "both" = (() => {
    const v = org?.review_request_channel;
    return v === "email" || v === "both" ? v : "sms";
  })();

  const scheduledFor = new Date(Date.now() + delayHours * 3600 * 1000).toISOString();

  await supabase.from("review_requests").insert({
    org_id: job.org_id,
    job_id: jobId,
    customer_id: job.customer_id || null,
    scheduled_for: scheduledFor,
    channel,
    status: "scheduled",
  });
}

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

    // Read the platform fee we computed at checkout creation time (stored in
    // session metadata so we don't have to recompute or re-query the cap).
    const platformFeeCents = Math.max(0, Number(session.metadata?.platform_fee_cents) || 0);

    // Payment intent id — stored on the job so the charge.refunded webhook
    // can find and adjust platform_fee_cents if the customer refunds later.
    const pi = session.payment_intent;
    const stripePaymentIntentId = typeof pi === "string" ? pi : pi?.id ?? null;

    // What was ACTUALLY charged. Stripe's amount_total is authoritative; the
    // checkout metadata is a fallback for sessions created before it existed.
    const paidNowCents = Number(session.amount_total ?? session.metadata?.amount_cents ?? 0);
    const paidNow = Math.max(0, paidNowCents) / 100;
    const kind = session.metadata?.kind || "payment";

    // ── Payment ledger ──────────────────────────────────────────────────
    // `stripe_session_id` is UNIQUE, so a refreshed /payment/success can't
    // double-count a deposit. A duplicate is a no-op. A missing table (org
    // hasn't run the migration) degrades to a single-payment check rather
    // than 500-ing a customer who genuinely paid.
    let ledgerOk = true;
    let alreadyRecorded = false;
    {
      const { error: payErr } = await supabase.from("payments").insert({
        org_id: job.org_id,
        job_id: jobId,
        amount: paidNow,
        kind,
        stripe_session_id: sessionId,
        stripe_payment_intent_id: stripePaymentIntentId,
        platform_fee_cents: platformFeeCents,
      });
      if (payErr) {
        if (payErr.code === "23505" || /duplicate key|unique/i.test(payErr.message)) alreadyRecorded = true;
        else ledgerOk = false;
      }
    }

    // Prior paid-to-date. Queried separately + best-effort so a pre-migration
    // org (no amount_paid column) doesn't 404 a real customer payment.
    const { data: paidRow, error: paidErr } = await supabase
      .from("jobs")
      .select("amount_paid")
      .eq("id", jobId)
      .maybeSingle();
    const priorPaid = paidErr ? 0 : Number(paidRow?.amount_paid) || 0;

    // Paid-to-date is the sum of the ledger — authoritative and idempotent.
    // The job's platform fee is likewise the sum of its charges' fees, so a
    // refund (which prorates a single charge's fee) stays consistent.
    let amountPaid: number;
    let ledgerFeeCents: number | null = null;
    if (ledgerOk) {
      const { data: rows, error: sumErr } = await supabase
        .from("payments")
        .select("amount, platform_fee_cents")
        .eq("job_id", jobId);
      if (!sumErr && rows) {
        amountPaid = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
        ledgerFeeCents = rows.reduce((s, r) => s + (Number(r.platform_fee_cents) || 0), 0);
      } else {
        // SUM failed — accumulate onto the prior total rather than clobbering
        // it with just this charge (which would lose an earlier deposit).
        amountPaid = priorPaid + (alreadyRecorded ? 0 : paidNow);
      }
    } else {
      // No ledger table: fall back to a single-payment check. A lone deposit
      // still won't mark the job paid, and a replay can't double-count.
      amountPaid = paidNow;
    }
    amountPaid = Math.round(amountPaid * 100) / 100;

    const total = Math.round((Number(job.total) || 0) * 100) / 100;
    // THE FIX: a deposit records against the job but must NOT mark it paid.
    // Only a paid-to-date that covers the total flips the status.
    const fullyPaid = total > 0 && amountPaid >= total - 0.01;
    const balance = Math.round(Math.max(0, total - amountPaid) * 100) / 100;

    const patch: Record<string, unknown> = {
      amount_paid: amountPaid,
      stripe_payment_intent_id: stripePaymentIntentId,
      // Ledger is the source of truth for fees (keeps refund proration honest on
      // multi-payment jobs). Without it, add this charge's fee once (never on a replay).
      platform_fee_cents:
        ledgerFeeCents ?? (Number(job.platform_fee_cents) || 0) + (alreadyRecorded ? 0 : platformFeeCents),
    };
    if (fullyPaid) {
      patch.status = "paid";
      patch.paid_at = job.paid_at || new Date().toISOString();
    }

    let { error } = await supabase
      .from("jobs")
      .update(patch)
      .eq("id", jobId)
      .eq("org_id", job.org_id);
    if (error && /amount_paid/i.test(error.message)) {
      // Pre-migration: no amount_paid column. Still record the correct status.
      delete patch.amount_paid;
      ({ error } = await supabase
        .from("jobs")
        .update(patch)
        .eq("id", jobId)
        .eq("org_id", job.org_id));
    }
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Only ask for a review once the job is actually settled — never after a
    // deposit. Best-effort; the cron at /api/reviews/dispatch sends it later.
    if (fullyPaid) {
      await scheduleReviewRequest(supabase, jobId).catch((e) => {
        console.error("[verify-payment] review-request schedule failed:", e);
      });
    }

    return NextResponse.json({ ok: true, amountPaid, total, balance, fullyPaid });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("verify-payment error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
