import {
  stopsForDay, nextStopFrom, isJobScheduled, needMatch, needsNudge, balanceDue,
  isEntryOnDay, crewStatus, dayPhase, myDay, fmtClock, addDaysYmd, localYmd,
  type NeedKey,
} from "@/lib/day-plan";
import type { Job, Profile, ScheduleEntry, TimeEntry } from "@/lib/types";

const DAY = "2026-10-12";

const job = (id: string, property: string, extra: Partial<Job> = {}): Job => ({
  id,
  property,
  client: "Client",
  job_date: DAY,
  rooms: "[]",
  total: 0,
  total_labor: 0,
  total_mat: 0,
  total_hrs: 0,
  status: "scheduled",
  created_by: "",
  created_at: "2026-10-01T10:00:00Z",
  trade: "",
  callback: false,
  is_upsell: false,
  requested_tech: "",
  ...extra,
});

const entry = (id: string, address: string, note: string, extra: Partial<ScheduleEntry> = {}): ScheduleEntry => ({
  id,
  sched_date: DAY,
  job: address,
  note,
  ...extra,
});

const te = (id: string, address: string, extra: Partial<TimeEntry> = {}): TimeEntry => ({
  id,
  job: address,
  entry_date: "10/12/2026",
  hours: 0,
  amount: 0,
  user_id: "u1",
  user_name: "Ann Smith",
  ...extra,
});

const profile = (id: string, name: string): Profile => ({
  id, name, email: "", role: "tech", rate: 30, start_date: "", emp_num: "", org_id: "o1",
});

describe("stopsForDay", () => {
  test("same-day stops sort by time — 8:00 before 14:00 regardless of input order, untimed last", () => {
    const schedule = [
      entry("s1", "1 Late St", "🕐 14:00"),
      entry("s2", "2 Untimed Rd", "fix gate"),
      entry("s3", "3 Early Ave", "🕐 8:00 · 👷 Bo"),
    ];
    const stops = stopsForDay({ schedule, jobs: [], timeEntries: [], day: DAY });
    expect(stops.map((s) => s.entry.id)).toEqual(["s3", "s1", "s2"]);
    expect(fmtClock(stops[0].time)).toBe("8:00 AM");
    expect(fmtClock(stops[1].time)).toBe("2:00 PM");
    expect(stops[2].time).toBe("");
  });

  test("a multi-day entry appears on its middle day", () => {
    const schedule = [entry("s1", "1 Main", "", { sched_date: "2026-10-11", end_date: "2026-10-13" })];
    expect(stopsForDay({ schedule, jobs: [], timeEntries: [], day: DAY })).toHaveLength(1);
    expect(stopsForDay({ schedule, jobs: [], timeEntries: [], day: "2026-10-14" })).toHaveLength(0);
  });

  test("an archived job drops out", () => {
    const jobs = [job("j1", "1 Main", { archived: true })];
    const schedule = [entry("s1", "1 Main", "", { job_id: "j1" })];
    expect(stopsForDay({ schedule, jobs, timeEntries: [], day: DAY })).toHaveLength(0);
  });

  test("done via job status", () => {
    const jobs = [job("j1", "1 Main", { status: "complete" })];
    const schedule = [entry("s1", "1 Main", "", { job_id: "j1" })];
    expect(stopsForDay({ schedule, jobs, timeEntries: [], day: DAY })[0].state).toBe("done");
  });

  test("done via a closed entry today; now via an open one", () => {
    const jobs = [job("j1", "1 Main"), job("j2", "2 Oak")];
    const schedule = [entry("s1", "1 Main", "", { job_id: "j1" }), entry("s2", "2 Oak", "", { job_id: "j2" })];
    const timeEntries = [
      te("t1", "1 Main", { job_id: "j1", start_time: "08:00 AM", end_time: "11:00 AM", hours: 3 }),
      te("t2", "2 Oak", { job_id: "j2", start_time: "11:30 AM" }),
    ];
    const stops = stopsForDay({ schedule, jobs, timeEntries, day: DAY });
    expect(stops.find((s) => s.entry.id === "s1")!.state).toBe("done");
    expect(stops.find((s) => s.entry.id === "s2")!.state).toBe("now");
  });

  test("a legacy (unlinked) closed entry at the address counts; one from another day doesn't", () => {
    const schedule = [entry("s1", "1 Main", "")];
    const yesterday = [te("t1", "1 Main", { entry_date: "10/11/2026", start_time: "08:00 AM", end_time: "09:00 AM", hours: 1 })];
    expect(stopsForDay({ schedule, jobs: [], timeEntries: yesterday, day: DAY })[0].state).toBe("todo");
    const today = [te("t1", "1 Main", { start_time: "08:00 AM", end_time: "09:00 AM", hours: 1 })];
    expect(stopsForDay({ schedule, jobs: [], timeEntries: today, day: DAY })[0].state).toBe("done");
  });

  test("mine first — by the 👷 name and by requested_tech", () => {
    const jobs = [job("j3", "3 Pine", { requested_tech: "Ann" })];
    const schedule = [
      entry("s1", "1 Main", "🕐 7:00 · 👷 Bo"),
      entry("s2", "2 Oak", "🕐 9:00 · 👷 Bo, Ann"),
      entry("s3", "3 Pine", "🕐 8:00", { job_id: "j3" }),
    ];
    const stops = stopsForDay({ schedule, jobs, timeEntries: [], day: DAY, me: "Ann" });
    expect(stops.map((s) => s.entry.id)).toEqual(["s3", "s2", "s1"]);
    expect(stops.map((s) => s.mine)).toEqual([true, true, false]);
    // Without `me` it's plain time order.
    expect(stopsForDay({ schedule, jobs, timeEntries: [], day: DAY }).map((s) => s.entry.id)).toEqual(["s1", "s3", "s2"]);
  });

  test("nextStopFrom skips done stops and looks ahead", () => {
    const jobs = [job("j1", "1 Main", { status: "complete" })];
    const schedule = [
      entry("s1", "1 Main", "", { job_id: "j1" }),
      entry("s2", "2 Oak", "🕐 10:00", { sched_date: addDaysYmd(DAY, 2) }),
    ];
    const next = nextStopFrom({ schedule, jobs, timeEntries: [], fromDay: DAY });
    expect(next?.day).toBe("2026-10-14");
    expect(next?.stop.entry.id).toBe("s2");
  });
});

