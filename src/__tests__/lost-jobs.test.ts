import { readyToBook, statusAfterUnschedule } from "../lib/day-plan";
import { recurringDueCutoff, recurringVisitDay, recurringVisitNote } from "../lib/recurring";
import { parseSchedTime } from "../lib/day-plan";
import { textBody } from "../lib/sms-templates";
import { isPaidUp } from "../lib/job-send";

describe("jobs that used to drop out of sight", () => {
  it("a 'scheduled' job counts as ready to book (the lists pair it with nothing-on-the-calendar)", () => {
    expect(readyToBook("accepted")).toBe(true);
    expect(readyToBook("scheduled")).toBe(true);
    for (const s of ["lead", "quoted", "active", "complete", "invoiced", "paid", undefined]) expect(readyToBook(s)).toBe(false);
  });

  it("removing the last visit puts the job back where it was", () => {
    // Approved work stays approved.
    expect(statusAfterUnschedule({ status: "scheduled", client_signature: "Jane" })).toBe("accepted");
    expect(statusAfterUnschedule({ status: "scheduled", approved_at: "2026-11-01" })).toBe("accepted");
    // A sent quote nobody approved goes back to waiting on the customer.
    expect(statusAfterUnschedule({ status: "scheduled", quote_sent_at: "2026-11-01" })).toBe("quoted");
    // Booked by hand with no quote sent (recurring, phone job): ready to book again.
    expect(statusAfterUnschedule({ status: "scheduled" })).toBe("accepted");
    // Started or finished work is never moved.
    for (const s of ["active", "complete", "invoiced", "paid", "quoted"] as const) {
      expect(statusAfterUnschedule({ status: s })).toBeNull();
    }
  });

  it("paid up = a real total fully covered", () => {
    expect(isPaidUp({ total: 400, amount_paid: 400 })).toBe(true);
    expect(isPaidUp({ total: 400, amount_paid: 399.995 })).toBe(true);
    expect(isPaidUp({ total: 400, amount_paid: 200 })).toBe(false);
    expect(isPaidUp({ total: 0, amount_paid: 0 })).toBe(false);
  });
});

describe("recurring visits reach the calendar", () => {
  const morning = Date.parse("2026-11-16T09:00:00Z"); // the 9:00 UTC cron, 3 AM Central Monday

  it("a visit due later today fires on this morning's run", () => {
    const cutoff = recurringDueCutoff(morning);
    expect(cutoff).toBe("2026-11-17T06:00:00.000Z");
    expect("2026-11-16T15:00:00.000Z" <= cutoff).toBe(true);  // 9 AM Central today
    expect("2026-11-17T15:00:00.000Z" <= cutoff).toBe(false); // tomorrow's
  });

  it("books the day the visit is due, never a day already gone", () => {
    expect(recurringVisitDay("2026-11-16T15:00:00.000Z", morning)).toBe("2026-11-16");
    expect(recurringVisitDay("2026-11-10T15:00:00.000Z", morning)).toBe("2026-11-16"); // fired late
    expect(recurringVisitDay(null, morning)).toBe("2026-11-16");
    expect(recurringVisitDay("not a date", morning)).toBe("2026-11-16");
  });

  it("writes a note the Schedule reads a time from", () => {
    const note = recurringVisitNote(9, "Gutter cleaning");
    expect(note).toBe("🕐 09:00 · Recurring: Gutter cleaning");
    expect(parseSchedTime(note)).toBe("09:00");
    expect(parseSchedTime(recurringVisitNote(null, "x"))).toBe("09:00");
    expect(parseSchedTime(recurringVisitNote(14, "x"))).toBe("14:00");
  });
});

describe("morning-of reminder", () => {
  it("says today instead of tomorrow", () => {
    const v = { business: "Creed Handyman", property: "123 Main St", role: "customer" as const, name: "Joe", time: "14:30" };
    expect(textBody("reminder", v)).toContain("tomorrow at 2:30 PM");
    const today = textBody("reminder", { ...v, sameDay: true });
    expect(today).toContain("today at 2:30 PM");
    expect(today).not.toContain("tomorrow");
  });
});
