import { NextRequest, NextResponse } from "next/server";
import { serviceClient } from "@/lib/api-auth";
import { cronAuth } from "@/lib/cron-auth";
import { syncOrgById } from "@/lib/gcal/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Every 10 minutes (vercel.json): the fallback when a push notification is
 * missed or a schedule row was written server-side (online booking, recurring
 * visits, AppFolio, the agent API). Each pass also renews the push channel.
 */
export async function GET(req: NextRequest) {
  if (!cronAuth(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const sb = serviceClient();
  const { data, error } = await sb.from("google_calendar_links").select("org_id").eq("status", "active").limit(500);
  if (error) return NextResponse.json({ ok: false, error: error.message });
  const deadline = Date.now() + 240000;
  const out: Record<string, string> = {};
  for (const { org_id } of data || []) {
    if (Date.now() > deadline) { out[org_id] = "next run"; continue; }
    const r = await syncOrgById(org_id, sb);
    out[org_id] = r.ok ? `pushed ${r.result.pushed}, pulled ${r.result.pulled}` : r.reason;
  }
  return NextResponse.json({ ok: true, orgs: out });
}
