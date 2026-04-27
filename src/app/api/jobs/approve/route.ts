import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

/**
 * Customer-side quote approval. The /status page POSTs here when a
 * client either types their name + ticks the authorization box OR
 * submits a canvas signature. Server-side because we want to:
 *   1. Capture the request IP for the audit trail (only the server
 *      sees the real x-forwarded-for chain).
 *   2. Stamp approved_at with the server's clock, not the client's.
 *   3. Auto-promote a "quoted" job to "accepted" atomically.
 *
 * Uses the service-role key so writes succeed regardless of any RLS
 * config — the caller is not authenticated.
 */

interface Body {
  jobId: string;
  signatureType: "typed" | "canvas";
  /** For typed: the customer's typed full name. For canvas: a
   *  base64 data URL of the inked PNG. */
  signatureValue: string;
}

const trim = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

function getClientIp(req: NextRequest): string {
  // x-forwarded-for is a comma-separated list, leftmost is original
  // client. Vercel sets x-real-ip too — fall back to that, then to
  // the request's own remoteAddress equivalent.
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  const xri = req.headers.get("x-real-ip");
  if (xri) return xri.trim();
  return "";
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Body;
    const jobId = trim(body.jobId);
    const signatureType = body.signatureType;
    const signatureValue = trim(body.signatureValue);

    if (!jobId || !signatureValue) {
      return NextResponse.json({ error: "Missing jobId or signatureValue" }, { status: 400 });
    }
    if (signatureType !== "typed" && signatureType !== "canvas") {
      return NextResponse.json({ error: "Invalid signatureType" }, { status: 400 });
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    // Pull the current job to decide whether to promote status. Only
    // "quoted" rolls forward — re-signing a paid invoice or an
    // already-accepted job shouldn't reset the workflow.
    const { data: jobs, error: getErr } = await supabase
      .from("jobs")
      .select("id, status")
      .eq("id", jobId)
      .limit(1);
    if (getErr) return NextResponse.json({ error: getErr.message }, { status: 500 });
    if (!jobs?.length) return NextResponse.json({ error: "Job not found" }, { status: 404 });
    const job = jobs[0];

    const ip = getClientIp(req);
    const nowIso = new Date().toISOString();

    const patch: Record<string, unknown> = {
      client_signature: signatureValue,
      signature_date: new Date().toLocaleDateString(),
      approved_at: nowIso,
      approved_ip: ip || null,
    };
    if (job.status === "quoted") patch.status = "accepted";

    const { error: updErr } = await supabase
      .from("jobs")
      .update(patch)
      .eq("id", jobId);
    if (updErr) {
      // The most likely failure is a missing approved_at / approved_ip
      // column. Surface a helpful hint so Bernard knows to run the
      // schema migration.
      return NextResponse.json(
        { error: `${updErr.message}${updErr.message.includes("approved_") ? " — has the schema migration been run? See CLAUDE.md." : ""}` },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, status: patch.status || job.status });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    // eslint-disable-next-line no-console
    console.error("approve error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
