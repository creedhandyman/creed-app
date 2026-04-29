import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

/**
 * Public lead intake endpoint. Called from /lead/[slug] when a prospect
 * submits the quote-request form. Resolves the org by slug, finds (or
 * creates) a Customer by phone/email match scoped to that org, attaches
 * an Address, and creates a Job with status="lead". Returns minimal
 * status — the caller doesn't need any of the IDs back.
 *
 * Uses the service-role key so writes succeed even if anyone re-enables
 * RLS on customers/addresses/jobs later. The caller is unauthenticated,
 * so all org scoping is derived server-side from the slug — never
 * trusted from the request body.
 */

interface Body {
  slug: string;
  name: string;
  phone?: string;
  email?: string;
  street?: string;
  city?: string;
  state?: string;
  zip?: string;
  description: string;
  photos?: string[];
  /** Profile.id of the technician whose share-link / QR brought the
   *  visitor here. Set by /card and /lead from ?tech=… or sessionStorage. */
  referrer_tech_id?: string;
}

const trim = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Body;
    const slug = trim(body.slug);
    const name = trim(body.name);
    const phone = trim(body.phone);
    const email = trim(body.email);
    const street = trim(body.street);
    const city = trim(body.city);
    const state = trim(body.state);
    const zip = trim(body.zip);
    const description = trim(body.description);
    const photos = Array.isArray(body.photos) ? body.photos.filter((p) => typeof p === "string") : [];
    // referrer_tech_id is a UUID of a profile row. We don't validate it
    // against the profiles table here — invalid values will simply not
    // match anything when Quests/leaderboards filter by it. Trust-but-
    // verify is fine because this is non-financial attribution data.
    const referrerTechId = trim(body.referrer_tech_id);

    if (!slug || !name || !description) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }
    if (!phone && !email) {
      return NextResponse.json({ error: "Need a phone or email so we can reach you" }, { status: 400 });
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    // Resolve org by slug — only published sites are allowed to receive leads.
    const { data: orgs, error: orgErr } = await supabase
      .from("organizations")
      .select("id, name, site_published")
      .eq("site_slug", slug)
      .limit(1);
    if (orgErr) return NextResponse.json({ error: orgErr.message }, { status: 500 });
    if (!orgs?.length) return NextResponse.json({ error: "Unknown business" }, { status: 404 });
    const org = orgs[0];
    if (org.site_published === false) {
      return NextResponse.json({ error: "This business isn't accepting leads online" }, { status: 403 });
    }
    const orgId = org.id;

    // Existing-customer match: phone first (more unique in the trade),
    // then email. Both case-insensitive on email; phone exact-match.
    let customerId: string | null = null;
    if (phone) {
      const { data } = await supabase
        .from("customers")
        .select("id")
        .eq("org_id", orgId)
        .eq("phone", phone)
        .limit(1);
      if (data?.length) customerId = data[0].id;
    }
    if (!customerId && email) {
      const { data } = await supabase
        .from("customers")
        .select("id")
        .eq("org_id", orgId)
        .ilike("email", email)
        .limit(1);
      if (data?.length) customerId = data[0].id;
    }

    if (!customerId) {
      const { data, error } = await supabase
        .from("customers")
        .insert({
          org_id: orgId,
          name,
          type: "individual",
          phone: phone || null,
          email: email || null,
        })
        .select("id")
        .single();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      customerId = data.id;
    }

    // Address — always insert a fresh row tied to this lead. Two leads
    // for the same property under the same customer would create two
    // address rows; the Backfill flow (or Bernard manually in
    // CustomerDetail) can dedupe later if needed.
    const addressLine = [street, city, state, zip].filter(Boolean).join(", ");
    let addressId: string | null = null;
    if (street || city) {
      const { data, error } = await supabase
        .from("addresses")
        .insert({
          org_id: orgId,
          customer_id: customerId,
          street: street || null,
          city: city || null,
          state: state || null,
          zip: zip || null,
        })
        .select("id")
        .single();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      addressId = data.id;
    }

    // Lead job. Free-text `property` and `client` fields stay populated
    // so existing print templates and Jobs-list rendering work unchanged.
    // The structured link lives at customer_id / address_id.
    const today = new Date().toISOString().split("T")[0];
    const { error: jobErr } = await supabase.from("jobs").insert({
      org_id: orgId,
      property: addressLine || street || "(address pending)",
      client: name,
      customer_id: customerId,
      address_id: addressId,
      job_date: today,
      rooms: JSON.stringify({ leadDescription: description, leadPhotos: photos }),
      total: 0,
      total_labor: 0,
      total_mat: 0,
      total_hrs: 0,
      status: "lead",
      created_by: name,
      ...(referrerTechId ? { referrer_tech_id: referrerTechId } : {}),
    });
    if (jobErr) return NextResponse.json({ error: jobErr.message }, { status: 500 });

    return NextResponse.json({ ok: true, business: org.name });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    // eslint-disable-next-line no-console
    console.error("leads error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
