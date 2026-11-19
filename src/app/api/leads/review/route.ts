import { NextRequest, NextResponse } from "next/server";
import { requireOwner, serviceClient } from "@/lib/api-auth";
import { createLead, inputFromHeld } from "@/lib/lead-intake";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // a restore starts the AI draft quote

/**
 * Quote requests held as possible spam (lead_review, written by /api/leads).
 * Owners / managers of the business only.
 *   GET                              → held requests (newest first) + count
 *   POST {action:"restore", id}      → make it a normal lead (same path as a
 *                                      fresh submission; no alert, the owner
 *                                      is the one restoring), AI draft starts
 *   POST {action:"dismiss", id}      → mark it spam (kept, hidden from the list)
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COLS = "id, name, phone, email, street, city, state, zip, description, score, reasons, ai_verdict, created_at";

export async function GET(req: NextRequest) {
  const prof = await requireOwner(req);
  if (prof instanceof NextResponse) return prof;
  const { data, error } = await serviceClient().from("lead_review").select(COLS)
    .eq("org_id", prof.orgId).eq("status", "flagged").order("created_at", { ascending: false }).limit(100);
  if (error) return NextResponse.json({ setup: false, held: [], count: 0 });
  return NextResponse.json({ setup: true, held: data || [], count: (data || []).length });
}

export async function POST(req: NextRequest) {
  const prof = await requireOwner(req);
  if (prof instanceof NextResponse) return prof;
  const orgId = prof.orgId as string;
  let body: { action?: string; id?: string } = {};
  try { body = await req.json(); } catch { /* */ }
  if (!body.id || !UUID.test(body.id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const sb = serviceClient();
  const now = new Date().toISOString();

  if (body.action === "dismiss") {
    const { data } = await sb.from("lead_review").update({ status: "dismissed", reviewed_at: now, reviewed_by: prof.userId })
      .eq("org_id", orgId).eq("id", body.id).eq("status", "flagged").select("id");
    return data?.length ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "already handled" }, { status: 409 });
  }
  if (body.action !== "restore") return NextResponse.json({ error: "unknown action" }, { status: 400 });

  // Claim it first so two taps (or two managers) can't make two leads.
  const { data: claimed } = await sb.from("lead_review")
    .update({ status: "restored", reviewed_at: now, reviewed_by: prof.userId })
    .eq("org_id", orgId).eq("id", body.id).eq("status", "flagged")
    .select("id, name, phone, email, street, city, state, zip, description, payload, from_tag, email_tag");
  const row = claimed?.[0];
  if (!row) return NextResponse.json({ error: "already handled" }, { status: 409 });
  const made = await createLead(sb, orgId, inputFromHeld(row), {
    notify: false, draft: true, extraBlob: { leadRestoredFromReview: now },
  });
  if (!made.ok) {
    await sb.from("lead_review").update({ status: "flagged", reviewed_at: null, reviewed_by: null }).eq("org_id", orgId).eq("id", row.id);
    return NextResponse.json({ error: made.error }, { status: 500 });
  }
  await sb.from("lead_review").update({ job_id: made.jobId }).eq("org_id", orgId).eq("id", row.id);
  return NextResponse.json({ ok: true, job_id: made.jobId });
}
