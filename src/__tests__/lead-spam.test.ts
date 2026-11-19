/**
 * Website quote-form spam protection (2026-11-23): honeypot + time-to-submit,
 * the solicitation classifier (real vendor pitches vs real repair requests),
 * the AI answer reader, Turnstile, the per-email limit, and the /api/leads
 * route deciding lead vs held vs dropped (fake Supabase, AI mocked).
 */
const writes: { table: string; op: string; row: Record<string, unknown> }[] = [];
let failReviewInsert = false;
let aiAnswer: { verdict: "job" | "solicitation"; reason: string } | null = null;
const createLead = jest.fn(async () => ({ ok: true as const, jobId: "job-1" }));

jest.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from(table: string) {
      const b: Record<string, unknown> = {};
      let head = false;
      for (const m of ["select", "eq", "gte", "like", "limit", "order", "in", "ilike"]) {
        b[m] = (...a: unknown[]) => { if (m === "select" && (a[1] as { head?: boolean })?.head) head = true; return b; };
      }
      b.insert = (row: Record<string, unknown>) => {
        writes.push({ table, op: "insert", row });
        return { then: (res: (v: unknown) => unknown) => Promise.resolve({ error: table === "lead_review" && failReviewInsert ? { message: "relation does not exist" } : null }).then(res) };
      };
      b.then = (res: (v: unknown) => unknown) => Promise.resolve(
        head ? { count: 0, error: null }
          : table === "organizations" ? { data: [{ id: "org-1", name: "Creed", site_published: true }], error: null }
          : { data: [], error: null },
      ).then(res);
      return b;
    },
  }),
}));
jest.mock("@/lib/lead-intake", () => ({
  ...jest.requireActual("@/lib/lead-intake"),
  createLead: (...a: unknown[]) => (createLead as unknown as (...x: unknown[]) => unknown)(...a),
}));
jest.mock("@/lib/anthropic-server", () => ({ callClaude: jest.fn() }));
jest.mock("@/lib/lead-guard", () => {
  const real = jest.requireActual("@/lib/lead-guard");
  return { ...real, aiSolicitationCheck: jest.fn(async () => aiAnswer) };
});

import { NextRequest } from "next/server";
import { botCheck, classifyLead, readAiVerdict, emailVerdict, MIN_FILL_MS } from "@/lib/lead-spam";
import { verifyTurnstile, emailTag } from "@/lib/lead-guard";
import { inputFromHeld } from "@/lib/lead-intake";
import { resetMemoryLimits } from "@/lib/rate-limit";

const REAL = [
  "Kitchen faucet drips and the disposal hums but won't spin.",
  "Need a ceiling fan installed in the master bedroom and two outlets replaced. Can you come next week?",
  "Tenant move-out at 1450 N Oliver: patch drywall holes, paint two bedrooms, replace blinds, fix the closet door.",
  "Our fence blew down in the storm, about 3 panels. I saw your website on Google and you had good reviews.",
  "Hi, can you hang 4 shelves and mount a TV? My company is paying, invoice to the office please.",
  "Water heater leaking in the garage, how soon can someone look at it?",
];
const SPAM = [
  "Hi, I came across your website and noticed it isn't ranking on the first page of Google. We offer affordable SEO services to help you rank higher. Reply for a free audit!",
  "We are a digital marketing agency. Our services include web design, social media management and lead generation. Let me know if you're interested. www.growfast-media.com",
  "Check these: https://bestlinks.biz/a https://bestlinks.biz/b https://guestposts.io/list – high DA backlinks, guest post packages from $99/month.",
  "Dear business owner, are you looking for a partnership to grow your business? We provide exclusive leads and booked appointments for handymen. If you're not interested reply STOP to opt out.",
  "Hello! We help contractors get more customers for your business with Google Business Profile optimization. Packages from $299 per month. Book a quick call.",
  "Need working capital? Business loan and merchant cash advance approval in 24 hours, no credit check.",
];