describe("isJobScheduled", () => {
  test("a linked entry counts only for its own job", () => {
    const j = job("j1", "1 Main");
    expect(isJobScheduled(j, [entry("s1", "1 Main", "", { job_id: "j1" })])).toBe(true);
    expect(isJobScheduled(j, [entry("s1", "1 Main", "", { job_id: "other" })])).toBe(false);
  });

  test("a legacy entry older than the job must NOT count", () => {
    const j = job("j1", "1 Main", { created_at: "2026-10-05T09:00:00Z" });
    expect(isJobScheduled(j, [entry("s1", "1 Main", "", { sched_date: "2026-09-20" })])).toBe(false);
    expect(isJobScheduled(j, [entry("s1", "1 Main", "", { sched_date: "2026-10-06" })])).toBe(true);
  });
});

describe("need buckets", () => {
  const cases: [Partial<Job>, NeedKey | null][] = [
    [{ status: "lead" }, "lead"],
    [{ status: "quoted" }, "toSend"],
    [{ status: "quoted", quote_sent_at: "2026-10-10T10:00:00Z" }, "waiting"],
    [{ status: "complete" }, "toInvoice"],
    [{ status: "invoiced" }, "unpaid"],
    [{ status: "accepted" }, null],
    [{ status: "paid" }, null],
  ];
  const keys: NeedKey[] = ["lead", "toSend", "waiting", "toInvoice", "unpaid"];

  test.each(cases)("%o → bucket %s", (extra, want) => {
    const j = job("j", "1 Main", extra);
    for (const k of keys) expect(needMatch(k, j)).toBe(k === want);
  });

  test("archived jobs are in no bucket", () => {
    for (const [extra] of cases) {
      const j = job("j", "1 Main", { ...extra, archived: true });
      for (const k of keys) expect(needMatch(k, j)).toBe(false);
    }
  });

  test("needsNudge: 2.9 days = no, 3 days = yes", () => {
    const now = new Date("2026-10-12T12:00:00Z");
    const sentAgo = (days: number) => job("j", "1 Main", { status: "quoted", quote_sent_at: new Date(now.getTime() - days * 86400000).toISOString() });
    expect(needsNudge(sentAgo(2.9), now)).toBe(false);
    expect(needsNudge(sentAgo(3), now)).toBe(true);
  });

  test("balanceDue = total − paid, never negative, cents", () => {
    expect(balanceDue(job("j", "x", { total: 500, amount_paid: 250 }))).toBe(250);
    expect(balanceDue(job("j", "x", { total: 99.99, amount_paid: 33.333 }))).toBe(66.66);
    expect(balanceDue(job("j", "x", { total: 100, amount_paid: 120 }))).toBe(0);
  });
});

describe("isEntryOnDay", () => {
  test("accepts M/D/YYYY, zero-padded and ISO", () => {
    expect(isEntryOnDay("10/12/2026", DAY)).toBe(true);
    expect(isEntryOnDay("10/02/2026", "2026-10-02")).toBe(true);
    expect(isEntryOnDay("10/2/2026", "2026-10-02")).toBe(true);
    expect(isEntryOnDay("2026-10-12", DAY)).toBe(true);
    expect(isEntryOnDay("10/11/2026", DAY)).toBe(false);
    expect(isEntryOnDay("", DAY)).toBe(false);
  });

  test("localYmd is the local calendar day", () => {
    expect(localYmd(new Date(2026, 9, 12, 23, 30))).toBe(DAY);
    expect(addDaysYmd("2026-10-31", 1)).toBe("2026-11-01");
  });
});

