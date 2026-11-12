import { NextRequest, NextResponse } from "next/server";
import { requireOwner, serviceClient } from "@/lib/api-auth";
import { isAudience } from "@/lib/campaigns";

export const dynamic = "force-dynamic";

/**
 * GET  /api/campaigns           → this business's campaigns, newest first,
 *                                 each with its send counts.
 * POST /api/campaigns { id?, name, subject, body, audience }
 *                               → create or save a DRAFT. Saving never sends.
 * Owner/manager only. The Campaigns screen (Ops → Campaigns) is the caller.
 */
export async function GET(req: NextRequest) {
  const auth = await requireOwner(req);
  if (auth instanceof NextResponse) return auth;
  const sb = serviceClient();
  const { data, error } = await sb
    .from("campaigns")
    .select("*")
    .eq("org_id", auth.orgId!)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const campaigns = data || [];
  const ids = campaigns.map((c: { id: string }) => c.id);
  const stats: Record<string, Record<string, number>> = {};
  if (ids.length) {
    const { data: sends } = await sb
      .from("campaign_sends")
      .select("campaign_id, status, opened_at, clicked_at, bounced_at, complained_at")
      .in("campaign_id", ids)
      .limit(50000);
    for (const s of (sends || []) as { campaign_id: string; status: string; opened_at: string | null; clicked_at: string | null; bounced_at: string | null; complained_at: string | null }[]) {
      const st = (stats[s.campaign_id] ||= { queued: 0, sending: 0, sent: 0, failed: 0, skipped: 0, opened: 0, clicked: 0, bounced: 0, complained: 0 });
      st[s.status] = (st[s.status] || 0) + 1;
      if (s.opened_at) st.opened++;
      if (s.clicked_at) st.clicked++;
      if (s.bounced_at) st.bounced++;
      if (s.complained_at) st.complained++;
    }
  }
  return NextResponse.json({ campaigns, stats });
}

const clip = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : "");

export async function POST(req: NextRequest) {
  const auth = await requireOwner(req);
  if (auth instanceof NextResponse) return auth;
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const audience = isAudience(b.audience) ? b.audience : "all";
  const row = {
    name: clip(b.name, 120).trim() || "Untitled campaign",
    subject: clip(b.subject, 200),
    body: clip(b.body, 20000),
    audience,
    updated_at: new Date().toISOString(),
  };
  const sb = serviceClient();
  if (typeof b.id === "string" && b.id) {
    // Only a draft can be edited: once queued, the email people get is fixed.
    const { data, error } = await sb
      .from("campaigns").update(row).eq("id", b.id).eq("org_id", auth.orgId!).eq("status", "draft").select("*");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data?.length) return NextResponse.json({ error: "Only a draft can be edited." }, { status: 409 });
    return NextResponse.json({ campaign: data[0] });
  }
  const { data, error } = await sb
    .from("campaigns")
    .insert({ ...row, org_id: auth.orgId!, status: "draft", created_by: auth.userId })
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ campaign: data });
}
