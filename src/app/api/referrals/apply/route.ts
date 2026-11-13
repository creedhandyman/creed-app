import { NextRequest, NextResponse } from "next/server";
import { requireOwner, serviceClient } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

/**
 * POST /api/referrals/apply { referralId, jobId }
 * QuoteForge calls this after it saved a quote with a "Referral credit"
 * discount: marks that earned credit as used on that job, so it can't be
 * used twice. The job must belong to the customer who earned it.
 * Owner/manager only.
 */
export async function POST(req: NextRequest) {
  const auth = await requireOwner(req);
  if (auth instanceof NextResponse) return auth;
  const b = (await req.json().catch(() => ({}))) as { referralId?: unknown; jobId?: unknown };
  if (typeof b.referralId !== "string" || typeof b.jobId !== "string") {
    return NextResponse.json({ error: "Missing referral or job" }, { status: 400 });
  }
  const sb = serviceClient();
  const { data: ref } = await sb
    .from("customer_referrals").select("id, referrer_customer_id, status")
    .eq("id", b.referralId).eq("org_id", auth.orgId!).maybeSingle();
  if (!ref) return NextResponse.json({ error: "Credit not found" }, { status: 404 });
  if (ref.status !== "earned") return NextResponse.json({ error: "That credit was already used." }, { status: 409 });
  const { data: job } = await sb.from("jobs").select("id, customer_id").eq("id", b.jobId).eq("org_id", auth.orgId!).maybeSingle();
  if (!job || job.customer_id !== ref.referrer_customer_id) {
    return NextResponse.json({ error: "That credit belongs to another customer." }, { status: 400 });
  }
  const { data: done } = await sb
    .from("customer_referrals")
    .update({ status: "applied", applied_at: new Date().toISOString(), applied_job_id: job.id })
    .eq("id", ref.id).eq("status", "earned").select("id");
  if (!done?.length) return NextResponse.json({ error: "That credit was already used." }, { status: 409 });
  return NextResponse.json({ ok: true });
}
