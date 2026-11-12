import { NextRequest, NextResponse } from "next/server";
import { cronAuth } from "@/lib/cron-auth";
import { serviceClient } from "@/lib/api-auth";
import { dispatchDueCampaigns } from "@/lib/campaigns-server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Cron (every 15 minutes, vercel.json): sends queued campaign emails that
 * are due. Auth: lib/cron-auth.ts. Each run sends for up to ~4 minutes,
 * then leaves the rest queued for the next run. Does nothing for a business
 * with campaigns switched off.
 */
async function handle(req: NextRequest): Promise<NextResponse> {
  if (!cronAuth(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const summary = await dispatchDueCampaigns(serviceClient(), { budgetMs: 240_000 });
    return NextResponse.json({ ok: true, ...summary, ts: new Date().toISOString() });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Dispatch failed" }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
