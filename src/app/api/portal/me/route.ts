import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifySession, PORTAL_COOKIE_NAME } from "@/lib/portal-session";
import { customerSafeBlob } from "@/lib/ai-hours";
import { availableCreditCents, referralLink } from "@/lib/referrals";
import { siteOrigin } from "@/lib/site-url";

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
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    const [customerRes, addressesRes, jobsRes, orgRes, membershipsRes] = await Promise.all([
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
        // stripe_account_id is fetched to compute stripe_connected below —
        // it's stripped before the response (never exposed to the browser).
        .select("id, name, phone, email, logo_url, address, license_num, default_rate, trade_rates, markup_pct, tax_pct, tax_mode, trip_fee, min_labor_hours, brand_color, brand_color_2, deposit_pct, quote_valid_days, quote_terms, stripe_account_id")
        .eq("id", session.org_id)
        .limit(1),
      // Active/paused/past-due memberships so the customer can see + cancel them.
      supabase
        .from("customer_memberships")
        .select("*")
        .eq("customer_id", session.customer_id)
        .eq("org_id", session.org_id)
        .neq("status", "cancelled"),
    ]);

    if (customerRes.error) return NextResponse.json({ error: customerRes.error.message }, { status: 500 });
    if (!customerRes.data?.length) {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    }

    const jobs = jobsRes.data || [];
    const jobIds = jobs.map((j) => j.id);
    const receiptsRaw = jobIds.length
      ? (await supabase.from("receipts").select("*").in("job_id", jobIds)).data || []
      : [];
    // The portal only shows a receipt COUNT, never the image. Strip photo_url
    // so the contractor's private receipt paths aren't exposed to customers.
    const receipts = receiptsRaw.map((r) => ({ ...r, photo_url: "" }));

    // Enrich memberships with plan name/price/interval + perks for display.
    const memberships = membershipsRes.data || [];
    const planIds = Array.from(new Set(memberships.map((m) => m.plan_id).filter(Boolean)));
    const plansById: Record<string, { id: string; name?: string; price?: number; interval?: string }> = {};
    if (planIds.length) {
      const { data: plans } = await supabase
        .from("membership_plans")
        .select("id, name, price, interval, included, visits_per_year")
        .in("id", planIds);
      for (const p of plans || []) plansById[(p as { id: string }).id] = p;
    }
    const enrichedMemberships = memberships.map((m) => ({ ...m, plan: plansById[m.plan_id] || null }));

    // Split the connected-account id off the org payload: the portal only
    // needs a boolean (can this org take membership payments?), never the id.
    const orgRow = (orgRes.data?.[0] || null) as ({ stripe_account_id?: string | null } & Record<string, unknown>) | null;
    const stripeConnected = !!orgRow?.stripe_account_id;
    let orgPublic: Record<string, unknown> | null = null;
    if (orgRow) {
      const { stripe_account_id: _drop, ...rest } = orgRow;
      orgPublic = rest;
    }

    // Upsell data: when the customer has no live membership, return the org's
    // active plans so the portal can render a "Join" card (self-serve enroll
    // goes through the hosted /api/portal/membership-checkout). Skipped when
    // Stripe isn't connected — the org can't take the payment anyway.
    let plans: unknown[] = [];
    if (memberships.length === 0 && stripeConnected) {
      const { data: planRows } = await supabase
        .from("membership_plans")
        .select("id, name, price, interval, included, visits_per_year")
        .eq("org_id", session.org_id)
        .eq("is_active", true)
        .order("price", { ascending: true });
      plans = planRows || [];
    }

    // Customer referrals — only when the business turned them on and has a
    // public request form to send friends to. Separate, best-effort read so
    // the portal still loads before the referrals migration has run.
    let referral: { link: string; reward_cents: number; credit_cents: number; referred: number } | null = null;
    try {
      const { data: ro } = await supabase
        .from("organizations")
        .select("referrals_enabled, referral_reward_cents, site_slug, site_published")
        .eq("id", session.org_id)
        .maybeSingle();
      const r = ro as { referrals_enabled?: boolean; referral_reward_cents?: number | null; site_slug?: string | null; site_published?: boolean | null } | null;
      const code = (customerRes.data[0] as { referral_code?: string | null }).referral_code;
      const link = r?.referrals_enabled ? referralLink(siteOrigin(), r, code) : null;
      if (link) {
        const { data: refs } = await supabase
          .from("customer_referrals")
          .select("status, reward_cents")
          .eq("org_id", session.org_id)
          .eq("referrer_customer_id", session.customer_id);
        const rows = (refs || []) as { status: "pending" | "earned" | "applied" | "void"; reward_cents: number | null }[];
        referral = {
          link,
          reward_cents: Math.max(0, Number(r?.referral_reward_cents ?? 2500) || 0),
          credit_cents: availableCreditCents(rows),
          referred: rows.filter((x) => x.status !== "void").length,
        };
      }
    } catch {
      referral = null;
    }

    return NextResponse.json({
      referral,
      // The text-consent record (IP, team member names) is internal; the
      // portal doesn't use it.
      customer: (({ sms_consent: _consent, ...rest }) => rest)(customerRes.data[0] as Record<string, unknown>),
      addresses: addressesRes.data || [],
      // aiHrs + the consent record's IP are internal — see ai-hours.ts.
      jobs: jobs.map((j) => ({ ...j, rooms: customerSafeBlob(j.rooms) })),
      receipts,
      memberships: enrichedMemberships,
      plans,
      stripe_connected: stripeConnected,
      org: orgPublic,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    // eslint-disable-next-line no-console
    console.error("portal/me error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
