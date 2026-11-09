import { NextRequest, NextResponse } from "next/server";
import { requireOwner, serviceClient } from "@/lib/api-auth";
import { tryReadBlob } from "@/lib/job-blob";
import { sendEmail } from "@/lib/email";
import { fmt12, fmtDay, googleCalendarUrl, readBookingSettings } from "@/lib/booking";

export const dynamic = "force-dynamic";

/**
 * Owner/manager answers an online booking request (the schedule row with
 * booking_status "requested" that /api/public/booking wrote).
 *
 *   confirm → the row becomes an ordinary confirmed visit on the Schedule and
 *             the customer gets a confirmation email with a calendar link.
 *   decline → the hold is removed so the time opens up again. The lead stays
 *             in Jobs so the owner can still quote or call them.
 *
 * Either way the job stays a LEAD — quoting it is the owner's next step.
 * Body: { scheduleId, action: "confirm" | "decline" }.
 */
export async function POST(req: NextRequest) {
  const auth = await requireOwner(req);
  if (auth instanceof NextResponse) return auth;
  const orgId = auth.orgId as string;

  const body = (await req.json().catch(() => ({}))) as { scheduleId?: unknown; action?: unknown };
  const scheduleId = typeof body.scheduleId === "string" || typeof body.scheduleId === "number" ? String(body.scheduleId) : "";
  const action = body.action === "confirm" || body.action === "decline" ? body.action : null;
  if (!scheduleId || !action) return NextResponse.json({ error: "Missing scheduleId or action" }, { status: 400 });

  const supabase = serviceClient();
  const { data: row, error } = await supabase.from("schedule")
    .select("id, org_id, sched_date, start_time, duration_min, job, job_id, note, booking_status")
    .eq("id", scheduleId).eq("org_id", orgId).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!row) return NextResponse.json({ error: "That booking request is gone." }, { status: 404 });
  if (row.booking_status !== "requested") {
    return NextResponse.json({ error: "That booking was already answered." }, { status: 409 });
  }

  if (action === "confirm") {
    const note = String(row.note || "").replace("⏳ Online booking request", "✅ Booked online");
    const { error: upErr } = await supabase.from("schedule")
      .update({ booking_status: "confirmed", note })
      .eq("id", row.id).eq("booking_status", "requested");
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
  } else {
    const { error: delErr } = await supabase.from("schedule")
      .delete().eq("id", row.id).eq("booking_status", "requested");
    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });
  }

  // Record the answer on the lead (merged onto the server's current blob).
  let customerEmail = "";
  let client = "";
  if (row.job_id) {
    const { data: job } = await supabase.from("jobs")
      .select("id, rooms, client, customer_id").eq("id", row.job_id).eq("org_id", orgId).maybeSingle();
    if (job) {
      client = String(job.client || "");
      const blob = tryReadBlob(job.rooms) || {};
      const prev = (blob.booking && typeof blob.booking === "object") ? blob.booking : {};
      blob.booking = { ...prev, status: action === "confirm" ? "confirmed" : "declined", answeredAt: new Date().toISOString() };
      await supabase.from("jobs").update({ rooms: JSON.stringify(blob) }).eq("id", job.id);
      if (job.customer_id) {
        const { data: c } = await supabase.from("customers").select("email").eq("id", job.customer_id).maybeSingle();
        customerEmail = String(c?.email || "");
      }
    }
  }

  // Confirmation email with an add-to-calendar link. Best-effort. A decline
  // sends nothing automatically — the owner calls or texts them personally.
  let emailed = false;
  if (action === "confirm" && customerEmail && row.start_time) {
    const { data: org } = await supabase.from("organizations")
      .select("name, phone, booking_tz, booking_slot_min").eq("id", orgId).maybeSingle();
    const s = readBookingSettings(org as Record<string, unknown> | null);
    const name = String(org?.name || "");
    const date = String(row.sched_date).slice(0, 10);
    const when = `${fmtDay(date)} at ${fmt12(row.start_time)}`;
    const cal = googleCalendarUrl({
      title: `${name} visit`,
      date,
      start: row.start_time,
      durationMin: row.duration_min || s.slotMin,
      tz: s.tz,
      location: String(row.job || ""),
    });
    const r = await sendEmail(
      customerEmail,
      `${name}: you're booked for ${when}`,
      [
        `Hi ${client.split(" ")[0] || "there"},`,
        "",
        `You're confirmed for ${when} at ${row.job}.`,
        `Add it to your calendar: ${cal}`,
        org?.phone ? `Need to change it? Call ${org.phone}.` : "",
        "",
        name,
      ].filter((l, i, a) => l !== "" || a[i - 1] !== "").join("\n"),
    );
    emailed = r.ok;
    if (!r.ok) console.log(`[booking] confirmation email not sent: ${r.error}`);
  }
  // HOOK(texting): send the customer a confirmation text here once the
  // automatic Twilio texts land (only with recorded text consent).

  return NextResponse.json({ ok: true, action, emailed });
}
