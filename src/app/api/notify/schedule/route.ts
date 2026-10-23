import { NextRequest, NextResponse } from "next/server";
import { dispatchNotifications } from "@/lib/notify-server";
import { getAuthedProfile, serviceClient } from "@/lib/api-auth";
import { messagesFor, type Notice, type NoticeKind } from "@/lib/schedule-notify";

export const dynamic = "force-dynamic";

/**
 * Schedule → crew alerts. The client posts the notices for a schedule write
 * (lib/schedule-notify scheduleNotices: booked / changed / taken off); here
 * crew NAMES are resolved to active profiles in the caller's org (names are
 * how the schedule note stores crew), the person who made the change is
 * skipped, and each person gets their notices as in-app (+ SMS / push when
 * those channels are on) — 3+ in one batch collapse into one summary.
 * Respects the "assigned to me" preference (notify_assigned).
 *
 * Body: { notices: Notice[] }  (text is written server-side, never taken
 * from the body)
 */
const KINDS: NoticeKind[] = ["scheduled", "changed", "removed"];
const str = (v: unknown, max = 300) => (typeof v === "string" ? v.slice(0, max) : "");
const ymd = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const snap = (v: any) => v && ymd(v.date) ? {
  job: str(v.job, 200),
  jobId: str(v.jobId, 64) || null,
  date: ymd(v.date),
  end: ymd(v.end) || null,
  time: /^\d{1,2}:\d{2}$/.test(str(v.time, 5)) ? str(v.time, 5) : "",
  crew: [],
} : null;

export async function POST(req: NextRequest) {
  try {
    const prof = await getAuthedProfile(req);
    if (!prof || !prof.orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const orgId = prof.orgId;
    const raw = (await req.json())?.notices;
    if (!Array.isArray(raw)) return NextResponse.json({ error: "notices required" }, { status: 400 });

    const notices: Notice[] = [];
    for (const n of raw.slice(0, 300)) {
      const visit = snap(n?.visit);
      const name = str(n?.name, 120).trim();
      if (!visit || !name || !KINDS.includes(n?.kind)) continue;
      notices.push({ name, kind: n.kind, visit, prev: snap(n?.prev) || undefined });
    }
    if (!notices.length) return NextResponse.json({ ok: true, sent: 0 });

    const supabase = serviceClient();
    const { data: profs, error } = await supabase
      .from("profiles")
      .select("id, name, phone, notify_sms, notify_assigned, status")
      .eq("org_id", orgId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const byName = new Map<string, NonNullable<typeof profs>[number]>();
    for (const p of profs || []) {
      if (p.status === "pending" || !p.name) continue;
      byName.set(String(p.name).trim().toLowerCase(), p);
    }

    // Deep links only to this org's jobs.
    const jobIds = [...new Set(notices.map((n) => n.visit.jobId).filter(Boolean))] as string[];
    const okJobs = new Set<string>();
    if (jobIds.length) {
      const { data } = await supabase.from("jobs").select("id").eq("org_id", orgId).in("id", jobIds);
      for (const j of data || []) okJobs.add(j.id);
    }

    const perPerson = new Map<string, Notice[]>();
    for (const n of notices) {
      const p = byName.get(n.name.toLowerCase());
      if (!p || p.id === prof.userId) continue; // unknown name (a sub) / yourself
      if (!perPerson.has(p.id)) perPerson.set(p.id, []);
      perPerson.get(p.id)!.push(n);
    }

    let sent = 0;
    for (const [id, list] of perPerson) {
      const p = (profs || []).find((x) => x.id === id)!;
      for (const m of messagesFor(list)) {
        const r = await dispatchNotifications(supabase, {
          orgId,
          type: "job_scheduled",
          title: m.title,
          body: m.body,
          jobId: m.jobId && okJobs.has(m.jobId) ? m.jobId : null,
          smsBody: `${m.title}: ${m.body}`,
          recipients: [{ id, phone: p.phone, notify_sms: p.notify_sms, eventOptIn: p.notify_assigned }],
        });
        sent += r.created;
      }
    }
    return NextResponse.json({ ok: true, sent });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    // eslint-disable-next-line no-console
    console.error("notify/schedule error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
