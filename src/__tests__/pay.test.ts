import { payRate, hasPayRate, roundHours, entryAmount, isUsersEntry, unpaidFor } from "../lib/pay";
import type { TimeEntry } from "../lib/types";

const entry = (p: Partial<TimeEntry>): TimeEntry => ({ id: "x", job: "General", entry_date: "10/1/2026", hours: 0, amount: 0, user_id: "", ...p } as TimeEntry);

describe("payRate / hasPayRate", () => {
  it("is the real rate, never a guess", () => {
    expect(payRate({ rate: 32 })).toBe(32);
    expect(payRate({ rate: 0 })).toBe(0);
    expect(payRate({ rate: -5 })).toBe(0);
    expect(payRate({ rate: null })).toBe(0);
    expect(payRate({})).toBe(0);
    expect(payRate(undefined)).toBe(0);
    expect(hasPayRate({ rate: 0 })).toBe(false);
    expect(hasPayRate({ rate: 20 })).toBe(true);
  });
});

describe("entryAmount", () => {
  it("rounds hours to 2 dp first, then hours × rate to cents", () => {
    expect(roundHours(1.23456)).toBe(1.23);
    // 1.236 h → 1.24 h × $33 = $40.92 (not 1.236 × 33 = 40.788 → 40.79)
    expect(entryAmount(1.236, { rate: 33 })).toBe(40.92);
    expect(entryAmount(2, { rate: 27.5 })).toBe(55);
  });
  it("is $0 with no rate", () => {
    expect(entryAmount(8, { rate: 0 })).toBe(0);
    expect(entryAmount(8, null)).toBe(0);
  });
});

describe("isUsersEntry", () => {
  const me = { id: "u1", name: "Jordan" };
  it("matches by id", () => {
    expect(isUsersEntry({ user_id: "u1", user_name: "Someone" }, me)).toBe(true);
    expect(isUsersEntry({ user_id: "u2", user_name: "Jordan" }, me)).toBe(false);
  });
  it("falls back to the name only for rows with no user_id", () => {
    expect(isUsersEntry({ user_id: "", user_name: "Jordan" }, me)).toBe(true);
    expect(isUsersEntry({ user_id: null as unknown as string, user_name: "Jordan" }, me)).toBe(true);
    expect(isUsersEntry({ user_id: "", user_name: "Sam" }, me)).toBe(false);
  });
});

describe("unpaidFor", () => {
  const me = { id: "u1", name: "Jordan", rate: 25 };
  const entries = [
    entry({ user_id: "u1", hours: 3 }),
    entry({ user_id: "u1", hours: 2.5, paid_at: "2026-10-01T00:00:00Z" }), // paid
    entry({ user_id: "", user_name: "Jordan", hours: 1 }),                // legacy
    entry({ user_id: "u2", user_name: "Jordan", hours: 4 }),              // someone else named Jordan
    entry({ user_id: "u1", hours: 0, start_time: "08:00 AM" }),           // still open
  ];
  it("is every unpaid entry of theirs × their rate (what Run Payroll pays)", () => {
    expect(unpaidFor(me, entries)).toEqual({ hours: 4, pay: 100, rateSet: true, rate: 25 });
  });
  it("is $0 with no rate, hours still counted", () => {
    expect(unpaidFor({ ...me, rate: 0 }, entries)).toEqual({ hours: 4, pay: 0, rateSet: false, rate: 0 });
  });
});
