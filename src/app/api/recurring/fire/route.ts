import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { computeNextFire, type Cadence } from "@/lib/recurring";
import { visitCadence } from "@/lib/memberships";

export const dynamic = "force-dynamic";

/**
 * Recurring Jobs cron endpoint.
 *
 * Triggered by Vercel cron (see vercel.json). Scans recurring_jobs for
 * active templates whose next_fire_at has elapsed, creates a new jobs
 * row from each template's saved rooms blob, then stamps last_fired_at
 * and recomputes next_fire_at using the shared cadence helper in
 * src/lib/recurring.ts (same code the UI uses to preview the next fire,
 * so what the user sees = what the server will do).
 *
 * Manual trigger for testing — admins can hit:
 *   GET /api/recurring/fire?force=1&id=<recurring_id>
 *     -H "x-admin-token: $ADMIN_PASSWORD"
 * to fire a single template immediately regardless of next_fire_at.
 */

interface RecurringRow {
  id: string;
  org_id: string;
  customer_id?: string | null;
  address_id?: string | null;
  property?: string | null;
  client?: string | null;
  template_rooms: unknown;
  title?: string | null;
  cadence: string;
  day_of_week?: number | null;
  day_of_month?: number | null;
  hour?: number | null;
  is_active?: boolean;
  last_fired_at?: string | null;
  next_fire_at?: string | null;
}

function isAuthorized(req: NextRequest): boolean {
  const auth = req.headers.get("authorization") || "";
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && auth === `Bearer ${cronSecret}`) return true;
  if (req.headers.get("x-vercel-cron") === "1") return true;
  const adminToken = req.headers.get("x-admin-token");
  const adminPw = process.env.ADMIN_PASSWORD;
  if (adminPw && adminToken && adminToken === adminPw) return true;
  return false;
}

const VALID_CADENCES: Cadence[] = [
  "weekly",
  "biweekly",
  "monthly",
  "quarterly",
  "semiannual",
  "annual",
];

function isCadence(s: string): s is Cadence {
  return (VALID_CADENCES as string[]).includes(s);
}

interface RoomsBlob {
  totals?: {
    total?: number;
    total_labor?: number;
    total_mat?: number;
    total_hrs?: number;
  };
  data?: {
    total?: number;
    total_labor?: number;
    total_mat?: number;
    total_hrs?: number;
  };
  trade?: string;
}