describe("bot checks", () => {
  it("honeypot or a too-fast fill is a bot; a missing timer is only a signal", () => {
    const now = 1_700_000_000_000;
    expect(botCheck({ hp: "https://spam.biz", startedAt: now - 10_000, now })).toEqual({ bot: true, why: "honeypot" });
    expect(botCheck({ hp: "", startedAt: now - 1200, now })).toEqual({ bot: true, why: "too_fast" });
    expect(botCheck({ hp: "", startedAt: now - MIN_FILL_MS - 1, now })).toEqual({ bot: false, noTimer: false });
    expect(botCheck({ startedAt: undefined, now })).toEqual({ bot: false, noTimer: true });
    expect(botCheck({ startedAt: now - 30 * 86_400_000, now })).toEqual({ bot: false, noTimer: true }); // stale stamp
    expect(botCheck({ hp: "   ", startedAt: now - 9000, now }).bot).toBe(false);
  });
});

describe("solicitation classifier", () => {
  it.each(REAL)("real request stays a lead: %s", (d) => {
    expect(classifyLead({ name: "Pat Jones", description: d, city: "Wichita" }).verdict).toBe("ok");
  });
  it.each(SPAM)("vendor pitch is held or sent to the AI: %s", (d) => {
    const r = classifyLead({ name: "Sam", email: "sam@example.com", description: d });
    expect(r.verdict).not.toBe("ok");
  });
  it("the obvious pitches are held outright, with reasons", () => {
    const r = classifyLead({ name: "Growth Media LLC", description: SPAM[0] });
    expect(r.verdict).toBe("spam");
    expect(r.reasons).toEqual(expect.arrayContaining(["\"I came across your website\"", "\"we offer\"", "SEO", "Google ranking", "company name"]));
    expect(classifyLead({ name: "x", description: SPAM[2] }).urls).toBe(3);
    expect(classifyLead({ name: "x", description: SPAM[2] }).verdict).toBe("spam");
  });
  it("repair words help, but don't cancel a link list", () => {
    const d = "Fix your door and drywall business leads: https://a.biz/1 https://a.biz/2 https://a.biz/3 we offer SEO";
    expect(classifyLead({ name: "x", description: d }).verdict).toBe("spam");
  });
  it("no timer or no address nudge the score, never alone", () => {
    expect(classifyLead({ name: "Pat", description: "Replace a toilet" }, { noTimer: true }).verdict).toBe("ok");
  });
});

describe("AI answer, Turnstile, email limit, held rows", () => {
  it("reads the AI's JSON; anything else is undecided", () => {
    expect(readAiVerdict('{"verdict":"solicitation","reason":"SEO pitch"}')).toEqual({ verdict: "solicitation", reason: "SEO pitch" });
    expect(readAiVerdict('Sure: {"verdict":"job","reason":"faucet repair"}')).toEqual({ verdict: "job", reason: "faucet repair" });
    expect(readAiVerdict("I can't tell")).toBeNull();
    expect(readAiVerdict('{"verdict":"maybe"}')).toBeNull();
  });
  it("Turnstile: off without a secret; with one, needs Cloudflare's yes", async () => {
    delete process.env.TURNSTILE_SECRET_KEY;
    expect(await verifyTurnstile(undefined, "1.2.3.4")).toBe(true);
    process.env.TURNSTILE_SECRET_KEY = "s";
    const yes = jest.fn(async () => ({ json: async () => ({ success: true }) })) as unknown as typeof fetch;
    const no = jest.fn(async () => ({ json: async () => ({ success: false }) })) as unknown as typeof fetch;
    expect(await verifyTurnstile("tok", "1.2.3.4", yes)).toBe(true);
    expect(await verifyTurnstile("tok", "1.2.3.4", no)).toBe(false);
    expect(await verifyTurnstile("", "1.2.3.4", yes)).toBe(false);
    delete process.env.TURNSTILE_SECRET_KEY;
  });
  it("email limit and tags", () => {
    expect(emailVerdict({ hour: 2, day: 5 })).toBe(true);
    expect(emailVerdict({ hour: 3, day: 3 })).toBe(false);
    expect(emailVerdict({ hour: 0, day: 6 })).toBe(false);
    expect(emailTag("A@B.com")).toBe(emailTag(" a@b.com "));
    expect(emailTag("")).toBe("");
  });
  it("a held row restores to the lead it would have been", () => {
    const l = inputFromHeld({ name: "Pat", phone: "316", email: null, street: "1 Elm", city: "Wichita", description: "Fix door",
      payload: { photos: ["https://x/p.jpg", 5], referralCode: "AB12", smsConsent: true, smsConsentText: "Yes", ip: "1.1.1.1" }, from_tag: "f", email_tag: null });
    expect(l).toMatchObject({ name: "Pat", phone: "316", email: "", photos: ["https://x/p.jpg"], referralCode: "AB12", smsConsent: true, fromTag: "f", mailTag: "" });
  });
});

