import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifySession, PORTAL_COOKIE_NAME } from "@/lib/portal-session";
import { removeSavedCard } from "@/lib/payments/saved-card";

export const dynamic = "force-dynamic";

/**
 * DELETE /api/portal/saved-card — the customer removes their own card on file
 * from the portal. Authed by the portal-session cookie: the customer comes
 * from the session, never the body. Detaches the card in Stripe so it can't be
 * charged again, then clears it from the customer row.
 */
export async function DELETE(req: NextRequest) {
  const session = verifySession(req.cookies.get(PORTAL_COOKIE_NAME)?.value);
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  const Stripe = (await import("stripe")).default;
  const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;
  const r = await removeSavedCard(supabase, stripe, session.org_id, session.customer_id);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}
