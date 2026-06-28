import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { generatePortalToken } from "@/lib/portal-session";
import { portalRedeemUrl } from "@/lib/site-url";
import { sendEmail } from "@/lib/email";

export const dynamic = "force-dynamic";

/**
 * POST /api/portal/request-link-email
 *
 * The email twin of /api/portal/request-link. Customer enters the email
 * their contractor has on file; we:
 *  1. Look up customers by email (case-insensitive exact match, across all
 *     orgs — we don't trust the request to specify the org).
 *  2. For each match, mint a single-use portal token (14-day TTL) and email
 *     the magic link via Resend (src/lib/email.ts).
 *  3. Return { ok: true } regardless of whether we found anyone — we never
 *     leak whether an email is in someone's customer list.
 *
 * Rate-limited to 2 req/min/IP by src/middleware.ts (same as the phone flow).
 */

interface Body {
  email: string;
}

const TOKEN_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Body;
    const email = (body.email || "").trim().toLowerCase();
    if (!EMAIL_RE.test(email)) {
      return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 });
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    // Case-insensitive exact match (ilike with no wildcards). Stricter than the
    // phone flow's suffix match — emails are unique enough that an exact match
    // is both safer (less enumeration surface) and less noisy.
    const { data: customers, error } = await supabase
      .from("customers")
      .select("id, org_id, name, email")
      .ilike("email", email)
      .limit(10);
    if (error) {
      console.error("portal/request-link-email lookup error:", error);
      return NextResponse.json({ ok: true }); // don't leak DB issues either
    }

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
        console.error("portal/request-link-email insert error:", insErr);
        continue;
      }

      const link = portalRedeemUrl(token);
      const orgRow = (await supabase.from("organizations").select("name").eq("id", c.org_id).limit(1)).data?.[0];
      const orgName = orgRow?.name || "your contractor";
      const subject = `Your customer portal link from ${orgName}`;
      const text =
        `Here's your single-use link to ${orgName}'s customer portal:\n\n${link}\n\n` +
        `It expires in 14 days. If you didn't request this, you can ignore this email.`;
      const html = portalLinkHtml(orgName, link);

      // Best-effort: if Resend isn't configured or the address bounces, the
      // token still exists and the contractor can resend manually. We never
      // surface failures to the requester — that would leak which emails exist.
      try {
        const r = await sendEmail(c.email || email, subject, text, html);
        if (!r.ok) console.error("portal/request-link-email send error:", r.error);
      } catch (e) {
        console.error("portal/request-link-email send threw:", e);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("portal/request-link-email error:", message);
    // Even on unexpected error, return ok — never leak.
    return NextResponse.json({ ok: true });
  }
}

/** Minimal, inline-styled HTML so it renders in any client without a template
 *  dependency. Plain text (above) is the fallback. */
function portalLinkHtml(orgName: string, link: string): string {
  const safeOrg = escapeHtml(orgName);
  const safeLink = escapeHtml(link);
  return `<!doctype html><html><body style="margin:0;background:#f4f5f7;font-family:Arial,Helvetica,sans-serif;color:#1a1a22">
  <div style="max-width:480px;margin:0 auto;padding:28px 20px">
    <div style="background:#ffffff;border-radius:12px;padding:28px;border:1px solid #e6e8ee">
      <h1 style="margin:0 0 6px;font-size:20px;color:#2E75B6">Your portal link</h1>
      <p style="margin:0 0 18px;font-size:15px;line-height:1.5;color:#444">
        Tap the button to open ${safeOrg}'s customer portal — view your quotes, jobs, and documents. This is a single-use link that expires in 14 days.
      </p>
      <a href="${safeLink}" style="display:inline-block;background:#2E75B6;color:#ffffff;text-decoration:none;font-size:16px;font-weight:bold;padding:13px 22px;border-radius:9px">Open my portal</a>
      <p style="margin:18px 0 0;font-size:12px;line-height:1.5;color:#888">
        If the button doesn't work, copy this link into your browser:<br>
        <span style="color:#2E75B6;word-break:break-all">${safeLink}</span>
      </p>
      <p style="margin:16px 0 0;font-size:12px;color:#aaa">If you didn't request this, you can safely ignore this email.</p>
    </div>
    <div style="text-align:center;color:#aaa;font-size:11px;margin-top:14px">Powered by Creed App</div>
  </div>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] || c),
  );
}
