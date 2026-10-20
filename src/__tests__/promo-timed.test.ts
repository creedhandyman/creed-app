import { promoEnd, findTimedPromo } from "../lib/promo-timed";
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

  it("free-access end = the later of the signup trial and the promo date", () => {
    const start = "2026-10-01T00:00:00Z";
    expect(orgTrialEnd({ trial_start: start })).toEqual(trialEndFromStart(start));
    expect(orgTrialEnd({ trial_start: start, trial_ends_at: "2027-01-20T00:00:00Z" }).toISOString()).toBe("2027-01-20T00:00:00.000Z");
    expect(orgTrialEnd({ trial_start: start, trial_ends_at: "2026-10-02T00:00:00Z" })).toEqual(trialEndFromStart(start));
  });
});
