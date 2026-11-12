import { NextRequest, NextResponse, after } from "next/server";
import { serviceClient } from "@/lib/api-auth";
import { dispatchNotifications, resolveRecipients } from "@/lib/notify-server";
import { applySmsConsent } from "@/lib/sms-consent";
import { recordCustomerSmsConsent } from "@/lib/sms-consent-server";
import { draftLeadQuote } from "@/lib/lead-draft";
import { sendEmail } from "@/lib/email";
import { loadBookingOrg, loadBusyVisits } from "@/lib/booking-server";
import { openSlots, isSlotOpen, localNow, fmt12, fmtDay, fromMin, toMin } from "@/lib/booking";

export const dynamic = "force-dynamic";
// The AI draft quote runs after the response, like /api/leads.
export const maxDuration = 300;

/**
 * Public online booking (/book/[slug]).
 *
 * GET  ?slug=…  → the business's name/logo/phone and the open times. No
 *               customer data is ever returned — only free start times.
 * POST          → a customer asks for one open time. Lands in Creed as a
 *               LEAD (status "lead", same shape /api/leads writes, so the
 *               owner quotes it from the description) plus a schedule row
 *               with booking_status "requested" that HOLDS the slot until
 *               the owner confirms or declines it (/api/booking/respond).
 *               Nothing is auto-confirmed.
 *
 * 404 for every slug where booking is off — the feature ships switched off.
 * Org scoping is derived server-side from the slug, never from the body.
 */

const trim = (v: unknown, max = 500): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

