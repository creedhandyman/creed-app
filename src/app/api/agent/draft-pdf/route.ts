import { NextRequest, NextResponse } from "next/server";
import { serviceClient } from "@/lib/api-auth";
import { tryReadBlob } from "@/lib/job-blob";
import { verifyDraftPdf } from "@/lib/agent/draft-link";
import { jobQuotePdfHtml } from "@/lib/quote-pdf";
import { draftTotals } from "@/lib/lead-draft";
import { shouldOfferTiers } from "@/lib/tiers";
import type { Job, Room } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * The printable page of an AI draft quote (the agent API's `pdf_link`):
 * the same quote PDF the customer would get, marked DRAFT, opened from a
 * signed 7-day link (lib/agent/draft-link.ts). Open it and print → Save as
 * PDF. Read-only; it never changes the job.
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const jobId = q.get("job") || "";
  if (!/^[0-9a-f-]{36}$/i.test(jobId) || !verifyDraftPdf(jobId, q.get("exp"), q.get("sig"))) {
    return new NextResponse("This link is invalid or has expired.", { status: 403 });
  }
  const sb = serviceClient();
  const { data: job } = await sb.from("jobs").select("*").eq("id", jobId).maybeSingle();
  if (!job) return new NextResponse("Not found", { status: 404 });
  const blob = tryReadBlob(job.rooms) || {};
  const draft = blob.leadDraft as { rooms?: Room[]; estDays?: number | null } | undefined;
  const saved = Array.isArray(blob.rooms) && blob.rooms.length > 0;
  const rooms = saved ? (blob.rooms as Room[]) : (draft?.rooms || []);
  if (!rooms.length) return new NextResponse("No draft on this job yet.", { status: 404 });

  const { data: org } = await sb.from("organizations")
    .select("name, phone, email, logo_url, address, license_num, default_rate, trade_rates, markup_pct, tax_pct, tax_mode, trip_fee, min_labor_hours, brand_color, brand_color_2, deposit_pct, quote_valid_days, quote_terms, material_tax_pct, material_tax_by_zip")
    .eq("id", job.org_id).maybeSingle();
  const { data: extra } = await sb.from("organizations").select("tiered_quotes_default, flat_pricing").eq("id", job.org_id).maybeSingle();
  const o = { ...(org || {}), ...(extra || {}) } as Record<string, unknown>;

  // A saved quote prints as itself; a draft prints the way the editor would
  // open it (the business's option default, the AI's day estimate).
  const view: Job = saved
    ? (job as Job)
    : {
        ...(job as Job),
        rooms: JSON.stringify({
          ...blob,
          rooms,
          tieredQuote: shouldOfferTiers(rooms, o.tiered_quotes_default !== false),
          estDays: draft?.estDays ?? null,
        }),
        ...(() => {
          const t = draftTotals(rooms, o, job.property || "");
          return { total: t.total, total_labor: t.labor, total_mat: t.materials, total_hrs: t.hours };
        })(),
      };
  let html = jobQuotePdfHtml(view, o as Parameters<typeof jobQuotePdfHtml>[1]);
  if (!saved) {
    html = html.replace(
      "<body>",
      '<body><div style="background:#fff4d6;border:1px solid #e0b84c;color:#6b4e00;padding:8px 12px;margin:0 0 10px;font:600 13px system-ui,sans-serif;text-align:center">DRAFT: not sent yet. The business will review this before it goes to the customer.</div>',
    );
  }
  return new NextResponse(html, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex" },
  });
}
