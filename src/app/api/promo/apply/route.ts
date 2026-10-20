import { NextRequest, NextResponse } from "next/server";
import { requireOwner, serviceClient } from "@/lib/api-auth";
import { findTimedPromo, promoEnd } from "@/lib/promo-timed";
import { orgTrialEnd } from "@/lib/trial";

export const dynamic = "force-dynamic";

/**
 * POST /api/promo/apply
 *
 * An owner/manager applies a comp code to their OWN org. Two things moved
 * server-side here to close the paywall bypass:
 *   1. The valid-code list lives in the PROMO_CODES env var (comma-separated),
 *      so it is no longer shipped in the client JS bundle.
 *   2. The `billing_enforced = false` write happens via the service role for
 *      the caller's session org — the client can no longer flip its own
 *      entitlement directly (that path is the bypass).
 *
 * Timed codes (lib/promo-timed.ts) instead grant N months of free access
 * by pushing trial_ends_at out — limited uses, counted in promo_redemptions.
 *
 * Body: { code: string }
 */
export async function POST(req: NextRequest) {
  const prof = await requireOwner(req);
  if (prof instanceof NextResponse) return prof;

  try {
    const { code } = (await req.json().catch(() => ({}))) as { code?: string };
    const norm = (code || "").trim().toUpperCase();
    if (!norm) {
      return NextResponse.json({ ok: false, error: "Enter a promo code" }, { status: 400 });
    }

    const valid = (process.env.PROMO_CODES || "")
      .split(",")
      .map((c) => c.trim().toUpperCase())
      .filter(Boolean);
    if (!valid.includes(norm)) {
      const timed = findTimedPromo(norm);
      if (!timed) {
        return NextResponse.json({ ok: false, error: "Invalid promo code" }, { status: 400 });
      }
      return applyTimed(timed, prof.orgId!);
    }

    const { error } = await serviceClient()
      .from("organizations")
      .update({ billing_enforced: false })
      .eq("id", prof.orgId!);
    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

async function applyTimed(promo: { id: string; months: number; maxUses: number }, orgId: string) {
  const sb = serviceClient();
  const { data: org, error: orgErr } = await sb
    .from("organizations")
    .select("id, trial_start, trial_ends_at, subscription_status")
    .eq("id", orgId)
    .single();
  if (orgErr || !org) return NextResponse.json({ ok: false, error: "Business not found" }, { status: 404 });
  if (org.subscription_status === "active") {
    return NextResponse.json({ ok: false, error: "This code is for businesses that haven't subscribed yet" }, { status: 400 });
  }

  // Use limit. A missing table (migration not run) shouldn't block the
  // business we're handing the code to — the code is unguessable anyway.
  const { data: uses, error: useErr } = await sb
    .from("promo_redemptions")
    .select("org_id")
    .eq("promo_id", promo.id);
  const tableMissing = !!useErr && (useErr.code === "42P01" || /does not exist/i.test(useErr.message));
  if (useErr && !tableMissing) return NextResponse.json({ ok: false, error: useErr.message }, { status: 500 });
  const usedBy = (uses || []).map((u: { org_id: string }) => u.org_id);
  if (usedBy.includes(orgId)) {
    return NextResponse.json({ ok: false, error: "This code is already applied to your business" }, { status: 400 });
  }
  if (usedBy.length >= promo.maxUses) {
    return NextResponse.json({ ok: false, error: "This promo code has already been used" }, { status: 400 });
  }

  const end = promoEnd(promo.months, orgTrialEnd(org));
  if (!tableMissing) {
    const { error: insErr } = await sb.from("promo_redemptions").insert({ promo_id: promo.id, org_id: orgId });
    if (insErr) return NextResponse.json({ ok: false, error: "This promo code has already been used" }, { status: 400 });
  }
  const { error } = await sb.from("organizations").update({ trial_ends_at: end.toISOString() }).eq("id", orgId);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, freeUntil: end.toISOString(), months: promo.months });
}
