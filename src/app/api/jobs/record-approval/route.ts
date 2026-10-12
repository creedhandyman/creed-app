import { NextRequest, NextResponse } from "next/server";
import { requireOwner, serviceClient } from "@/lib/api-auth";
import { applyApproval } from "@/lib/approve-job";
import type { ApprovalVia } from "@/lib/approval";

export const dynamic = "force-dynamic";

/**
 * Owner-recorded quote approval — for a homeowner who said yes in person, on
 * the phone or on a paper copy instead of on the /status page. Owner/manager
 * only, scoped to their org. Locks the job exactly like the online approval
 * (shared applyApproval): picked Good-Better-Best option → price + crew work
 * order, status quoted → accepted, approval record (+ how/who recorded it).
 */

interface Body {
  jobId: string;
  tier?: "base" | "better" | "best";
  via: "in_person" | "phone" | "paper";
  /** The homeowner's name (printed as their typed signature). */
  name: string;
  /** Optional: signature drawn on the owner's phone (PNG data URL). */
  signature?: string;
}

const trim = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

export async function POST(req: NextRequest) {
  const auth = await requireOwner(req);
  if (auth instanceof NextResponse) return auth;
  try {
    const body = (await req.json()) as Body;
    const jobId = trim(body.jobId);
    const name = trim(body.name);
    const via: ApprovalVia | null = body.via === "in_person" || body.via === "phone" || body.via === "paper" ? body.via : null;
    if (!jobId || !via) return NextResponse.json({ error: "Missing job or how it was approved" }, { status: 400 });
    if (!name || name.length > 100 || /[\u0000-\u001f\u007f]/.test(name) || /^data:/i.test(name)) {
      return NextResponse.json({ error: "Enter the homeowner's name (up to 100 characters)." }, { status: 400 });
    }
    const drawn = trim(body.signature);
    if (drawn && (drawn.length > 400_000 || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(drawn))) {
      return NextResponse.json({ error: "That signature couldn't be read — please sign again." }, { status: 400 });
    }

    const supabase = serviceClient();
    const { data: jobs, error: getErr } = await supabase
      .from("jobs")
      .select("id, status, client_signature, org_id, rooms, total")
      .eq("id", jobId)
      .limit(1);
    if (getErr) return NextResponse.json({ error: getErr.message }, { status: 500 });
    const job = jobs?.[0];
    if (!job || job.org_id !== auth.orgId) return NextResponse.json({ error: "Job not found" }, { status: 404 });
    if (job.client_signature) return NextResponse.json({ error: "This quote is already approved." }, { status: 409 });
    if (job.status === "lead") return NextResponse.json({ error: "Build and save the quote first." }, { status: 409 });

    let tiered = false;
    try {
      const b = typeof job.rooms === "string" ? JSON.parse(job.rooms) : job.rooms;
      tiered = b?.tieredQuote === true && !!b?.tierTotals;
    } catch { /* not tiered */ }
    const tier = body.tier === "base" || body.tier === "better" || body.tier === "best" ? body.tier : null;
    if (tiered && !tier) return NextResponse.json({ error: "Pick the option the homeowner chose." }, { status: 400 });

    // Who recorded it — printed as "recorded by …".
    let by = auth.email || "";
    try {
      const { data: prof } = await supabase.from("profiles").select("name").eq("id", auth.userId).limit(1);
      if (prof?.[0]?.name) by = String(prof[0].name);
    } catch { /* email fallback */ }

    const nowIso = new Date().toISOString();
    const { patch, blob, approval } = applyApproval(job, {
      // A drawn signature prints as the signature; otherwise their name does.
      signature: drawn || name,
      tier,
      nowIso,
      via,
      by,
      signer: name,
    });
    if (blob) patch.rooms = JSON.stringify(blob);

    const { error: updErr } = await supabase.from("jobs").update(patch).eq("id", jobId).eq("org_id", auth.orgId);
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });
    return NextResponse.json({ ok: true, status: patch.status || job.status, total: patch.total ?? job.total, approval });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    // eslint-disable-next-line no-console
    console.error("record-approval error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
