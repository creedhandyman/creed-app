import { NextRequest, NextResponse } from "next/server";
import { getAuthedProfile, serviceClient } from "@/lib/api-auth";
import { canAssign, rowsToAssign, summarizeThreads } from "@/lib/sms-threads";
import { openThread } from "@/lib/sms-threads-server";

export const dynamic = "force-dynamic";

const OPEN = ["lead", "quoted", "accepted", "scheduled", "active", "inspection"];

/**
 * POST /api/sms/assign { phone, customerId } or { phone, jobId }: the Texts
 * screen's Link to customer (an unknown number) and Move to job (a Check
 * match conversation, where Creed guessed between several jobs). Owners and
 * managers only (Bernard's plan, build 3).
 *
 *   customerId  file the conversation on that customer and their newest open
 *               job (else their newest job), and save the number on the
 *               customer when they have none, so later texts match them.
 *   jobId       file it on that job and the job's customer.
 *
 * Re-files the texts Creed couldn't place or placed by guess (lib/sms-threads
 * rowsToAssign), marks the received ones match "linked" so the next text from
 * the number lands in the same place (lib/sms-inbound-server matchInbound),
 * and copies any photos they sent onto the new job. Photos stay on the job
 * Creed guessed; remove them there if they don't belong.
 */
export async function POST(req: NextRequest) {
  let body: { phone?: unknown; jobId?: unknown; customerId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  const supabase = serviceClient();
  const o = await openThread(supabase, await getAuthedProfile(req), body.phone);
  if (!o.ok) return NextResponse.json({ error: o.error }, { status: o.status });
  if (!o.viewer.admin) return NextResponse.json({ error: "Only owners and managers can move conversations" }, { status: 403 });

  const [t] = summarizeThreads(o.rows);
  if (!canAssign(t)) {
    return NextResponse.json({ error: "This conversation is already on a job" }, { status: 409 });
  }

  const orgId = o.viewer.orgId;
  let jobId: string | null = null;
  let customerId: string | null = null;
  let customerPhone: string | null = null;

  if (typeof body.jobId === "string" && body.jobId) {
    const { data: job } = await supabase.from("jobs").select("id, customer_id").eq("org_id", orgId).eq("id", body.jobId).maybeSingle();
    if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
    jobId = (job as { id: string }).id;
    customerId = (job as { customer_id?: string | null }).customer_id || null;
  } else if (typeof body.customerId === "string" && body.customerId) {
    const { data: cust } = await supabase.from("customers").select("id, phone").eq("org_id", orgId).eq("id", body.customerId).maybeSingle();
    if (!cust) return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    customerId = (cust as { id: string }).id;
    customerPhone = (cust as { phone?: string | null }).phone || null;
    const { data: jobs } = await supabase
      .from("jobs")
      .select("id, status, archived, created_at")
      .eq("org_id", orgId)
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false })
      .limit(50);
    const list = (jobs || []) as { id: string; status: string | null; archived?: boolean | null }[];
    jobId = (list.find((j) => !j.archived && OPEN.includes(j.status || "")) || list[0])?.id || null;
  } else {
    return NextResponse.json({ error: "Pick a customer or a job" }, { status: 400 });
  }

  const ids = rowsToAssign(o.rows, t.jobId);
  if (ids.length) {
    const { error } = await supabase.from("sms_messages").update({ job_id: jobId, customer_id: customerId }).eq("org_id", orgId).in("id", ids);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const inIds = o.rows.filter((r) => ids.includes(r.id) && r.direction === "in").map((r) => r.id);
    if (inIds.length) {
      await supabase.from("sms_messages").update({ match_status: "linked" }).eq("org_id", orgId).in("id", inIds);
    }
  }

  // Later texts from this number match the customer by phone too.
  if (customerId && !customerPhone && body.customerId) {
    await supabase.from("customers").update({ phone: o.phone }).eq("org_id", orgId).eq("id", customerId);
  }

  // Their photos belong on the job they're about now.
  if (jobId) {
    const urls = o.rows
      .filter((r) => ids.includes(r.id) && r.direction === "in")
      .flatMap((r) => (Array.isArray(r.media) ? r.media.map((m) => m?.url).filter((u): u is string => !!u) : []));
    if (urls.length) {
      try {
        await supabase.rpc("sms_add_job_photos", { p_job: jobId, p_org: orgId, p_urls: urls });
      } catch {
        /* best-effort: the photos are still on the texts */
      }
    }
  }

  return NextResponse.json({ ok: true, jobId, customerId, moved: ids.length });
}
