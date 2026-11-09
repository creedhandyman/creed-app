import { cleanTipPct, tipAllowed, tipCentsFor, TIP_PCTS } from "@/lib/tips";

test("only the picker's percents count; anything else is no tip", () => {
  expect(TIP_PCTS).toEqual([10, 15, 20]);
  expect(cleanTipPct(15)).toBe(15);
  expect(cleanTipPct("20")).toBe(20);
  for (const bad of [0, 5, 50, 100, -10, "abc", null, undefined, 15.5]) expect(cleanTipPct(bad)).toBe(0);
});

test("the server works the cents out from the percent", () => {
  expect(tipCentsFor(100000, 15)).toBe(15000);
  expect(tipCentsFor(12345, 10)).toBe(1235);   // 1234.5 rounds up
  expect(tipCentsFor(12345, 33)).toBe(0);      // not a picker choice
  expect(tipCentsFor(-500, 20)).toBe(0);
});

const base = { tipsEnabled: true, jobStatus: "complete", payAmount: 1000, balance: 1000 };

test("a tip is allowed on the whole balance of finished work", () => {
  expect(tipAllowed(base)).toBe(true);
  expect(tipAllowed({ ...base, jobStatus: "invoiced" })).toBe(true);
  expect(tipAllowed({ ...base, payAmount: 999.995 })).toBe(true); // rounding slack
});

test("no tip when the business hasn't turned tips on", () => {
  expect(tipAllowed({ ...base, tipsEnabled: false })).toBe(false);
  expect(tipAllowed({ ...base, tipsEnabled: null })).toBe(false);
  expect(tipAllowed({ ...base, tipsEnabled: undefined })).toBe(false);
});

test("no tip on a deposit, a part payment, or unfinished work", () => {
  expect(tipAllowed({ ...base, jobStatus: "accepted" })).toBe(false);
  expect(tipAllowed({ ...base, jobStatus: "scheduled" })).toBe(false);
  expect(tipAllowed({ ...base, payAmount: 500 })).toBe(false);
  expect(tipAllowed({ ...base, payAmount: 0, balance: 0 })).toBe(false);
});
