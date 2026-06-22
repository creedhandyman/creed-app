// Server-only Twilio sender. Single send path shared by /api/sms (after auth)
// and /api/portal/request-link (server-to-server) so there's no internal HTTP
// hop to a public route — that hop is what made /api/sms hard to lock down.

/** Loose US → E.164. "+" prefixes are kept; bare 10/11-digit US numbers get +1. */
export function normalizePhone(raw: string): string {
  const v = (raw || "").trim();
  if (!v) return "";
  if (v.startsWith("+")) return "+" + v.slice(1).replace(/\D/g, "");
  const digits = v.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return digits ? `+${digits}` : "";
}

export interface SmsResult {
  ok: boolean;
  sid?: string;
  error?: string;
  status: number;
}

export async function sendSms(to: string, body: string): Promise<SmsResult> {
  const dest = normalizePhone(to);
  const text = (body || "").trim();
  if (!dest || !text) return { ok: false, error: "Missing to or body", status: 400 };

  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!sid || !token || !from) {
    return {
      ok: false,
      error: "SMS not configured — TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_FROM_NUMBER must be set on Vercel.",
      status: 503,
    };
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
  const auth = Buffer.from(`${sid}:${token}`).toString("base64");
  const form = new URLSearchParams({ To: dest, From: from, Body: text });

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
    return { ok: false, error: msg, status: res.status };
  }
  return { ok: true, sid: (data as { sid?: string }).sid, status: 200 };
}
