import {
  isClosedRow, needsServerCheck, serverVerdict, MISSING_GRACE_MS,
  markLocalClockOut, unmarkLocalClockOut, isLocalClockOut, isCloseWrite, resolveClose,
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

describe("isCloseWrite", () => {
  it("inserts, deletes, onlyIfOpen and end_time patches are close writes", () => {
    expect(isCloseWrite({ op: "post" })).toBe(true);
    expect(isCloseWrite({ op: "del" })).toBe(true);
    expect(isCloseWrite({ op: "patch", onlyIfOpen: true, payload: {} })).toBe(true);
    expect(isCloseWrite({ op: "patch", payload: { end_time: "5:00 PM", hours: 8 } })).toBe(true); // legacy queue item
  });
  it("a GPS stamp or an hours tweak is not", () => {
    expect(isCloseWrite({ op: "patch", payload: { end_lat: 1, end_lng: 2 } })).toBe(false);
    expect(isCloseWrite({ op: "patch", payload: { hours: 3 } })).toBe(false);
  });
});

describe("resolveClose", () => {
  const close = { end_time: "03:00 PM", hours: 7, amount: 196 };
  it("an open row (blank finish) is written", () => {
    expect(resolveClose("patch", close, { end_time: "", hours: 0 })).toBe("write");
    expect(resolveClose("del", undefined, { end_time: null })).toBe("write");
  });
  it("our own close already landed (lost response, retried) = done, not a conflict", () => {
    expect(resolveClose("patch", close, { end_time: "03:00 PM", hours: 7 })).toBe("done");
    expect(resolveClose("patch", close, { end_time: "03:00 PM", hours: "7" })).toBe("done");
  });
  it("a removal whose row is already gone = done; a close of a removed row = conflict", () => {
    expect(resolveClose("del", undefined, null)).toBe("done");
    expect(resolveClose("patch", close, null)).toBe("conflict");
  });
  it("never deletes a shift someone else closed", () => {
    expect(resolveClose("del", undefined, { end_time: "5:00 PM", hours: 8 })).toBe("conflict");
  });
  it("the tech's earlier real clock-out beats a later force-out on an unpaid row", () => {
    expect(resolveClose("patch", close, { end_time: "06:00 PM", hours: 10 })).toBe("write-if-earlier");
  });
  it("a later close (forgotten shift) keeps the office's earlier close", () => {
    expect(resolveClose("patch", { end_time: "09:00 AM", hours: 25 }, { end_time: "06:00 PM", hours: 10 })).toBe("conflict");
  });
  it("a paid row is never touched", () => {
    expect(resolveClose("patch", close, { end_time: "06:00 PM", hours: 10, paid_at: "2026-10-10T00:00:00Z" })).toBe("conflict");
    expect(resolveClose("patch", close, { end_time: "", hours: 0, paid_at: "2026-10-10T00:00:00Z" })).toBe("conflict");
    expect(resolveClose("del", undefined, { end_time: null, paid_at: "2026-10-10T00:00:00Z" })).toBe("conflict");
  });
  it("our own close is recognised by its finish time even after the hours were edited", () => {
    expect(resolveClose("patch", close, { end_time: "03:00 PM", hours: 8.5 })).toBe("done");
  });
  it("zero / negative / missing hours never win as 'earlier'", () => {
    expect(resolveClose("patch", { end_time: "1:00 PM", hours: 0 }, { end_time: "06:00 PM", hours: 10 })).toBe("conflict");
    expect(resolveClose("patch", { end_time: "1:00 PM", hours: -3 }, { end_time: "06:00 PM", hours: 10 })).toBe("conflict");
    expect(resolveClose("patch", { end_time: "1:00 PM" }, { end_time: "06:00 PM", hours: 10 })).toBe("conflict");
  });
});
