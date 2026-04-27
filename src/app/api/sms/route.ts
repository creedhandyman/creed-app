import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Server-side Twilio SMS send. Called from in-app one-tap "On the way",
 * "Running late", "Job complete" buttons. We don't pull in the Twilio
 * SDK — a single fetch to the REST API is enough and keeps the server
 * bundle lean.
 *
 * Required environment variables on Vercel:
 *   - TWILIO_ACCOUNT_SID
 *   - TWILIO_AUTH_TOKEN
 *   - TWILIO_FROM_NUMBER  (a Twilio-purchased number in E.164,
 *                          e.g. "+15551234567")
 *
 * If any env var is missing, return a 503 with a hint so Bernard
 * notices in the toast and knows what to add to Vercel.
 */

interface Body {
  to: string;
  body: string;
  jobId?: string;
}

const trim = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** Light E.164 normalization. We assume US numbers if there's no
 *  country code so Bernard can paste 555-555-5555 from Customers and
 *  it Just Works. If the number already starts with "+", keep it.
 *  Twilio rejects malformed numbers with a 400 — surfaced via the
 *  toast. */
function normalizePhone(raw: string): string {
  const v = raw.trim();
  if (!v) return "";
  if (v.startsWith("+")) return "+" + v.slice(1).replace(/\D/g, "");
  const digits = v.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return digits ? `+${digits}` : "";
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Body;
    const to = normalizePhone(trim(body.to));
    const text = trim(body.body);

    if (!to || !text) {
      return NextResponse.json({ error: "Missing to or body" }, { status: 400 });
    }

    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    const from = process.env.TWILIO_FROM_NUMBER;
    if (!sid || !token || !from) {
      return NextResponse.json(
        { error: "SMS not configured — TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_FROM_NUMBER must be set on Vercel." },
        { status: 503 }
      );
    }

    const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
    const auth = Buffer.from(`${sid}:${token}`).toString("base64");
    const form = new URLSearchParams({ To: to, From: from, Body: text });

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
      // Twilio puts a human-readable explanation in `message`.
      const msg = (data as { message?: string }).message || `Twilio responded ${res.status}`;
      return NextResponse.json({ error: msg }, { status: res.status });
    }

    return NextResponse.json({ ok: true, sid: (data as { sid?: string }).sid });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    // eslint-disable-next-line no-console
    console.error("sms error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
