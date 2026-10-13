import {
  isClosedRow, needsServerCheck, serverVerdict, MISSING_GRACE_MS,
  markLocalClockOut, unmarkLocalClockOut, isLocalClockOut,
} from "../lib/clock-sync";

const NOW = Date.UTC(2026, 9, 12, 22, 0, 0);
const on = (activeId: string | null, st: number | null = NOW - 3600000) => ({ on: true, activeId, st });

describe("isClosedRow", () => {
  it("treats null / missing / empty / blank end_time as open", () => {
    expect(isClosedRow({ end_time: null })).toBe(false);
    expect(isClosedRow({})).toBe(false);
    expect(isClosedRow({ end_time: "" })).toBe(false);
    expect(isClosedRow({ end_time: "  " })).toBe(false);
    expect(isClosedRow(undefined)).toBe(false);
  });
  it("a finish time means closed", () => {
    expect(isClosedRow({ end_time: "05:12 PM" })).toBe(true);
  });
});

describe("needsServerCheck", () => {
  it("never checks when off the clock or without a row id (legacy)", () => {
    expect(needsServerCheck({ on: false, activeId: "a", st: NOW - 1e7 }, [], { end_time: "5:00 PM" }, NOW)).toBe(false);
    expect(needsServerCheck(on(null), [], undefined, NOW)).toBe(false);
  });
  it("never checks while our own write for that row is unsynced", () => {
    expect(needsServerCheck(on("a"), ["a"], { end_time: "5:00 PM" }, NOW)).toBe(false);
    expect(needsServerCheck(on("a"), ["a"], undefined, NOW)).toBe(false);
  });
  it("checks when the store shows the row closed elsewhere", () => {
    expect(needsServerCheck(on("a"), ["other"], { end_time: "5:00 PM" }, NOW)).toBe(true);
  });
  it("does not check an open row", () => {
    expect(needsServerCheck(on("a"), [], { end_time: null }, NOW)).toBe(false);
    expect(needsServerCheck(on("a"), [], { end_time: "" }, NOW)).toBe(false);
  });
  it("a missing row is only suspicious after the grace period", () => {
    expect(needsServerCheck(on("a", NOW - 30000), [], undefined, NOW)).toBe(false);
    expect(needsServerCheck(on("a", NOW - MISSING_GRACE_MS - 1), [], undefined, NOW)).toBe(true);
    expect(needsServerCheck(on("a", null), [], undefined, NOW)).toBe(false);
  });
});

describe("serverVerdict", () => {
  it("empty read = deleted, closed row = closed, open row = keep", () => {
    expect(serverVerdict([])).toBe("deleted");
    expect(serverVerdict([{ end_time: "5:00 PM" }])).toBe("closed");
    expect(serverVerdict([{ end_time: null }])).toBe("keep");
    expect(serverVerdict([{ end_time: "" }])).toBe("keep");
  });
});

describe("local clock-out marker", () => {
  it("marks and unmarks by id", () => {
    expect(isLocalClockOut("x")).toBe(false);
    markLocalClockOut("x");
    expect(isLocalClockOut("x")).toBe(true);
    unmarkLocalClockOut("x");
    expect(isLocalClockOut("x")).toBe(false);
    markLocalClockOut(null);
    expect(isLocalClockOut(null)).toBe(false);
  });
});
