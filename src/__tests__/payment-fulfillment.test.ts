import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";

jest.mock("@/lib/notify-server", () => ({ notifyJobPaid: jest.fn(async () => {}) }));

import { notifyJobPaid } from "@/lib/notify-server";
import {
  fulfillJobPayment,
  paymentFromCheckoutSession,
  recordJobRefund,
} from "@/lib/payment-fulfillment";

// ── A tiny in-memory stand-in for the supabase-js query builder ─────────────
type Row = Record<string, unknown>;
interface FakeOpts {
  missingTables?: string[];      // relation does not exist
  missingColumns?: string[];     // jobs column does not exist (select/update)
  throwOn?: string[];            // any query on this table rejects
}
interface Call { table: string; op: string; payload?: unknown; filters: [string, string, unknown][] }

function fakeDb(seed: Record<string, Row[]>, opts: FakeOpts = {}) {
  const tables: Record<string, Row[]> = {};
  for (const [k, v] of Object.entries(seed)) tables[k] = v.map((r) => ({ ...r }));
  const calls: Call[] = [];
  let n = 0;

  function from(table: string) {
    let op = "select";
    let cols = "*";
    let payload: Row | undefined;
    let onConflict: string | undefined;
    const filters: [string, string, unknown][] = [];
    let lim: number | undefined;
    let mode: "many" | "one" | "single" = "many";
    const rows = () => (tables[table] ||= []);
    const match = (r: Row) => filters.every(([k, c, v]) => (k === "eq" ? r[c] === v : r[c] !== v));
    const missingCol = (keys: string[]) => keys.find((k) => opts.missingColumns?.includes(k));

    function run(): { data: unknown; error: { code?: string; message: string } | null } {
      calls.push({ table, op, payload, filters: [...filters] });
      if (opts.throwOn?.includes(table)) throw new Error(`boom on ${table}`);
      if (opts.missingTables?.includes(table)) {
        return { data: null, error: { code: "42P01", message: `relation "${table}" does not exist` } };
      }
      if (op === "insert") {
        const r = payload!;
        if (table === "payments" && rows().some((x) => x.stripe_session_id === r.stripe_session_id)) {
          return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } };
        }
        rows().push({ id: `row${++n}`, ...r });
        return { data: null, error: null };
      }
      if (op === "upsert") {
        const key = onConflict!;
        const i = rows().findIndex((x) => x[key] === payload![key]);
        if (i >= 0) rows()[i] = { ...rows()[i], ...payload };
        else rows().push({ id: `row${++n}`, ...payload });
        return { data: null, error: null };
      }
      if (op === "update") {
        const bad = table === "jobs" && missingCol(Object.keys(payload!));
        if (bad) return { data: null, error: { message: `column jobs.${bad} does not exist` } };
        rows().filter(match).forEach((r) => Object.assign(r, payload));
        return { data: null, error: null };
      }
      const bad = table === "jobs" && missingCol(cols.split(",").map((c) => c.trim()));
      if (bad) return { data: null, error: { message: `column jobs.${bad} does not exist` } };
      let out = rows().filter(match);
      if (lim !== undefined) out = out.slice(0, lim);
      if (mode === "many") return { data: out, error: null };
      if (mode === "single" && out.length !== 1) return { data: null, error: { message: "no rows" } };
      return { data: out[0] ?? null, error: null };
    }

    const b = {
      select(c?: string) { if (c) cols = c; return b; },
      insert(r: Row) { op = "insert"; payload = r; return b; },
      upsert(r: Row, o: { onConflict: string }) { op = "upsert"; payload = r; onConflict = o.onConflict; return b; },
      update(p: Row) { op = "update"; payload = p; return b; },
      eq(c: string, v: unknown) { filters.push(["eq", c, v]); return b; },
      neq(c: string, v: unknown) { filters.push(["neq", c, v]); return b; },
      limit(x: number) { lim = x; return b; },
      maybeSingle() { mode = "one"; return b; },
      single() { mode = "single"; return b; },
      then<T>(res: (v: ReturnType<typeof run>) => T, rej?: (e: unknown) => T) {
        return new Promise<ReturnType<typeof run>>((ok) => ok(run())).then(res, rej);
      },
    };
    return b;
  }
  return { db: { from } as unknown as SupabaseClient, tables, calls };
}

const notify = notifyJobPaid as jest.Mock;
const JOB = "11111111-1111-4111-8111-111111111111";
const ORG = "org-a";
const job = (over: Row = {}): Row => ({
  id: JOB, org_id: ORG, total: 1000, platform_fee_cents: 0, paid_at: null, status: "invoiced", ...over,
});
const charge = (sessionId: string, paidNow: number, over: Partial<Parameters<typeof fulfillJobPayment>[1]> = {}) => ({
  jobId: JOB, expectOrgId: ORG, sessionId, paymentIntentId: `pi_${sessionId}`, paidNow,
  platformFeeCents: 50, kind: "payment", source: "test", ...over,
});

beforeEach(() => notify.mockClear());

