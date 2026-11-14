import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cronAuth } from "@/lib/cron-auth";
import { sendEmail } from "@/lib/email";
import { DEFAULT_SIGNUP_NOTIFY_EMAIL, signupEmail, signupWindow, type NewSignup } from "@/lib/signup-notify";

export const dynamic = "force-dynamic";

/**
 * Hourly cron: email Creed (the platform owner) when a new business signs up.
 *
 * A "sign-up" is a new `organizations` row: the moment someone finishes
 * "Create a business" in onboarding. Crew joining an existing business is not
 * one. Each run covers everything created since the previous successful run
 * stopped (its `result.until` in cron_log, endpoint "signups"), so nothing is
 * announced twice and nothing is missed across a failed run. One email per run.
 *
 * Reads only; the sign-up flow itself is untouched. Recipient:
 * SIGNUP_NOTIFY_EMAIL (default in lib/signup-notify.ts). Auth:
 * lib/cron-auth.ts. `?dry=1` shows what WOULD be sent without sending or
 * moving the marker.
 */
const ENDPOINT = "signups";

interface OrgRow {
  id: string;
  name: string | null;
  phone: string | null;
  primary_trade: string | null;
  plan: string | null;
  subscription_status: string | null;
  created_at: string;
  created_by: string | null;
}

async function handle(req: NextRequest): Promise<NextResponse> {
  const via = cronAuth(req);
  if (!via) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const dry = req.nextUrl.searchParams.get("dry") === "1";
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  // Where the last successful run stopped.
  const { data: lastRuns } = await supabase
    .from("cron_log").select("result").eq("endpoint", ENDPOINT).eq("authorized", true)
    .order("invoked_at", { ascending: false }).limit(1);
  const lastUntil = (lastRuns?.[0]?.result as { until?: string } | null)?.until ?? null;
  const { since, until } = signupWindow(Date.now(), lastUntil);

  const { data: orgs, error } = await supabase
    .from("organizations")
    .select("id, name, phone, primary_trade, plan, subscription_status, created_at, created_by")
    .gt("created_at", since).lte("created_at", until)
    .order("created_at", { ascending: true }).limit(50);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const rows = (orgs ?? []) as OrgRow[];

  let sent = false;
  let emailError: string | null = null;
  if (rows.length) {
    const ownerIds = [...new Set(rows.map((o) => o.created_by).filter((x): x is string => !!x))];
    const owners = new Map<string, { name: string | null; email: string | null }>();
    if (ownerIds.length) {
      const { data: profiles } = await supabase.from("profiles").select("id, name, email").in("id", ownerIds);
      for (const p of profiles ?? []) owners.set(p.id as string, { name: p.name as string | null, email: p.email as string | null });
    }
    const signups: NewSignup[] = rows.map((o) => ({
      name: o.name, created_at: o.created_at, phone: o.phone, primary_trade: o.primary_trade, plan: o.plan,
      subscription_status: o.subscription_status,
      owner_name: o.created_by ? owners.get(o.created_by)?.name : null,
      owner_email: o.created_by ? owners.get(o.created_by)?.email : null,
    }));
    const { count } = await supabase.from("organizations").select("id", { count: "exact", head: true });
    const { subject, body } = signupEmail(signups, count ?? rows.length);
    if (dry) return NextResponse.json({ ok: true, dry: true, since, until, found: rows.length, subject, body });
    const to = process.env.SIGNUP_NOTIFY_EMAIL || DEFAULT_SIGNUP_NOTIFY_EMAIL;
    const r = await sendEmail(to, subject, body);
    sent = r.ok;
    if (!r.ok) emailError = r.error;
  } else if (dry) {
    return NextResponse.json({ ok: true, dry: true, since, until, found: 0 });
  }

  // Move the marker only when there was nothing to send or the email went out:
  // a failed send is tried again on the next run.
  if (!rows.length || sent) {
    try {
      await supabase.from("cron_log").insert({
        endpoint: ENDPOINT, authorized: true, auth_via: via,
        is_vercel_cron: req.headers.get("x-vercel-cron") === "1",
        user_agent: (req.headers.get("user-agent") || "").slice(0, 200), force: false,
        result: { since, until, found: rows.length, sent },
      });
    } catch { /* logging is best-effort; the next run then covers this stretch again */ }
  }

  if (emailError) return NextResponse.json({ ok: false, since, until, found: rows.length, error: emailError }, { status: 502 });
  return NextResponse.json({ ok: true, since, until, found: rows.length, sent });
}

export const GET = handle;
export const POST = handle;
