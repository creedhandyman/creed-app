import { promoEnd, promoEndFor, findTimedPromo } from "../lib/promo-timed";
import { orgTrialEnd, trialEndFromStart } from "../lib/trial";

describe("timed promo codes", () => {
  it("rejects unknown codes", () => {
    expect(findTimedPromo("NOPE")).toBeNull();
  });

  it("gives N months from now, never shortening a longer trial", () => {
    const now = new Date("2026-10-20T12:00:00Z");
    expect(promoEnd(3, new Date("2026-11-01T00:00:00Z"), now).toISOString()).toBe("2027-01-20T12:00:00.000Z");
    const longer = new Date("2027-06-01T00:00:00Z");
    expect(promoEnd(3, longer, now)).toBe(longer);
  });

  it("lands on the same instant across a daylight-saving change, in any time zone", () => {
    // Oct -> Jan crosses the November change; Feb -> May crosses the March one.
    expect(promoEnd(3, new Date(0), new Date("2026-10-20T05:30:00Z")).toISOString()).toBe("2027-01-20T05:30:00.000Z");
    expect(promoEnd(3, new Date(0), new Date("2027-02-10T18:45:00Z")).toISOString()).toBe("2027-05-10T18:45:00.000Z");
    // Late evening Central is already the next day in UTC; the UTC date steps.
    expect(promoEnd(1, new Date(0), new Date("2026-11-01T04:30:00Z")).toISOString()).toBe("2026-12-01T04:30:00.000Z");
  });

  it("free-access end = the later of the signup trial and the promo date", () => {
    const start = "2026-10-01T00:00:00Z";
    expect(orgTrialEnd({ trial_start: start })).toEqual(trialEndFromStart(start));
    expect(orgTrialEnd({ trial_start: start, trial_ends_at: "2027-01-20T00:00:00Z" }).toISOString()).toBe("2027-01-20T00:00:00.000Z");
    expect(orgTrialEnd({ trial_start: start, trial_ends_at: "2026-10-02T00:00:00Z" })).toEqual(trialEndFromStart(start));
  });

  it("FOUNDING25 stacks 76 days on the 14-day trial (~3 months), 25 uses", () => {
    const p = findTimedPromo("  founding25 ");
    expect(p).toMatchObject({ id: "founding-25", maxUses: 25, addDays: 76 });
    const start = new Date("2026-11-01T12:00:00Z");
    const trialEnd = new Date(start.getTime() + 14 * 86_400_000);
    const end = promoEndFor(p!, trialEnd, new Date("2026-11-03T12:00:00Z"));
    expect((end.getTime() - start.getTime()) / 86_400_000).toBe(90);
    // trial already over → 76 days from today
    const now = new Date("2026-12-01T00:00:00Z");
    expect(promoEndFor(p!, trialEnd, now).getTime() - now.getTime()).toBe(76 * 86_400_000);
  });
});
