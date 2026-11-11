import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cronAuth } from "@/lib/cron-auth";
import { smsConfigured } from "@/lib/sms";
import { sendLoggedSms } from "@/lib/sms-log";
import { textRecipient, type RecipientCustomer } from "@/lib/sms-recipient";
import { textBody } from "@/lib/sms-templates";
import { parseSchedTime } from "@/lib/day-plan";
import { ymdInZone } from "@/lib/dates";
import { notifyManagers } from "@/lib/notify-server";

export const dynamic = "force-dynamic";

/**
 * Daily cron (5 PM Central): day-before visit reminders. A second run each
 * morning (`/api/sms/reminders/today` = `?when=today`, 14:00 UTC = 8 AM CST / 9 AM CDT) catches the visits
 * the evening run couldn't: booked after it ran, or moved onto today/tomorrow
 * after their reminder had gone out (Schedule clears `reminder_sent_at` when a
 * visit changes day). It texts "today", and skips a visit whose time has
 * already passed.
 *
 * Opt-in per business (organizations.auto_sms_reminder, Operations → Settings,
 * OFF by default). For each schedule row on TOMORROW (Central time) that is
 * linked to a job and hasn't been reminded, text the right person
 * (lib/sms-recipient: the resident on a property-manager job, else the
 * customer) the day and time. No resident number on a PM job = nothing is
 * sent and the owner gets an in-app alert.
 *
 * Idempotent: each row is claimed (reminder_sent_at set where it was null)
 * BEFORE sending, so a double-fired cron can't text twice. One text per job
 * per day even if it has several rows. Auth: lib/cron-auth.ts. `?dry=1` shows
 * what WOULD go out without sending or stamping anything.
 */
const MAX_PER_RUN = 100;
const SKIP_STATUSES = new Set(["complete", "invoiced", "paid"]);

interface SchedRow { id: number; org_id: string; job_id: string; sched_date: string; note: string | null; created_at?: string | null }
interface JobRow {
  id: string; org_id: string; property: string | null; client: string | null;
  customer_id: string | null; rooms: string | null; status: string | null; archived: boolean | null;
}

