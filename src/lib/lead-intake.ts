/**
 * Turning a public quote request into a lead — shared by /api/leads (a
 * normal submission) and /api/leads/review (the owner restores one that was
 * held as possible spam). Finds or adds the customer (phone, then email),
 * adds the address, saves the job as status "lead", records the text-message
 * consent and referral, and optionally alerts the team and starts the AI
 * draft quote. Service-role client; org always resolved by the caller.
 */
import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { dispatchNotifications, resolveRecipients } from "./notify-server";
import { siteOrigin } from "./site-url";
import { applySmsConsent } from "./sms-consent";
import { recordCustomerSmsConsent } from "./sms-consent-server";
import { draftLeadQuote } from "./lead-draft";
import { findReferrer, recordReferralLead } from "./referrals-server";
import { ymdInZone } from "./dates";
import { escapeLike } from "./like-escape";

export interface LeadInput {
  name: string;
  phone: string;
  email: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  description: string;
  photos: string[];
  referrerTechId: string;
  referralCode: string;
  /** undefined = the form didn't ask. */
  smsConsent?: boolean;
  smsConsentText: string;
  ip: string;
  fromTag: string;
  mailTag: string;
}

export type LeadResult = { ok: true; jobId: string } | { ok: false; error: string };

export async function createLead(
  supabase: SupabaseClient,
  orgId: string,
  l: LeadInput,
  opts: { notify: boolean; draft: boolean; extraBlob?: Record<string, unknown> },
): Promise<LeadResult> {
  let customerId: string | null = null;
  if (l.phone) {
    const { data } = await supabase.from("customers").select("id").eq("org_id", orgId).eq("phone", l.phone).limit(1);
    if (data?.length) customerId = data[0].id;
  }
  if (!customerId && l.email) {
    const { data } = await supabase.from("customers").select("id").eq("org_id", orgId).ilike("email", escapeLike(l.email)).limit(1);
    if (data?.length) customerId = data[0].id;
  }
  const createdNewCustomer = !customerId;
  if (!customerId) {
    const { data, error } = await supabase.from("customers")
      .insert({ org_id: orgId, name: l.name, type: "individual", phone: l.phone || null, email: l.email || null })
      .select("id").single();
    if (error) return { ok: false, error: error.message };
    customerId = data.id as string;
  }

  // Address: always a fresh row tied to this lead (dedupe happens later).
  const addressLine = [l.street, l.city, l.state, l.zip].filter(Boolean).join(", ");
  let addressId: string | null = null;
  if (l.street || l.city) {
    const { data, error } = await supabase.from("addresses")
      .insert({ org_id: orgId, customer_id: customerId, street: l.street || null, city: l.city || null, state: l.state || null, zip: l.zip || null })
      .select("id").single();
    if (error) return { ok: false, error: error.message };
    addressId = data.id as string;
  }

  const referrer = l.referralCode ? await findReferrer(supabase, orgId, l.referralCode) : null;
  const consentAt = new Date().toISOString();
  const { data: jobRow, error: jobErr } = await supabase.from("jobs").insert({
    org_id: orgId,
    property: addressLine || l.street || "(address pending)",
    client: l.name,
    customer_id: customerId,
    address_id: addressId,
    job_date: ymdInZone(Date.now()), // the business's date, not UTC's
    rooms: JSON.stringify({
      leadDescription: l.description,
      leadPhotos: l.photos,
      // One-way tags of the sender's address / email — what the rate limits count.
      leadFrom: l.fromTag || "unknown",
      ...(l.mailTag ? { leadMail: l.mailTag } : {}),
      ...(referrer && createdNewCustomer && referrer.id !== customerId ? { leadReferredBy: referrer.name || "a customer" } : {}),
      // Consent record per CTIA 5.1.2: when, where, the exact wording, the IP.
      ...(typeof l.smsConsent === "boolean"
        ? applySmsConsent({}, { granted: l.smsConsent, at: consentAt, source: "website quote form", text: l.smsConsentText, ip: l.ip })
        : {}),
      ...(opts.extraBlob || {}),
    }),
    total: 0, total_labor: 0, total_mat: 0, total_hrs: 0,
    status: "lead",
    created_by: l.name,
    ...(l.referrerTechId ? { referrer_tech_id: l.referrerTechId } : {}),
  }).select("id").single();
  if (jobErr) return { ok: false, error: jobErr.message };
  const jobId = jobRow.id as string;

  const referral = referrer
    ? await recordReferralLead(supabase, { orgId, referrer, leadCustomerId: customerId, createdNewCustomer, leadJobId: jobId })
    : null;
  const referredBy = referral?.credited ? (referral.referrerName || "a customer") : null;
  if (typeof l.smsConsent === "boolean") {
    await recordCustomerSmsConsent(supabase, customerId, orgId, {
      granted: l.smsConsent, at: consentAt, source: "website quote form", phone: l.phone || undefined,
      text: l.smsConsentText, ip: l.ip, jobId,
    }, "form");
  }

  if (opts.notify) {
    // Best-effort: never fail the lead over an alert.
    try {
      const recipients = await resolveRecipients(supabase, orgId, { managers: true, ids: l.referrerTechId ? [l.referrerTechId] : [], event: "leads" });
      if (recipients.length) {
        // Trusted origin, never the request's Host (this endpoint is public).
        const origin = siteOrigin();
        const summary = l.description.length > 90 ? `${l.description.slice(0, 90)}…` : l.description;
        await dispatchNotifications(supabase, {
          orgId, type: "new_lead", title: "New lead",
          body: (addressLine ? `${l.name} · ${addressLine}` : l.name) + (referredBy ? ` · referred by ${referredBy}` : ""),
          jobId,
          smsBody: `New lead: ${l.name}${l.phone ? ` (${l.phone})` : ""} — ${summary}.${origin ? ` ${origin}` : ""}`,
          recipients,
        });
      }
    } catch (e) {
      console.error("leads notify failed (lead still saved):", e);
    }
  }

  if (opts.draft) {
    // The AI draft quote runs after the response (lib/lead-draft.ts).
    after(async () => {
      try {
        const r = await draftLeadQuote(supabase, {
          orgId, jobId, description: l.description, photos: l.photos, property: addressLine || l.street || "", client: l.name,
        });
        if (!r.ok) console.log(`[leads] no AI draft for ${jobId}: ${r.reason}`);
      } catch (e) {
        console.error("[leads] AI draft failed (lead still saved):", e);
      }
    });
  }
  return { ok: true, jobId };
}

