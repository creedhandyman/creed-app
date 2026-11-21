/**
 * Jobs hours card: hours added back from pay_history only cover the pay runs
 * that DELETED their time entries (before 2026-04-27). An owner lowering a
 * paid entry's hours after that must change the card (bug 2026-11-18: the
 * old run's hours filled the gap back in, so the card never moved).
 */
import { payRunDeletedEntries, recoverDeletedHours, PAYROLL_KEEPS_ENTRIES_FROM } from "@/lib/job-entries";

describe("payRunDeletedEntries", () => {
  it("counts runs from before the fix, including the day of the fix", () => {
    expect(payRunDeletedEntries({ created_at: "2026-03-10T15:00:00Z" })).toBe(true);
    expect(payRunDeletedEntries({ created_at: "2026-04-26T20:00:00Z" })).toBe(true);
  });
  it("skips runs from after the fix (they kept their rows)", () => {
    expect(payRunDeletedEntries({ created_at: `${PAYROLL_KEEPS_ENTRIES_FROM}T00:00:00Z` })).toBe(false);
    expect(payRunDeletedEntries({ created_at: "2026-11-01T12:00:00Z" })).toBe(false);
  });
  it("falls back to pay_date, and treats an undated row as old", () => {
    expect(payRunDeletedEntries({ pay_date: "2026-10-03" })).toBe(false);
    expect(payRunDeletedEntries({ pay_date: "2026-02-01" })).toBe(true);
    expect(payRunDeletedEntries({})).toBe(true);
  });
});

describe("recoverDeletedHours", () => {
  it("adds back the full pre-fix run when its rows are gone", () => {
    expect(recoverDeletedHours({ hrs: 8, cost: 200 }, [])).toEqual({ hrs: 8, cost: 200 });
  });

  it("subtracts rows a day-of-fix run kept", () => {
    const kept = [{ paid_at: "2026-04-26T21:00:00Z", hours: 3, amount: 75 }];
    expect(recoverDeletedHours({ hrs: 8, cost: 200 }, kept)).toEqual({ hrs: 5, cost: 125 });
  });

  it("ignores rows paid after the fix, so editing them never refills the gap", () => {
    // A post-fix paid row lowered from 8 h to 6 h: no pre-fix history for it,
    // and the row itself must not be offset against anything.
    const edited = [{ paid_at: "2026-10-10T18:00:00Z", hours: 6, amount: 150 }];
    expect(recoverDeletedHours({ hrs: 0, cost: 0 }, edited)).toEqual({ hrs: 0, cost: 0 });
    // Pre-fix history for the same person stays whole beside it.
    expect(recoverDeletedHours({ hrs: 4, cost: 100 }, edited)).toEqual({ hrs: 4, cost: 100 });
  });

  it("is never negative", () => {
    const kept = [{ paid_at: "2026-04-01T10:00:00Z", hours: 10, amount: 300 }];
    expect(recoverDeletedHours({ hrs: 8, cost: 200 }, kept)).toEqual({ hrs: 0, cost: 0 });
  });
});
