import {
  heartbeatDue, usableFix, isMissingTableError, liveFixFor, stampMs,
  HEARTBEAT_MS, RETURN_GAP_MS, MAX_FIX_ACC_M,
} from "@/lib/crew-location";

const NOW = new Date("2026-10-19T11:00:00").getTime();
const base = { clockedIn: true, visible: true, now: NOW, lastAt: 0, clockInAt: null, trigger: "tick" as const };

describe("heartbeatDue", () => {
  it("never fires off the clock or while the app is hidden", () => {
    expect(heartbeatDue({ ...base, clockedIn: false })).toBe(false);
    expect(heartbeatDue({ ...base, visible: false })).toBe(false);
    expect(heartbeatDue({ ...base, clockedIn: false, trigger: "return" })).toBe(false);
  });
  it("fires on the first check of the session while on the clock", () => {
    expect(heartbeatDue(base)).toBe(true);
    expect(heartbeatDue({ ...base, trigger: "return" })).toBe(true);
  });
  it("ticks every ~4 minutes", () => {
    expect(heartbeatDue({ ...base, lastAt: NOW - HEARTBEAT_MS + 1000 })).toBe(false);
    expect(heartbeatDue({ ...base, lastAt: NOW - HEARTBEAT_MS })).toBe(true);
  });
  it("a return to the app fixes sooner, but not on a quick app switch", () => {
    expect(heartbeatDue({ ...base, trigger: "return", lastAt: NOW - 30_000 })).toBe(false);
    expect(heartbeatDue({ ...base, trigger: "return", lastAt: NOW - RETURN_GAP_MS })).toBe(true);
  });
  it("counts the clock-in's own GPS stamp as the last fix", () => {
    expect(heartbeatDue({ ...base, clockInAt: NOW - 60_000 })).toBe(false);
    expect(heartbeatDue({ ...base, clockInAt: NOW - HEARTBEAT_MS })).toBe(true);
    // Clocked in, went straight to Maps, back 20 min later → fix right away.
    expect(heartbeatDue({ ...base, trigger: "return", clockInAt: NOW - 20 * 60_000 })).toBe(true);
  });
  it("ignores a clock-in time in the future (phone clock / edited start)", () => {
    expect(heartbeatDue({ ...base, clockInAt: NOW + 3_600_000 })).toBe(true);
  });
});

describe("usableFix", () => {
  it("keeps a good fix, drops rough or broken ones", () => {
    expect(usableFix({ lat: 37.68, lng: -97.33, accuracy: 12 })).toBe(true);
    expect(usableFix({ lat: 37.68, lng: -97.33, accuracy: MAX_FIX_ACC_M })).toBe(true);
    expect(usableFix({ lat: 37.68, lng: -97.33, accuracy: MAX_FIX_ACC_M + 1 })).toBe(false);
    expect(usableFix({ lat: NaN, lng: -97.33, accuracy: 5 })).toBe(false);
    expect(usableFix({ lat: 95, lng: -97.33, accuracy: 5 })).toBe(false);
    expect(usableFix(null)).toBe(false);
  });
});

describe("isMissingTableError", () => {
  it("spots a migration that hasn't run", () => {
    expect(isMissingTableError({ code: "PGRST205", message: "Could not find the table 'public.crew_locations' in the schema cache" })).toBe(true);
    expect(isMissingTableError({ code: "42P01", message: 'relation "crew_locations" does not exist' })).toBe(true);
  });
  it("leaves RLS refusals and network errors alone", () => {
    expect(isMissingTableError({ code: "42501", message: "new row violates row-level security policy" })).toBe(false);
    expect(isMissingTableError({ message: "TypeError: Failed to fetch" })).toBe(false);
    expect(isMissingTableError(null)).toBe(false);
  });
});

describe("liveFixFor", () => {
  const now = new Date("2026-10-19T11:00:00");
  const loc = (at: string) => ({ user_id: "a", lat: 37.7, lng: -97.3, acc: 15, at });
  const iso = (local: string) => new Date(local).toISOString();

  it("uses a fix from today that's newer than the last stamp", () => {
    const f = liveFixFor(loc(iso("2026-10-19T10:52:00")), stampMs(now, "9:30 AM"), now);
    expect(f).toMatchObject({ lat: 37.7, lng: -97.3, acc: 15, ageMin: 8 });
  });
  it("a later clock stamp wins (same minute too)", () => {
    expect(liveFixFor(loc(iso("2026-10-19T10:52:00")), stampMs(now, "10:55 AM"), now)).toBeUndefined();
    expect(liveFixFor(loc(iso("2026-10-19T10:55:30")), stampMs(now, "10:55 AM"), now)).toBeUndefined();
    expect(liveFixFor(loc(iso("2026-10-19T10:56:00")), stampMs(now, "10:55 AM"), now)).toBeDefined();
  });
  it("ignores yesterday's fix and works with no stamp at all", () => {
    expect(liveFixFor(loc(iso("2026-10-18T16:00:00")), null, now)).toBeUndefined();
    expect(liveFixFor(loc(iso("2026-10-19T07:10:00")), null, now)?.ageMin).toBe(230);
    expect(liveFixFor(undefined, null, now)).toBeUndefined();
    expect(liveFixFor(loc("not a date"), null, now)).toBeUndefined();
  });
  it("never reports a negative age (server clock a bit ahead)", () => {
    expect(liveFixFor(loc(iso("2026-10-19T11:01:00")), null, now)?.ageMin).toBe(0);
  });
});

describe("stampMs", () => {
  it("reads 12h and 24h clock text on that day", () => {
    const day = new Date("2026-10-19T15:00:00");
    expect(stampMs(day, "9:30 AM")).toBe(new Date("2026-10-19T09:30:00").getTime());
    expect(stampMs(day, "12:05 PM")).toBe(new Date("2026-10-19T12:05:00").getTime());
    expect(stampMs(day, "17:12:00")).toBe(new Date("2026-10-19T17:12:00").getTime());
    expect(stampMs(day, "")).toBeNull();
  });
});
