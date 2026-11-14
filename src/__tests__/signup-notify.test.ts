import { FIRST_RUN_LOOKBACK_MS, MAX_LOOKBACK_MS, signupEmail, signupWindow } from "../lib/signup-notify";

const NOW = Date.parse("2026-11-14T15:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();

describe("signupWindow", () => {
  it("picks up exactly where the last run stopped", () => {
    const last = iso(NOW - 3_600_000);
    expect(signupWindow(NOW, last)).toEqual({ since: last, until: iso(NOW) });
  });

  it("covers only the last hour on the very first run", () => {
    expect(signupWindow(NOW, null).since).toBe(iso(NOW - FIRST_RUN_LOOKBACK_MS));
    expect(signupWindow(NOW, undefined).since).toBe(iso(NOW - FIRST_RUN_LOOKBACK_MS));
  });

  it("never reaches further back than the cap after a long outage", () => {
    expect(signupWindow(NOW, iso(NOW - 10 * 86_400_000)).since).toBe(iso(NOW - MAX_LOOKBACK_MS));
  });

  it("treats a marker that is unreadable or in the future as no marker", () => {
    expect(signupWindow(NOW, "not a date").since).toBe(iso(NOW - FIRST_RUN_LOOKBACK_MS));
    expect(signupWindow(NOW, iso(NOW + 60_000)).since).toBe(iso(NOW - FIRST_RUN_LOOKBACK_MS));
  });
});

describe("signupEmail", () => {
  const one = { name: "Ace Handyman", created_at: "2026-11-14T14:20:00Z", owner_name: "Pat Lee", owner_email: "pat@example.com", phone: "316-555-0100", primary_trade: "handyman", plan: "pro", subscription_status: "trialing" };

  it("names the business in the subject when there is one", () => {
    const { subject, body } = signupEmail([one], 10);
    expect(subject).toBe("New Creed Handy Manager sign-up: Ace Handyman");
    expect(body).toContain("Owner: Pat Lee <pat@example.com>");
    expect(body).toContain("Phone: 316-555-0100");
    expect(body).toContain("Plan: pro, trialing");
    expect(body).toContain("Businesses on the platform now: 10");
  });

  it("counts them in the subject when there are several", () => {
    const { subject, body } = signupEmail([one, { name: "B&B Repairs", created_at: "2026-11-14T14:40:00Z" }], 11);
    expect(subject).toBe("2 new Creed Handy Manager sign-ups");
    expect(body).toContain("Ace Handyman");
    expect(body).toContain("B&B Repairs");
  });

  it("leaves out details it does not have", () => {
    const { subject, body } = signupEmail([{ name: null, created_at: "2026-11-14T14:40:00Z", owner_email: "x@example.com" }], 3);
    expect(subject).toBe("New Creed Handy Manager sign-up: a new business");
    expect(body).toContain("(no business name yet)");
    expect(body).toContain("Owner: <x@example.com>");
    expect(body).not.toContain("Phone:");
    expect(body).not.toContain("Plan:");
  });
});
