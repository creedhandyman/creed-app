import { collectWeek, toPlanInput, planWrites, composeNote, stripNoteParts, crewNow, spanDays, poolKey } from "@/lib/dispatch-week";
import { planWeek, minToHhmm, roundQuarter } from "@/lib/route-plan";
import type { Job, ScheduleEntry, TimeEntry, TimeOffRequest } from "@/lib/types";

const MON = "2026-10-19", TUE = "2026-10-20", WED = "2026-10-21";
const crew = [{ id: "a", name: "Ann Lee" }, { id: "b", name: "Bo Diaz" }];

const mkJob = (id: string, property: string, status: Job["status"], hrs: number, extra: Partial<Job> = {}): Job => ({
  id, property, client: "", job_date: "", rooms: "{}", total: 0, total_labor: 0, total_mat: 0, total_hrs: hrs,
  status, created_by: "", created_at: "2026-10-01T12:00:00Z", trade: "", callback: false, is_upsell: false, requested_tech: "",
  ...extra,
});
const mkEntry = (id: string, job: string, sched_date: string, note = "", extra: Partial<ScheduleEntry> = {}): ScheduleEntry =>
  ({ id, job, sched_date, note, ...extra });

describe("notes", () => {
  it("strips the time and crew, keeping the free text", () => {
    expect(stripNoteParts("🕐 14:00 · 👷 Ann Lee, Bo Diaz · gate code 1234")).toBe("gate code 1234");
    expect(stripNoteParts("🕐 2:00pm · 👷 Ann Lee")).toBe("");
    expect(stripNoteParts("bring ladder · 🕐 9:00")).toBe("bring ladder");
  });
  it("composes in quick-add order", () => {
    expect(composeNote("🕐 9:00 · old note", "13:30", ["Bo Diaz"])).toBe("🕐 13:30 · 👷 Bo Diaz · old note");
    expect(composeNote("", "08:00", [])).toBe("🕐 08:00");
  });
});

describe("spanDays", () => {
  it("counts calendar days", () => {
    expect(spanDays({ sched_date: MON })).toBe(1);
    expect(spanDays({ sched_date: MON, end_date: WED })).toBe(3);
  });
});

describe("collectWeek", () => {
  const jobs = [
    mkJob("j1", "100 E Main", "scheduled", 6),
    mkJob("j2", "200 W Oak", "accepted", 3),
    mkJob("j3", "300 N Elm", "quoted", 2),
    mkJob("j4", "400 S Pine", "complete", 4),
    mkJob("j5", "500 Ash", "accepted", 0, { requested_tech: "Bo Diaz" }),
    mkJob("j6", "600 Birch", "scheduled", 8),
  ];
  const schedule = [
    mkEntry("s1", "100 E Main", MON, "🕐 09:00 · 👷 Ann Lee", { job_id: "j1" }),
    mkEntry("s2", "100 E Main", WED, "", { job_id: "j1" }),
    mkEntry("s4", "400 S Pine", MON, "", { job_id: "j4" }),
    mkEntry("s6", "600 Birch", TUE, "👷 Joe's Plumbing", { job_id: "j6" }),
  ];

  it("splits a job's hours over its visit days and maps crew by name", () => {
    const { booked } = collectWeek({ jobs, schedule, timeEntries: [], crew, days: [MON, TUE, WED], includeQuoted: false, dayMin: 540 });
    const s1 = booked.find((b) => b.entry.id === "s1")!;
    expect(s1.durMin).toBe(180); // 6 h over 2 visit days
    expect(s1.techIds).toEqual(["a"]);
    expect(s1.fixedMin).toBe(540);
    expect(booked.some((b) => b.entry.id === "s4")).toBe(false); // finished job
    const s6 = booked.find((b) => b.entry.id === "s6")!;
    expect(s6.external).toBe(true); // a sub, not our crew
    expect(booked.find((b) => b.entry.id === "s2")!.movable).toBe(true);
  });

  it("pools approved work (quotes only when asked), requested tech kept", () => {
    const a = collectWeek({ jobs, schedule, timeEntries: [], crew, days: [MON], includeQuoted: false, dayMin: 540 });
    expect(a.pool.map((p) => p.job.id)).toEqual(["j2", "j5"]);
    expect(a.pool.find((p) => p.job.id === "j5")).toMatchObject({ totalMin: 120, estimated: true, techId: "b" });
    const b = collectWeek({ jobs, schedule, timeEntries: [], crew, days: [MON], includeQuoted: true, dayMin: 540 });
    expect(b.pool.map((p) => p.job.id)).toEqual(["j2", "j5", "j3"]);
  });

  it("reads the quote's crew size and day estimate", () => {
    const quoteJobs = [
      mkJob("c2", "1 Crew Ct", "accepted", 6, { rooms: JSON.stringify({ rooms: [], crewSize: 2 }) }),
      mkJob("auto", "2 Auto Ave", "accepted", 12, { rooms: JSON.stringify({ rooms: [], crewSize: null }) }),
      mkJob("small", "3 Small St", "accepted", 4, { rooms: "not json" }),
      mkJob("cure", "4 Paint Pl", "accepted", 5, { rooms: JSON.stringify({ estDays: 2.5 }) }),
    ];
    const run = (c: typeof crew) => collectWeek({ jobs: quoteJobs, schedule: [], timeEntries: [], crew: c, days: [MON], includeQuoted: false, dayMin: 540 }).pool;
    const two = run(crew);
    expect(two.find((p) => p.job.id === "c2")).toMatchObject({ crew: 2, totalMin: 360 });
    expect(two.find((p) => p.job.id === "auto")!.crew).toBe(2); // Auto: over a day's work → 2
    expect(two.find((p) => p.job.id === "small")).toMatchObject({ crew: 1, minDays: undefined });
    expect(two.find((p) => p.job.id === "cure")!.minDays).toBe(3);
    // Auto never asks for more people than are planned; a picked crew is kept.
    const solo = run([crew[0]]);
    expect(solo.find((p) => p.job.id === "auto")!.crew).toBe(1);
    expect(solo.find((p) => p.job.id === "c2")!.crew).toBe(2);
  });

  it("drops a stop someone already clocked out of today", () => {
    const te: TimeEntry = { id: "t", job: "100 E Main", job_id: "j1", entry_date: MON, hours: 2, amount: 0, user_id: "a", user_name: "Ann Lee", start_time: "8:00 AM", end_time: "10:00 AM" };
    const { booked } = collectWeek({ jobs, schedule, timeEntries: [te], crew, days: [MON], includeQuoted: false, dayMin: 540 });
    expect(booked.some((b) => b.entry.id === "s1")).toBe(false);
  });
});

