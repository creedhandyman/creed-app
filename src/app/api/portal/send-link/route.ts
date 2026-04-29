import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { generatePortalToken } from "@/lib/portal-session";

export const dynamic = "force-dynamic";

/**
 * Server-side: generate a one-time portal magic-link for a customer.
 * Called from the contractor's CustomerDetail screen. We don't strictly
 * authenticate the caller here (matches the rest of the in-app API
 * routes — Bernard's app is single-tenant per logged-in user) but we
 * verify the customer exists and belongs to the claimed org so a
 * mistyped customerId can't generate a token for someone else's data.
 *
 * Magic links live for 14 days; once redeemed (used_at is set) they
 * can't be reused. The cookie session that redemption establishes
 * lasts longer (30 days), so the customer doesn't need a fresh link
 * every time they revisit.
 */

interface Body {
  customerId: string;
  orgId: string;
}

const TOKEN_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Body;
    const customerId = (body.customerId || "").trim();
    const orgId = (body.orgId || "").trim();
    if (!customerId || !orgId) {
      return NextResponse.json({ error: "Missing customerId or orgId" }, { status: 400 });
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );

    // Verify the customer exists and is in the claimed org.
    const { data: customers, error: cErr } = await supabase
      .from("customers")
      .select("id, org_id, name, phone, email")
      .eq("id", customerId)
      .eq("org_id", orgId)
      .limit(1);
    if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 });
    if (!customers?.length) {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    }
    const customer = customers[0];

    const token = generatePortalToken();
    const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString();
    const { error: insErr } = await supabase
      .from("portal_tokens")
      .insert({
        org_id: orgId,
        customer_id: customerId,
        token,
        expires_at: expiresAt,
      });
    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

    // Build the redeem URL using the request origin so previews and
    // production both work without a hardcoded NEXT_PUBLIC_APP_URL.
    const origin = req.headers.get("origin") || `https://${req.headers.get("host") || "creed-app.vercel.app"}`;
    const link = `${origin}/portal/redeem/${token}`;

    return NextResponse.json({
      ok: true,
      link,
      customer: { name: customer.name, phone: customer.phone, email: customer.email },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    // eslint-disable-next-line no-console
    console.error("portal/send-link error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
