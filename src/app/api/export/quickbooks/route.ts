import { NextRequest, NextResponse } from "next/server";
import { requireOwner, serviceClient } from "@/lib/api-auth";
import { buildQuickBooksExport, type QbCustomer, type QbJob, type QbPayment, type QbReceipt } from "@/lib/export-quickbooks";

export const dynamic = "force-dynamic";

/**
 * POST /api/export/quickbooks — owner/manager only. Body {from?, to?}
 * (YYYY-MM-DD, inclusive; omit both = all time). Returns the four QuickBooks
 * Online CSV file contents. `payments` is service-role-only, hence the route.
 */
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(req: NextRequest) {
  const prof = await requireOwner(req);
  if (prof instanceof NextResponse) return prof;
  const body = (await req.json().catch(() => ({}))) as { from?: string; to?: string };
  const from = body.from && DATE.test(body.from) ? body.from : null;
  const to = body.to && DATE.test(body.to) ? body.to : null;
  if ((body.from && !from) || (body.to && !to)) {
    return NextResponse.json({ error: "Invalid date" }, { status: 400 });
  }
  const orgId = prof.orgId as string;
  const sb = serviceClient();
  try {
    const [jobs, payments, receipts, customers, addresses] = await Promise.all([
      sb.from("jobs").select("id, client, property, job_date, created_at, total, status, archived, rooms, customer_id").eq("org_id", orgId),
      sb.from("payments").select("job_id, amount, kind, stripe_session_id, created_at").eq("org_id", orgId),
      sb.from("receipts").select("job_id, note, amount, receipt_date, created_at").eq("org_id", orgId),
      sb.from("customers").select("id, name, type, email, phone").eq("org_id", orgId),
      sb.from("addresses").select("customer_id, street, city, state, zip, created_at").eq("org_id", orgId).order("created_at", { ascending: true }),
    ]);
    // A missing payments table (migration not run) just means no ledger rows.
    for (const r of [jobs, receipts, customers]) if (r.error) throw new Error(r.error.message);
    const firstAddr = new Map<string, { street?: string; city?: string; state?: string; zip?: string }>();
    for (const a of (addresses.data || []) as Array<{ customer_id: string; street?: string; city?: string; state?: string; zip?: string }>) {
      if (a.customer_id && !firstAddr.has(a.customer_id)) firstAddr.set(a.customer_id, a);
    }
    const custs = ((customers.data || []) as QbCustomer[]).map((c) => ({ ...c, ...(firstAddr.get(c.id) || {}) }));
    const out = buildQuickBooksExport(
      {
        jobs: (jobs.data || []) as QbJob[],
        payments: (payments.error ? [] : payments.data || []) as QbPayment[],
        receipts: (receipts.data || []) as QbReceipt[],
        customers: custs,
      },
      { from, to },
    );
    return NextResponse.json(out);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Export failed" }, { status: 500 });
  }
}
