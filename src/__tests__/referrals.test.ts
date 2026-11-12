import type { SupabaseClient } from "@supabase/supabase-js";
import {
  availableCreditCents,
  fmtCents,
  normalizeRefCode,
  referralLink,
  shouldCreditReferral,
} from "@/lib/referrals";
import { creditReferralOnPayment, findReferrer, recordReferralLead } from "@/lib/referrals-server";

describe("referral rules", () => {
  test("codes", () => {
    expect(normalizeRefCode(" AbC123def ")).toBe("abc123def");
    expect(normalizeRefCode("abc")).toBeNull();
    expect(normalizeRefCode("abc-123-def")).toBeNull();
    expect(normalizeRefCode(42)).toBeNull();
  });

  test("link needs a published site and a valid code", () => {
    expect(referralLink("https://x.com/", { site_slug: "creed" }, "abc123def")).toBe("https://x.com/lead/creed?ref=abc123def");
    expect(referralLink("https://x.com", { site_slug: "creed", site_published: false }, "abc123def")).toBeNull();
    expect(referralLink("https://x.com", { site_slug: null }, "abc123def")).toBeNull();
    expect(referralLink("https://x.com", { site_slug: "creed" }, "bad")).toBeNull();
  });

  test("only a new customer, not yourself, only while on", () => {
    const base = { enabled: true, referrerId: "r", leadCustomerId: "n", createdNewCustomer: true };
    expect(shouldCreditReferral(base)).toBe(true);
    expect(shouldCreditReferral({ ...base, enabled: false })).toBe(false);
    expect(shouldCreditReferral({ ...base, createdNewCustomer: false })).toBe(false);
    expect(shouldCreditReferral({ ...base, leadCustomerId: "r" })).toBe(false);
  });

  test("credit sums earned only", () => {
    expect(availableCreditCents([
      { status: "earned", reward_cents: 2500 },
      { status: "earned", reward_cents: 1000 },
      { status: "applied", reward_cents: 2500 },
      { status: "pending", reward_cents: 0 },
    ])).toBe(3500);
    expect(fmtCents(2500)).toBe("$25");
    expect(fmtCents(2550)).toBe("$25.50");
  });
});

// ── tiny in-memory supabase stand-in ──
type Row = Record<string, unknown>;
function fakeDb(seed: Record<string, Row[]>) {
  const tables: Record<string, Row[]> = {};
  for (const [k, v] of Object.entries(seed)) tables[k] = v.map((r) => ({ ...r }));
  let n = 0;
  function from(table: string) {
    let op = "select";
    let payload: Row | undefined;
    let wantRows = false;
    let lim: number | undefined;
    let mode: "many" | "one" = "many";
    const filters: [string, unknown][] = [];
    const rows = () => (tables[table] ||= []);
    const match = (r: Row) => filters.every(([c, v]) => r[c] === v);
    function run() {
      if (op === "insert") {
        const r = payload!;
        if (table === "customer_referrals" && rows().some((x) => x.org_id === r.org_id && x.referred_customer_id === r.referred_customer_id)) {
          return { data: null, error: { code: "23505", message: "duplicate" } };
        }
        rows().push({ id: `row${++n}`, ...r });
        return { data: null, error: null };
      }
      if (op === "update") {
        const hit = rows().filter(match);
        hit.forEach((r) => Object.assign(r, payload));
        return { data: wantRows ? hit.map((r) => ({ id: r.id })) : null, error: null };
      }
      let out = rows().filter(match);
      if (lim !== undefined) out = out.slice(0, lim);
      return { data: mode === "one" ? out[0] ?? null : out, error: null };
    }
    const b = {
      select() { if (op !== "select") wantRows = true; return b; },
      insert(r: Row) { op = "insert"; payload = r; return b; },
      update(p: Row) { op = "update"; payload = p; return b; },
      eq(c: string, v: unknown) { filters.push([c, v]); return b; },
      limit(x: number) { lim = x; return b; },
      maybeSingle() { mode = "one"; return b; },
      then<T>(res: (v: ReturnType<typeof run>) => T, rej?: (e: unknown) => T) {
        return Promise.resolve().then(run).then(res, rej);
      },
    };
    return b;
  }
  return { db: { from } as unknown as SupabaseClient, tables };
}

describe("referrals server flow", () => {
  const ORG = "org1";
  const seed = (on: boolean) => ({
    organizations: [{ id: ORG, referrals_enabled: on, referral_reward_cents: 3000 }],
    customers: [{ id: "ref", org_id: ORG, name: "Rita", referral_code: "abc123def" }],
  });

  test("lead with a code → pending, then the friend's first payment → earned once", async () => {
    const { db, tables } = fakeDb(seed(true));
    const referrer = await findReferrer(db, ORG, "ABC123DEF");
    expect(referrer).toEqual({ id: "ref", name: "Rita" });
    const r = await recordReferralLead(db, { orgId: ORG, referrer, leadCustomerId: "new1", createdNewCustomer: true, leadJobId: "j1" });
    expect(r.credited).toBe(true);
    expect(tables.customer_referrals[0]).toMatchObject({ referrer_customer_id: "ref", referred_customer_id: "new1", status: "pending" });

    // A second lead from the same new customer doesn't make a second credit.
    const again = await recordReferralLead(db, { orgId: ORG, referrer, leadCustomerId: "new1", createdNewCustomer: true, leadJobId: "j2" });
    expect(again.credited).toBe(false);
    expect(tables.customer_referrals).toHaveLength(1);

    expect(await creditReferralOnPayment(db, { id: "j1", org_id: ORG, customer_id: "new1" })).toEqual({ earned: true });
    expect(tables.customer_referrals[0]).toMatchObject({ status: "earned", reward_cents: 3000, earned_job_id: "j1" });
    expect(await creditReferralOnPayment(db, { id: "j3", org_id: ORG, customer_id: "new1" })).toEqual({ earned: false });
  });

  test("existing customer or referrals off → nothing", async () => {
    const on = fakeDb(seed(true));
    const referrer = await findReferrer(on.db, ORG, "abc123def");
    const r = await recordReferralLead(on.db, { orgId: ORG, referrer, leadCustomerId: "old", createdNewCustomer: false, leadJobId: "j" });
    expect(r.credited).toBe(false);
    expect(on.tables.customer_referrals ?? []).toHaveLength(0);

    const off = fakeDb(seed(false));
    expect(await findReferrer(off.db, ORG, "abc123def")).toBeNull();
  });

  test("payment on a job with no customer does nothing", async () => {
    const { db } = fakeDb(seed(true));
    expect(await creditReferralOnPayment(db, { id: "j", org_id: ORG, customer_id: null })).toEqual({ earned: false });
  });
});