function parseTemplateBlob(blob: unknown): { text: string; parsed: RoomsBlob } {
  if (typeof blob === "string") {
    let parsed: RoomsBlob = {};
    try { parsed = JSON.parse(blob) as RoomsBlob; } catch { /* leave empty */ }
    return { text: blob, parsed };
  }
  return { text: JSON.stringify(blob ?? {}), parsed: (blob as RoomsBlob) ?? {} };
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const force = url.searchParams.get("force") === "1";
  const forceId = url.searchParams.get("id");

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const now = new Date();
  const nowIso = now.toISOString();

  let query = supabase.from("recurring_jobs").select("*").eq("is_active", true);
  if (forceId) {
    query = query.eq("id", forceId);
  } else if (!force) {
    // Two predicates: due now, OR never-fired (next_fire_at IS NULL) so
    // a freshly-created template without a precomputed next_fire_at still
    // gets picked up on the next cron tick.
    query = query.or(`next_fire_at.lte.${nowIso},next_fire_at.is.null`);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows: RecurringRow[] = (data || []) as RecurringRow[];
  const fired: { id: string; jobId: string; nextFireAt: string; title?: string | null }[] = [];
  const errors: { id: string; error: string }[] = [];
  const skipped: { id: string; reason: string }[] = [];

  for (const r of rows) {
    if (r.is_active === false) {
      skipped.push({ id: r.id, reason: "row inactive (index drift)" });
      continue;
    }
    if (!isCadence(r.cadence)) {
      errors.push({ id: r.id, error: `invalid cadence "${r.cadence}"` });
      continue;
    }

    const { text: roomsText, parsed } = parseTemplateBlob(r.template_rooms);
    const totals = parsed.totals ?? parsed.data ?? {};

    const title = (r.title || "").trim() || "Recurring service";
    const jobDate = now.toISOString().split("T")[0];

    const insertRow = {
      org_id: r.org_id,
      property: r.property || "",
      client: r.client || "",
      job_date: jobDate,
      rooms: roomsText,
      total: Number(totals.total ?? 0),
      total_labor: Number(totals.total_labor ?? 0),
      total_mat: Number(totals.total_mat ?? 0),
      total_hrs: Number(totals.total_hrs ?? 0),
      status: "scheduled",
      created_by: `Recurring: ${title}`,
      trade: parsed.trade || "General",
      callback: false,
      is_upsell: false,
      requested_tech: "",
      customer_id: r.customer_id ?? null,
      address_id: r.address_id ?? null,
    };

    const { data: jobIns, error: jobErr } = await supabase
      .from("jobs")
      .insert(insertRow)
      .select("id")
      .single();
    if (jobErr || !jobIns) {
      errors.push({ id: r.id, error: `job insert failed: ${jobErr?.message || "no row returned"}` });
      continue;
    }

    const nextFire = computeNextFire(now, r.cadence, {
      dayOfWeek: r.day_of_week ?? undefined,
      dayOfMonth: r.day_of_month ?? undefined,
      hour: r.hour ?? 9,
    });

    const { error: updErr } = await supabase
      .from("recurring_jobs")
      .update({
        last_fired_at: nowIso,
        next_fire_at: nextFire.toISOString(),
        updated_at: nowIso,
      })
      .eq("id", r.id);
    if (updErr) {
      errors.push({ id: r.id, error: `job created (${(jobIns as { id: string }).id}) but stamp failed: ${updErr.message}` });
    }

    fired.push({
      id: r.id,
      jobId: (jobIns as { id: string }).id,
      nextFireAt: nextFire.toISOString(),
      title: r.title,
    });
  }

  // ── Membership service visits ──────────────────────────────────────────
  // Active customer_memberships whose next_visit_at is due (or unset) spawn a
  // service job from their plan's `included` template, then advance next_visit_at
  // by the plan's visit cadence. Skipped when forcing a single recurring row.
  const membershipsFired: { id: string; jobId: string; nextVisitAt: string }[] = [];
  if (!forceId) {
    let mq = supabase.from("customer_memberships").select("*").eq("status", "active");
    if (!force) mq = mq.or(`next_visit_at.lte.${nowIso},next_visit_at.is.null`);
    const { data: memData, error: memErr } = await mq;
    if (memErr) {
      errors.push({ id: "memberships", error: memErr.message });
    } else {
      const mems = (memData || []) as Array<{ id: string; org_id: string; customer_id: string; plan_id: string }>;
      const planIds = Array.from(new Set(mems.map((m) => m.plan_id)));
      const custIds = Array.from(new Set(mems.map((m) => m.customer_id)));
      const planMap = new Map<string, { name?: string; included?: unknown; visits_per_year?: number; is_active?: boolean }>();
      const custMap = new Map<string, { name?: string }>();
      if (planIds.length) {
        const { data: plans } = await supabase.from("membership_plans").select("id, name, included, visits_per_year, is_active").in("id", planIds);
        for (const p of (plans || []) as Array<{ id: string; name?: string; included?: unknown; visits_per_year?: number; is_active?: boolean }>) planMap.set(p.id, p);
      }
      if (custIds.length) {
        const { data: custs } = await supabase.from("customers").select("id, name").in("id", custIds);
        for (const c of (custs || []) as Array<{ id: string; name?: string }>) custMap.set(c.id, c);
      }
      for (const m of mems) {
        const plan = planMap.get(m.plan_id);
        if (!plan || plan.is_active === false) {
          skipped.push({ id: m.id, reason: "membership plan missing/inactive" });
          continue;
        }
        const { text: roomsText, parsed } = parseTemplateBlob(plan.included);
        const totals = parsed.totals ?? parsed.data ?? {};
        const cust = custMap.get(m.customer_id);
        const insertRow = {
          org_id: m.org_id,
          property: "",
          client: cust?.name || "",
          job_date: now.toISOString().split("T")[0],
          rooms: roomsText,
          total: Number(totals.total ?? 0),
          total_labor: Number(totals.total_labor ?? 0),
          total_mat: Number(totals.total_mat ?? 0),
          total_hrs: Number(totals.total_hrs ?? 0),
          status: "scheduled",
          created_by: `Membership: ${plan.name || "Service plan"}`,
          trade: parsed.trade || "General",
          callback: false,
          is_upsell: false,
          requested_tech: "",
          customer_id: m.customer_id,
          address_id: null,
        };
        const { data: jobIns, error: jobErr } = await supabase.from("jobs").insert(insertRow).select("id").single();
        if (jobErr || !jobIns) {
          errors.push({ id: m.id, error: `membership job insert failed: ${jobErr?.message || "no row returned"}` });
          continue;
        }
        const nextVisit = computeNextFire(now, visitCadence(plan.visits_per_year ?? 12), { hour: 9 });
        await supabase.from("customer_memberships").update({ next_visit_at: nextVisit.toISOString() }).eq("id", m.id);
        membershipsFired.push({ id: m.id, jobId: (jobIns as { id: string }).id, nextVisitAt: nextVisit.toISOString() });
      }
    }
  }

  return NextResponse.json({
    ok: true,
    timestamp: nowIso,
    matched: rows.length,
    fired,
    membershipsFired,
    skipped,
    errors,
  });
}
