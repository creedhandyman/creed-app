import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { dispatchNotifications } from "@/lib/notify-server";

export const dynamic = "force-dynamic";

/**
 * In-app notification trigger called from the client. Today it handles the
 * "job assigned to a tech" event (fired from the Jobs detail → Requested
 * tech dropdown). The new-lead event is created server-side inside
 * /api/leads, so it doesn't come through here.
 *
 * Auth follows the app's in-app convention (e.g. /api/portal/send-link):
 * no bearer token — the caller is a logged-in staff member, and every
 * lookup is re-scoped to the org_id the client sends, so a notification
 * can only ever target someone in the same org. Uses the service-role key
 * so the write succeeds regardless of RLS posture.
 *
 * Body: { type:"job_assigned", orgId, jobId, recipientId?, techName?, actorId? }
 *   - recipientId  preferred (the client resolves the tech name → profile id)
 *   - techName     fallback when only the name is known (requested_tech is
 *                  stored as a name); matched against profiles in the org
 *   - actorId      the assigner; suppresses self-notification
 */

interface Body {
  type: "job_assigned";
  orgId: string;
  jobId: string;
  recipientId?: string;
  techName?: string;
  actorId?: string;
}

const trim = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Body;
    const type = trim(body.type);
    const orgId = trim(body.orgId);
    const jobId = trim(body.jobId);
    const recipientId = trim(body.recipientId);
    const techName = trim(body.techName);
    const actorId = trim(body.actorId);

    if (type !== "job_assigned") {
      return NextResponse.json({ error: "Unsupported notification type" }, { status: 400 });
    }
    if (!orgId || !jobId || (!recipientId && !techName)) {
      return NextResponse.json({ error: "Missing orgId, jobId, or recipient" }, { status: 400 });
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );

    // Resolve the recipient profile (scoped to the org), by id when we have
    // it, else by exact name match against requested_tech.
    let q = supabase
      .from("profiles")
      .select("id, name, phone, notify_sms, notify_assigned, org_id")
      .eq("org_id", orgId);
    q = recipientId ? q.eq("id", recipientId) : q.eq("name", techName);
    const { data: profs, error: pErr } = await q.limit(1);
    if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });
    if (!profs?.length) return NextResponse.json({ error: "Tech not found in org" }, { status: 404 });
    const tech = profs[0];

    // Don't notify someone for assigning a job to themselves.
    if (actorId && actorId === tech.id) {
      return NextResponse.json({ ok: true, skipped: "self-assignment" });
    }

    // Job context for the message + org verification.
    const { data: jobs, error: jErr } = await supabase
      .from("jobs")
      .select("id, property, client, org_id")
      .eq("id", jobId)
      .eq("org_id", orgId)
      .limit(1);
    if (jErr) return NextResponse.json({ error: jErr.message }, { status: 500 });
    if (!jobs?.length) return NextResponse.json({ error: "Job not found" }, { status: 404 });
    const job = jobs[0];

    const property = job.property || "a job";
    const origin = req.headers.get("origin") || `https://${req.headers.get("host") || ""}`;

    const result = await dispatchNotifications(supabase, {
      orgId,
      type: "job_assigned",
      title: "New job assigned",
      body: job.client ? `${property} · ${job.client}` : property,
      jobId,
      smsBody: `New job assigned: ${property}${job.client ? ` (${job.client})` : ""}.${origin ? ` ${origin}` : ""}`,
      recipients: [{
        id: tech.id,
        phone: tech.phone,
        notify_sms: tech.notify_sms,
        eventOptIn: tech.notify_assigned,
      }],
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    // eslint-disable-next-line no-console
    console.error("notify error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
