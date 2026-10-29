import { NextRequest, NextResponse } from "next/server";
import { getAuthedProfile, serviceClient } from "@/lib/api-auth";
import { verifyJobToken } from "@/lib/job-token";
import { notifyQuoteViewed } from "@/lib/notify-server";
import { looksLikeBot, shouldNotifyView } from "@/lib/quote-followup";

export const dynamic = "force-dynamic";

/**
 * POST /api/jobs/viewed — the customer-facing /status page calls this once per
 * browser session when a quoted job is opened. Records the open
 * (quote_view_count / quote_viewed_at) and alerts the owner ("Dave opened your
 * quote") on the first open and after a quiet gap on re-opens.
 *
 * Body: { job: string, t: string }   (the same signed token the Approve flow
 * uses — only a link we actually sent counts, so a guessed/forged job id can't
 * inflate counts or spam alerts).
 *
 * Not counted: link-preview bots; a signed-in member of the job's own org (the
 * owner previewing the link — the page forwards their session if there is one).
 * Never errors loudly: the customer's page must not care whether this lands, and
 * until the migration adds the columns it quietly does nothing.
 */
export async function POST(req: NextRequest) {
  const quiet = (extra: Record<string, unknown> = {}) => NextResponse.json({ ok: true, ...extra });
  try {
    const { job: jobId, t } = (await req.json().catch(() => ({}))) as { job?: string; t?: string };
    if (!jobId || !verifyJobToken(jobId, t)) return quiet({ counted: false });
    if (looksLikeBot(req.headers.get("user-agent"))) return quiet({ counted: false });

    const supabase = serviceClient();
    const { data: row } = await supabase.from("jobs").select("*").eq("id", jobId).maybeSingle();
    const job = row as Record<string, unknown> | null;
    if (!job || job.status !== "quoted" || !job.org_id) return quiet({ counted: false });

    // The owner (or crew) previewing their own link shouldn't read as the customer.
    const prof = await getAuthedProfile(req).catch(() => null);
    if (prof?.orgId && prof.orgId === job.org_id) return quiet({ counted: false, own: true });

    const now = Date.now();
    const prevCount = Number(job.quote_view_count) || 0;
    const prevAt = (job.quote_viewed_at as string | null) ?? null;
    const alert = shouldNotifyView(prevAt, prevCount, now);
    const viewCount = prevCount + 1;

    const { error } = await supabase
      .from("jobs")
      .update({ quote_view_count: viewCount, quote_viewed_at: new Date(now).toISOString() })
      .eq("id", jobId);
    if (error) return quiet({ counted: false }); // columns missing until the migration runs

    if (alert) {
      await notifyQuoteViewed(supabase, {
        jobId,
        orgId: String(job.org_id),
        total: Number(job.total) || null,
        property: (job.property as string | null) ?? null,
        client: (job.client as string | null) ?? null,
        viewCount,
      });
    }
    return quiet({ counted: true });
  } catch {
    return quiet({ counted: false });
  }
}
