import { NextRequest, NextResponse } from "next/server";
import { requireOwner, serviceClient } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

/** POST /api/campaigns/cancel { id } — stop a scheduled or sending campaign.
 *  Emails already sent stay sent; everything still queued is dropped.
 *  A draft is deleted instead. Owner/manager only. */
export async function POST(req: NextRequest) {
  const auth = await requireOwner(req);
  if (auth instanceof NextResponse) return auth;
  const b = (await req.json().catch(() => ({}))) as { id?: unknown };
  if (typeof b.id !== "string" || !b.id) return NextResponse.json({ error: "Missing campaign" }, { status: 400 });
  const sb = serviceClient();
  const { data: c } = await sb.from("campaigns").select("id, status").eq("id", b.id).eq("org_id", auth.orgId!).maybeSingle();
  if (!c) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  if (c.status === "draft") {
    await sb.from("campaigns").delete().eq("id", c.id).eq("org_id", auth.orgId!);
    return NextResponse.json({ ok: true, deleted: true });
  }
  if (c.status !== "scheduled" && c.status !== "sending") {
    return NextResponse.json({ error: "This campaign already finished." }, { status: 409 });
  }
  await sb.from("campaigns").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", c.id);
  const { data: dropped } = await sb
    .from("campaign_sends").update({ status: "skipped", error: "Campaign cancelled" })
    .eq("campaign_id", c.id).eq("status", "queued").select("id");
  return NextResponse.json({ ok: true, dropped: dropped?.length || 0 });
}
