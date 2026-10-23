import { NextRequest, NextResponse } from "next/server";
import { serviceClient } from "@/lib/api-auth";
import { buildCalendar, type FeedJob, type FeedRow } from "@/lib/calendar-feed";
import { siteOrigin } from "@/lib/site-url";

export const dynamic = "force-dynamic";

/**
 * The phone-calendar subscription itself: GET /api/calendar/feed/<token>.ics.
 * No login (Google / Apple fetch it on their own every few hours) — the
 * random token from /api/calendar/link is the credential. Serves the visits
 * from 30 days back to 6 months ahead: the person's own visits ("mine": the
 * schedule note's crew list or the job's requested tech), or everyone's
 * ("team", owner/manager links). A reset token or a person who left the
 * business stops working.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ file: string }> }) {
  const { file } = await ctx.params;
  const token = (file || "").replace(/\.ics$/i, "");
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return new NextResponse("Not found", { status: 404 });
  const supabase = serviceClient();
  const { data: feed } = await supabase.from("calendar_feeds").select("user_id, org_id, scope").eq("token", token).maybeSingle();
  if (!feed) return new NextResponse("Not found", { status: 404 });
  const { data: prof } = await supabase.from("profiles").select("name, org_id, role, status").eq("id", feed.user_id).maybeSingle();
  if (!prof || prof.org_id !== feed.org_id || prof.status === "pending") return new NextResponse("Not found", { status: 404 });
  const team = feed.scope === "team" && (prof.role === "owner" || prof.role === "manager");

  const day = (n: number) => { const d = new Date(Date.now() + n * 86400000); return d.toISOString().slice(0, 10); };
  // A visit that started before the window but runs into it still counts.
  const { data: rows } = await supabase.from("schedule")
    .select("id, job, job_id, sched_date, end_date, note")
    .eq("org_id", feed.org_id).gte("sched_date", day(-60)).lte("sched_date", day(183));
  const recent = ((rows || []) as FeedRow[]).filter((r) => (r.end_date || r.sched_date) >= day(-30));
  const jobIds = [...new Set(recent.map((r) => r.job_id).filter(Boolean))] as string[];
  let jobs: FeedJob[] = [];
  if (jobIds.length) {
    const { data } = await supabase.from("jobs").select("id, client, requested_tech, total_hrs, trade, archived")
      .eq("org_id", feed.org_id).in("id", jobIds);
    jobs = (data || []) as FeedJob[];
  }
  const { data: org } = await supabase.from("organizations").select("name").eq("id", feed.org_id).maybeSingle();
  const biz = org?.name || "Creed";
  const ics = buildCalendar(recent, jobs, {
    name: team ? `${biz} — crew schedule` : `${biz} — my jobs`,
    forName: team ? null : prof.name || "",
    appUrl: siteOrigin(),
  });
  // Best-effort "last synced" stamp.
  try { await supabase.from("calendar_feeds").update({ last_fetched_at: new Date().toISOString() }).eq("token", token); } catch { /* */ }
  return new NextResponse(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `inline; filename="schedule.ics"`,
      "Cache-Control": "private, max-age=900",
    },
  });
}