async function handle(req: NextRequest): Promise<NextResponse> {
  if (!cronAuth(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const dry = req.nextUrl.searchParams.get("dry") === "1";
  const sameDay = req.nextUrl.searchParams.get("when") === "today";
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  const { data: orgs, error: oErr } = await supabase
    .from("organizations").select("id, name").eq("auto_sms_reminder", true);
  if (oErr) {
    return NextResponse.json({
      error: oErr.message,
      hint: "organizations.auto_sms_reminder is missing — run supabase/migrations/20261109_automatic_texts.sql.",
    }, { status: 500 });
  }
  if (!orgs?.length) return NextResponse.json({ ok: true, orgs: 0, sent: 0 });
  if (!dry && !smsConfigured()) return NextResponse.json({ error: "Twilio settings missing" }, { status: 503 });
  const orgName = new Map<string, string>(orgs.map((o) => [o.id as string, (o.name as string) || ""]));

  // Central time for now (every business on Creed is in Wichita today).
  // `tomorrow` = the visit day this run reminds about (today on the morning run).
  const tomorrow = ymdInZone(Date.now(), sameDay ? 0 : 1);
  const nowHHMM = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Chicago", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
  const { data: rows, error: sErr } = await supabase
    .from("schedule")
    .select("id, org_id, job_id, sched_date, note, created_at")
    .in("org_id", [...orgName.keys()])
    .eq("sched_date", tomorrow)
    .not("job_id", "is", null)
    .is("reminder_sent_at", null)
    .order("id")
    .limit(MAX_PER_RUN);
  if (sErr) {
    return NextResponse.json({
      error: sErr.message,
      hint: "schedule.reminder_sent_at is missing — run supabase/migrations/20261109_automatic_texts.sql.",
    }, { status: 500 });
  }
  const sched = (rows || []) as SchedRow[];
  if (!sched.length) return NextResponse.json({ ok: true, dry, date: tomorrow, due: 0, sent: 0 });

  const jobIds = [...new Set(sched.map((r) => r.job_id))];
  const { data: jobRows } = await supabase
    .from("jobs").select("id, org_id, property, client, customer_id, rooms, status, archived").in("id", jobIds);
  const jobs = new Map<string, JobRow>(((jobRows || []) as JobRow[]).map((j) => [j.id, j]));
  const custIds = [...new Set([...jobs.values()].map((j) => j.customer_id).filter(Boolean) as string[])];
  const { data: custRows } = custIds.length
    ? await supabase.from("customers").select("id, type, name, phone, email").in("id", custIds)
    : { data: [] };
  const customers = new Map<string, RecipientCustomer>(
    ((custRows || []) as (RecipientCustomer & { id: string })[]).map((c) => [c.id, c]),
  );

  const results: { schedule_id: number; job_id: string; via: string; error?: string }[] = [];
  const doneJobs = new Set<string>();

  for (const row of sched) {
    const job = jobs.get(row.job_id);
    if (!job || job.org_id !== row.org_id || job.archived || SKIP_STATUSES.has(job.status || "")) {
      results.push({ schedule_id: row.id, job_id: row.job_id, via: "skipped" });
      continue;
    }
    if (doneJobs.has(job.id)) {
      results.push({ schedule_id: row.id, job_id: job.id, via: "duplicate" });
      continue;
    }
    doneJobs.add(job.id);
    const customer = job.customer_id ? customers.get(job.customer_id) : undefined;
    const to = textRecipient("reminder", job, customer);
    const time = parseSchedTime(row.note);
    // Morning-of run: a visit that has already started needs no reminder,
    // and neither does one booked this same morning (they just agreed to it).
    const bookedToday = !!row.created_at && ymdInZone(Date.parse(row.created_at)) === tomorrow;
    if (sameDay && (bookedToday || (!!time && time.padStart(5, "0") <= nowHHMM))) {
      results.push({ schedule_id: row.id, job_id: job.id, via: "skipped" });
      continue;
    }

    if (dry) {
      results.push({ schedule_id: row.id, job_id: job.id, via: to.ok ? `sms:${to.role}` : "owner", ...(to.ok ? {} : { error: to.reason }) });
      continue;
    }

    const { data: claimed } = await supabase
      .from("schedule")
      .update({ reminder_sent_at: new Date().toISOString() })
      .eq("id", row.id)
      .is("reminder_sent_at", null)
      .select("id");
    if (!claimed?.length) { results.push({ schedule_id: row.id, job_id: job.id, via: "skipped" }); continue; }

    if (!to.ok) {
      await notifyManagers(supabase, {
        orgId: job.org_id,
        jobId: job.id,
        type: "visit_reminder",
        title: "Reminder not sent",
        body: `${sameDay ? "Today" : "Tomorrow"}'s reminder for ${job.property || "a job"} didn't go out. ${to.message}`,
      });
      results.push({ schedule_id: row.id, job_id: job.id, via: "owner", error: to.reason });
      continue;
    }

    const body = textBody("reminder", {
      role: to.role,
      name: to.name,
      business: orgName.get(job.org_id),
      property: job.property,
      time,
      sameDay,
    });
    const r = await sendLoggedSms(supabase, { orgId: job.org_id, jobId: job.id, to: to.phone, body, kind: "reminder", role: to.role });
    results.push({ schedule_id: row.id, job_id: job.id, via: r.ok ? `sms:${to.role}` : "failed", ...(r.ok ? {} : { error: r.error }) });
  }

  return NextResponse.json({
    ok: true,
    dry,
    date: tomorrow,
    due: sched.length,
    sent: results.filter((r) => r.via.startsWith("sms:")).length,
    results,
  });
}

export const GET = handle;
export const POST = handle;
