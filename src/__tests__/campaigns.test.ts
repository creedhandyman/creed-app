import crypto from "crypto";
import {
  campaignFooter,
  campaignProblems,
  isEmail,
  mergeFields,
  pickRecipients,
  renderCampaignEmail,
  textToHtml,
} from "@/lib/campaigns";
import { verifySvix } from "@/lib/resend-webhook";
import { signUnsubscribeToken, verifyUnsubscribeToken } from "@/lib/unsubscribe-token";

const NOW = Date.parse("2026-11-12T12:00:00Z");
const DAY = 86400_000;
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

describe("pickRecipients", () => {
  const customers = [
    { id: "a", type: "individual", name: "Ann Lee", email: "ann@example.com" },
    { id: "b", type: "business", name: "Bob Co", email: "bob@example.com" },
    { id: "c", type: "property_manager", name: "Cara PM", email: "cara@example.com" },
    { id: "d", type: "individual", name: "Dan", email: "not-an-email" },
    { id: "e", type: "individual", name: "Eve", email: "eve@example.com", email_unsubscribed_at: iso(DAY) },
    { id: "f", type: "individual", name: "Ann again", email: "ANN@example.com " },
    { id: "g", type: null, name: "Gus", email: "gus@example.com" },
  ];

  test("everyone: skips bad emails, unsubscribes and duplicate addresses", () => {
    const r = pickRecipients({ audience: "all", customers, now: NOW });
    expect(r.map((x) => x.customer_id)).toEqual(["a", "b", "c", "g"]);
  });

  test("by customer type (no type counts as a homeowner)", () => {
    expect(pickRecipients({ audience: "individual", customers, now: NOW }).map((x) => x.customer_id)).toEqual(["a", "g"]);
    expect(pickRecipients({ audience: "business", customers, now: NOW }).map((x) => x.customer_id)).toEqual(["b"]);
    expect(pickRecipients({ audience: "property_manager", customers, now: NOW }).map((x) => x.customer_id)).toEqual(["c"]);
  });

  test("lapsed: finished work before, nothing in the last year", () => {
    const jobs = [
      { customer_id: "a", status: "paid", job_date: iso(400 * DAY) },
      { customer_id: "b", status: "paid", job_date: iso(400 * DAY) },
      { customer_id: "b", status: "lead", job_date: iso(10 * DAY) }, // recent lead: not lapsed
      { customer_id: "c", status: "lead", job_date: iso(500 * DAY) }, // never finished work
      { customer_id: "g", status: "complete", job_date: iso(400 * DAY) },
      { customer_id: "g", status: "paid", job_date: iso(20 * DAY), archived: true }, // archived ignored
    ];
    expect(pickRecipients({ audience: "lapsed", customers, jobs, now: NOW }).map((x) => x.customer_id)).toEqual(["a", "g"]);
  });

  test("members: active or past due plans only", () => {
    const memberships = [
      { customer_id: "a", status: "active" },
      { customer_id: "b", status: "cancelled" },
      { customer_id: "c", status: "past_due" },
      { customer_id: "e", status: "active" }, // unsubscribed still skipped
    ];
    expect(pickRecipients({ audience: "members", customers, memberships, now: NOW }).map((x) => x.customer_id)).toEqual(["a", "c"]);
  });
});

describe("rendering", () => {
  test("merge fields and first name fallback", () => {
    expect(mergeFields("Hi {first_name} from {business_name} {referral_link}", { firstName: "Ann", businessName: "Creed" })).toBe("Hi Ann from Creed ");
  });

  test("html escapes and links only https", () => {
    const h = textToHtml("Hi <b>you</b>\n\nSee https://example.com/x. and http://bad.com");
    expect(h).toContain("&lt;b&gt;you&lt;/b&gt;");
    expect(h).toContain('<a href="https://example.com/x">https://example.com/x</a>.');
    expect(h).not.toContain('href="http://bad.com"');
    expect(h.match(/<p /g)).toHaveLength(2);
  });

  test("every email carries the address, the reason and the unsubscribe link", () => {
    const m = renderCampaignEmail({
      subject: "Hello {first_name}",
      body: "Hi {first_name},\n\nThanks.",
      customerName: "Ann Lee",
      businessName: "Creed Handyman",
      address: "151 Main St, Wichita KS",
      unsubscribeUrl: "https://www.creedhm.com/u/tok",
    });
    expect(m.subject).toBe("Hello Ann");
    for (const part of [m.text, m.html]) {
      expect(part).toContain("151 Main St, Wichita KS");
      expect(part).toContain("https://www.creedhm.com/u/tok");
      expect(part).toContain("customer of Creed Handyman");
    }
    expect(campaignFooter({ businessName: "A&B", address: "x", unsubscribeUrl: "https://u" }).html).toContain("A&amp;B");
  });

  test("can't send without subject, body or business address", () => {
    expect(campaignProblems({ subject: "s", body: "b" }, { address: "x" })).toEqual([]);
    expect(campaignProblems({ subject: " ", body: "b" }, { address: "x" })).toHaveLength(1);
    expect(campaignProblems({ subject: "s", body: "b" }, { address: "" })[0]).toMatch(/mailing address/);
  });

  test("isEmail", () => {
    expect(isEmail("a@b.co")).toBe(true);
    expect(isEmail("a@b")).toBe(false);
    expect(isEmail("a b@c.com")).toBe(false);
    expect(isEmail(null)).toBe(false);
  });
});

describe("unsubscribe token", () => {
  const prev = process.env.PORTAL_SESSION_SECRET;
  beforeAll(() => { process.env.PORTAL_SESSION_SECRET = "test-secret"; });
  afterAll(() => { process.env.PORTAL_SESSION_SECRET = prev; });
  const id = "11111111-1111-4111-8111-111111111111";

  test("round-trips and rejects tampering", () => {
    const tok = signUnsubscribeToken(id);
    expect(verifyUnsubscribeToken(tok)).toBe(id);
    expect(verifyUnsubscribeToken(tok.replace(id, "22222222-2222-4222-8222-222222222222"))).toBeNull();
    expect(verifyUnsubscribeToken(tok.slice(0, -2) + "xx")).toBeNull();
    expect(verifyUnsubscribeToken("test")).toBeNull();
    expect(verifyUnsubscribeToken(undefined)).toBeNull();
  });
});

describe("Resend webhook signature", () => {
  const key = Buffer.from("supersecretkey123");
  const secret = `whsec_${key.toString("base64")}`;
  const body = JSON.stringify({ type: "email.opened", data: { email_id: "re_1" } });
  const ts = "1762948800";
  const sig = crypto.createHmac("sha256", key).update(`msg_1.${ts}.${body}`).digest("base64");

  test("accepts a good signature, rejects bad, stale or missing", () => {
    const base = { secret, id: "msg_1", timestamp: ts, body, nowS: Number(ts) + 10 };
    expect(verifySvix({ ...base, signature: `v1,${sig}` })).toBe(true);
    expect(verifySvix({ ...base, signature: `v1,bogus v1,${sig}` })).toBe(true);
    expect(verifySvix({ ...base, signature: `v1,${sig}`, body: body + " " })).toBe(false);
    expect(verifySvix({ ...base, signature: `v1,${sig}`, nowS: Number(ts) + 3600 })).toBe(false);
    expect(verifySvix({ ...base, signature: `v1,${sig}`, secret: undefined })).toBe(false);
    expect(verifySvix({ ...base, signature: null })).toBe(false);
  });
});
