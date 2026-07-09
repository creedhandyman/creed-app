import { NextRequest, NextResponse } from "next/server";
import { serviceClient } from "@/lib/api-auth";
import { verifyJobToken } from "@/lib/job-token";
import { verifySession, PORTAL_COOKIE_NAME } from "@/lib/portal-session";
import { itemInTier, type TierKey } from "@/lib/tiers";

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
  /** Server-signed approval token from the /status link (see job-token.ts). */
  token: string;
  signatureType: "typed" | "canvas";
  /** For typed: the customer's typed full name. For canvas: a
   *  base64 data URL of the inked PNG. */
  signatureValue: string;
  /** Good-Better-Best: the option the customer picked. When the job's blob
   *  is tiered, this sets the accepted total (from the blob's tierTotals) and
   *  records which tier was chosen. Ignored for non-tiered quotes. */
  tier?: "base" | "better" | "best";
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
    const token = trim(body.token);
    const signatureType = body.signatureType;
    const signatureValue = trim(body.signatureValue);

    if (!jobId || !signatureValue) {
      return NextResponse.json({ error: "Missing jobId or signatureValue" }, { status: 400 });
    }
    if (signatureType !== "typed" && signatureType !== "canvas") {
      return NextResponse.json({ error: "Invalid signatureType" }, { status: 400 });
    }
    const supabase = serviceClient();

    // Pull the current job to decide whether to promote status. Only
    // "quoted" rolls forward — re-signing a paid invoice or an
    // already-accepted job shouldn't reset the workflow. org_id/customer_id
    // also feed the portal-session authorization below.
    const { data: jobs, error: getErr } = await supabase
      .from("jobs")
      .select("id, status, client_signature, org_id, customer_id, rooms, total")
      .eq("id", jobId)
      .limit(1);
    if (getErr) return NextResponse.json({ error: getErr.message }, { status: 500 });
    if (!jobs?.length) return NextResponse.json({ error: "Job not found" }, { status: 404 });
    const job = jobs[0];

    // Authorize the approval — EITHER proof is sufficient:
    //   (1) the server-signed token from the /status link (proves the quote
    //       was actually sent to this customer), OR
    //   (2) a valid portal session that OWNS this job — the same
    //       (customer_id, org_id) rule /api/portal/me uses to decide which
    //       jobs a customer can see. Portal job links are token-less, so this
    //       lets a logged-in portal customer approve their own quote.
    // Without either, someone who merely learns a job id can't forge approval.
    const portalSession = verifySession(req.cookies.get(PORTAL_COOKIE_NAME)?.value);
    const portalOwnsJob =
      !!portalSession &&
      !!job.customer_id &&
      portalSession.customer_id === job.customer_id &&
      portalSession.org_id === job.org_id;
    if (!verifyJobToken(jobId, token) && !portalOwnsJob) {
      return NextResponse.json(
        { error: "This approval link is invalid or expired — please ask for a new link." },
        { status: 403 },
      );
    }

    // Never overwrite an existing approval — once signed, it's locked.
    if (job.client_signature) {
      return NextResponse.json({ error: "This quote has already been approved." }, { status: 409 });
    }

    const ip = getClientIp(req);
    const nowIso = new Date().toISOString();

    const patch: Record<string, unknown> = {
      client_signature: signatureValue,
      signature_date: new Date().toLocaleDateString(),
      approved_at: nowIso,
      approved_ip: ip || null,
    };
    if (job.status === "quoted") patch.status = "accepted";

    // Tiered (Good-Better-Best) quote: the customer's picked option sets the
    // accepted total + records which tier they chose. Option prices come from
    // the blob's tierTotals (computed by the editor's authoritative pricing
    // cascade) so there's no server-side re-derivation of the math.
    const tier = body.tier;
    if (tier === "base" || tier === "better" || tier === "best") {
      try {
        const blob = typeof job.rooms === "string" ? JSON.parse(job.rooms) : job.rooms;
        const tt = blob?.tierTotals as Record<string, number> | undefined;
        if (blob?.tieredQuote === true && tt && typeof tt[tier] === "number" && tt[tier] >= 0) {
          patch.total = tt[tier];
          blob.acceptedTier = tier;
          // Lock the rest of the job to the accepted option so the crew + the
          // paperwork match what was bought: snap the labor/material/hour totals
          // to the tier's stored breakdown, and prune the crew work order to
          // that tier's tasks. The full line-items stay on the blob (customer
          // reference + any later upsell); only the operational artifacts move.
          const bk = blob?.tierBreakdown?.[tier] as { labor?: number; mat?: number; hrs?: number } | undefined;
          if (bk) {
            if (typeof bk.labor === "number") patch.total_labor = bk.labor;
            if (typeof bk.mat === "number") patch.total_mat = bk.mat;
            if (typeof bk.hrs === "number") patch.total_hrs = bk.hrs;
          }
          // Work-order tasks carry their line-item option MEMBERSHIP at save
          // time; keep only tasks whose set includes the accepted option.
          // Legacy tasks (single `tier`, no `tiers`) fall back to the cumulative
          // reading via itemInTier, and untagged tasks stay in (never hidden).
          if (Array.isArray(blob?.workOrder)) {
            blob.workOrder = blob.workOrder.filter(
              (w: { tier?: string; tiers?: TierKey[] }) => itemInTier(w, tier),
            );
          }
          patch.rooms = JSON.stringify(blob);
        }
      } catch {
        /* malformed blob — fall back to the stored total */
      }
    }

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
