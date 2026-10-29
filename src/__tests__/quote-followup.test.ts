import {
  followupChannel, followupDue, followupMessage, lastContactMs, looksLikeBot, ordinal,
  shouldNotifyView, FOLLOWUP_GAP_DAYS, VIEW_RENOTIFY_HOURS,
} from "../lib/quote-followup";

const DAY = 86_400_000;
const HOUR = 3_600_000;
const T0 = Date.parse("2026-10-20T15:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();

const quoted = (over: Record<string, unknown> = {}) => ({
  status: "quoted",
  quote_sent_at: iso(T0),
  quote_followup_count: 0,
  rooms: JSON.stringify({ rooms: [] }),
  ...over,
});

describe("followupDue", () => {
  it("waits the first gap, then fires step 1", () => {
    expect(followupDue(quoted(), T0 + 2 * DAY - 1)).toBeNull();
    expect(followupDue(quoted(), T0 + FOLLOWUP_GAP_DAYS[0] * DAY)).toBe(1);
  });

  it("fires step 2 three days after the first follow-up, then stops", () => {
    const afterFirst = quoted({ quote_followup_count: 1, quote_followup_at: iso(T0 + 2 * DAY) });
    expect(followupDue(afterFirst, T0 + 5 * DAY - 1)).toBeNull();
    expect(followupDue(afterFirst, T0 + 5 * DAY)).toBe(2);
    const afterSecond = quoted({ quote_followup_count: 2, quote_followup_at: iso(T0 + 5 * DAY) });
    expect(followupDue(afterSecond, T0 + 60 * DAY)).toBeNull();
  });

  it("a manual follow-up (re-stamped quote_sent_at) pushes the robot back", () => {
    const chasedByHand = quoted({ quote_sent_at: iso(T0 + 1.5 * DAY) });
    expect(followupDue(chasedByHand, T0 + 2 * DAY)).toBeNull();
    expect(followupDue(chasedByHand, T0 + 3.5 * DAY)).toBe(1);
  });

  it("never follows up on a quote that wasn't sent, was approved, or isn't quoted", () => {
    expect(followupDue(quoted({ quote_sent_at: null }), T0 + 30 * DAY)).toBeNull();
    expect(followupDue(quoted({ status: "accepted" }), T0 + 30 * DAY)).toBeNull();
    expect(followupDue(quoted({ status: "lead" }), T0 + 30 * DAY)).toBeNull();
    expect(followupDue(quoted({ archived: true }), T0 + 30 * DAY)).toBeNull();
    const signed = quoted({ rooms: JSON.stringify({ approval: { v: 1, at: iso(T0) } }) });
    expect(followupDue(signed, T0 + 30 * DAY)).toBeNull();
  });

  it("treats a missing count as zero and tolerates junk blobs", () => {
    expect(followupDue(quoted({ quote_followup_count: null }), T0 + 3 * DAY)).toBe(1);
    expect(followupDue(quoted({ rooms: "not json{" }), T0 + 3 * DAY)).toBe(1);
  });
});

describe("lastContactMs", () => {
  it("is the later of sent and follow-up", () => {
    expect(lastContactMs({ quote_sent_at: iso(T0), quote_followup_at: iso(T0 + DAY) })).toBe(T0 + DAY);
    expect(lastContactMs({ quote_sent_at: iso(T0 + DAY), quote_followup_at: iso(T0) })).toBe(T0 + DAY);
    expect(Number.isNaN(lastContactMs({}))).toBe(true);
  });
});

describe("shouldNotifyView", () => {
  it("always alerts on the first open", () => {
    expect(shouldNotifyView(null, 0, T0)).toBe(true);
    expect(shouldNotifyView(undefined, undefined, T0)).toBe(true);
  });
  it("re-opens alert only after the quiet gap", () => {
    const prev = iso(T0);
    expect(shouldNotifyView(prev, 1, T0 + (VIEW_RENOTIFY_HOURS * HOUR - 1))).toBe(false);
    expect(shouldNotifyView(prev, 1, T0 + VIEW_RENOTIFY_HOURS * HOUR)).toBe(true);
  });
  it("a count with no usable timestamp still alerts", () => {
    expect(shouldNotifyView("garbage", 3, T0)).toBe(true);
  });
});

describe("followupChannel", () => {
  it("texts only with consent AND a phone", () => {
    expect(followupChannel({ consent: true, phone: "316-555-0100", email: "a@b.com" })).toBe("sms");
    expect(followupChannel({ consent: false, phone: "316-555-0100", email: "a@b.com" })).toBe("email");
    expect(followupChannel({ consent: true, phone: "  ", email: "a@b.com" })).toBe("email");
  });
  it("falls to the owner when there's nothing to send to", () => {
    expect(followupChannel({ consent: false, phone: "316-555-0100" })).toBe("owner");
    expect(followupChannel({ consent: true, phone: null, email: "nope" })).toBe("owner");
  });
});

describe("followupMessage", () => {
  const base = { customer: "Dave Smith", business: "Creed Handyman", property: "123 Main St", link: "https://x.test/s?job=1", viewed: false };
  it("changes with whether they've opened it, and with the step", () => {
    const a = followupMessage({ ...base, step: 1 });
    const b = followupMessage({ ...base, step: 1, viewed: true });
    const c = followupMessage({ ...base, step: 2 });
    expect(a).toContain("Hi Dave");
    expect(a).toContain("123 Main St");
    expect(a).toContain(base.link);
    expect(b).toContain("had a chance to look");
    expect(c).toContain("one more time");
    expect(new Set([a, b, c]).size).toBe(3);
  });
  it("copes with missing names and addresses, and never uses an em dash", () => {
    const m = followupMessage({ step: 1, link: "https://x.test", viewed: false });
    expect(m).toContain("Hi there");
    expect(m).toContain("your quote");
    for (const s of [1, 2] as const) expect(followupMessage({ ...base, step: s })).not.toContain("—");
  });
});

describe("looksLikeBot / ordinal", () => {
  it("flags crawlers and empty agents, passes real phones", () => {
    expect(looksLikeBot("")).toBe(true);
    expect(looksLikeBot("facebookexternalhit/1.1")).toBe(true);
    expect(looksLikeBot("Mozilla/5.0 (compatible; Googlebot/2.1)")).toBe(true);
    expect(looksLikeBot("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148")).toBe(false);
  });
  it("ordinals", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd"]);
  });
});
