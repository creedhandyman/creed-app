import { NextRequest, NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { runPayrollForUser, type RunPayrollResult } from "@/lib/payroll-runner";

export const dynamic = "force-dynamic";

/**
 * Auto Payroll cron endpoint.
 *
 * Triggered by Vercel cron (see vercel.json). Reads every org with
 * auto_payroll_enabled=true and decides whether NOW matches their
 * scheduled day-of-week + (optionally) hour-of-day, and whether the
 * cadence (weekly vs biweekly) says it's time to run again.
 *
 * For each matching org, iterates through every profile with rate > 0
 * and calls runPayrollForUser (src/lib/payroll-runner.ts) — the same
 * helper the manual "Run Payroll" button uses. Quest bonuses are NOT
 * auto-approved: the cron passes approvedBonuses=[] so pending quests
 * stay pending until a human reviews them. Only the base hours roll
 * up automatically. auto_payroll_last_run is stamped only if at least
 * one user actually got paid, so a day-match with zero unpaid hours
 * doesn't burn the cadence window.
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
  phone?: string;
  email?: string;
  address?: string;
  license_num?: string;
  logo_url?: string;
  auto_payroll_enabled?: boolean;
  auto_payroll_day?: number;
  auto_payroll_hour?: number;
  auto_payroll_cadence?: string;
  auto_payroll_last_run?: string | null;
}

interface ProfileRow {
  id: string;
  name: string;
  rate: number;
  emp_num?: string | null;
}

interface UserResult {
  userId: string;
  userName: string;
  totalHrs: number;
  totalPay: number;
  entriesPaid: number;
  payHistoryId?: string;
}

interface UserSkip {
  userId: string;
  userName: string;
  reason: string;
}

interface FiredOrg {
  id: string;
  name?: string;
  paid: UserResult[];
  skipped: UserSkip[];
  errors: { userId: string; userName: string; error: string }[];
  stamped: boolean;
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
  const adminPw = process.env.ADMIN_PASSWORD;
  if (adminPw && adminToken && adminToken === adminPw) return true;
  return false;
}

/**
 * Owner/manager session auth — lets the in-app "Run now" test button in
 * the Auto Payroll panel trigger this endpoint with the logged-in user's
 * Supabase JWT (`Authorization: Bearer <access_token>`) instead of the
 * cron secret / admin token. We validate the JWT and confirm the caller
 * is an owner or manager before allowing the run.
 */
async function isOwnerSession(
  req: NextRequest,
  supabase: SupabaseClient,
): Promise<boolean> {
  const auth = req.headers.get("authorization") || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return false;
  const token = m[1].trim();
  if (!token || token === process.env.CRON_SECRET) return false;
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return false;
  const { data: prof } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", data.user.id)
    .maybeSingle();
  const role = (prof as { role?: string } | null)?.role;
  return role === "owner" || role === "manager";
}

export async function GET(req: NextRequest) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );

  if (!isAuthorized(req) && !(await isOwnerSession(req, supabase))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("organizations")
    .select("id, name, phone, email, address, license_num, logo_url, auto_payroll_enabled, auto_payroll_day, auto_payroll_hour, auto_payroll_cadence, auto_payroll_last_run")
    .eq("auto_payroll_enabled", true);

  if (error) {
    // Most common real-world cause: the auto_payroll_* columns were never
    // added in Supabase, so this SELECT errors. Surface a concrete hint
    // instead of a raw Postgres message.
    const missingCols = /does not exist|auto_payroll/i.test(error.message);
    return NextResponse.json(
      {
        error: error.message,
        hint: missingCols
          ? "The auto_payroll_* columns may be missing on the organizations table — run the Auto Payroll migration from CLAUDE.md in Supabase."
          : undefined,
      },
      { status: 500 },
    );
  }

  const orgs: OrgRow[] = data || [];
  const now = new Date();
  const today = now.getDay();
  const nowHour = now.getHours();
  // `force=1` bypasses the day-of-week and cadence-debounce skips so an
  // owner can validate auto-payroll on demand without waiting for the
  // scheduled day. Same pattern /api/recurring/fire uses. Requires the
  // same auth as the cron itself (Vercel cron header, CRON_SECRET, or
  // x-admin-token), gated by isAuthorized() above.
  const force = new URL(req.url).searchParams.get("force") === "1";
  const fired: FiredOrg[] = [];
  // Skip payload now carries the org's actual config + last_run so a
  // ?force=0 hit lets the owner see "is my config what I think it is?"
  // and "when did it last actually fire?" without digging through DB.
  type SkipRow = {
    id: string;
    name?: string;
    reason: string;
    config: { day: number; hour: number; cadence: string; last_run: string | null };
  };
  const skipped: SkipRow[] = [];

  for (const org of orgs) {
    const day = typeof org.auto_payroll_day === "number" ? org.auto_payroll_day : 5;
    const hour = typeof org.auto_payroll_hour === "number" ? org.auto_payroll_hour : 17;
    const cadence = org.auto_payroll_cadence === "biweekly" ? "biweekly" : "weekly";
    const cfg = { day, hour, cadence, last_run: org.auto_payroll_last_run ?? null };

    if (!force && day !== today) {
      skipped.push({ id: org.id, name: org.name, reason: `day mismatch (today=${today}, org=${day})`, config: cfg });
      continue;
    }
    // Hour check: only enforce if the cron is firing more than once
    // per day. Detect that by checking whether we're within 1h of the
    // org's preferred hour. On a daily cron, this is usually true (we
    // schedule the cron near the most common preferred hour).
    if (Math.abs(nowHour - hour) > 1) {
      // Don't skip — Vercel hobby fires daily and may not hit the
      // org's exact hour. Treat hour as advisory: still process if
      // day matches. Comment kept so a future hourly switch is just
      // changing `continue` back on:
      // continue;
    }
    // Debounce by cadence. Weekly = at least 6 days since last_run
    // (allows for a small early margin in case of clock drift / DST).
    // Biweekly = at least 13 days.
    if (!force && org.auto_payroll_last_run) {
      const last = new Date(org.auto_payroll_last_run);
      const diffDays = (now.getTime() - last.getTime()) / 86_400_000;
      const minDays = cadence === "biweekly" ? 13 : 6;
      if (diffDays < minDays) {
        skipped.push({ id: org.id, name: org.name, reason: `cadence debounce (${diffDays.toFixed(1)}d < ${minDays}d)`, config: cfg });
        continue;
      }
    }

    // Fetch this org's whole team. We pull EVERYONE (not just rate>0) so a
    // crew member without a pay rate is reported as an explicit skip
    // ("no pay rate set") rather than silently vanishing — the #1 reason
    // an owner sees "auto payroll never paid my crew". Only rate>0
    // profiles actually get paid; we never auto-pay a fabricated rate.
    const { data: profileRows, error: profErr } = await supabase
      .from("profiles")
      .select("id, name, rate, emp_num")
      .eq("org_id", org.id);

    if (profErr) {
      skipped.push({ id: org.id, name: org.name, reason: `profile query failed: ${profErr.message}`, config: cfg });
      continue;
    }

    const allProfiles: ProfileRow[] = profileRows || [];
    const profiles: ProfileRow[] = allProfiles.filter((p) => Number(p.rate) > 0);
    const paid: UserResult[] = [];
    const userSkipped: UserSkip[] = [];
    const userErrors: FiredOrg["errors"] = [];

    // Surface rate-less crew so the owner knows exactly who to fix in Team.
    for (const p of allProfiles) {
      if (!(Number(p.rate) > 0)) {
        userSkipped.push({ userId: p.id, userName: p.name, reason: "no pay rate set (set it in Team)" });
      }
    }

    // Use ONE paidAt for the whole batch so every entry in this run
    // shares a timestamp — easier to audit / rollback as a group.
    const paidAt = now.toISOString();

    for (const p of profiles) {
      let result: RunPayrollResult;
      try {
        result = await runPayrollForUser({
          supabase,
          orgId: org.id,
          userId: p.id,
          userName: p.name,
          rate: p.rate,
          empNum: p.emp_num || undefined,
          paidAt,
          // Auto-run NEVER auto-approves quest bonuses. Pending quests
          // stay pending in the Payroll UI until a human reviews them.
          approvedBonuses: [],
          org: {
            name: org.name,
            phone: org.phone,
            email: org.email,
            address: org.address,
            license_num: org.license_num,
            logo_url: org.logo_url,
          },
          // Cron-side: name-fallback off. Two profiles with the same
          // display name could otherwise steal each other's nameless
          // legacy entries. Manual flow opts in for its own self-view.
          includeLegacyNameMatch: false,
        });
      } catch (e) {
        userErrors.push({
          userId: p.id,
          userName: p.name,
          error: e instanceof Error ? e.message : String(e),
        });
        continue;
      }

      if (!result.ok) {
        userErrors.push({
          userId: p.id,
          userName: p.name,
          error: result.error || "unknown error",
        });
      } else if (result.skipped) {
        userSkipped.push({
          userId: p.id,
          userName: p.name,
          reason: result.reason || "skipped",
        });
      } else {
        paid.push({
          userId: p.id,
          userName: p.name,
          totalHrs: result.totalHrs,
          totalPay: result.totalPay,
          entriesPaid: result.entriesPaid,
          payHistoryId: result.payHistoryId,
        });
      }
    }

    // Stamp last_run only when somebody actually got paid. Otherwise
    // an org with zero unpaid hours would burn its cadence window on
    // a no-op fire and have to wait another full cycle.
    let stamped = false;
    if (paid.length > 0) {
      const stampRes = await supabase
        .from("organizations")
        .update({ auto_payroll_last_run: paidAt })
        .eq("id", org.id);
      stamped = !stampRes.error;
    }

    fired.push({
      id: org.id,
      name: org.name,
      paid,
      skipped: userSkipped,
      errors: userErrors,
      stamped,
    });
  }

  return NextResponse.json({
    ok: true,
    timestamp: now.toISOString(),
    force,
    today,
    // Diagnostic: false means the cron is on the anon key (service-role
    // env var missing). Fine if RLS is off, but a red flag if the run
    // claims 0 rows for everyone.
    usingServiceRole: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    enabledOrgs: orgs.length,
    fired,
    skipped,
  });
}
