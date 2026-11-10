import { NextRequest, NextResponse } from "next/server";
import { getAuthedProfile, serviceClient } from "@/lib/api-auth";
import { summarizeThreads } from "@/lib/sms-threads";
import { describe, openThread } from "@/lib/sms-threads-server";

export const dynamic = "force-dynamic";

/**
 * One conversation on the Texts screen.
 *   GET  /api/sms/thread?phone=+13165550142  both sides, oldest first, with
 *        the name, job, STOP state and whether texting is on.
 *   POST /api/sms/thread { phone }           mark its received texts read.
 * Same visibility as the list: owners/managers any conversation in their
 * business, crew only conversations on their jobs.
 */
async function open(req: NextRequest, phoneRaw: unknown) {
  const o = await openThread(serviceClient(), await getAuthedProfile(req), phoneRaw);
  if (!o.ok) return { res: NextResponse.json({ error: o.error }, { status: o.status }) };
  return o;
}

export async function GET(req: NextRequest) {
  const o = await open(req, req.nextUrl.searchParams.get("phone"));
  if ("res" in o) return o.res;
  const supabase = serviceClient();
  const [summary] = summarizeThreads(o.rows);
  const [info, orgRes] = await Promise.all([
    describe(supabase, o.viewer.orgId, [summary]),
    supabase.from("organizations").select("auto_sms_enroute").eq("id", o.viewer.orgId).maybeSingle(),
  ]);
  const texting = (orgRes.data as { auto_sms_enroute?: boolean } | null)?.auto_sms_enroute === true;
  return NextResponse.json({
    phone: o.phone,
    jobId: summary.jobId,
    match: summary.match,
    unread: summary.unread,
    texting,
    admin: o.viewer.admin,
    ...info[o.phone],
    messages: [...o.rows].reverse().map((r) => ({
      id: r.id,
      direction: r.direction,
      body: r.body || "",
      status: r.status || "",
      error: r.error || "",
      kind: r.kind || "",
      media: Array.isArray(r.media) ? r.media.filter((m) => m && typeof m.url === "string") : [],
      createdAt: r.created_at,
    })),
  });
}

export async function POST(req: NextRequest) {
  let body: { phone?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  const o = await open(req, body.phone);
  if ("res" in o) return o.res;
  const ids = o.rows.filter((r) => r.direction === "in" && !r.read_at).map((r) => r.id);
  if (ids.length) {
    await serviceClient()
      .from("sms_messages")
      .update({ read_at: new Date().toISOString() })
      .eq("org_id", o.viewer.orgId)
      .in("id", ids);
  }
  return NextResponse.json({ ok: true, marked: ids.length });
}
