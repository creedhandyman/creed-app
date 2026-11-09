import { NextRequest, NextResponse } from "next/server";
import { requireOwner, serviceClient } from "@/lib/api-auth";
import { removeSavedCard } from "@/lib/payments/saved-card";

export const dynamic = "force-dynamic";

/**
 * DELETE /api/payments/saved-card — owner/manager removes a customer's card on
 * file (the customer asked by phone, say). Body: { customerId }. Detaches the
 * card in Stripe so it can't be charged again, then clears it from the
 * customer row. Scoped to the caller's own org.
 */
export async function DELETE(req: NextRequest) {
  const prof = await requireOwner(req);
  if (prof instanceof NextResponse) return prof;
  const { customerId } = (await req.json().catch(() => ({}))) as { customerId?: string };
  if (!customerId) return NextResponse.json({ error: "Missing customer" }, { status: 400 });

  const Stripe = (await import("stripe")).default;
  const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;
  const r = await removeSavedCard(serviceClient(), stripe, prof.orgId!, customerId);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}