// ── The route ──────────────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-require-imports
const route = require("@/app/api/leads/route") as { POST: (r: NextRequest) => Promise<Response> };
let ipN = 0;
const post = (body: Record<string, unknown>) => route.POST(new NextRequest("http://localhost/api/leads", {
  method: "POST",
  headers: { "content-type": "application/json", "x-forwarded-for": `10.0.0.${++ipN}` },
  body: JSON.stringify({ slug: "creedhandyman", name: "Pat Jones", phone: "3165550101", city: "Wichita", started_at: Date.now() - 20_000, ...body }),
}));
const held = () => writes.filter((w) => w.table === "lead_review");

describe("/api/leads decides", () => {
  beforeEach(() => { writes.length = 0; createLead.mockClear(); failReviewInsert = false; aiAnswer = null; resetMemoryLimits(); });

  it("a real request becomes a lead with alerts + AI draft", async () => {
    const r = await post({ description: REAL[1] });
    expect(r.status).toBe(200);
    expect(createLead).toHaveBeenCalledTimes(1);
    expect((createLead.mock.calls[0] as unknown[])[3]).toEqual({ notify: true, draft: true });
    expect(held()).toEqual([]);
  });

  it("a vendor pitch is held: no lead, no alert, and the sender is told it went through", async () => {
    const r = await post({ name: "Growth Media LLC", email: "x@growth.agency", description: SPAM[0] });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true });
    expect(createLead).not.toHaveBeenCalled();
    expect(held()[0].row).toMatchObject({ org_id: "org-1", status: "flagged", description: SPAM[0] });
    expect((held()[0].row.reasons as string[]).length).toBeGreaterThan(2);
  });

  it("honeypot / too fast: dropped, nothing written", async () => {
    expect((await post({ description: REAL[0], hp: "http://bot" })).status).toBe(200);
    expect((await post({ description: REAL[0], started_at: Date.now() - 500 })).status).toBe(200);
    expect(createLead).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });

  it("borderline: the AI decides; no AI answer = a lead", async () => {
    const borderline = "Hi, let me know if you're interested in a quick call about your website. contact me";
    expect(classifyLead({ name: "Pat Jones", description: borderline, city: "Wichita" }).verdict).toBe("borderline");
    aiAnswer = { verdict: "solicitation", reason: "sales call" };
    await post({ description: borderline });
    expect(held()).toHaveLength(1);
    expect(held()[0].row.ai_verdict).toBe("solicitation: sales call");
    writes.length = 0; aiAnswer = null;
    await post({ description: borderline });
    expect(held()).toHaveLength(0);
    expect(createLead).toHaveBeenCalledTimes(1);
  });

  it("before the review table exists: a quiet lead (no alert, no text, no AI), tagged", async () => {
    failReviewInsert = true;
    await post({ description: SPAM[1] });
    expect(createLead).toHaveBeenCalledTimes(1);
    const opts = (createLead.mock.calls[0] as unknown[])[3] as { notify: boolean; draft: boolean; extraBlob: { leadFlagged: unknown } };
    expect(opts).toMatchObject({ notify: false, draft: false });
    expect(opts.extraBlob.leadFlagged).toBeTruthy();
  });

  it("the same email can't flood the form", async () => {
    let last: Response | null = null;
    for (let i = 0; i < 4; i++) last = await post({ email: "same@x.com", description: REAL[i] });
    expect(last!.status).toBe(429);
  });

  it("Turnstile on: a request without a token is refused", async () => {
    process.env.TURNSTILE_SECRET_KEY = "s";
    const r = await post({ description: REAL[0] });
    expect(r.status).toBe(400);
    expect(createLead).not.toHaveBeenCalled();
    delete process.env.TURNSTILE_SECRET_KEY;
  });
});
