import { balanceDue, invoiceChannel, invoiceReminderDue } from "../lib/invoice-reminder";
import { ymdInZone } from "../lib/dates";

const DAY = 86_400_000;
const HOUR = 3_600_000;
const T0 = Date.parse("2026-11-02T20:00:00Z");
const job = (over: Record<string, unknown> = {}) => ({
  status: "invoiced",
  archived: false,
  total: 300,
  amount_paid: 0,
  invoice_sent_at: new Date(T0).toISOString(),
  invoice_reminder_count: 0,
  ...over,
});

describe("balanceDue", () => {
  it("is total minus paid, never negative", () => {
    expect(balanceDue({ total: 300, amount_paid: 125.5 })).toBe(174.5);
    expect(balanceDue({ total: "300", amount_paid: "300" })).toBe(0);
    expect(balanceDue({ total: 100, amount_paid: 150 })).toBe(0);
    expect(balanceDue({ total: null, amount_paid: null })).toBe(0);
  });
});

describe("invoiceReminderDue", () => {
  it("fires at 3, 7 and 14 days, then stops", () => {
    expect(invoiceReminderDue(job(), T0 + 2 * DAY)).toBeNull();
    expect(invoiceReminderDue(job(), T0 + 3 * DAY)).toBe(1);
    expect(invoiceReminderDue(job({ invoice_reminder_count: 1 }), T0 + 5 * DAY)).toBeNull();
    expect(invoiceReminderDue(job({ invoice_reminder_count: 1 }), T0 + 7 * DAY)).toBe(2);
    expect(invoiceReminderDue(job({ invoice_reminder_count: 2 }), T0 + 14 * DAY)).toBe(3);
    expect(invoiceReminderDue(job({ invoice_reminder_count: 3 }), T0 + 60 * DAY)).toBeNull();
  });

  it("lets a once-a-day cron catch an afternoon invoice on day 3", () => {
    expect(invoiceReminderDue(job(), T0 + 3 * DAY - 4 * HOUR)).toBe(1);
  });

  it("stops when paid, archived, not invoiced, or never sent", () => {
    expect(invoiceReminderDue(job({ amount_paid: 300 }), T0 + 10 * DAY)).toBeNull();
    expect(invoiceReminderDue(job({ archived: true }), T0 + 10 * DAY)).toBeNull();
    expect(invoiceReminderDue(job({ status: "paid" }), T0 + 10 * DAY)).toBeNull();
    expect(invoiceReminderDue(job({ invoice_sent_at: null }), T0 + 10 * DAY)).toBeNull();
  });

  it("still reminds about a partly paid invoice", () => {
    expect(invoiceReminderDue(job({ amount_paid: 150 }), T0 + 3 * DAY)).toBe(1);
  });
});

describe("invoiceChannel", () => {
  it("emails property managers, never texts them", () => {
    expect(invoiceChannel({ propertyManager: true, consent: true, phone: "3165550100", email: "pm@example.com" })).toBe("email");
    expect(invoiceChannel({ propertyManager: true, consent: true, phone: "3165550100" })).toBe("owner");
  });

  it("texts a customer only with their opt-in", () => {
    expect(invoiceChannel({ propertyManager: false, consent: true, phone: "3165550100", email: "a@b.co" })).toBe("sms");
    expect(invoiceChannel({ propertyManager: false, consent: false, phone: "3165550100", email: "a@b.co" })).toBe("email");
    expect(invoiceChannel({ propertyManager: false, consent: false, phone: "3165550100" })).toBe("owner");
  });
});

describe("ymdInZone", () => {
  it("uses Central time, not UTC", () => {
    // 11 PM UTC on Nov 9 is 5 PM Central on Nov 9.
    const t = Date.parse("2026-11-09T23:00:00Z");
    expect(ymdInZone(t)).toBe("2026-11-09");
    expect(ymdInZone(t, 1)).toBe("2026-11-10");
    // 2 AM UTC on Nov 10 is still Nov 9 in Wichita.
    expect(ymdInZone(Date.parse("2026-11-10T02:00:00Z"))).toBe("2026-11-09");
  });

  it("rolls over month ends", () => {
    expect(ymdInZone(Date.parse("2026-11-30T20:00:00Z"), 1)).toBe("2026-12-01");
  });
});
