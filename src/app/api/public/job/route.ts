import { NextRequest, NextResponse } from "next/server";
import { serviceClient } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

/**
 * Public, read-only fetch for the customer-facing /status page.
 *
 * That page is opened by people who are NOT logged in — the status link is
 * texted/emailed to a customer and frequently opened in the Messages app's
 * in-app browser, which carries no app session. A client-side anon read of
 * `jobs` returns nothing in that context, so the page showed "this link is
 * invalid or the job has been removed" for everyone except a logged-in owner
 * on the same browser. We read with the service-role key here instead.
 *
 * Exposure is by design: anyone holding the job's UUID can already view its
 * status (that's the whole point of a shareable status link), and the only
 * destructive action — approving the quote — stays separately token-gated in
 * /api/jobs/approve. We return the full job row (the page parses its rooms
 * blob for the work order / discount / line items) plus a curated set of org
 * branding fields.
 */
export async function GET(req: NextRequest) {
  const id = (req.nextUrl.searchParams.get("id") || "").trim();
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  try {
    const supabase = serviceClient();
    const { data: jobs, error } = await supabase.from("jobs").select("*").eq("id", id).limit(1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!jobs?.length) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }
    // Strip internal fields the customer-facing /status page never needs — this
    // endpoint is UNauthenticated (anyone with the job UUID can read it), so
    // don't leak payment-processor ids, the platform fee, or internal attribution.
    const {
      stripe_payment_intent_id: _pi,
      platform_fee_cents: _fee,
      created_by: _cb,
      referrer_tech_id: _ref,
      ...job
    } = jobs[0] as Record<string, unknown>;
    void _pi; void _fee; void _cb; void _ref;

    let org = null;
    if (job.org_id) {
      // NOTE: no stripe_account_id here. The status page doesn't need it —
      // /api/checkout resolves the payout account from the job's org server-side
      // (it ignores the body's stripeAccountId), so exposing it only leaks the
      // org's Stripe Connect account id to an unauthenticated caller.
      const { data: orgs } = await supabase
        .from("organizations")
        .select("id, name, logo_url, phone, default_rate, stripe_connected, brand_color, brand_color_2, deposit_pct, quote_valid_days, quote_terms")
        .eq("id", job.org_id)
        .limit(1);
      org = orgs?.[0] || null;
    }

    return NextResponse.json({ job, org });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    // eslint-disable-next-line no-console
    console.error("public/job error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
