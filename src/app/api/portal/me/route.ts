import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifySession, PORTAL_COOKIE_NAME } from "@/lib/portal-session";

export const dynamic = "force-dynamic";

/**
 * GET /api/portal/me
 *
 * The portal landing page calls this on mount. We verify the cookie,
 * then return everything the customer can see:
 *  - their customer record
 *  - their addresses
 *  - all jobs linked to them (by customer_id) — we don't fall back to
 *    legacy name-match here because portal data exposure must be
 *    deterministic (no leaking jobs that happen to share a name).
 *  - receipts for those jobs (so the portal can list invoices/docs)
 *  - the org (name, logo, phone) for branded chrome
 *
 * Returns 401 if no valid session — the page treats that as a redirect
 * to /portal/login.
 */
export async function GET(req: NextRequest) {
  const cookie = req.cookies.get(PORTAL_COOKIE_NAME)?.value;
  const session = verifySession(cookie);
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );

    const [customerRes, addressesRes, jobsRes, orgRes] = await Promise.all([
      supabase
        .from("customers")
        .select("*")
        .eq("id", session.customer_id)
        .eq("org_id", session.org_id)
        .limit(1),
      supabase
        .from("addresses")
        .select("*")
        .eq("customer_id", session.customer_id)
        .eq("org_id", session.org_id),
      supabase
        .from("jobs")
        .select("*")
        .eq("customer_id", session.customer_id)
        .eq("org_id", session.org_id)
        .order("created_at", { ascending: false }),
      supabase
        .from("organizations")
        // Include the rate / markup / tax / trip_fee fields too — the
        // portal Documents section regenerates the contractor's quote
        // PDF client-side and needs the same numbers QuoteForge uses.
        .select("id, name, phone, email, logo_url, address, license_num, default_rate, markup_pct, tax_pct, trip_fee")
        .eq("id", session.org_id)
        .limit(1),
    ]);

    if (customerRes.error) return NextResponse.json({ error: customerRes.error.message }, { status: 500 });
    if (!customerRes.data?.length) {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    }

    const jobs = jobsRes.data || [];
    const jobIds = jobs.map((j) => j.id);
    const receipts = jobIds.length
      ? (await supabase.from("receipts").select("*").in("job_id", jobIds)).data || []
      : [];

    return NextResponse.json({
      customer: customerRes.data[0],
      addresses: addressesRes.data || [],
      jobs,
      receipts,
      org: orgRes.data?.[0] || null,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    // eslint-disable-next-line no-console
    console.error("portal/me error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
