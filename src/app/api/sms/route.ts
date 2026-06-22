import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { sendSms } from "@/lib/sms";

export const dynamic = "force-dynamic";

/**
 * Server-side Twilio SMS send. Called from in-app one-tap "On the way",
 * "Running late", "Job complete" buttons (logged-in staff only).
 *
 * Requires a valid Supabase session — previously this was an OPEN endpoint that
 * would send any text to any number on the org's Twilio account (toll fraud /
 * smishing). The actual Twilio call lives in src/lib/sms.ts so the internal
 * portal "lost my link" flow can send without re-POSTing this public route.
 *
 * Env: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER.
 */
interface Body {
  to: string;
  body: string;
  jobId?: string;
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = (await req.json()) as Body;
    const result = await sendSms(body.to, body.body);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({ ok: true, sid: result.sid });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    // eslint-disable-next-line no-console
    console.error("sms error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
