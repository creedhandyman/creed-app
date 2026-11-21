import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isSupabaseStorageUrl } from "@/lib/api-auth";
import { clientIp, addressTag, memoryLimit, publicFormLimit, formLimitMessage, LEAD_LIMITS } from "@/lib/rate-limit";
import { botCheck, classifyLead, emailVerdict } from "@/lib/lead-spam";
import { aiSolicitationCheck, emailTag, guardCounts, turnstileOn, verifyTurnstile } from "@/lib/lead-guard";
import { createLead, heldPayload, type LeadInput } from "@/lib/lead-intake";

export const dynamic = "force-dynamic";
// The AI draft quote runs after the response (see `after` below) — a parse
// takes ~30–90s, so give the function room to finish it.
export const maxDuration = 300;

/**
 * Public lead intake endpoint. Called from /lead/[slug] (creedhm.com) and the
 * creedhandyman.com quote form. Spam layers first (2026-11-22): honeypot +
 * time-to-submit, per-address and per-email rate limits, optional Turnstile,
 * then the solicitation classifier (heuristics, AI for borderline). A held
 * submission goes to `lead_review` (no lead, no alert, no text); everything
 * else becomes a lead via lib/lead-intake.ts. The rest of this note: Resolves the org by slug, finds (or
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
  /** The website quote form's optional text-message consent box (unchecked
   *  by default). Recorded on the lead as proof of opt-in for carrier
   *  (A2P 10DLC) compliance. Absent = the form didn't ask (older forms, /lead). */
  sms_consent?: boolean;
  /** The exact consent wording the form showed (stored with the opt-in). */
  sms_consent_text?: string;
  /** Profile.id of the technician whose share-link / QR brought the
   *  visitor here. Set by /card and /lead from ?tech=… or sessionStorage. */
  referrer_tech_id?: string;
  /** A customer's referral code (the ?ref=… on their share link). Only
   *  counts while the business has referrals on (lib/referrals-server.ts). */
  referral_code?: string;
  /** Hidden honeypot field: a person leaves it empty. */
  hp?: string;
  /** When the form appeared (ms since epoch) — the time-to-submit check. */
  started_at?: number;
  /** Cloudflare Turnstile token (only checked when TURNSTILE_SECRET_KEY is set). */
  turnstile_token?: string;
}

// Every field is cut to a sane length — this endpoint is public, and what it
// stores is shown in the app, texted to the crew and sent to the AI.
const trim = (v: unknown, max = 500): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// The marketing site (creedhandyman.com) posts its quote form here
// cross-origin. Browsers preflight the JSON POST, so we answer OPTIONS
// and echo the origin back — but only for these origins. Same-origin
// callers (/lead/[slug]) send no Origin header and are unaffected.
const CORS_ORIGINS = new Set([
  "https://creedhandyman.com",
  "https://www.creedhandyman.com",
  "http://localhost:3005", // website dev server
]);

function corsHeaders(req: NextRequest): Record<string, string> {
  const origin = req.headers.get("origin") || "";
  if (!CORS_ORIGINS.has(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    Vary: "Origin",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req) });
}

export async function POST(req: NextRequest) {
  const res = await handlePost(req);
  for (const [k, v] of Object.entries(corsHeaders(req))) res.headers.set(k, v);
  return res;
}


/** What a held or dropped submission is told: the same as a real one, so a
 *  bot or a vendor learns nothing from the answer. */
const looksSent = (business?: string) => NextResponse.json({ ok: true, ...(business ? { business } : {}) });

