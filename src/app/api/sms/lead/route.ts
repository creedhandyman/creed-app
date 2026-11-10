import { NextRequest, NextResponse } from "next/server";
import { getAuthedProfile, serviceClient } from "@/lib/api-auth";
import { prettyPhone } from "@/lib/sms-inbound";
import { summarizeThreads } from "@/lib/sms-threads";
import { openThread } from "@/lib/sms-threads-server";

export const dynamic = "force-dynamic";

/**
 * POST /api/sms/lead { phone, name? }: the Texts screen's Make a lead button
 * on a conversation with a number Creed doesn't know (Bernard, 2026-11-10).
 * Owners/managers only. Creates a customer with that phone and a "lead" job
 * whose description is what they texted (photos included), then puts the
 * conversation's texts on that job and customer, so later texts from the
 * number match it.
 */
export async function POST(req: NextRequest) {
  let body: { phone?: unknown; name?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  const supabase = serviceClient();
  const o = await openThread(supabase, await getAuthedProfile(req), body.phone);
  if (!o.ok) return NextResponse.json({ error: o.error }, { status: o.status });
  if (!o.viewer.admin) return NextResponse.json({ error: "Only owners and managers can make leads" }, { status: 403 });

  const [t] = summarizeThreads(o.rows);
  if (t.customerId || t.jobId) {
    return NextResponse.json({ error: "This number is already on a job or customer" }, { status: 409 });
  }
  const name = (typeof body.name === "string" ? body.name.trim() : "").slice(0, 80) || prettyPhone(o.phone);
  const received = o.rows.filter((r) => r.direction === "in" && r.kind !== "stop" && r.kind !== "start" && r.kind !== "help");
  const oldestFirst = [...received].reverse();
  const description = oldestFirst.map((r) => (r.body || "").trim()).filter(Boolean).join("\n").slice(0, 2000);
  const photos = oldestFirst.flatMap((r) => (Array.isArray(r.media) ? r.media.map((m) => m?.url).filter(Boolean) : [])).slice(0, 10);

  const { data: cust, error: cErr } = await supabase
    .from("customers")
    .insert({ org_id: o.viewer.orgId, name, type: "individual", phone: o.phone })
    .select("id")
    .single();
  if (cErr || !cust) return NextResponse.json({ error: cErr?.message || "Couldn't save the customer" }, { status: 500 });

  const { data: job, error: jErr } = await supabase
    .from("jobs")
    .insert({
      org_id: o.viewer.orgId,
      property: "(address pending)",
      client: name,
      customer_id: cust.id,
      job_date: new Date().toISOString().split("T")[0],
      rooms: JSON.stringify({ leadDescription: description || "Texted the business number", leadPhotos: photos }),
      total: 0,
      total_labor: 0,
      total_mat: 0,
      total_hrs: 0,
      status: "lead",
      created_by: "Texts",
    })
    .select("id")
    .single();
  if (jErr || !job) return NextResponse.json({ error: jErr?.message || "Couldn't save the lead" }, { status: 500 });

  await supabase
    .from("sms_messages")
    .update({ job_id: job.id, customer_id: cust.id })
    .eq("org_id", o.viewer.orgId)
    .eq("contact_phone", o.phone)
    .is("job_id", null);

  return NextResponse.json({ ok: true, jobId: job.id, customerId: cust.id, name });
}