describe("toPlanInput + planWrites", () => {
  // Real-ish coordinates so the planner has something to chew on.
  const pts: Record<string, { lat: number; lng: number }> = {
    "100 E Main": { lat: 37.69, lng: -97.25 },
    "200 W Oak": { lat: 37.69, lng: -97.41 },
    "500 Ash": { lat: 37.7, lng: -97.3 },
    "700 Crewless": { lat: 37.68, lng: -97.26 },
  };
  const coords = (a: string) => pts[a] ?? null;
  const jobs = [
    mkJob("j1", "100 E Main", "scheduled", 2),
    mkJob("j2", "200 W Oak", "accepted", 3),
    mkJob("j5", "500 Ash", "accepted", 1, { requested_tech: "Bo Diaz" }),
    mkJob("j7", "700 Crewless", "scheduled", 2),
    mkJob("j8", "800 Nowhere", "accepted", 1),
  ];
  const schedule = [
    mkEntry("s1", "100 E Main", MON, "🕐 09:00 · 👷 Ann Lee · knock loud", { job_id: "j1" }),
    mkEntry("s7", "700 Crewless", MON, "", { job_id: "j7" }),
  ];
  const timeOff: TimeOffRequest[] = [];
  const shop = { lat: 37.6872, lng: -97.3301 };

  const run = (replanBooked = false, leaveOut: string[] = []) => {
    const { pool, booked } = collectWeek({ jobs, schedule, timeEntries: [], crew, days: [MON], includeQuoted: false, dayMin: 540 });
    const { input, noLocation } = toPlanInput({ pool, booked, coords, days: [MON], crew, replanBooked, leaveOut, base: shop, timeOff });
    const plan = planWeek(input);
    return { plan, noLocation, booked, writes: planWrites(plan, { booked, crew, replanBooked }) };
  };

  it("books new jobs with a quarter-hour time and the planned tech", () => {
    const { writes, noLocation } = run();
    expect(noLocation).toEqual([poolKey("j8")]);
    const ash = writes.posts.find((p) => p.jobId === "j5")!;
    expect(ash.sched_date).toBe(MON);
    expect(ash.note).toMatch(/^🕐 \d{2}:(00|15|30|45) · 👷 Bo Diaz$/);
    expect(writes.posts.map((p) => p.jobId).sort()).toEqual(["j2", "j5"]);
  });

  it("gives a crew-less booked visit a tech + time and leaves a timed, crewed one alone", () => {
    const { writes } = run();
    expect(writes.patches.find((p) => p.entryId === "s1")).toBeUndefined();
    const s7 = writes.patches.find((p) => p.entryId === "s7")!;
    expect(s7.recrewed && s7.retimed).toBe(true);
    expect(s7.patch.note).toMatch(/^🕐 \d{2}:\d{2} · 👷 (Ann Lee|Bo Diaz)$/);
    expect(s7.patch.sched_date).toBeUndefined();
  });

  it("leaving a job out keeps it off the plan", () => {
    const { writes } = run(false, ["j2"]);
    expect(writes.posts.map((p) => p.jobId)).toEqual(["j5"]);
  });

  it("marks multi-day jobs with an end date", () => {
    const big = [...jobs, mkJob("j9", "100 E Main", "accepted", 14)];
    const { pool, booked } = collectWeek({ jobs: big, schedule: [], timeEntries: [], crew: [crew[0]], days: [MON, TUE, WED], includeQuoted: false, dayMin: 540 });
    const { input } = toPlanInput({ pool: pool.filter((p) => p.job.id === "j9"), booked, coords, days: [MON, TUE, WED], crew: [crew[0]], replanBooked: false, leaveOut: [], base: shop, timeOff });
    const writes = planWrites(planWeek(input), { booked, crew: [crew[0]], replanBooked: false });
    expect(writes.posts).toEqual([expect.objectContaining({ jobId: "j9", sched_date: MON, end_date: TUE })]);
  });

  describe("crew jobs", () => {
    const deck = mkJob("deck", "200 W Oak", "accepted", 12, { rooms: JSON.stringify({ rooms: [], crewSize: 2 }) });
    const plan2 = (off: TimeOffRequest[] = []) => {
      const { pool, booked } = collectWeek({ jobs: [deck], schedule: [], timeEntries: [], crew, days: [MON, TUE, WED], includeQuoted: false, dayMin: 540 });
      const { input } = toPlanInput({ pool, booked, coords, days: [MON, TUE, WED], crew, replanBooked: false, leaveOut: [], base: shop, timeOff: off });
      const plan = planWeek(input);
      return { plan, writes: planWrites(plan, { booked, crew, replanBooked: false }) };
    };

    it("writes ONE row for a crew visit, listing everyone on it", () => {
      const { plan, writes } = plan2();
      expect(plan.routes.map((r) => `${r.day}|${r.techId}`)).toEqual([`${MON}|a`, `${MON}|b`]);
      const [a, b] = plan.routes.map((r) => r.stops[0]);
      expect(a.startMin).toBe(b.startMin);
      expect(writes.posts).toHaveLength(1);
      expect(writes.posts[0]).toMatchObject({ jobId: "deck", sched_date: MON, end_date: undefined });
      expect(writes.posts[0].note).toMatch(/^🕐 \d{2}:(00|15|30|45) · 👷 Ann Lee, Bo Diaz$/);
    });

    it("gives a booked crew visit with no time ONE start, when the last of them gets there", () => {
      const jobs = [
        mkJob("jw", "200 W Oak", "scheduled", 2),
        mkJob("jc", "100 E Main", "scheduled", 6),
      ];
      const schedule = [
        mkEntry("sw", "200 W Oak", MON, "🕐 08:00 · 👷 Bo Diaz", { job_id: "jw" }),
        mkEntry("sc", "100 E Main", MON, "👷 Ann Lee, Bo Diaz · side gate", { job_id: "jc" }),
      ];
      const { pool, booked } = collectWeek({ jobs, schedule, timeEntries: [], crew, days: [MON], includeQuoted: false, dayMin: 540 });
      const { input } = toPlanInput({ pool, booked, coords, days: [MON], crew, replanBooked: false, leaveOut: [], base: shop, timeOff });
      const plan = planWeek(input);
      const starts = plan.routes.map((r) => r.stops.find((s) => s.key === `sc@${MON}`)!.startMin);
      expect(starts).toHaveLength(2);
      expect(starts[0]).toBe(starts[1]);
      expect(starts[0]).toBeGreaterThan(10 * 60); // after Bo's 8:00 visit across town
      const writes = planWrites(plan, { booked, crew, replanBooked: false });
      expect(writes.patches).toEqual([expect.objectContaining({ entryId: "sc", retimed: true, recrewed: false })]);
      expect(writes.patches[0].patch.note).toBe(`🕐 ${minToHhmm(roundQuarter(starts[0]))} · 👷 Ann Lee, Bo Diaz · side gate`);
    });

    it("books one person over more days when the other is off, and flags it", () => {
      const off: TimeOffRequest[] = [{ id: "o", user_id: "b", user_name: "Bo Diaz", start_date: MON, end_date: WED, hours: 24, kind: "vacation", status: "approved" }];
      const { plan, writes } = plan2(off);
      expect(plan.shortCrew).toEqual([{ key: poolKey("deck"), wanted: 2, got: 1, days: 2 }]);
      expect(writes.posts).toEqual([expect.objectContaining({ jobId: "deck", sched_date: MON, end_date: TUE })]);
      expect(writes.posts[0].note).toMatch(/👷 Ann Lee$/);
    });
  });
});