/** What a held submission keeps so a restore makes exactly the lead it would have. */
export function heldPayload(l: LeadInput): Record<string, unknown> {
  return {
    photos: l.photos, referrerTechId: l.referrerTechId || null, referralCode: l.referralCode || null,
    ...(typeof l.smsConsent === "boolean" ? { smsConsent: l.smsConsent, smsConsentText: l.smsConsentText } : {}),
    ip: l.ip || null,
  };
}

/** A held row → the LeadInput to restore it with. */
export function inputFromHeld(r: {
  name?: string | null; phone?: string | null; email?: string | null; street?: string | null; city?: string | null; state?: string | null;
  zip?: string | null; description?: string | null; payload?: Record<string, unknown> | null; from_tag?: string | null; email_tag?: string | null;
}): LeadInput {
  const p = (r.payload || {}) as Record<string, unknown>;
  const s = (v: unknown) => (typeof v === "string" ? v : "");
  return {
    name: s(r.name) || s(r.phone) || s(r.email) || "Website request",
    phone: s(r.phone), email: s(r.email), street: s(r.street), city: s(r.city), state: s(r.state), zip: s(r.zip),
    description: s(r.description),
    photos: Array.isArray(p.photos) ? (p.photos as unknown[]).filter((x): x is string => typeof x === "string") : [],
    referrerTechId: s(p.referrerTechId), referralCode: s(p.referralCode),
    smsConsent: typeof p.smsConsent === "boolean" ? p.smsConsent : undefined,
    smsConsentText: s(p.smsConsentText), ip: s(p.ip), fromTag: s(r.from_tag), mailTag: s(r.email_tag),
  };
}
