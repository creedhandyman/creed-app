import { NextRequest, NextResponse } from "next/server";
import { requireOwner, serviceClient } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/preflight — beta-readiness verification.
 *
 * One admin-gated URL that reports, in booleans, whether the production
 * deployment is beta-ready: required env vars present, Supabase migrations
 * applied, service role actually working (live read, not just var-set),
 * Stripe reachable. `ready:true` + empty `blockers` = good to go.
 *
 * Auth (same pattern as /api/payroll/auto-run): x-admin-token ===
 * ADMIN_PASSWORD, OR an owner/manager Supabase session JWT. This exposes
 * system state, so it must never be public.
 *
 * Guardrails: read-only (no writes, no money movement), presence BOOLEANS
 * only — never secret values — and every check is try/caught so one failure
 * can't 500 the whole report.
 *
 * Usage:
 *   curl -H "x-admin-token: $ADMIN_PASSWORD" https://www.creedhm.com/api/preflight
 */

// Required in every deployment. SMS/push vars are conditionally required below.
const REQUIRED_ENV = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "PORTAL_SESSION_SECRET",
  "CRON_SECRET",
  "ADMIN_PASSWORD",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "NEXT_PUBLIC_SITE_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
] as const;

const SMS_ENV = ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER"] as const;
const PUSH_ENV = ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "NEXT_PUBLIC_VAPID_PUBLIC_KEY"] as const;

// Migration checks. PostgREST doesn't expose information_schema, so each
// entry is verified by a read-only probe: select <column> from <table>
// limit 1 via the service role. Success = table + column exist; a
// 42P01/42703-style error = the migration hasn't run.
const DB_CHECKS: { key: string; table: string; column: string }[] = [
  { key: "organizations.brand_color", table: "organizations", column: "brand_color" },
  { key: "organizations.auto_payroll_enabled", table: "organizations", column: "auto_payroll_enabled" },
  { key: "membership_plans", table: "membership_plans", column: "id" },
  { key: "customer_memberships", table: "customer_memberships", column: "id" },
  { key: "recurring_jobs", table: "recurring_jobs", column: "id" },
  { key: "review_requests", table: "review_requests", column: "id" },
  { key: "notifications", table: "notifications", column: "id" },
  { key: "ai_usage", table: "ai_usage", column: "id" },
  { key: "cron_log", table: "cron_log", column: "id" },
  { key: "time_off_requests", table: "time_off_requests", column: "id" },
  { key: "equipment", table: "equipment", column: "id" },
  { key: "push_subscriptions", table: "push_subscriptions", column: "id" },
  { key: "price_corrections.zip", table: "price_corrections", column: "zip" },
  { key: "jobs.archived", table: "jobs", column: "archived" },
  { key: "time_entries.paid_at", table: "time_entries", column: "paid_at" },
  { key: "time_entries.job_id", table: "time_entries", column: "job_id" },
  { key: "profiles.photo_url", table: "profiles", column: "photo_url" },
];

async function isAuthorized(req: NextRequest): Promise<boolean> {
  // Path 1: shared admin token (works even when Supabase itself is broken —
  // which is exactly when you need this endpoint).
  const adminPw = process.env.ADMIN_PASSWORD;
  const token = req.headers.get("x-admin-token");
  if (adminPw && token && token === adminPw) return true;
  // Path 2: owner/manager Supabase session. requireOwner resolves the
  // profile via the service role, which throws when the key is missing —
  // treat any failure as unauthorized rather than 500ing the gate.
  try {
    const prof = await requireOwner(req);
    return !(prof instanceof NextResponse);
  } catch {
    return false;
  }
}

export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const blockers: string[] = [];

  // ── Env presence (booleans only — never values) ──
  const env: Record<string, boolean> = {};
  for (const name of REQUIRED_ENV) {
    env[name] = !!process.env[name];
    if (!env[name]) blockers.push(`${name} missing`);
  }
  // SMS vars required only when the SMS channel is switched on.
  const smsEnabled = process.env.NOTIFY_SMS_ENABLED === "1";
  for (const name of SMS_ENV) {
    env[name] = !!process.env[name];
    if (smsEnabled && !env[name]) blockers.push(`${name} missing (NOTIFY_SMS_ENABLED=1 needs it)`);
  }
  // Push vars required only when push is (partially) configured — all three
  // must then be present or subscriptions/sends silently fail.
  const pushConfigured = PUSH_ENV.some((n) => !!process.env[n]);
  for (const name of PUSH_ENV) {
    env[name] = !!process.env[name];
    if (pushConfigured && !env[name]) blockers.push(`${name} missing (push is partially configured — set all three VAPID vars)`);
  }

  // ── Service role: live read, not just var-set ──
  let usingServiceRole = false;
  let svc: ReturnType<typeof serviceClient> | null = null;
  try {
    svc = serviceClient();
    const { error } = await svc.from("organizations").select("id").limit(1);
    usingServiceRole = !error;
    if (error) blockers.push(`service-role read failed: ${error.message}`);
  } catch {
    usingServiceRole = false;
    if (env.SUPABASE_SERVICE_ROLE_KEY) blockers.push("service-role client failed to initialize");
    // key missing is already a blocker from the env loop
  }

  // ── Migrations (read-only probes via service role) ──
  const db: Record<string, boolean> = {};
  if (svc && usingServiceRole) {
    const client = svc;
    const results = await Promise.all(
      DB_CHECKS.map(async (c) => {
        try {
          const { error } = await client.from(c.table).select(c.column).limit(1);
          return !error;
        } catch {
          return false;
        }
      }),
    );
    DB_CHECKS.forEach((c, i) => {
      db[c.key] = results[i];
      if (!results[i]) {
        blockers.push(
          c.key.includes(".")
            ? `${c.key} column missing — run its migration (see CLAUDE.md / creed_supabase_sql_library.sql)`
            : `${c.key} table missing — run its migration (see CLAUDE.md / creed_supabase_sql_library.sql)`,
        );
      }
    });
  } else {
    DB_CHECKS.forEach((c) => { db[c.key] = false; });
    blockers.push("migrations unchecked — service-role read must work first");
  }

  // ── Stripe reachability: one cheap authenticated read ──
  let stripeReachable = false;
  if (env.STRIPE_SECRET_KEY) {
    try {
      const Stripe = (await import("stripe")).default;
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
      await stripe.balance.retrieve();
      stripeReachable = true;
    } catch (e) {
      blockers.push(`Stripe API call failed with the configured key: ${e instanceof Error ? e.message : "unknown error"}`);
    }
  }
  // key missing is already a blocker from the env loop

  const ready = blockers.length === 0;

  return NextResponse.json({
    ready,
    blockers,
    env,
    usingServiceRole,
    db,
    stripe: { reachable: stripeReachable },
    checkedAt: new Date().toISOString(),
  });
}
