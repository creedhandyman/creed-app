import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const { password } = await req.json();

    // Simple admin password — set ADMIN_PASSWORD in Vercel env vars
    const adminPw = process.env.ADMIN_PASSWORD || "creed2026";
    if (password !== adminPw) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    // Fetch all data
    const [
      { data: orgs },
      { data: profiles },
      { data: jobs },
      { data: reviews },
    ] = await Promise.all([
      supabase.from("organizations").select("id, name, created_at, subscription_status, plan, stripe_connected, trial_start, site_slug"),
      supabase.from("profiles").select("id, name, email, role, org_id, created_at"),
      supabase.from("jobs").select("id, status, total, created_at, org_id"),
      supabase.from("reviews").select("id, rating, created_at, org_id"),
    ]);

    const allOrgs = orgs || [];
    const allProfiles = profiles || [];
    const allJobs = jobs || [];
    const allReviews = reviews || [];

    // Total counts
    const totalOrgs = allOrgs.length;
    const totalUsers = allProfiles.length;
    const totalJobs = allJobs.length;
    const totalReviews = allReviews.length;

    // Revenue potential
    const totalQuoteValue = allJobs.reduce((s, j) => s + (j.total || 0), 0);
    const paidJobs = allJobs.filter((j) => j.status === "paid");
    const totalRevenue = paidJobs.reduce((s, j) => s + (j.total || 0), 0);
    const platformFees = totalRevenue * 0.02; // 2% platform fee

    // Subscription stats
    const activeSubscriptions = allOrgs.filter((o) => o.subscription_status === "active").length;
    const trialOrgs = allOrgs.filter((o) => o.subscription_status === "trial" || !o.subscription_status).length;
    const stripeConnected = allOrgs.filter((o) => o.stripe_connected).length;
    const withSites = allOrgs.filter((o) => o.site_slug).length;

    // Signups per day (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const recentSignups: Record<string, number> = {};
    allProfiles.forEach((p) => {
      if (!p.created_at) return;
      const d = p.created_at.split("T")[0];
      if (new Date(d) >= thirtyDaysAgo) {
        recentSignups[d] = (recentSignups[d] || 0) + 1;
      }
    });

    // Jobs per day (last 30 days)
    const recentJobs: Record<string, number> = {};
    allJobs.forEach((j) => {
      if (!j.created_at) return;
      const d = j.created_at.split("T")[0];
      if (new Date(d) >= thirtyDaysAgo) {
        recentJobs[d] = (recentJobs[d] || 0) + 1;
      }
    });

    // Org details
    const orgDetails = allOrgs.map((o) => ({
      name: o.name,
      created: o.created_at?.split("T")[0] || "",
      users: allProfiles.filter((p) => p.org_id === o.id).length,
      jobs: allJobs.filter((j) => j.org_id === o.id).length,
      reviews: allReviews.filter((r) => r.org_id === o.id).length,
      revenue: allJobs.filter((j) => j.org_id === o.id && j.status === "paid").reduce((s, j) => s + (j.total || 0), 0),
      status: o.subscription_status || "trial",
      plan: o.plan || "—",
      stripe: !!o.stripe_connected,
      site: o.site_slug || "",
    }));

    return NextResponse.json({
      totalOrgs,
      totalUsers,
      totalJobs,
      totalReviews,
      totalQuoteValue,
      totalRevenue,
      platformFees,
      activeSubscriptions,
      trialOrgs,
      stripeConnected,
      withSites,
      recentSignups,
      recentJobs,
      orgDetails,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