describe("crewStatus", () => {
  test("yesterday's open row is stale, not on the clock", () => {
    const now = new Date(2026, 9, 12, 10, 0);
    const profiles = [profile("u1", "Ann Smith"), profile("u2", "Bo Jones")];
    const timeEntries = [
      te("t1", "1 Main", { user_id: "u1", entry_date: "10/11/2026", start_time: "08:00 AM" }),
      te("t2", "2 Oak", { user_id: "u2", user_name: "Bo Jones", start_time: "08:30 AM" }),
      te("t3", "3 Pine", { user_id: "u2", start_time: "07:00 AM", end_time: "08:00 AM", hours: 1 }),
    ];
    const { onClock, stale } = crewStatus(timeEntries, profiles, now);
    expect(onClock.map((c) => c.name)).toEqual(["Bo Jones"]);
    expect(stale.map((e) => e.id)).toEqual(["t1"]);
  });

  test("a paid-out open row is not flagged stale", () => {
    const now = new Date(2026, 9, 12, 10, 0);
    const timeEntries = [te("t1", "1 Main", { entry_date: "10/11/2026", start_time: "08:00 AM", paid_at: "2026-10-11T20:00:00Z" })];
    expect(crewStatus(timeEntries, [], now).stale).toHaveLength(0);
  });
});

describe("myDay", () => {
  test("hours from closed entries today; a job entry means drives to log", () => {
    const user = { id: "u1", name: "Ann Smith" };
    const timeEntries = [
      te("t1", "General", { start_time: "07:00 AM", end_time: "08:00 AM", hours: 1 }),
      te("t2", "1 Main", { start_time: "08:00 AM", end_time: "10:30 AM", hours: 2.5 }),
      te("t3", "2 Oak", { start_time: "11:00 AM" }),
      te("t4", "3 Pine", { entry_date: "10/11/2026", start_time: "08:00 AM", end_time: "09:00 AM", hours: 1 }),
      te("t5", "4 Elm", { user_id: "u2", start_time: "08:00 AM", end_time: "09:00 AM", hours: 1 }),
    ];
    expect(myDay(timeEntries, user, DAY)).toEqual({ hoursToday: 3.5, clockedOutToday: true, workedJobToday: true });
    expect(myDay(timeEntries.slice(0, 1), user, DAY).workedJobToday).toBe(false);
  });
});

describe("dayPhase", () => {
  const hourOf = (h: number, m: number) => { const d = new Date(2026, 9, 12, h, m); return d.getHours() + d.getMinutes() / 60; };

  test("admin: 14:59 stays on the day, 15:00 wraps only once nothing is left", () => {
    expect(dayPhase({ hour: hourOf(14, 59), clockedIn: false, admin: true, todoStops: 0, clockedOutToday: false })).toBe("start");
    expect(dayPhase({ hour: hourOf(15, 0), clockedIn: false, admin: true, todoStops: 0, clockedOutToday: false })).toBe("wrap");
    expect(dayPhase({ hour: hourOf(15, 0), clockedIn: false, admin: true, todoStops: 1, clockedOutToday: false })).toBe("start");
    expect(dayPhase({ hour: hourOf(17, 0), clockedIn: false, admin: true, todoStops: 1, clockedOutToday: false })).toBe("wrap");
  });

  test("on the clock is always work", () => {
    expect(dayPhase({ hour: hourOf(18, 0), clockedIn: true, admin: true, todoStops: 0, clockedOutToday: true })).toBe("work");
    expect(dayPhase({ hour: hourOf(9, 0), clockedIn: true, admin: false, todoStops: 2, clockedOutToday: false })).toBe("work");
  });

  test("tech wraps once their stops are done and they've clocked out (or it's late)", () => {
    expect(dayPhase({ hour: hourOf(13, 0), clockedIn: false, admin: false, todoStops: 0, clockedOutToday: true })).toBe("wrap");
    expect(dayPhase({ hour: hourOf(13, 0), clockedIn: false, admin: false, todoStops: 0, clockedOutToday: false })).toBe("start");
    expect(dayPhase({ hour: hourOf(15, 0), clockedIn: false, admin: false, todoStops: 0, clockedOutToday: false })).toBe("wrap");
    expect(dayPhase({ hour: hourOf(16, 0), clockedIn: false, admin: false, todoStops: 1, clockedOutToday: true })).toBe("start");
  });
});