test("deposit records but doesn't settle; replay is a no-op; balance settles + asks for a review", async () => {
  const { db, tables } = fakeDb({ jobs: [job()], organizations: [{ id: ORG }] });

  const dep = await fulfillJobPayment(db, charge("cs_dep", 500, { kind: "deposit" }));
  expect(dep.ok && dep.result).toMatchObject({ amountPaid: 500, balance: 500, fullyPaid: false, alreadyRecorded: false });
  expect(tables.jobs[0]).toMatchObject({ amount_paid: 500, status: "invoiced", stripe_payment_intent_id: "pi_cs_dep" });
  expect(tables.review_requests ?? []).toHaveLength(0);
  expect(notify).toHaveBeenCalledTimes(1);
  expect(notify.mock.calls[0][1]).toMatchObject({ jobId: JOB, orgId: ORG, paidNow: 500, amountPaid: 500, fullyPaid: false });

  // The webhook + redirect both fulfil the same session: second call alerts nobody.
  const again = await fulfillJobPayment(db, charge("cs_dep", 500));
  expect(again.ok && again.result).toMatchObject({ amountPaid: 500, alreadyRecorded: true, fullyPaid: false });
  expect(tables.payments).toHaveLength(1);
  expect(notify).toHaveBeenCalledTimes(1);

  const bal = await fulfillJobPayment(db, charge("cs_bal", 500, { kind: "balance" }));
  expect(bal.ok && bal.result).toMatchObject({ amountPaid: 1000, balance: 0, fullyPaid: true });
  expect(tables.jobs[0]).toMatchObject({ status: "paid", amount_paid: 1000, platform_fee_cents: 100 });
  expect(tables.jobs[0].paid_at).toBeTruthy();
  expect(tables.review_requests).toHaveLength(1);
  expect(notify).toHaveBeenCalledTimes(2);
});

test("unknown job / other org's job: nothing recorded, nobody alerted", async () => {
  const { db, tables } = fakeDb({ jobs: [job()] });
  expect(await fulfillJobPayment(db, charge("cs_x", 100, { jobId: "nope" }))).toEqual({ ok: false, reason: "job_not_found" });
  expect(await fulfillJobPayment(db, charge("cs_x", 100, { expectOrgId: "org-b" }))).toEqual({ ok: false, reason: "org_mismatch" });
  expect(tables.payments ?? []).toHaveLength(0);
  expect(notify).not.toHaveBeenCalled();
  // No org on the session (older checkouts) = not checked.
  const ok = await fulfillJobPayment(db, charge("cs_y", 100, { expectOrgId: null }));
  expect(ok.ok).toBe(true);
});

test("manual (cash) payment alerts owners once per ref and honours skipReview", async () => {
  const { db, tables } = fakeDb({ jobs: [job({ stripe_payment_intent_id: "pi_card" })] });
  const cash = charge("manual_abc", 1000, { paymentIntentId: null, platformFeeCents: 0, kind: "cash", skipReview: true });
  const r = await fulfillJobPayment(db, cash);
  expect(r.ok && r.result.fullyPaid).toBe(true);
  expect(tables.review_requests ?? []).toHaveLength(0);
  // A cash payment never wipes the card payment's intent id (refunds need it).
  expect(tables.jobs[0].stripe_payment_intent_id).toBe("pi_card");
  expect(notify).toHaveBeenCalledTimes(1);
  await fulfillJobPayment(db, cash); // double tap
  expect(notify).toHaveBeenCalledTimes(1);
});

test("a failing review-request schedule is logged and never fails the payment", async () => {
  const err = jest.spyOn(console, "error").mockImplementation(() => {});
  const { db, tables } = fakeDb({ jobs: [job()] }, { throwOn: ["review_requests"] });
  const r = await fulfillJobPayment(db, charge("cs_full", 1000));
  expect(r.ok && r.result.fullyPaid).toBe(true);
  expect(tables.jobs[0].status).toBe("paid");
  expect(err).toHaveBeenCalledWith("[test] review-request schedule failed:", expect.any(Error));
  expect(notify).toHaveBeenCalledTimes(1);
  err.mockRestore();
});

test("pre-migration (no payments table, no amount_paid column): a lone deposit doesn't mark paid, a full charge does", async () => {
  const opts = { missingTables: ["payments"], missingColumns: ["amount_paid"] };
  const a = fakeDb({ jobs: [job()] }, opts);
  const dep = await fulfillJobPayment(a.db, charge("cs_d", 500));
  expect(dep.ok && dep.result).toMatchObject({ amountPaid: 500, fullyPaid: false });
  expect(a.tables.jobs[0].status).toBe("invoiced");

  const b = fakeDb({ jobs: [job()] }, opts);
  const full = await fulfillJobPayment(b.db, charge("cs_f", 1000));
  expect(full.ok && full.result.fullyPaid).toBe(true);
  expect(b.tables.jobs[0].status).toBe("paid");
  expect(b.tables.jobs[0].amount_paid).toBeUndefined();
});

