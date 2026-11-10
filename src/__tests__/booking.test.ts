import {
  openSlots, openSlotsOnDay, isSlotOpen, readBookingHours, readBookingSettings, visitFromRow,
  localNow, addDays, fmt12, googleCalendarUrl, DEFAULT_BOOKING_HOURS, type BookingSettings,
} from "@/lib/booking";
import { parseSchedTime } from "@/lib/day-plan";

// Tue 2026-11-10 (a weekday) with Bernard's default hours.
const TUE = "2026-11-10";
const base: BookingSettings = {
  hours: DEFAULT_BOOKING_HOURS,
  slotMin: 120,
  bufferMin: 30,
  minNoticeHours: 0,
  daysAhead: 7,
  tz: "America/Chicago",
};

describe("openSlotsOnDay", () => {
  it("offers only times that fit inside one window, so nothing runs through lunch", () => {
    expect(openSlotsOnDay(TUE, base, [])).toEqual([
      "09:30", "10:00", // morning 9:30–12:00 fits two 2h starts
      "13:30", "14:00", "14:30", "15:00", "15:30", "16:00", // afternoon 1:30–6
    ]);
  });

  it("with 1h slots the last morning start is 11:00, nothing in lunch", () => {
    const s = openSlotsOnDay(TUE, { ...base, slotMin: 60 }, []);
    expect(s).toContain("11:00");
    expect(s).not.toContain("11:30");
    expect(s).not.toContain("12:00");
    expect(s).not.toContain("12:30");
    expect(s).not.toContain("13:00");
  });

  it("is closed on weekends by default", () => {
    expect(openSlotsOnDay("2026-11-14", base, [])).toEqual([]); // Sat
    expect(openSlotsOnDay("2026-11-15", base, [])).toEqual([]); // Sun
  });

  it("keeps the buffer clear around a timed visit", () => {
    // 1:30–3:30 visit (+30 min either side → busy 1:00–4:00)
    const s = openSlotsOnDay(TUE, base, [{ date: TUE, start: "13:30", durationMin: 120 }]);
    expect(s).toEqual(["09:30", "10:00", "16:00"]);
  });

  it("blocks the whole day for a visit with no time", () => {
    expect(openSlotsOnDay(TUE, base, [{ date: TUE, start: null }])).toEqual([]);
  });

  it("blocks every day of a multi-day job", () => {
    const v = [{ date: "2026-11-09", endDate: "2026-11-11", start: "09:30", durationMin: 480 }];
    expect(openSlotsOnDay("2026-11-09", base, v)).toEqual([]);
    expect(openSlotsOnDay(TUE, base, v)).toEqual([]);
    expect(openSlotsOnDay("2026-11-11", base, v)).toEqual([]);
    expect(openSlotsOnDay("2026-11-12", base, v).length).toBeGreaterThan(0);
  });

  it("uses the default length when a visit has none", () => {
    // 9:30 visit, default 120 → busy 9:00–12:00, morning gone
    expect(openSlotsOnDay(TUE, base, [{ date: TUE, start: "09:30" }])).not.toContain("10:00");
  });

  it("respects the earliest minute (minimum notice)", () => {
    expect(openSlotsOnDay(TUE, base, [], 14 * 60 + 15)).toEqual(["14:30", "15:00", "15:30", "16:00"]);
  });
});

describe("openSlots", () => {
  it("skips days inside the notice window and days with nothing open", () => {
    // Mon 2026-11-09 at 3:00 PM, 24h notice → nothing before Tue 3:00 PM
    const days = openSlots({ ...base, minNoticeHours: 24 }, [], { date: "2026-11-09", minutes: 15 * 60 });
    expect(days[0]).toEqual({ date: TUE, slots: ["15:00", "15:30", "16:00"] });
    expect(days.find((d) => d.date === "2026-11-14")).toBeUndefined(); // Saturday
    expect(days.find((d) => d.date === "2026-11-09")).toBeUndefined();
  });

  it("stops at daysAhead", () => {
    const days = openSlots({ ...base, daysAhead: 2 }, [], { date: "2026-11-09", minutes: 0 });
    expect(days.map((d) => d.date)).toEqual(["2026-11-09", TUE, "2026-11-11"]);
  });
});

