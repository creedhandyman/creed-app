import {
  readLocalClock, writeLocalClock, clearLocalClock, clockIn, clockOut, latestOpenRow,
  resolveClockInJobId, fmtClockTime, type ClockDeps,
} from "../lib/clock";
import { isLocalClockOut } from "../lib/clock-sync";
import { LONG_SHIFT_MS } from "../lib/shift";
import type { Job, TimeEntry } from "../lib/types";

function memStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, raw: m };
}

type Call = { kind: "save" | "drop"; rowId: string; patch?: Record<string, unknown>; mode?: string; opts?: Record<string, unknown> };

function fakeDeps(over: Partial<ClockDeps> & { rows?: TimeEntry[]; pending?: string[]; now?: () => number } = {}) {
  const storage = memStorage();
  const calls: Call[] = [];
  let rows: TimeEntry[] = over.rows ?? [];
  const promoted: string[] = [];
  let n = 0;
  const deps: ClockDeps = {
    saveTimeEntry: async (rowId, patch, mode, opts) => {
      calls.push({ kind: "save", rowId, patch, mode, opts });
      const i = rows.findIndex((r) => r.id === rowId);
      if (i >= 0) rows[i] = { ...rows[i], ...patch } as TimeEntry;
      else rows = [{ id: rowId, ...patch } as TimeEntry, ...rows];
      return true;
    },
    dropTimeEntry: async (rowId, opts) => { calls.push({ kind: "drop", rowId, opts }); rows = rows.filter((r) => r.id !== rowId); return true; },
    timeEntries: () => rows,
    pendingRowIds: () => over.pending ?? [],
    getFix: async () => ({ lat: 37.7, lng: -97.3, accuracy: 12 }),
    setJobActive: async (id) => { promoted.push(id); },
    newRowId: () => `row-${++n}`,
    storage,
    ...over,
  };
  return { deps, calls, storage, promoted, rows: () => rows };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const T0 = new Date(2026, 9, 28, 8, 0, 0).getTime();
const user = { id: "u1", name: "Jordan", rate: 30 };
const job = (p: Partial<Job>): Job => ({ id: "j", property: "12 Oak St", status: "scheduled", ...p } as Job);

describe("local clock state", () => {
  it("reads off for empty / junk storage", () => {
    const s = memStorage();
    expect(readLocalClock(s)).toEqual({ on: false, st: null, sj: "", activeId: null, activeJobId: null });
    s.setItem("c_t_on", "not json");
    s.setItem("c_t_st", "\"oops\"");
    expect(readLocalClock(s).on).toBe(false);
    expect(readLocalClock(s).st).toBe(null);
  });
  it("round-trips and clears every key", () => {
    const s = memStorage();
    writeLocalClock({ on: true, st: T0, sj: "12 Oak St", activeId: "r1", activeJobId: "j1" }, s);
    expect(readLocalClock(s)).toEqual({ on: true, st: T0, sj: "12 Oak St", activeId: "r1", activeJobId: "j1" });
    expect(s.raw.get("c_t_on")).toBe("true");
    clearLocalClock(s);
    expect(readLocalClock(s)).toEqual({ on: false, st: null, sj: "", activeId: null, activeJobId: null });
  });
});

describe("resolveClockInJobId", () => {
  it("prefers an open job the picker shows over a paid / archived one at the same address", () => {
    const jobs = [
      job({ id: "old", status: "active", archived: true, created_at: "2026-10-20" }),
      job({ id: "paid", status: "paid", created_at: "2026-10-25" }),
      job({ id: "open", status: "quoted", created_at: "2026-09-01" }),
    ];
    expect(resolveClockInJobId(jobs, "12 Oak St")).toBe("open");
    expect(resolveClockInJobId(jobs, "")).toBeUndefined();
  });
});

describe("clockIn", () => {
  it("writes the local clock, inserts the open row, stamps GPS and promotes a scheduled job", async () => {
    const { deps, calls, storage, promoted } = fakeDeps({ now: () => T0 });
    let seen: unknown = null;
    const s = await clockIn({ job: "12 Oak St", jobs: [job({ id: "j1" })], user, onLocal: (l) => { seen = l; } }, deps);
    expect(s).toEqual({ on: true, st: T0, sj: "12 Oak St", activeId: "row-1", activeJobId: "j1" });
    expect(seen).toEqual(s);
    expect(readLocalClock(storage)).toEqual(s);
    expect(calls[0]).toMatchObject({ kind: "save", rowId: "row-1", mode: "post", patch: { job: "12 Oak St", job_id: "j1", hours: 0, amount: 0, user_id: "u1", start_time: fmtClockTime(T0) } });
    expect(calls[0].patch).not.toHaveProperty("end_time");
    expect(promoted).toEqual(["j1"]);
    await flush();
    expect(calls[1]).toMatchObject({ kind: "save", rowId: "row-1", mode: "patch", patch: { start_lat: 37.7, start_lng: -97.3, start_acc: 12 } });
  });
  it("General time has no job and promotes nothing", async () => {
    const { deps, calls, promoted } = fakeDeps({ now: () => T0 });
    await clockIn({ job: "", jobs: [job({ id: "j1" })], user }, deps);
    expect(calls[0].patch).toMatchObject({ job: "General", job_id: undefined });
    expect(promoted).toEqual([]);
  });
});

describe("clockOut (self)", () => {
  async function onShift(minutes: number, over: Parameters<typeof fakeDeps>[0] = {}) {
    let now = T0;
    const f = fakeDeps({ now: () => now, ...over });
    await clockIn({ job: "12 Oak St", jobs: [job({ id: "j1" })], user }, f.deps);
    f.calls.length = 0;
    await flush();
    f.calls.length = 0;
    now = T0 + minutes * 60000;
    return f;
  }

  it("closes the open row with onlyIfOpen + earlierWins, rounded hours × real rate, clears the clock and stamps GPS", async () => {
    const f = await onShift(95); // 1.5833 h → 1.58 h
    let off = 0;
    const r = await clockOut({ reason: "self", person: user, onOff: () => { off++; } }, f.deps);
    expect(r).toEqual({ status: "closed", rowId: "row-1", hours: 1.58, landed: true });
    expect(off).toBe(1);
    expect(f.calls[0]).toMatchObject({
      kind: "save", rowId: "row-1", mode: "patch",
      patch: { hours: 1.58, amount: 47.4, end_time: fmtClockTime(T0 + 95 * 60000), job: "12 Oak St" },
      opts: { onlyIfOpen: true, earlierWins: true },
    });
    expect(readLocalClock(f.storage).on).toBe(false);
    expect(readLocalClock(f.storage).sj).toBe("");
    expect(isLocalClockOut("row-1")).toBe(false); // unmarked afterwards
    await flush();
    expect(f.calls[1]).toMatchObject({ rowId: "row-1", patch: { end_lat: 37.7, end_lng: -97.3, end_acc: 12 } });
  });

  it("marks the row as this phone's own close while the write is in flight", async () => {
    const f = await onShift(60);
    let markedDuringWrite = false;
    const save = f.deps.saveTimeEntry;
    f.deps.saveTimeEntry = async (...a) => { if (a[1].end_time) markedDuringWrite = isLocalClockOut(a[0]); return save(...a); };
    await clockOut({ reason: "self", person: user }, f.deps);
    expect(markedDuringWrite).toBe(true);
  });

  it("stores $0 for a person with no pay rate", async () => {
    const f = await onShift(120);
    await clockOut({ reason: "self", person: { id: "u1", rate: 0 } }, f.deps);
    expect(f.calls[0].patch).toMatchObject({ hours: 2, amount: 0 });
  });

  it("removes an in-and-out shift under 0.01 h instead of keeping a ghost", async () => {
    const f = await onShift(0.2); // 12 s → 0.00 h
    const r = await clockOut({ reason: "self", person: user }, f.deps);
    expect(r).toEqual({ status: "dropped" });
    expect(f.calls).toEqual([{ kind: "drop", rowId: "row-1", opts: { onlyIfOpen: true } }]);
    expect(readLocalClock(f.storage).on).toBe(false);
  });

  it("keeps a row closed elsewhere: no write, every key cleared (job too)", async () => {
    const f = await onShift(60);
    f.rows()[0].end_time = "09:30 AM";
    const r = await clockOut({ reason: "self", person: user }, f.deps);
    expect(r).toEqual({ status: "already-closed" });
    expect(f.calls).toEqual([]);
    expect(readLocalClock(f.storage)).toEqual({ on: false, st: null, sj: "", activeId: null, activeJobId: null });
  });

  it("still closes a closed-looking row when our own write is pending", async () => {
    const f = await onShift(60, { pending: ["row-1"] });
    f.rows()[0].end_time = "09:30 AM";
    const r = await clockOut({ reason: "self", person: user }, f.deps);
    expect(r.status).toBe("closed");
  });

  it("never posts a second entry when no open row can be found", async () => {
    const f = fakeDeps({ now: () => T0 + 3600000 });
    writeLocalClock({ on: true, st: T0, sj: "12 Oak St", activeId: null }, f.storage);
    const r = await clockOut({ reason: "self", person: user }, f.deps);
    expect(r).toEqual({ status: "already-closed" });
    expect(f.calls).toEqual([]);
    expect(readLocalClock(f.storage).on).toBe(false);
  });

  it("legacy (no row id): closes the user's LATEST open row by real time, not string order", async () => {
    const rows = [
      { id: "morning", user_id: "u1", entry_date: "10/28/2026", start_time: "09:30 AM", hours: 0 },
      { id: "afternoon", user_id: "u1", entry_date: "10/28/2026", start_time: "01:15 PM", hours: 0 },
      { id: "theirs", user_id: "u2", entry_date: "10/28/2026", start_time: "03:00 PM", hours: 0 },
    ] as TimeEntry[];
    // "09:30 AM" > "01:15 PM" as strings — the old sort picked the morning row.
    expect(latestOpenRow(rows, "u1")?.id).toBe("afternoon");
    const f = fakeDeps({ now: () => T0 + 3600000, rows });
    writeLocalClock({ on: true, st: T0, sj: "", activeId: null }, f.storage);
    const r = await clockOut({ reason: "self", person: user }, f.deps);
    expect(r).toMatchObject({ status: "closed", rowId: "afternoon" });
  });

  it("asks for the finish time on a forgotten shift; cancel leaves the clock running", async () => {
    const f = await onShift(LONG_SHIFT_MS / 60000 + 30);
    const asked: number[] = [];
    const r = await clockOut({ reason: "self", person: user, askFinish: async (s) => { asked.push(s); return null; } }, f.deps);
    expect(r).toEqual({ status: "cancelled" });
    expect(asked).toEqual([T0]);
    expect(f.calls).toEqual([]);
    expect(readLocalClock(f.storage).on).toBe(true);
    const r2 = await clockOut({ reason: "self", person: user, askFinish: async () => T0 + 8 * 3600000 }, f.deps);
    expect(r2).toMatchObject({ status: "closed", hours: 8 });
    expect(f.calls[0].patch).toMatchObject({ amount: 240 });
  });

  it("a passed-in finish time skips the question", async () => {
    const f = await onShift(LONG_SHIFT_MS / 60000 + 30);
    const r = await clockOut({ reason: "self", person: user, endAt: T0 + 2 * 3600000, askFinish: async () => { throw new Error("asked"); } }, f.deps);
    expect(r).toMatchObject({ status: "closed", hours: 2 });
  });

  it("is not-on when this phone isn't clocked in", async () => {
    const f = fakeDeps();
    expect(await clockOut({ reason: "self", person: user }, f.deps)).toEqual({ status: "not-on" });
  });
});

describe("clockOut (force — an office close)", () => {
  const open = { id: "e1", user_id: "u2", entry_date: "10/28/2026", start_time: "08:00 AM", hours: 0 } as TimeEntry;

  it("closes from the entry's real start with onlyIfOpen and NO earlierWins, at that person's rate", async () => {
    const f = fakeDeps({ now: () => T0 + 150 * 60000, rows: [{ ...open }] });
    const r = await clockOut({ reason: "force", entry: open, person: { id: "u2", rate: 20 } }, f.deps);
    expect(r).toEqual({ status: "closed", rowId: "e1", hours: 2.5, landed: true });
    expect(f.calls).toEqual([{ kind: "save", rowId: "e1", mode: "patch", patch: { hours: 2.5, amount: 50, end_time: fmtClockTime(T0 + 150 * 60000) }, opts: { onlyIfOpen: true } }]);
  });

  it("leaves this phone's own clock alone", async () => {
    const f = fakeDeps({ now: () => T0 + 3600000 });
    writeLocalClock({ on: true, st: T0, sj: "x", activeId: "mine" }, f.storage);
    await clockOut({ reason: "force", entry: open, person: { id: "u2", rate: 20 } }, f.deps);
    expect(readLocalClock(f.storage)).toMatchObject({ on: true, activeId: "mine" });
  });

  it("refuses a row with no readable start", async () => {
    const f = fakeDeps({ now: () => T0 });
    const r = await clockOut({ reason: "force", entry: { ...open, start_time: "" } as TimeEntry, person: { id: "u2", rate: 20 } }, f.deps);
    expect(r).toEqual({ status: "no-start" });
    expect(f.calls).toEqual([]);
  });

  it("asks the finish time for a forgotten shift, or uses one passed in (Set finish time)", async () => {
    const f = fakeDeps({ now: () => T0 + LONG_SHIFT_MS + 60000 });
    const r = await clockOut({ reason: "force", entry: open, person: { id: "u2", rate: 0 }, askFinish: async () => T0 + 4 * 3600000 }, f.deps);
    expect(r).toMatchObject({ status: "closed", hours: 4 });
    expect(f.calls[0].patch).toMatchObject({ amount: 0 });
    const r2 = await clockOut({ reason: "force", entry: open, person: { id: "u2", rate: 10 }, endAt: T0 + 3600000 }, f.deps);
    expect(r2).toMatchObject({ status: "closed", hours: 1 });
  });
});
