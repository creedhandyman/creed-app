import { NextRequest, NextResponse } from "next/server";
import { getAuthedProfile, serviceClient } from "@/lib/api-auth";
import { scheduleReviewRequest } from "@/lib/payment-fulfillment";

export const dynamic = "force-dynamic";

/**
 * POST /api/reviews/queue — queue the automatic review request for a job that
 * just settled in the app rather than through a payment.
 *
 * A job paid in full up front stays in the pipeline until the work is done
 * (lib/payment-fulfillment). Completing it then flips it straight to "paid"
 * (lib/job-transition), and no payment arrives afterwards to schedule the
 * review text, so the Jobs screen calls this instead.
 *
 * Body: { jobId }. Any signed-in member of the job's business. Only a job
 * that is already "paid" qualifies; scheduleReviewRequest is idempotent and
 * respects the business's review settings.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  const prof = await getAuthedProfile(req);
  if (!prof?.orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { jobId?: string };
  if (!body.jobId || !UUID.test(body.jobId)) return NextResponse.json({ error: "Missing job" }, { status: 400 });

  const supabase = serviceClient();
  const { data: job } = await supabase
    .from("jobs").select("id, org_id, status").eq("id", body.jobId).maybeSingle();
  if (!job || job.org_id !== prof.orgId) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  if (job.status !== "paid") return NextResponse.json({ ok: true, queued: false });

  try {
    await scheduleReviewRequest(supabase, job.id);
    return NextResponse.json({ ok: true, queued: true });
  } catch (e) {
    console.error("[reviews/queue]", e);
    return NextResponse.json({ error: "Couldn't queue the review request." }, { status: 500 });
  }
}
