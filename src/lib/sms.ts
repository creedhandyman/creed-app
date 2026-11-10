// Server-only Twilio sender — the ONLY one. Shared by /api/sms (after auth),
// /api/portal/request-link (server-to-server, so there's no internal HTTP hop
// to a public route — that hop is what made /api/sms hard to lock down),
// lib/notify-server (crew/owner alerts) and the review-request cron. Every
// text gets the STOP opt-out line (withOptOut).
import { withOptOut } from "@/lib/sms-consent";
import { normalizePhone } from "@/lib/phone";

// Kept exported from here so existing imports keep working.
export { normalizePhone };

export interface SmsResult {
  ok: boolean;
  sid?: string;
  error?: string;
  status: number;
  /** Twilio error code, e.g. 21610 = the number replied STOP. */
  code?: number;
}

/**
 * True when Twilio can send: account SID + auth token, plus either a Messaging
 * Service (TWILIO_MESSAGING_SERVICE_SID, preferred: it carries the A2P 10DLC
 * campaign and handles STOP) or a single sending number (TWILIO_FROM_NUMBER).
 */
export function smsConfigured(): boolean {
  return !!(
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    (process.env.TWILIO_MESSAGING_SERVICE_SID || process.env.TWILIO_FROM_NUMBER)
  );
}

export interface SendSmsOptions {
  /** Absolute URL Twilio posts delivery updates to (/api/sms/status). */
  statusCallback?: string;
}

export async function sendSms(to: string, body: string, opts: SendSmsOptions = {}): Promise<SmsResult> {
  const dest = normalizePhone(to);
  const text = (body || "").trim();
  if (!dest || !text) return { ok: false, error: "Missing to or body", status: 400 };

  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const service = process.env.TWILIO_MESSAGING_SERVICE_SID;
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!sid || !token || (!service && !from)) {
    return {
      ok: false,
      error: "SMS not configured — set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_MESSAGING_SERVICE_SID (or TWILIO_FROM_NUMBER) on Vercel.",
      status: 503,
    };
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
  const auth = Buffer.from(`${sid}:${token}`).toString("base64");
  const form = new URLSearchParams({ To: dest, Body: withOptOut(text) });
  // A Messaging Service wins over a bare number: it is what the 10DLC
  // campaign is registered on.
  if (service) form.set("MessagingServiceSid", service);
  else form.set("From", from as string);
  if (opts.statusCallback) form.set("StatusCallback", opts.statusCallback);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data as { message?: string }).message || `Twilio responded ${res.status}`;
    const code = (data as { code?: number }).code;
    return { ok: false, error: msg, status: res.status, ...(code ? { code } : {}) };
  }
  return { ok: true, sid: (data as { sid?: string }).sid, status: 200 };
}