describe("isSlotOpen", () => {
  const now = { date: "2026-11-09", minutes: 8 * 60 };
  it("accepts an open time and rejects a taken or bogus one", () => {
    expect(isSlotOpen(base, [], now, TUE, "14:00")).toBe(true);
    expect(isSlotOpen(base, [{ date: TUE, start: "14:00", durationMin: 120 }], now, TUE, "14:00")).toBe(false);
    expect(isSlotOpen(base, [], now, TUE, "12:00")).toBe(false); // lunch
    expect(isSlotOpen(base, [], now, "nope", "14:00")).toBe(false);
    expect(isSlotOpen(base, [], now, TUE, "2pm")).toBe(false);
  });
});

describe("readBookingHours", () => {
  it("falls back to the defaults for junk", () => {
    expect(readBookingHours(null)).toBe(DEFAULT_BOOKING_HOURS);
    expect(readBookingHours("not json")).toBe(DEFAULT_BOOKING_HOURS);
    expect(readBookingHours({ foo: 1 })).toBe(DEFAULT_BOOKING_HOURS);
  });
  it("keeps every day closed when the owner closed them all", () => {
    const closed = { "0": [], "1": [], "2": [], "3": [], "4": [], "5": [], "6": [] };
    const h = readBookingHours(closed);
    expect(Object.values(h).every((w) => w.length === 0)).toBe(true);
    expect(openSlots({ ...base, hours: h }, [], { date: "2026-11-09", minutes: 0 })).toEqual([]);
  });
  it("keeps good windows, sorts them, drops bad ones", () => {
    const h = readBookingHours(JSON.stringify({ "6": [["13:00", "15:00"], ["8:00", "11:00"], ["x", "y"]] }));
    expect(h["6"]).toEqual([["08:00", "11:00"], ["13:00", "15:00"]]);
    expect(h["1"]).toEqual([]);
  });
});

describe("readBookingSettings", () => {
  it("applies defaults and clamps", () => {
    const s = readBookingSettings({ booking_slot_min: 5, booking_buffer_min: "45", booking_tz: "Mars/Base" });
    expect(s.slotMin).toBe(30);
    expect(s.bufferMin).toBe(45);
    expect(s.minNoticeHours).toBe(24);
    expect(s.tz).toBe("America/Chicago");
  });
});

describe("visitFromRow", () => {
  it("reads the time from the note when start_time is empty (AppFolio am/pm too)", () => {
    expect(visitFromRow({ sched_date: TUE, note: "🕐 2:30pm · AppFolio WO #1" }, parseSchedTime))
      .toEqual({ date: TUE, endDate: null, start: "14:30", durationMin: null });
  });
  it("prefers the note's time (a retimed visit) over start_time", () => {
    expect(visitFromRow({ sched_date: TUE, note: "🕐 9:00", start_time: "13:30", duration_min: 90 }, parseSchedTime).start).toBe("09:00");
    expect(visitFromRow({ sched_date: TUE, note: "no time here", start_time: "13:30" }, parseSchedTime).start).toBe("13:30");
  });
  it("uses duration_min, else the job's hours", () => {
    expect(visitFromRow({ sched_date: TUE, note: "🕐 9:00", duration_min: 90 }, parseSchedTime).durationMin).toBe(90);
    expect(visitFromRow({ sched_date: TUE, note: "🕐 9:00" }, parseSchedTime, 1.5).durationMin).toBe(90);
  });
});

describe("helpers", () => {
  it("localNow reads the wall clock in the business's zone", () => {
    // 2026-11-10 03:30 UTC = Nov 9, 9:30 PM in Chicago (CST, UTC-6)
    expect(localNow(new Date("2026-11-10T03:30:00Z"), "America/Chicago")).toEqual({ date: "2026-11-09", minutes: 21 * 60 + 30 });
  });
  it("addDays crosses months", () => {
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
  });
  it("fmt12", () => {
    expect(fmt12("09:30")).toBe("9:30 AM");
    expect(fmt12("13:30")).toBe("1:30 PM");
    expect(fmt12("12:00")).toBe("12:00 PM");
  });
  it("googleCalendarUrl", () => {
    const u = googleCalendarUrl({ title: "Handyman visit", date: TUE, start: "14:00", durationMin: 120, tz: "America/Chicago" });
    expect(u).toContain("dates=20261110T140000%2F20261110T160000");
    expect(u).toContain("ctz=America%2FChicago");
  });
});
