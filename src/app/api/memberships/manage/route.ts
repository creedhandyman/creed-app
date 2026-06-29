import { NextRequest, NextResponse } from "next/server";
import { requireOwner, serviceClient } from "@/lib/api-auth";
import type { CustomerMembership } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * POST /api/memberships/manage  { membershipId, action: 'cancel'|'pause'|'resume' }
 *
 * Owner controls for an enrolled customer's membership. Drives the Stripe
 * subscription (cancel / pause_collection) and mirrors the status locally;
 * the webhook also syncs, so this is best-effort-safe either way. A non-active
 * membership stops auto-spawning visits (the cron only fires status='active').
 */
export async function POST(req: NextRequest) {
  const prof = await requireOwner(req);
  if (prof instanceof NextResponse) return prof;
  const orgId = prof.orgId!;
  try {
    const { membershipId, action } = (await req.json()) as { membershipId?: string; action?: string };
    if (!membershipId || !["cancel", "pause", "resume"].includes(action || "")) {
      return NextResponse.json({ error: "Missing membershipId or invalid action" }, { status: 400 });
    }
    const supabase = serviceClient();
    const { data: row } = await supabase
      .from("customer_memberships")
      .select("id, org_id, stripe_subscription_id, status")
      .eq("id", membershipId)
      .eq("org_id", orgId)
      .single();
    const m = row as CustomerMembership | null;
    if (!m) return NextResponse.json({ error: "Membership not found" }, { status: 404 });

    const Stripe = (await import("stripe")).default;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
    const subId = m.stripe_subscription_id || "";

    if (action === "cancel") {
      if (subId) {
        try { await stripe.subscriptions.cancel(subId); }
        catch (e) { console.error("membership cancel (sub may already be gone):", e); }
      }
      await supabase.from("customer_memberships").update({ status: "cancelled" }).eq("id", m.id);
    } else if (action === "pause") {
      if (subId) await stripe.subscriptions.update(subId, { pause_collection: { behavior: "void" } });
      await supabase.from("customer_memberships").update({ status: "paused" }).eq("id", m.id);
    } else if (action === "resume") {
      if (subId) await stripe.subscriptions.update(subId, { pause_collection: null });
      await supabase.from("customer_memberships").update({ status: "active" }).eq("id", m.id);
    }

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
