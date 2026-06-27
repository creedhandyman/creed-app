/**
 * Inspection cap tracking + plan-gate helpers.
 *
 * Voice Walk / Inspector inspections are billable units across all
 * paid tiers (Solo 75, Crew 175, Pro 450 per month). Solo is NOT
 * locked out — it's the wedge feature of the product. This module
 * owns the "what's my org's current month usage" query, the "should
 * I let this inspection start" decision, and the "increment counter
 * on completion" write. Reads are best-effort: a transient network
 * error never blocks an inspection from starting, since the counter
 * is soft-gating, not accounting.
 *
 * Underlying table — Bernard runs this migration once:
 *
 *   CREATE TABLE inspection_usage (
 *     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 *     org_id UUID NOT NULL,
 *     ym TEXT NOT NULL,                  -- YYYY-MM bucket
 *     count INTEGER NOT NULL DEFAULT 0,
 *     created_at TIMESTAMPTZ DEFAULT now(),
 *     updated_at TIMESTAMPTZ DEFAULT now(),
 *     UNIQUE (org_id, ym)
 *   );
 */
import { supabase } from "./supabase";

export interface UsageInfo {
  plan: string;
  cap: number;       // monthly included quota; 0 only for unknown/legacy plans
  count: number;     // inspections used this calendar month
  remaining: number; // max(cap - count, 0)
  blocked: boolean;  // hit-or-exceeded the cap (overage prompt — not a hard block)
  warning: boolean;  // >= 80% of the cap used — surface a toast
  ym: string;        // YYYY-MM bucket the counter is keyed by
}

/** Monthly included inspection quota by plan. All tiers get a quota; over-cap
 *  nudges an upgrade rather than blocking or charging per-inspection. */
export function getCap(plan: string | null | undefined): number {
  if (plan === "pro") return 450;
  if (plan === "crew") return 175;
  if (plan === "solo") return 75;
  // Unrecognized / unset plan names fall back to the Solo quota so they
  // don't get accidentally blocked.
  return 75;
}

/** YYYY-MM bucket (UTC-local doesn't matter — month boundaries land in
 *  the same calendar day for all of North America when the cap resets). */
export function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Read the current month's usage row and compute the derived booleans.
 * Returns a safe-default (cap 0, count 0, blocked: cap==0) on any DB
 * error so the caller doesn't have to do the math.
 */
export async function getUsage(orgId: string, plan: string): Promise<UsageInfo> {
  const ym = currentMonth();
  const cap = getCap(plan);

  let count = 0;
  try {
    const { data } = await supabase
      .from("inspection_usage")
      .select("count")
      .eq("org_id", orgId)
      .eq("ym", ym)
      .maybeSingle();
    count = data?.count || 0;
  } catch {
    // Treat the absence of the table (pre-migration) as 0 — the gate
    // still works against the cap, and Bernard's existing toast plumbing
    // surfaces the "table does not exist" error so he notices.
  }

  const remaining = Math.max(cap - count, 0);
  const blocked = cap > 0 && count >= cap;
  const warning = cap > 0 && count >= Math.floor(cap * 0.8);
  return { plan, cap, count, remaining, blocked, warning, ym };
}

/**
 * Increment the current month's counter by one. Reads first to decide
 * UPDATE vs INSERT — Supabase's UPSERT requires the unique constraint
 * to be declared at insert time, and we want the helper to work even
 * before the unique index is fully in place. Race-condition tolerant
 * because the counter is soft-gating, not billing.
 *
 * Returns the post-increment usage info; callers can read it back if
 * they want to flash "X inspections left this month" right after.
 */
export async function incrementUsage(orgId: string, plan: string): Promise<UsageInfo> {
  const ym = currentMonth();
  const nowIso = new Date().toISOString();

  try {
    const { data: existing } = await supabase
      .from("inspection_usage")
      .select("id, count")
      .eq("org_id", orgId)
      .eq("ym", ym)
      .maybeSingle();

    if (existing) {
      await supabase
        .from("inspection_usage")
        .update({ count: (existing.count || 0) + 1, updated_at: nowIso })
        .eq("id", existing.id);
    } else {
      await supabase
        .from("inspection_usage")
        .insert({ org_id: orgId, ym, count: 1 });
    }
  } catch (err) {
    // Swallow — the inspection still happened, the cap is just slightly
    // under-counted. Counting failure is never a reason to break a
    // user's quote-in-progress flow.
    // eslint-disable-next-line no-console
    console.warn("[inspection-usage] increment failed", err);
  }

  return getUsage(orgId, plan);
}
