import { NextRequest, NextResponse } from "next/server";
import { serviceClient } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

/**
 * Server-to-server endpoint for the AppFolio work-order agent (Cowork).
 * Not a browser route — authenticated with a shared secret
 * (APPFOLIO_AGENT_SECRET bearer token), the same shape CRON_SECRET uses
 * for other server-to-server calls in this app (see lib/api-auth.ts).
 * org_id is pinned server-side via APPFOLIO_AGENT_ORG_ID rather than
 * accepted from the caller, so a bad request can't misfile a job into
 * the wrong org.
 *
 * GET  -> upcoming jobs + schedule entries, so the agent can propose a
 *         slot from Bernard's real job density and the same street-
 *         proximity signal Schedule.tsx's suggestDay() already uses,
 *         instead of a separately-maintained set of availability rules.
 *
 * POST -> called only after Bernard has confirmed a date/time in chat.
 *         Inserts ONE Job (status "scheduled") + ONE matching Schedule
 *         entry. The two are linked by the `property` string matching
 *         EXACTLY — the same convention Schedule.tsx's quickAdd() relies
 *         on (see CLAUDE.md) — and the schedule note is built with the
 *         🕐 marker the UI parses back out for its time chip. Idempotent
 *         on the AppFolio work-order number: re-running the agent (or a
 *         retried call) on the same WO returns 409 instead of double-
 *         booking.
 */

function authorized(req: NextRequest): boolean {
  const auth = req.headers.get("authorization") || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  const token = m ? m[1].trim() : null;
  const secret = process.env.APPFOLIO_AGENT_SECRET;
  return !!secret && !!token && token === secret;
}

function requireOrgId(): string | NextResponse {
  const orgId = process.env.APPFOLIO_AGENT_ORG_ID;
  if (!orgId) {
    return NextResponse.json(
      { error: "APPFOLIO_AGENT_ORG_ID is not configured on the server" },
      { status: 500 },
    );
  }
  return orgId;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = requireOrgId();
  if (orgId instanceof NextResponse) return orgId;

  const supabase = serviceClient();
  const today = new Date().toISOString().split("T")[0];

  const [{ data: schedule, error: schedErr }, { data: jobs, error: jobsErr }] = await Promise.all([
    supabase
      .from("schedule")
      .select("id, sched_date, end_date, job, note")
      .eq("org_id", orgId)
      .gte("sched_date", today)
      .order("sched_date", { ascending: true }),
    supabase
      .from("jobs")
      .select("id, property, client, job_date, status, trade")
      .eq("org_id", orgId)
      .in("status", ["scheduled", "active"])
      .gte("job_date", today),
  ]);

  if (schedErr) return NextResponse.json({ error: schedErr.message }, { status: 500 });
  if (jobsErr) return NextResponse.json({ error: jobsErr.message }, { status: 500 });

  return NextResponse.json({ schedule: schedule || [], jobs: jobs || [] });
}

interface ImportBody {
  property: string; // job site address — becomes jobs.property AND schedule.job
  client: string; // e.g. "Keyrenter Wichita"
  trade?: string; // mapped from the AppFolio issue category; defaults to "General"
  schedDate: string; // YYYY-MM-DD, already confirmed with Bernard in chat
  schedTime?: string; // e.g. "10:30am"
  endDate?: string; // for multi-day jobs
  workOrder: {
    number: string;
    status?: string;
    tenantName?: string;
    tenantPhone?: string;
    tenantEmail?: string;
    maintenanceLimit?: string;
    description?: string;
    issueDetails?: Record<string, string>;
    propertyNotes?: string;
    flags?: { type: string; reason: string }[];
    pre1978?: boolean;
  };
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = requireOrgId();
  if (orgId instanceof NextResponse) return orgId;

  let body: ImportBody;
  try {
    body = (await req.json()) as ImportBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const property = (body.property || "").trim();
  const client = (body.client || "").trim();
  const schedDate = (body.schedDate || "").trim();
  const woNumber = (body.workOrder?.number || "").trim();
  if (!property || !client || !schedDate || !woNumber) {
    return NextResponse.json(
      { error: "property, client, schedDate, and workOrder.number are required" },
      { status: 400 },
    );
  }

  const supabase = serviceClient();

  // Idempotency: an AppFolio WO# is unique per work order, so key on it
  // (parsed back out of `rooms`, same JSON.parse pattern jobs/approve
  // already uses — `rooms` is stored as a stringified JSON blob, not a
  // native jsonb column, so this can't be a DB-side contains() query).
  const { data: candidates, error: existErr } = await supabase
    .from("jobs")
    .select("id, rooms")
    .eq("org_id", orgId)
    .eq("property", property);
  if (existErr) return NextResponse.json({ error: existErr.message }, { status: 500 });
  const dup = (candidates || []).find((j) => {
    try {
      const blob = typeof j.rooms === "string" ? JSON.parse(j.rooms) : j.rooms;
      return blob?.appfolioWorkOrderNumber === woNumber;
    } catch {
      return false;
    }
  });
  if (dup) {
    return NextResponse.json({ error: "Already imported", jobId: dup.id }, { status: 409 });
  }

  const roomsBlob = JSON.stringify({
    leadSource: "appfolio",
    appfolioWorkOrderNumber: woNumber,
    appfolioStatus: body.workOrder.status || null,
    tenantName: body.workOrder.tenantName || null,
    tenantPhone: body.workOrder.tenantPhone || null,
    tenantEmail: body.workOrder.tenantEmail || null,
    maintenanceLimit: body.workOrder.maintenanceLimit || null,
    pre1978: !!body.workOrder.pre1978,
    leadDescription: body.workOrder.description || "",
    issueDetails: body.workOrder.issueDetails || {},
    propertyNotes: body.workOrder.propertyNotes || null,
    flags: body.workOrder.flags || [],
  });

  const { data: jobRows, error: jobErr } = await supabase
    .from("jobs")
    .insert({
      org_id: orgId,
      property,
      client,
      job_date: schedDate,
      rooms: roomsBlob,
      total: 0,
      total_labor: 0,
      total_mat: 0,
      total_hrs: 0,
      status: "scheduled",
      trade: body.trade || "General",
      created_by: "AppFolio agent",
    })
    .select("id")
    .limit(1);
  if (jobErr) return NextResponse.json({ error: jobErr.message }, { status: 500 });
  const jobId = jobRows?.[0]?.id;

  const noteParts: string[] = [];
  if (body.schedTime) noteParts.push(`🕐 ${body.schedTime.trim()}`);
  noteParts.push(`AppFolio WO #${woNumber}`);
  const note = noteParts.join(" · ");

  const schedPayload: Record<string, unknown> = {
    org_id: orgId,
    sched_date: schedDate,
    job: property,
    note,
  };
  if (body.endDate && body.endDate > schedDate) schedPayload.end_date = body.endDate;

  const { error: schedInsertErr } = await supabase.from("schedule").insert(schedPayload);
  if (schedInsertErr) {
    // The job now exists even though the schedule entry didn't — surface
    // both pieces of state rather than silently losing track of the job.
    // (A blind retry won't double-book: the WO# check above would now
    // catch it as a dup and report jobId — the caller still needs to
    // manually add the schedule entry, or delete the job and retry clean.)
    return NextResponse.json(
      { error: `Job created but schedule entry failed: ${schedInsertErr.message}`, jobId },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, jobId });
}
