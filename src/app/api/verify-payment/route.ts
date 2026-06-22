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
    const session = await stripe.checkout.sessions.retrieve(sessionId);

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
      .select("id, org_id")
      .eq("id", jobId)
      .single();
    if (jobErr || !job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }
    const sessionOrgId = session.metadata?.org_id;
    if (sessionOrgId && sessionOrgId !== job.org_id) {
      return NextResponse.json({ error: "Session/job org mismatch" }, { status: 400 });
    }

    const { error } = await supabase
      .from("jobs")
      .update({ status: "paid" })
      .eq("id", jobId)
      .eq("org_id", job.org_id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Schedule a review-request for this job. Best-effort — never let
    // a scheduling failure block the payment confirmation. The cron at
    // /api/reviews/dispatch picks it up later and sends the SMS / email.
    await scheduleReviewRequest(supabase, jobId).catch((e) => {
      console.error("[verify-payment] review-request schedule failed:", e);
    });

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("verify-payment error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