export async function GET(req: NextRequest) {
  try {
    const slug = trim(req.nextUrl.searchParams.get("slug"), 80);
    const supabase = serviceClient();
    const org = await loadBookingOrg(supabase, slug);
    if (!org) return NextResponse.json({ error: "Online booking isn't available for this business." }, { status: 404 });
    const now = localNow(new Date(), org.settings.tz);
    const visits = await loadBusyVisits(supabase, org.id, now.date, org.settings.daysAhead);
    return NextResponse.json({
      business: { name: org.name, phone: org.phone, logo_url: org.logo_url, brand_color: org.brand_color },
      durationMin: org.settings.slotMin,
      days: openSlots(org.settings, visits, now),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("[booking] slots failed:", e);
    return NextResponse.json({ error: "Couldn't load open times. Please try again." }, { status: 500 });
  }
}

interface Body {
  slug?: string;
  date?: string;
  time?: string;
  name?: string;
  phone?: string;
  email?: string;
  street?: string;
  city?: string;
  state?: string;
  zip?: string;
  description?: string;
  sms_consent?: boolean;
  sms_consent_text?: string;
  /** Honeypot — hidden from people. Anything in it = a bot. */
  company?: string;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as Body;
    // Bots fill every field. Pretend it worked so they don't retry.
    if (trim(body.company)) return NextResponse.json({ ok: true });

    const slug = trim(body.slug, 80);
    const date = trim(body.date, 10);
    const time = trim(body.time, 5);
    const name = trim(body.name, 120);
    const phone = trim(body.phone, 40);
    const email = trim(body.email, 200);
    const street = trim(body.street, 200);
    const city = trim(body.city, 100);
    const state = trim(body.state, 40);
    const zip = trim(body.zip, 20);
    const description = trim(body.description, 4000);

    if (!slug || !date || !time || !name || !description) {
      return NextResponse.json({ error: "Please pick a time and fill in your name and what you need done." }, { status: 400 });
    }
    if (!phone && !email) return NextResponse.json({ error: "Please add a phone number or email so we can reach you." }, { status: 400 });
    if (!street) return NextResponse.json({ error: "Please add the address where the work is." }, { status: 400 });

    const supabase = serviceClient();
    const org = await loadBookingOrg(supabase, slug);
    if (!org) return NextResponse.json({ error: "Online booking isn't available for this business." }, { status: 404 });
    const orgId = org.id;
    const s = org.settings;

    // Re-check the time right before holding it.
    const now = localNow(new Date(), s.tz);
    const visits = await loadBusyVisits(supabase, orgId, now.date, s.daysAhead);
    if (!isSlotOpen(s, visits, now, date, time)) {
      return NextResponse.json({ error: "Sorry, that time was just taken. Please pick another.", taken: true }, { status: 409 });
    }
    const start = fromMin(toMin(time));
    const when = `${fmtDay(date)} at ${fmt12(start)}`;
    const addressLine = [street, city, state, zip].filter(Boolean).join(", ");

    // 1) Hold the slot first. The unique index (org, day, start) on booking
    //    rows makes a simultaneous second booking fail here, before any
    //    customer/job rows exist.
    const { data: hold, error: holdErr } = await supabase.from("schedule").insert({
      org_id: orgId,
      sched_date: date,
      job: addressLine,
      note: `🕐 ${start} · ⏳ Online booking request · ${name}`,
      start_time: start,
      duration_min: s.slotMin,
      booking_status: "requested",
    }).select("id").single();
    if (holdErr) {
      if (holdErr.code === "23505") {
        return NextResponse.json({ error: "Sorry, that time was just taken. Please pick another.", taken: true }, { status: 409 });
      }
      throw new Error(holdErr.message);
    }
    const scheduleId = hold.id;
    const releaseHold = async () => { await supabase.from("schedule").delete().eq("id", scheduleId); };

    // The unique index only stops two holds at the SAME start. Two requests at
    // overlapping starts (1:30 and 2:00) can both pass the check above, so
    // check again now that our hold is written, against everything but it.
    // If both collide, both give the time back; neither customer is booked
    // into a double.
    try {
      const others = await loadBusyVisits(supabase, orgId, now.date, s.daysAhead, scheduleId);
      if (!isSlotOpen(s, others, now, date, start)) {
        await releaseHold();
        return NextResponse.json({ error: "Sorry, that time was just taken. Please pick another.", taken: true }, { status: 409 });
      }
    } catch (e) {
      await releaseHold().catch(() => {});
      throw e;
    }

    try {
      // 2) Customer — same match rule as /api/leads: phone, then email.
      let customerId: string | null = null;
      if (phone) {
        const { data } = await supabase.from("customers").select("id").eq("org_id", orgId).eq("phone", phone).limit(1);
        if (data?.length) customerId = data[0].id;
      }
      if (!customerId && email) {
        const { data } = await supabase.from("customers").select("id").eq("org_id", orgId).ilike("email", email).limit(1);
        if (data?.length) customerId = data[0].id;
      }
      if (!customerId) {
        const { data, error } = await supabase.from("customers")
          .insert({ org_id: orgId, name, type: "individual", phone: phone || null, email: email || null })
          .select("id").single();
        if (error) throw new Error(error.message);
        customerId = data.id;
      }

      const { data: addr, error: addrErr } = await supabase.from("addresses")
        .insert({ org_id: orgId, customer_id: customerId, street, city: city || null, state: state || null, zip: zip || null })
        .select("id").single();
      if (addrErr) throw new Error(addrErr.message);

      // 3) The lead. The owner quotes it from leadDescription like any web
      //    lead; `booking` records the time asked for and links the hold.
      const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || req.headers.get("x-real-ip") || "";
      const blob: Record<string, unknown> = {
        leadDescription: `Booked online for ${when}.\n\n${description}`,
        leadPhotos: [],
        booking: {
          status: "requested",
          date,
          start,
          durationMin: s.slotMin,
          scheduleId,
          requestedAt: new Date().toISOString(),
          source: "online booking",
        },
      };
      if (typeof body.sms_consent === "boolean") {
        applySmsConsent(blob, {
          granted: body.sms_consent,
          at: new Date().toISOString(),
          source: "online booking page",
          text: trim(body.sms_consent_text, 1000),
          ip,
        });
      }
      const { data: jobRow, error: jobErr } = await supabase.from("jobs").insert({
        org_id: orgId,
        property: addressLine,
        client: name,
        customer_id: customerId,
        address_id: addr.id,
        job_date: date,
        rooms: JSON.stringify(blob),
        total: 0,
        total_labor: 0,
        total_mat: 0,
        total_hrs: 0,
        status: "lead",
        created_by: name,
      }).select("id").single();
      if (jobErr) throw new Error(jobErr.message);
      const jobId = jobRow.id as string;

      await supabase.from("schedule").update({ job_id: jobId }).eq("id", scheduleId);

      // The booking page's text box, onto the customer too (see sms-consent).
      if (typeof body.sms_consent === "boolean") {
        await recordCustomerSmsConsent(supabase, customerId, orgId, {
          granted: body.sms_consent,
          at: new Date().toISOString(),
          source: "online booking page",
          phone: phone || undefined,
          text: trim(body.sms_consent_text, 1000),
          ip,
          jobId,
        }, "form");
      }

      // 4) Tell the owner/managers (in-app feed + their usual channels).
      try {
        const recipients = await resolveRecipients(supabase, orgId, { managers: true, event: "leads" });
        if (recipients.length) {
          await dispatchNotifications(supabase, {
            orgId,
            type: "new_lead",
            title: "Booking request",
            body: `${name} asked for ${when} · ${addressLine}. Confirm or decline it on the Schedule.`,
            jobId,
            smsBody: `Booking request: ${name} asked for ${when}. Open Creed to confirm or decline.`,
            recipients,
          });
        }
      } catch (e) {
        console.error("[booking] notify failed (booking still saved):", e);
      }

      // 5) "We got it" email to the customer. Best-effort; skipped without an
      //    email or without RESEND_API_KEY.
      if (email) {
        const r = await sendEmail(
          email,
          `${org.name}: we got your request for ${when}`,
          [
            `Hi ${name.split(" ")[0]},`,
            "",
            `Thanks for booking with ${org.name}. You asked for ${when} at ${addressLine}.`,
            `This time is held for you. We'll confirm it shortly${org.phone ? `, or call ${org.phone} with any questions` : ""}.`,
            "",
            org.name,
          ].join("\n"),
        );
        if (!r.ok) console.log(`[booking] request email not sent: ${r.error}`);
      }
      // HOOK(texting): once the automatic Twilio texts land, send the
      // customer a "request received" text here — only when
      // smsConsentGranted(blob) is true. Not built in this change.
      // HOOK(payments): an optional booking deposit would be collected here
      // (before the hold is final). Not built in this change.

      after(async () => {
        try {
          const r = await draftLeadQuote(supabase, { orgId, jobId, description, photos: [], property: addressLine, client: name });
          if (!r.ok) console.log(`[booking] no AI draft for ${jobId}: ${r.reason}`);
        } catch (e) {
          console.error("[booking] AI draft failed (booking still saved):", e);
        }
      });

      return NextResponse.json({ ok: true, business: org.name, date, time: start });
    } catch (inner) {
      // Don't leave a held slot with no lead behind it.
      await releaseHold().catch(() => {});
      throw inner;
    }
  } catch (e) {
    console.error("[booking] book failed:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Something went wrong saving your booking. Please call us directly." }, { status: 500 });
  }
}
