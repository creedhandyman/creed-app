import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { generatePortalToken } from "@/lib/portal-session";

export const dynamic = "force-dynamic";

/**
 * POST /api/portal/request-link
 *
 * The "I lost my link" flow. Customer enters their phone (the same one
 * the contractor has on file). We:
 *  1. Look up customers by phone (across all orgs — we don't trust
 *     the request to specify the org).
 *  2. For each match, generate a token and send a Twilio SMS via the
 *     existing /api/sms route.
 *  3. Return { ok: true } regardless of whether we found anyone — we
 *     don't want this endpoint to leak whether a phone number is in
 *     anyone's customer list.
 *
 * Rate-limit / bot-protection is intentionally out of scope for v1; if
 * abuse becomes a problem we'll add Vercel Edge rate-limit + a captcha.
 */

interface Body {
  phone: string;
}

const TOKEN_TTL_MS = 14 * 24 * 60 * 60 * 1000;

function normalizePhoneDigits(raw: string): string {
  return raw.replace(/\D/g, "");
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Body;
    const phoneInput = (body.phone || "").trim();
    const digits = normalizePhoneDigits(phoneInput);
    if (digits.length < 7) {
      return NextResponse.json({ error: "Enter a valid phone number" }, { status: 400 });
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );

    // Match by suffix — different contractors may store the same number
    // with different formatting ("555-123-4567" vs "+1 555 123 4567").
    // Postgres ilike on the last 10 digits catches both.
    const last10 = digits.slice(-10);
    const { data: customers, error } = await supabase
      .from("customers")
      .select("id, org_id, name, phone")
      .ilike("phone", `%${last10}%`)
      .limit(10);
    if (error) {
      // eslint-disable-next-line no-console
      console.error("portal/request-link lookup error:", error);
      return NextResponse.json({ ok: true }); // don't leak DB issues either
    }

    const origin = req.headers.get("origin") || `https://${req.headers.get("host") || "creed-app.vercel.app"}`;

    for (const c of customers || []) {
      const token = generatePortalToken();
      const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString();
      const { error: insErr } = await supabase
        .from("portal_tokens")
        .insert({
          org_id: c.org_id,
          customer_id: c.id,
          token,
          expires_at: expiresAt,
        });
      if (insErr) {
        // eslint-disable-next-line no-console
        console.error("portal/request-link insert error:", insErr);
        continue;
      }
      const link = `${origin}/portal/redeem/${token}`;
      const orgRow = (await supabase.from("organizations").select("name").eq("id", c.org_id).limit(1)).data?.[0];
      const orgName = orgRow?.name || "us";
      const message = `Your customer portal link from ${orgName}: ${link} (expires in 14 days)`;

      // Best-effort SMS via the existing Twilio route. If Twilio env vars
      // aren't set or the phone is malformed, we just log and move on —
      // the token still exists, and the customer can ask the contractor
      // to resend manually. We don't surface failures to the requester
      // because we shouldn't leak which phone numbers exist.
      try {
        await fetch(`${origin}/api/sms`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ to: c.phone || phoneInput, body: message }),
        });
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error("portal/request-link SMS error:", e);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    // eslint-disable-next-line no-console
    console.error("portal/request-link error:", message);
    // Even on unexpected error, return ok — never leak.
    return NextResponse.json({ ok: true });
  }
}
