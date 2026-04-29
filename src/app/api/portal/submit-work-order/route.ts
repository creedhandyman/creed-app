import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifySession, PORTAL_COOKIE_NAME } from "@/lib/portal-session";

export const dynamic = "force-dynamic";

/**
 * POST /api/portal/submit-work-order
 *
 * The portal's "Request work" CTA submits here. We mirror the public
 * /api/leads flow — insert a Job with status="lead" — but everything
 * is keyed off the cookie session, so the customer never has to
 * re-enter their name/phone/email and can't submit on someone else's
 * behalf.
 *
 * The work-order is linked to one of the customer's existing addresses
 * (the dropdown on the form is populated from /api/portal/me's
 * addresses, all of which already share customer_id). We re-validate
 * the address belongs to the session's customer before inserting so a
 * tampered request can't attach a job to someone else's address.
 *
 * Lead description and uploaded photos go into the rooms JSON under
 * the same `leadDescription` / `leadPhotos` keys that /api/leads uses,
 * so Bernard's existing surfaces (Quests "leads" tab, Jobs list)
 * render portal submissions identically.
 */

interface Body {
  addressId?: string;
  description: string;
  photos?: string[];
}

export async function POST(req: NextRequest) {
  const cookie = req.cookies.get(PORTAL_COOKIE_NAME)?.value;
  const session = verifySession(cookie);
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  try {
    const body = (await req.json()) as Body;
    const description = (body.description || "").trim();
    const addressId = (body.addressId || "").trim() || null;
    const photos = Array.isArray(body.photos)
      ? body.photos.filter((p) => typeof p === "string").slice(0, 12)
      : [];
    if (!description) {
      return NextResponse.json({ error: "Describe what you need done" }, { status: 400 });
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );

    // Re-fetch the customer (for name) and validate the address.
    const { data: customers, error: cErr } = await supabase
      .from("customers")
      .select("id, name, phone, email")
      .eq("id", session.customer_id)
      .eq("org_id", session.org_id)
      .limit(1);
    if (cErr || !customers?.length) {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    }
    const customer = customers[0];

    let address: {
      id: string;
      street: string | null;
      city: string | null;
      state: string | null;
      zip: string | null;
      label: string | null;
    } | null = null;
    if (addressId) {
      const { data: addrs, error: aErr } = await supabase
        .from("addresses")
        .select("id, street, city, state, zip, label, customer_id, org_id")
        .eq("id", addressId)
        .limit(1);
      if (aErr) return NextResponse.json({ error: aErr.message }, { status: 500 });
      const a = addrs?.[0];
      if (!a || a.customer_id !== session.customer_id || a.org_id !== session.org_id) {
        return NextResponse.json({ error: "Address not found" }, { status: 404 });
      }
      address = a;
    }

    const addressLine = address
      ? [address.street, address.city, address.state, address.zip].filter(Boolean).join(", ") ||
        address.label ||
        "(address pending)"
      : "(no specific address)";

    const today = new Date().toISOString().split("T")[0];
    const { error: jobErr } = await supabase.from("jobs").insert({
      org_id: session.org_id,
      property: addressLine,
      client: customer.name,
      customer_id: session.customer_id,
      address_id: address?.id || null,
      job_date: today,
      rooms: JSON.stringify({
        leadDescription: description,
        leadPhotos: photos,
        leadSource: "portal",
      }),
      total: 0,
      total_labor: 0,
      total_mat: 0,
      total_hrs: 0,
      status: "lead",
      created_by: customer.name,
    });
    if (jobErr) {
      return NextResponse.json({ error: jobErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    // eslint-disable-next-line no-console
    console.error("portal/submit-work-order error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
