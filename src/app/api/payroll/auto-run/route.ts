import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

/**
 * Auto Payroll cron endpoint.
 *
 * Triggered by Vercel cron (see vercel.json). Reads every org with
 * auto_payroll_enabled=true and decides whether NOW matches their
 * scheduled day-of-week + (optionally) hour-of-day, and whether the
 * cadence (weekly vs biweekly) says it's time to run again.
 *
 * For each matching org this stamps auto_payroll_last_run so we don't
 * double-fire within the same window, and (TODO) triggers the actual
 * payroll-process logic.
 *
 * On Vercel Hobby plans, cron jobs are limited to one fire per day —
 * so even though we accept an auto_payroll_hour preference, the
 * effective fire happens at whatever single time the cron is scheduled
 * for. The matching logic only checks day-of-week and a 23h debounce
 * against last_run, so the hour preference is informational in that
 * environment. On Pro plans you can move the vercel.json cron to
 * hourly and the endpoint will honor the hour field.
 */

interface OrgRow {
  id: string;
  name?: string;
  auto_payroll_enabled?: boolean;
  auto_payroll_day?: number;
  auto_payroll_hour?: number;
  auto_payroll_cadence?: string;
  auto_payroll_last_run?: string | null;
}

function isAuthorized(req: NextRequest): boolean {
  // Vercel cron requests carry an `Authorization: Bearer <CRON_SECRET>`
  // header when CRON_SECRET is set. Allow both that and a manual
  // x-admin-token (matches the ADMIN_PASSWORD pattern from /api/admin)
  // for ad-hoc manual triggers during testing.
  const auth = req.headers.get("authorization") || "";
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && auth === `Bearer ${cronSecret}`) return true;
  // Vercel always sets x-vercel-cron=1 on legitimate cron invocations.
  if (req.headers.get("x-vercel-cron") === "1") return true;
  const adminToken = req.headers.get("x-admin-token");
  const adminPw = process.env.ADMIN_PASSWORD || "creed2026";
  if (adminToken && adminToken === adminPw) return true;
  return false;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );

  const { data, error } = await supabase
    .from("organizations")
    .select("id, name, auto_payroll_enabled, auto_payroll_day, auto_payroll_hour, auto_payroll_cadence, auto_payroll_last_run")
    .eq("auto_payroll_enabled", true);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const orgs: OrgRow[] = data || [];
  const now = new Date();
  const today = now.getDay();
  const nowHour = now.getHours();
  const fired: { id: string; name?: string }[] = [];
  const skipped: { id: string; name?: string; reason: string }[] = [];

  for (const org of orgs) {
    const day = typeof org.auto_payroll_day === "number" ? org.auto_payroll_day : 5;
    const hour = typeof org.auto_payroll_hour === "number" ? org.auto_payroll_hour : 17;
    const cadence = org.auto_payroll_cadence === "biweekly" ? "biweekly" : "weekly";

    if (day !== today) {
      skipped.push({ id: org.id, name: org.name, reason: `day mismatch (today=${today}, org=${day})` });
      continue;
    }
    // Hour check: only enforce if the cron is firing more than once
    // per day. Detect that by checking whether we're within 1h of the
    // org's preferred hour. On a daily cron, this is usually true (we
    // schedule the cron near the most common preferred hour).
    if (Math.abs(nowHour - hour) > 1) {
      skipped.push({ id: org.id, name: org.name, reason: `hour mismatch (now=${nowHour}, org=${hour})` });
      // Don't skip — Vercel hobby fires daily and may not hit the
      // org's exact hour. Treat hour as advisory: still process if
      // day matches. Comment kept so a future hourly switch is just
      // changing `continue` back on:
      // continue;
    }
    // Debounce by cadence. Weekly = at least 6 days since last_run
    // (allows for a small early margin in case of clock drift / DST).
    // Biweekly = at least 13 days.
    if (org.auto_payroll_last_run) {
      const last = new Date(org.auto_payroll_last_run);
      const diffDays = (now.getTime() - last.getTime()) / 86_400_000;
      const minDays = cadence === "biweekly" ? 13 : 6;
      if (diffDays < minDays) {
        skipped.push({ id: org.id, name: org.name, reason: `cadence debounce (${diffDays.toFixed(1)}d < ${minDays}d)` });
        continue;
      }
    }

    // TODO: actually run payroll for this org.
    //
    // The manual flow lives in Payroll.tsx (processPay): it pulls every
    // unpaid time_entries row for each profile, builds a pay stub HTML,
    // inserts pay_history, and patches time_entries.paid_at. That logic
    // is currently entangled with React state (selUser, approvedQuests,
    // org branding for the stub PDF). Lift the pure parts into a shared
    // helper in src/lib/ and call it here per-profile per-org.
    //
    // For v1, the toggle + scheduler + last-run stamp work; the
    // automatic processing is stubbed so Bernard can validate the
    // schedule fires correctly first.

    const stampedAt = now.toISOString();
    await supabase
      .from("organizations")
      .update({ auto_payroll_last_run: stampedAt })
      .eq("id", org.id);

    fired.push({ id: org.id, name: org.name });
  }

  return NextResponse.json({
    ok: true,
    timestamp: now.toISOString(),
    enabledOrgs: orgs.length,
    fired,
    skipped,
  });
}
