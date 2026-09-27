import { NextRequest, NextResponse } from "next/server";
import { serviceClient } from "@/lib/api-auth";
import { verifyJobToken } from "@/lib/job-token";
import { verifySession, PORTAL_COOKIE_NAME } from "@/lib/portal-session";
import { itemInTier, type TierKey } from "@/lib/tiers";
import { scopeFingerprint, type ApprovalRecord } from "@/lib/approval";
import type { Room } from "@/lib/types";

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
  /** What the customer's /status page was showing when they signed:
   *  scopeFingerprint of its line items + the total it displayed. When sent,
   *  the approval is refused (409, stale) if the quote changed since. Older
   *  page bundles send neither and are accepted as before. */
  scopeFp?: string;
  shownTotal?: number;
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
    // The signature is customer-supplied and prints on the quote PDFs, so
    // hold it to the shapes /status produces: a typed name, or the signature
    // pad's PNG (a few KB — the cap only stops abuse).
    if (signatureType === "typed") {
      if (signatureValue.length > 100 || /[\u0000-\u001f\u007f]/.test(signatureValue) || /^data:/i.test(signatureValue)) {
        return NextResponse.json({ error: "Please type your full name (up to 100 characters)." }, { status: 400 });
      }
    } else if (signatureValue.length > 400_000 || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(signatureValue)) {
      return NextResponse.json({ error: "That signature couldn't be read — please sign again." }, { status: 400 });
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
    // A lead is a request that hasn't been quoted — nothing to approve yet.
    if (job.status === "lead") {
      return NextResponse.json({ error: "Your quote isn't ready yet — you'll get a link once it's sent." }, { status: 409 });
    }

    // Stale page: the customer approves what THEIR page showed. If the owner
    // revised the quote after it loaded, refuse — /status reloads — instead
    // of recording an approval of scope or a price they never saw.
    const shownFp = typeof body.scopeFp === "string" ? body.scopeFp : "";
    const shownTotal =
      typeof body.shownTotal === "number" && Number.isFinite(body.shownTotal) ? body.shownTotal : null;
    if (shownFp || shownTotal !== null) {
      let current: Record<string, unknown> | null = null;
      try {
        current = typeof job.rooms === "string" ? JSON.parse(job.rooms) : job.rooms ?? null;
      } catch {
        current = null;
      }
      const tt = current?.tierTotals as Record<string, number> | undefined;
      const t = body.tier;
      const expectedTotal =
        current?.tieredQuote === true && tt && (t === "base" || t === "better" || t === "best") && typeof tt[t] === "number"
          ? tt[t]
          : Number(job.total) || 0;
      const fpNow = scopeFingerprint(Array.isArray(current?.rooms) ? (current!.rooms as Room[]) : []);
      if ((shownFp && shownFp !== fpNow) || (shownTotal !== null && Math.abs(shownTotal - expectedTotal) > 0.01)) {
        return NextResponse.json(
          { error: "This quote was updated after you opened it — reloading so you can review the latest version.", stale: true },
          { status: 409 },
        );
      }
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

    // Record WHAT was signed: a fingerprint of the quote's line items + the
    // approved amount, on the rooms blob (acceptedTier's home too, and
    // QuoteForge's save spreads unknown blob keys, so it survives re-saves).
    // The quote PDF prints the customer's signature only while the items it
    // prints still match — a quote revised after signing never shows the
    // signature on scope the customer didn't approve. Stamped on ANY object
    // blob — one with no line items yet records the empty scope, so items
    // added later read as a revision. Best-effort: an unparseable blob just
    // means no record (the PDF then won't print the signature against any
    // version); never fails the approval.
    let approval: ApprovalRecord | null = null;
    try {
      const base = typeof patch.rooms === "string" ? patch.rooms : job.rooms;
      const blob = typeof base === "string" ? JSON.parse(base) : base;
      if (blob && typeof blob === "object" && !Array.isArray(blob)) {
        const acceptedTier = blob.acceptedTier;
        approval = {
          v: 1,
          fp: scopeFingerprint(Array.isArray(blob.rooms) ? blob.rooms : []),
          total: typeof patch.total === "number" ? patch.total : Number(job.total) || 0,
          at: nowIso,
          ...(acceptedTier === "base" || acceptedTier === "better" || acceptedTier === "best"
            ? { tier: acceptedTier as TierKey }
            : {}),
        };
        blob.approval = approval;
        patch.rooms = JSON.stringify(blob);
      }
    } catch {
      approval = null;
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

    // `approval` lets the /status page fold the record into its local copy of
    // the job, so a PDF downloaded right after signing prints the approval.
    return NextResponse.json({ ok: true, status: patch.status || job.status, approval });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    // eslint-disable-next-line no-console
    console.error("approve error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