async function handlePost(req: NextRequest): Promise<NextResponse> {
  try {
    const body = (await req.json()) as Body;
    const slug = trim(body.slug, 80);
    const name = trim(body.name, 120);
    const phone = trim(body.phone, 40);
    const email = trim(body.email, 200);
    const street = trim(body.street, 200);
    const city = trim(body.city, 100);
    const state = trim(body.state, 40);
    const zip = trim(body.zip, 20);
    const description = trim(body.description, 4000);
    // Photos are links the form uploaded — https only, a handful at most.
    const photos = (Array.isArray(body.photos) ? body.photos : [])
      .filter((p): p is string => typeof p === "string" && p.length <= 600 && !/["'<>\s]/.test(p) && isSupabaseStorageUrl(p))
      .slice(0, 12);
    // referrer_tech_id: attribution only; anything that isn't a UUID is dropped.
    const rawTech = trim(body.referrer_tech_id, 64);
    const referrerTechId = UUID_RE.test(rawTech) ? rawTech : "";

    if (!slug || !name || !description) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }
    if (!phone && !email) {
      return NextResponse.json({ error: "Need a phone or email so we can reach you" }, { status: 400 });
    }

    // Spam layer 1: honeypot + time-to-submit (lib/lead-spam.ts). Dropped
    // silently — nothing stored, nobody alerted, the bot is told "ok".
    const bot = botCheck({ hp: body.hp, startedAt: body.started_at });
    if (bot.bot) {
      console.warn(`[leads] dropped (${bot.why}) for ${slug}`);
      return looksSent();
    }

    // Rate limit, layer 1: a burst from one address / one email on this instance.
    const ip = clientIp(req);
    const fromTag = addressTag(ip);
    const mailTag = emailTag(email);
    if (fromTag && !memoryLimit(`lead:${fromTag}`, 6, 60_000)) {
      return NextResponse.json({ error: formLimitMessage("burst") }, { status: 429 });
    }
    if (mailTag && !memoryLimit(`leadmail:${mailTag}`, 3, 600_000)) {
      return NextResponse.json({ error: formLimitMessage("address") }, { status: 429 });
    }

    // Optional Cloudflare Turnstile (only when TURNSTILE_SECRET_KEY is set).
    if (turnstileOn() && !(await verifyTurnstile(body.turnstile_token, ip))) {
      return NextResponse.json({ error: "Please complete the \"I'm not a robot\" check and send again." }, { status: 400 });
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
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
    const orgId = org.id as string;

    // Rate limit, layer 2 (shared by every instance), checked BEFORE any row
    // is written: leads already saved from this address (lib/rate-limit.ts),
    // plus this email's leads and everything held for review from either.
    const g = await guardCounts(supabase, { orgId, fromTag, mailTag });
    const limit = await publicFormLimit(supabase, { orgId, tag: fromTag });
    if (!limit.ok || g.heldFromHour >= LEAD_LIMITS.perAddressHour || g.heldFromDay >= LEAD_LIMITS.perAddressDay) {
      const why = limit.ok ? "address" : limit.why;
      console.warn(`[leads] rate limited (${why}) org ${orgId}`);
      return NextResponse.json({ error: formLimitMessage(why) }, { status: 429 });
    }
    if (!emailVerdict({ hour: g.mailHour, day: g.mailDay })) {
      console.warn(`[leads] rate limited (email) org ${orgId}`);
      return NextResponse.json({ error: formLimitMessage("address") }, { status: 429 });
    }

    const input: LeadInput = {
      name, phone, email, street, city, state, zip, description, photos, referrerTechId,
      referralCode: trim(body.referral_code, 80),
      smsConsent: typeof body.sms_consent === "boolean" ? body.sms_consent : undefined,
      smsConsentText: trim(body.sms_consent_text),
      ip, fromTag, mailTag,
    };

    // Spam layer 3: is this a vendor pitch? Heuristics first; the AI only
    // decides the borderline ones. No AI answer = treated as a real request.
    const spam = classifyLead({ name, email, street, city, description }, { noTimer: bot.noTimer });
    let hold = spam.verdict === "spam";
    let ai: { verdict: "job" | "solicitation"; reason: string } | null = null;
    if (spam.verdict === "borderline") {
      ai = await aiSolicitationCheck(orgId, { name, email, street, city, description });
      hold = ai?.verdict === "solicitation";
    }

    if (hold) {
      const { error: heldErr } = await supabase.from("lead_review").insert({
        org_id: orgId, status: "flagged",
        name, phone: phone || null, email: email || null, street: street || null, city: city || null,
        state: state || null, zip: zip || null, description,
        payload: heldPayload(input), from_tag: fromTag || null, email_tag: mailTag || null,
        score: spam.score, reasons: spam.reasons, ai_verdict: ai ? `${ai.verdict}: ${ai.reason}` : null,
      });
      if (!heldErr) {
        console.log(`[leads] held for review (score ${spam.score}${ai ? `, AI ${ai.verdict}` : ""}) org ${orgId}`);
        return looksSent(org.name);
      }
      // The review table isn't there yet (migration not run): keep the
      // request as a QUIET lead — tagged, no alert, no text, no AI draft —
      // rather than lose a possible customer.
      console.warn(`[leads] could not hold for review (${heldErr.message}); saving a quiet lead`);
      const quiet = await createLead(supabase, orgId, input, {
        notify: false, draft: false,
        extraBlob: { leadFlagged: { score: spam.score, reasons: spam.reasons, ai: ai ? `${ai.verdict}: ${ai.reason}` : null } },
      });
      if (!quiet.ok) return NextResponse.json({ error: quiet.error }, { status: 500 });
      return looksSent(org.name);
    }

    const made = await createLead(supabase, orgId, input, { notify: true, draft: true });
    if (!made.ok) return NextResponse.json({ error: made.error }, { status: 500 });
    return NextResponse.json({ ok: true, business: org.name });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    // eslint-disable-next-line no-console
    console.error("leads error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