test("paymentFromCheckoutSession reads amount, intent, fee and kind", () => {
  const s = {
    id: "cs_1", amount_total: 12345, payment_intent: { id: "pi_9" },
    metadata: { job_id: JOB, org_id: ORG, platform_fee_cents: "62", kind: "deposit" },
  } as unknown as Stripe.Checkout.Session;
  expect(paymentFromCheckoutSession(s)).toEqual({
    jobId: JOB, orgId: ORG, sessionId: "cs_1", paymentIntentId: "pi_9",
    paidNow: 123.45, platformFeeCents: 62, kind: "deposit",
  });
  const old = { id: "cs_2", amount_total: null, payment_intent: "pi_s", metadata: { amount_cents: "5000", platform_fee_cents: "-3" } } as unknown as Stripe.Checkout.Session;
  expect(paymentFromCheckoutSession(old)).toMatchObject({
    jobId: null, orgId: null, paymentIntentId: "pi_s", paidNow: 50, platformFeeCents: 0, kind: "payment",
  });
});

// ── Refunds ─────────────────────────────────────────────────────────────────

function paidJobDb(opts?: FakeOpts) {
  return fakeDb({
    jobs: [job({ status: "paid", paid_at: "2026-10-01T00:00:00Z", amount_paid: 1000, platform_fee_cents: 100 })],
    payments: [
      { id: "p1", org_id: ORG, job_id: JOB, amount: 400, kind: "deposit", stripe_session_id: "cs_a", stripe_payment_intent_id: "pi_a", platform_fee_cents: 40 },
      { id: "p2", org_id: ORG, job_id: JOB, amount: 600, kind: "balance", stripe_session_id: "cs_b", stripe_payment_intent_id: "pi_b", platform_fee_cents: 60 },
    ],
  }, opts);
}

test("partial refund of the deposit: fee prorated, job back to invoiced, org-scoped, idempotent", async () => {
  const { db, tables, calls } = paidJobDb();
  const r = await recordJobRefund(db, { paymentIntentId: "pi_a", chargeCents: 40000, refundedCents: 10000, fullyRefunded: false });
  expect(r).toEqual({ ok: true, jobId: JOB, orgId: ORG, amountPaid: 900, reverted: true });
  expect(tables.payments.find((p) => p.id === "p1")!.platform_fee_cents).toBe(30);
  expect(tables.jobs[0]).toMatchObject({ amount_paid: 900, status: "invoiced", paid_at: null, platform_fee_cents: 90 });
  // Every jobs read/write carries the org filter.
  for (const c of calls.filter((c) => c.table === "jobs")) {
    expect(c.filters).toContainEqual(["eq", "org_id", ORG]);
  }

  // Webhook retry, then the rest refunded: still ONE refund row, cumulative.
  await recordJobRefund(db, { paymentIntentId: "pi_a", chargeCents: 40000, refundedCents: 10000, fullyRefunded: false });
  await recordJobRefund(db, { paymentIntentId: "pi_a", chargeCents: 40000, refundedCents: 40000, fullyRefunded: true });
  const refunds = tables.payments.filter((p) => p.kind === "refund");
  expect(refunds).toHaveLength(1);
  expect(refunds[0].amount).toBe(-400);
  expect(tables.jobs[0]).toMatchObject({ amount_paid: 600, platform_fee_cents: 60 });
});

test("refund leaves a still-covered job paid; pre-migration column still flips status", async () => {
  const a = fakeDb({
    jobs: [job({ status: "paid", total: 500 })],
    payments: [{ id: "p1", org_id: ORG, job_id: JOB, amount: 600, kind: "payment", stripe_session_id: "cs", stripe_payment_intent_id: "pi_1", platform_fee_cents: 0 }],
  });
  const kept = await recordJobRefund(a.db, { paymentIntentId: "pi_1", chargeCents: 60000, refundedCents: 5000, fullyRefunded: false });
  expect(kept).toMatchObject({ ok: true, reverted: false, amountPaid: 550 });
  expect(a.tables.jobs[0].status).toBe("paid");

  const b = paidJobDb({ missingColumns: ["amount_paid"] });
  const r = await recordJobRefund(b.db, { paymentIntentId: "pi_b", chargeCents: 60000, refundedCents: 60000, fullyRefunded: true });
  expect(r).toMatchObject({ ok: true, reverted: true });
  expect(b.tables.jobs[0]).toMatchObject({ status: "invoiced", paid_at: null });
});

test("legacy refund (no ledger row) prorates the job's own fee by org; unknown intent is skipped", async () => {
  const { db, tables } = fakeDb({
    jobs: [job({ status: "paid", stripe_payment_intent_id: "pi_old", platform_fee_cents: 80 })],
    payments: [],
  });
  const r = await recordJobRefund(db, { paymentIntentId: "pi_old", chargeCents: 100000, refundedCents: 25000, fullyRefunded: false });
  expect(r).toMatchObject({ ok: true, jobId: JOB, orgId: ORG });
  expect(tables.jobs[0].platform_fee_cents).toBe(60);
  expect(await recordJobRefund(db, { paymentIntentId: "pi_none", chargeCents: 1, refundedCents: 1, fullyRefunded: true }))
    .toEqual({ ok: false, reason: "no_job" });
});
