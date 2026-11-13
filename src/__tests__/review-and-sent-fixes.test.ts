/**
 * Review requests fall back to email when the text can't go, and a customer
 * opening a quote link sent outside Creed marks that quote as sent.
 */
jest.mock("next/server", () => ({
  NextResponse: { json: (body: unknown, init?: { status?: number }) => ({ body, status: init?.status ?? 200 }) },
}));

const sendEmail = jest.fn(async (_to: string, _subject: string, _body: string) => ({ ok: true }));
jest.mock("@/lib/email", () => ({ sendEmail: (to: string, s: string, b: string) => sendEmail(to, s, b) }));
const sendSms = jest.fn(async (_to: string, _body: string) => ({ ok: true }));
jest.mock("@/lib/sms", () => ({
  normalizePhone: (p: string) => p,
  smsConfigured: () => true,
  sendSms: (to: string, body: string) => sendSms(to, body),
}));
jest.mock("@/lib/cron-auth", () => ({ cronAuth: () => true }));

type Cust = { id: string; name: string; phone: string | null; email: string | null; sms_consent?: unknown };
let customers = new Map<string, Cust>();
jest.mock("@/lib/sms-consent-server", () => ({ loadCustomersWithConsent: async () => customers }));

let jobRow: Record<string, unknown> = {};
const updates: { table: string; patch: Record<string, unknown> }[] = [];
function fakeClient() {
  const from = (table: string) => {
    let op = "select";
    let payload: Record<string, unknown> = {};
    const q: Record<string, unknown> = {};
    const chain = () => q;
    for (const m of ["select", "eq", "lte", "order", "limit", "in"]) q[m] = chain;
    q.update = (p: Record<string, unknown>) => { op = "update"; payload = p; return q; };
    const result = () => {
      if (op === "update") { updates.push({ table, patch: payload }); return { error: null }; }
      if (table === "review_requests") return { data: [{ id: "r1", org_id: "o1", job_id: "j1", customer_id: "c1", channel: "sms" }], error: null };
      if (table === "organizations") return { data: [{ id: "o1", name: "Creed Handyman LLC", review_request_message: null, google_review_url: "https://g.page/r/test/review" }], error: null };
      if (table === "jobs") return { data: Array.isArray(jobRow) ? jobRow : [jobRow], error: null };
      return { data: null, error: null };
    };
    q.maybeSingle = async () => ({ data: jobRow, error: null });
    q.then = (res: (v: unknown) => unknown) => Promise.resolve(result()).then(res);
    return q;
  };
  return { from };
}
jest.mock("@supabase/supabase-js", () => ({ createClient: () => fakeClient() }));
jest.mock("@/lib/api-auth", () => ({ getAuthedProfile: async () => null, serviceClient: () => fakeClient() }));
jest.mock("@/lib/job-token", () => ({ verifyJobToken: () => true }));
jest.mock("@/lib/notify-server", () => ({ notifyQuoteViewed: async () => undefined }));

import { GET as dispatchReviews } from "@/app/api/reviews/dispatch/route";
import { POST as quoteViewed } from "@/app/api/jobs/viewed/route";

const req = (body?: unknown) => ({
  headers: new Map([["user-agent", "Mozilla/5.0 (iPhone)"]]),
  json: async () => body,
  nextUrl: { searchParams: new URLSearchParams() },
}) as never;

beforeEach(() => { sendEmail.mockClear(); sendSms.mockClear(); updates.length = 0; });

describe("review request dispatch", () => {
  test("a text-only request with no text consent goes out by email, Google link first", async () => {
    jobRow = { id: "j1", property: "1 Main St", client: "Jane Doe", rooms: "{}" };
    customers = new Map([["c1", { id: "c1", name: "Jane Doe", phone: "3165550100", email: "jane@example.com" }]]);
    const r = (await dispatchReviews(req())) as unknown as { body: { sent: number } };
    expect(r.body.sent).toBe(1);
    expect(sendSms).not.toHaveBeenCalled();
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0][0]).toBe("jane@example.com");
    expect(sendEmail.mock.calls[0][2]).toContain("https://g.page/r/test/review");
    expect(updates.find((u) => u.table === "review_requests")?.patch.status).toBe("sent");
  });

  test("a customer who agreed to texts gets the text and no email", async () => {
    jobRow = { id: "j1", property: "1 Main St", client: "Jane Doe", rooms: "{}" };
    customers = new Map([["c1", { id: "c1", name: "Jane Doe", phone: "3165550100", email: "jane@example.com", sms_consent: { granted: true, at: "2026-11-01T00:00:00Z", source: "verbal" } }]]);
    await dispatchReviews(req());
    expect(sendSms).toHaveBeenCalledTimes(1);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  test("no consent and no email still fails with a readable reason", async () => {
    jobRow = { id: "j1", property: "1 Main St", client: "Jane Doe", rooms: "{}" };
    customers = new Map([["c1", { id: "c1", name: "Jane Doe", phone: "3165550100", email: null }]]);
    const r = (await dispatchReviews(req())) as unknown as { body: { failed: number } };
    expect(r.body.failed).toBe(1);
    expect(String(updates.find((u) => u.table === "review_requests")?.patch.error)).toMatch(/fallback/);
  });
});

describe("quote opened", () => {
  test("opening a quote that was never marked sent stamps it as sent", async () => {
    jobRow = { id: "j1", org_id: "o1", status: "quoted", quote_sent_at: null, quote_view_count: 0 };
    await quoteViewed(req({ job: "j1", t: "tok" }));
    const patch = updates.find((u) => u.table === "jobs")?.patch || {};
    expect(patch.quote_view_count).toBe(1);
    expect(typeof patch.quote_sent_at).toBe("string");
  });

  test("an already-sent quote keeps its sent date", async () => {
    jobRow = { id: "j1", org_id: "o1", status: "quoted", quote_sent_at: "2026-11-10T15:00:00Z", quote_view_count: 2 };
    await quoteViewed(req({ job: "j1", t: "tok" }));
    const patch = updates.find((u) => u.table === "jobs")?.patch || {};
    expect(patch.quote_view_count).toBe(3);
    expect(patch).not.toHaveProperty("quote_sent_at");
  });
});
