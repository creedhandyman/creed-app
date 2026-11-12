// Server-only transactional email sender via Resend. Single shared send path
// used by the review-request cron (/api/reviews/dispatch) and the portal
// "email me a fresh link" flow (/api/portal/request-link-email).
//
// Best-effort + non-throwing, mirroring src/lib/sms.ts: returns a structured
// result instead of throwing, and reports a clear error when RESEND_API_KEY is
// unset so callers can log and move on without failing the request.

export type EmailResult = { ok: true; id?: string } | { ok: false; error: string };

/** Extras for marketing mail (campaigns): a display-name From, the business's
 *  own address as Reply-To, and the List-Unsubscribe headers. */
export interface EmailOptions {
  from?: string;
  replyTo?: string;
  headers?: Record<string, string>;
}

/**
 * Send a transactional email through Resend. `html` is optional — when given,
 * Resend sends a multipart message with `body` as the plain-text fallback.
 * From-address is RESEND_FROM_EMAIL, defaulting to reviews@creedhandyman.com.
 */
export async function sendEmail(
  to: string,
  subject: string,
  body: string,
  html?: string,
  opts: EmailOptions = {},
): Promise<EmailResult> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    return { ok: false, error: "Resend not configured (set RESEND_API_KEY to enable email)" };
  }
  if (!to || !to.includes("@")) {
    return { ok: false, error: "No valid email on customer record" };
  }
  const from = opts.from || process.env.RESEND_FROM_EMAIL || "reviews@creedhandyman.com";
  const payload: Record<string, unknown> = { from, to: [to], subject, text: body };
  if (html) payload.html = html;
  if (opts.replyTo) payload.reply_to = opts.replyTo;
  if (opts.headers && Object.keys(opts.headers).length) payload.headers = opts.headers;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({} as { message?: string }));
    return { ok: false, error: (data as { message?: string }).message || `Resend ${res.status}` };
  }
  const data = await res.json().catch(() => ({} as { id?: string }));
  const id = (data as { id?: unknown }).id;
  return typeof id === "string" ? { ok: true, id } : { ok: true };
}