describe("crewNow", () => {
  const now = new Date("2026-10-19T11:00:00");
  it("finds the last stamp, the job they're on and their next stop", () => {
    const te: TimeEntry[] = [
      { id: "1", job: "100 E Main", job_id: "j1", entry_date: MON, hours: 1, amount: 0, user_id: "a", user_name: "Ann Lee", start_time: "8:00 AM", end_time: "9:00 AM", start_lat: 1, start_lng: 1, end_lat: 2, end_lng: 2 },
      { id: "2", job: "200 W Oak", job_id: "j2", entry_date: MON, hours: 0, amount: 0, user_id: "a", user_name: "Ann Lee", start_time: "9:30 AM", start_lat: 3, start_lng: 3 },
    ];
    const jobs = [mkJob("j2", "200 W Oak", "active", 2), mkJob("j3", "300 N Elm", "scheduled", 2)];
    const schedule = [
      mkEntry("s2", "200 W Oak", MON, "👷 Ann Lee", { job_id: "j2" }),
      mkEntry("s3", "300 N Elm", MON, "🕐 13:00 · 👷 Ann Lee", { job_id: "j3" }),
    ];
    const [ann, bo] = crewNow({ crew, timeEntries: te, schedule, jobs, now });
    expect(ann.fix).toEqual({ lat: 3, lng: 3, time: "9:30 AM", kind: "in" });
    expect(ann.onJob).toMatchObject({ address: "200 W Oak", since: "9:30 AM" });
    expect(ann.next).toEqual({ address: "300 N Elm", time: "13:00", jobId: "j3" });
    expect(bo.fix).toBeUndefined();
    expect(bo.next).toBeUndefined();
  });

  describe("live locations", () => {
    const te: TimeEntry[] = [
      { id: "1", job: "200 W Oak", job_id: "j2", entry_date: MON, hours: 0, amount: 0, user_id: "a", user_name: "Ann Lee", start_time: "9:30 AM", start_lat: 3, start_lng: 3 },
      { id: "2", job: "100 E Main", entry_date: MON, hours: 2, amount: 0, user_id: "b", user_name: "Bo Diaz", start_time: "8:00 AM", end_time: "10:50 AM", start_lat: 5, start_lng: 5, end_lat: 6, end_lng: 6 },
    ];
    const at = (local: string) => new Date(local).toISOString();

    it("prefers a heartbeat fix newer than the last stamp, with its age", () => {
      const locations = [{ user_id: "a", lat: 7, lng: 7, acc: 20, at: at("2026-10-19T10:57:00") }];
      const [ann] = crewNow({ crew, timeEntries: te, schedule: [], jobs: [], locations, now });
      expect(ann.fix).toEqual({ lat: 7, lng: 7, time: "10:57 AM", kind: "live", ageMin: 3 });
      expect(ann.onJob).toMatchObject({ address: "200 W Oak" });
    });
    it("keeps a later clock stamp over an older heartbeat", () => {
      // Bo's heartbeat came before he clocked out at 10:50.
      const locations = [{ user_id: "b", lat: 8, lng: 8, at: at("2026-10-19T10:40:00") }];
      const [, bo] = crewNow({ crew, timeEntries: te, schedule: [], jobs: [], locations, now });
      expect(bo.fix).toEqual({ lat: 6, lng: 6, time: "10:50 AM", kind: "out" });
    });
    it("shows a live fix with no stamp, and ignores yesterday's", () => {
      const ok = crewNow({ crew, timeEntries: [], schedule: [], jobs: [], locations: [{ user_id: "b", lat: 9, lng: 9, at: at("2026-10-19T10:30:00") }], now });
      expect(ok[1].fix).toMatchObject({ lat: 9, kind: "live", ageMin: 30 });
      const old = crewNow({ crew, timeEntries: [], schedule: [], jobs: [], locations: [{ user_id: "b", lat: 9, lng: 9, at: at("2026-10-18T16:00:00") }], now });
      expect(old[1].fix).toBeUndefined();
    });
  });
});
