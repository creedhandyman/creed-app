import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import {
  findOrgIdForSub,
  orgUpdateFromSubscription,
  planFromSubscription,
  statusFromStripe,
} from "@/lib/stripe-subscription";

const sub = (over: Record<string, unknown> = {}) =>
  ({ id: "sub_1", status: "active", items: { data: [] }, metadata: {}, customer: "cus_1", trial_end: null, ...over }) as unknown as Stripe.Subscription;
const priced = (priceId: string, over: Record<string, unknown> = {}) =>
  sub({ items: { data: [{ price: { id: priceId } }] }, ...over });

beforeEach(() => {
  process.env.STRIPE_PRICE_SOLO = "price_solo";
  process.env.STRIPE_PRICE_CREW = "price_crew";
  process.env.STRIPE_PRICE_PRO = "price_pro";
});

test("plan comes from the price id, then metadata.plan, else null", () => {
  expect(planFromSubscription(priced("price_solo"))).toBe("solo");
  expect(planFromSubscription(priced("price_crew"))).toBe("crew");
  expect(planFromSubscription(priced("price_pro"))).toBe("pro");
  expect(planFromSubscription(priced("price_rotated", { metadata: { plan: "crew" } }))).toBe("crew");
  expect(planFromSubscription(sub({ metadata: { plan: "enterprise" } }))).toBeNull();
  expect(planFromSubscription(sub())).toBeNull();
});

test("Stripe status maps onto the strings BillingGate reads", () => {
  expect(statusFromStripe("active")).toBe("active");
  expect(statusFromStripe("trialing")).toBe("trialing");
  expect(statusFromStripe("canceled")).toBe("canceled");
  for (const s of ["past_due", "unpaid", "incomplete", "incomplete_expired", "paused"] as const) {
    expect(statusFromStripe(s)).toBe("past_due");
  }
});

test("org update mirrors the plan to the legacy column and adds the trial end only when set", () => {
  expect(orgUpdateFromSubscription(priced("price_pro", { status: "trialing", trial_end: 1_800_000_000 }))).toEqual({
    subscription_status: "trialing",
    stripe_subscription_id: "sub_1",
    subscription_plan: "pro",
    plan: "pro",
    trial_ends_at: new Date(1_800_000_000_000).toISOString(),
  });
  expect(orgUpdateFromSubscription(sub({ status: "unpaid" }))).toEqual({
    subscription_status: "past_due",
    stripe_subscription_id: "sub_1",
  });
});

function orgsDb(rows: Record<string, unknown>[]) {
  const from = () => {
    const filters: [string, unknown][] = [];
    const b = {
      select: () => b,
      eq: (c: string, v: unknown) => { filters.push([c, v]); return b; },
      single: async () => {
        const hit = rows.filter((r) => filters.every(([c, v]) => r[c] === v));
        return hit.length === 1 ? { data: hit[0], error: null } : { data: null, error: { message: "no rows" } };
      },
    };
    return b;
  };
  return { from } as unknown as SupabaseClient;
}

test("org lookup order: session org, sub metadata, subscription id, customer id", async () => {
  const db = orgsDb([
    { id: "by-sub", stripe_subscription_id: "sub_1" },
    { id: "by-cust", stripe_customer_id: "cus_2" },
  ]);
  expect(await findOrgIdForSub(db, sub({ metadata: { org_id: "meta" } }), "session")).toBe("session");
  expect(await findOrgIdForSub(db, sub({ metadata: { org_id: "meta" } }))).toBe("meta");
  expect(await findOrgIdForSub(db, sub())).toBe("by-sub");
  expect(await findOrgIdForSub(db, sub({ id: "sub_9", customer: { id: "cus_2" } }))).toBe("by-cust");
  expect(await findOrgIdForSub(db, sub({ id: "sub_9", customer: "cus_9" }))).toBeNull();
});
