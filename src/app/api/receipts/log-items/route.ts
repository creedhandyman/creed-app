import { NextRequest, NextResponse } from "next/server";
import { getAuthedProfile, serviceClient } from "@/lib/api-auth";
import { isSupplyStore, receiptLog, receiptPurchaseLines, type ScannedItem } from "@/lib/receipt-lines";
import type { StoredPrice } from "@/lib/purchase-import";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MAX_ITEMS = 300;
const missingTable = (err: { code?: string; message?: string } | null) =>
  !!err && (err.code === "42P01" || err.code === "PGRST205" || /does not exist|could not find the table/i.test(err.message || ""));

/**
 * Save a scanned receipt's line items to the material log
 * (lib/receipt-lines.ts has the rules): every bought line to
 * material_price_history with the price paid per unit, and the newest price
 * per product to material_prices, which quotes read.
 *
 * Any signed-in member of the org may call it (techs scan receipts), so the
 * writes go through the service role, always stamped with the CALLER's org —
 * the org is never taken from the request.
 *
 * Body: { vendor, date ("YYYY-MM-DD"), items: ScannedItem[], jobId? }
 * Reply: { ok, saved (history lines), prices (products updated), skipped?: "store" | "setup" }
 */
export async function POST(req: NextRequest) {
  const prof = await getAuthedProfile(req);
  if (!prof) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!prof.orgId) return NextResponse.json({ error: "No organization on profile" }, { status: 403 });
  const orgId = prof.orgId;

  let body: { vendor?: unknown; date?: unknown; items?: unknown; jobId?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Bad request" }, { status: 400 }); }

  const vendor = typeof body.vendor === "string" ? body.vendor.slice(0, 80) : "";
  const date = typeof body.date === "string" ? body.date.slice(0, 10) : "";
  const items = (Array.isArray(body.items) ? body.items.slice(0, MAX_ITEMS) : []) as ScannedItem[];
  if (!items.length) return NextResponse.json({ ok: true, saved: 0, prices: 0 });
  // A gas or lunch receipt is an expense on the job, not a material price.
  if (!isSupplyStore(vendor)) return NextResponse.json({ ok: true, saved: 0, prices: 0, skipped: "store" });

  const sb = serviceClient();

  // The job the receipt is on (same org only) names the purchase in the log.
  let job: string | null = null;
  const jobId = typeof body.jobId === "string" ? body.jobId : "";
  if (/^[0-9a-f-]{36}$/i.test(jobId)) {
    const { data } = await sb.from("jobs").select("property, client").eq("id", jobId).eq("org_id", orgId).maybeSingle();
    const j = data as { property?: string | null; client?: string | null } | null;
    job = (j?.property || j?.client || "").slice(0, 80) || null;
  }

  const lines = receiptPurchaseLines({ vendor, date, items }, { job });
  const log = receiptLog(lines, orgId);
  if (!log.history.length) return NextResponse.json({ ok: true, saved: 0, prices: 0 });

  const hist = log.history.map((r) => ({ ...r, created_by: prof.userId }));
  const { error: e1 } = await sb.from("material_price_history")
    .upsert(hist, { onConflict: "org_id,line_hash", ignoreDuplicates: true });
  if (e1) {
    // Migration 20261119 not run: the receipt itself is already saved.
    if (missingTable(e1)) return NextResponse.json({ ok: true, saved: 0, prices: 0, skipped: "setup" });
    console.error("receipt log-items history:", e1.message);
    return NextResponse.json({ error: "Could not save the receipt's items." }, { status: 500 });
  }

  let prices = 0;
  if (log.keys.length) {
    const { data, error: e2 } = await sb.from("material_prices")
      .select("product_key, unit_price, purchased_on").eq("org_id", orgId).in("product_key", log.keys);
    if (e2) {
      console.error("receipt log-items read prices:", e2.message);
      return NextResponse.json({ ok: true, saved: hist.length, prices: 0 });
    }
    const stored: StoredPrice[] = ((data || []) as Array<{ product_key: string; unit_price: number | string; purchased_on: string | null }>)
      .map((r) => ({ product_key: r.product_key, unit_price: Number(r.unit_price), purchased_on: r.purchased_on }));
    const rows = log.prices(stored);
    if (rows.length) {
      const { error: e3 } = await sb.from("material_prices").upsert(rows, { onConflict: "org_id,product_key" });
      if (e3) console.error("receipt log-items prices:", e3.message);
      else prices = rows.length;
    }
  }
  return NextResponse.json({ ok: true, saved: hist.length, prices });
}
