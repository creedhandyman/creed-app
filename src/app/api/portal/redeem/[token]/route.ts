import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { buildSessionCookie } from "@/lib/portal-session";

export const dynamic = "force-dynamic";

/**
 * GET /api/portal/redeem/<token>
 *
 * The customer hits this URL by tapping their magic link in SMS/email.
 * We:
 *  1. Look up the token in portal_tokens.
 *  2. Reject if missing, already used, or expired.
 *  3. Stamp used_at so the link can't be reused.
 *  4. Set the signed portal session cookie.
 *  5. Redirect to /portal.
 *
 * On any failure we redirect to /portal/login with a ?reason= so the
 * customer sees a friendly "request a new link" page instead of a
 * raw 4xx.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const origin = `${req.nextUrl.protocol}//${req.nextUrl.host}`;

  const fail = (reason: string) =>
    NextResponse.redirect(`${origin}/portal/login?reason=${encodeURIComponent(reason)}`);

  if (!token) return fail("invalid");

  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );

    const { data: tokens, error } = await supabase
      .from("portal_tokens")
      .select("id, customer_id, org_id, expires_at, used_at")
      .eq("token", token)
      .limit(1);
    if (error || !tokens?.length) return fail("invalid");

    const t = tokens[0];
    if (t.used_at) return fail("used");
    if (new Date(t.expires_at).getTime() < Date.now()) return fail("expired");

    // Mark as used immediately so a stolen link can't be replayed
    // alongside a legitimate redemption (race window is tiny but real).
    await supabase
      .from("portal_tokens")
      .update({ used_at: new Date().toISOString() })
      .eq("id", t.id);

    const cookie = buildSessionCookie(t.customer_id, t.org_id);
    const res = NextResponse.redirect(`${origin}/portal`);
    res.cookies.set(cookie.name, cookie.value, cookie.options);
    return res;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("portal/redeem error:", e);
    return fail("error");
  }
}
