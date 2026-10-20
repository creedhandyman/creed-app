import { planWeek, hhmmToMin, minToHhmm, roundQuarter, type FlexVisit, type FixedVisit, type LatLng } from "@/lib/route-plan";

// Wichita-ish: the shop downtown, one cluster ~4 mi east, one ~4 mi west.
const SHOP: LatLng = { lat: 37.6872, lng: -97.3301 };
const E1 = { lat: 37.69, lng: -97.255 }, E2 = { lat: 37.695, lng: -97.25 }, E3 = { lat: 37.7, lng: -97.245 };
const W1 = { lat: 37.69, lng: -97.405 }, W2 = { lat: 37.695, lng: -97.41 }, W3 = { lat: 37.7, lng: -97.415 };

const MON = "2026-10-19", TUE = "2026-10-20", WED = "2026-10-21", THU = "2026-10-22", FRI = "2026-10-23";
const WEEK = [MON, TUE, WED, THU, FRI];

const job = (key: string, pt: LatLng, hrs: number, extra: Partial<FlexVisit> = {}): FlexVisit =>
  ({ key, jobId: key, address: key, pt, totalMin: hrs * 60, isNew: true, phase: 0, ...extra });
const booked = (key: string, pt: LatLng, day: string, techId: string, hrs: number, extra: Partial<FixedVisit> = {}): FixedVisit =>
  ({ key, entryId: key, address: key, pt, durMin: hrs * 60, day, techId, ...extra });

const keysOf = (plan: ReturnType<typeof planWeek>, day: string, techId: string) =>
  plan.routes.find((r) => r.day === day && r.techId === techId)?.stops.map((s) => s.key) ?? [];

describe("planWeek", () => {
  it("gives each tech a neighbourhood instead of criss-crossing town", () => {
    const flex = [job("e1", E1, 2.5), job("w1", W1, 2.5), job("e2", E2, 2.5), job("w2", W2, 2.5), job("e3", E3, 2.5), job("w3", W3, 2.5)];
    const plan = planWeek({ days: [MON], techIds: ["a", "b"], base: SHOP, fixed: [], flex });
    expect(plan.unplaced).toEqual([]);
    const a = keysOf(plan, MON, "a").sort();
    const b = keysOf(plan, MON, "b").sort();
    expect([a, b].map((k) => k.join()).sort()).toEqual(["e1,e2,e3", "w1,w2,w3"]);
  });

  it("puts small jobs early in the week", () => {
    const plan = planWeek({ days: WEEK, techIds: ["a"], base: SHOP, fixed: [], flex: [job("e1", E1, 1), job("w1", W1, 1)] });
    expect(plan.routes.map((r) => r.day)).toEqual([MON]);
    expect(plan.placedNew).toBe(2);
  });

  it("spills to the next day when the day is full, and every day ends on time", () => {
    const flex = [job("e1", E1, 3), job("e2", E2, 3), job("e3", E3, 3), job("w1", W1, 3)];
    const plan = planWeek({ days: [MON, TUE], techIds: ["a"], base: SHOP, fixed: [], flex });
    expect(plan.unplaced).toEqual([]);
    expect(plan.routes).toHaveLength(2);
    for (const r of plan.routes) {
      expect(r.overMin).toBe(0);
      expect(r.endMin).toBeLessThanOrEqual(17 * 60);
    }
  });

  it("keeps each overflow day to one side of town", () => {
    const flex = [job("e1", E1, 2.5), job("w1", W1, 2.5), job("e2", E2, 2.5), job("w2", W2, 2.5), job("e3", E3, 2.5), job("w3", W3, 2.5)];
    const plan = planWeek({ days: [MON, TUE], techIds: ["a"], base: SHOP, fixed: [], flex });
    expect(plan.unplaced).toEqual([]);
    const mon = keysOf(plan, MON, "a").map((k) => k[0]);
    const tue = keysOf(plan, TUE, "a").map((k) => k[0]);
    expect(new Set(mon).size).toBe(1);
    expect(new Set(tue).size).toBe(1);
  });

  it("plans a busy week quickly", () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const flex = Array.from({ length: 40 }, (_, i) =>
      job(`j${i}`, { lat: 37.6 + rnd() * 0.2, lng: -97.45 + rnd() * 0.3 }, 1 + Math.round(rnd() * 6) / 2));
    const t0 = Date.now();
    const plan = planWeek({ days: WEEK, techIds: ["a", "b", "c", "d"], base: SHOP, fixed: [], flex });
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(plan.placedNew).toBe(40);
    for (const r of plan.routes) expect(r.overMin).toBe(0);
  });

  it("never makes a promised time late", () => {
    const fixed = [booked("b-east", E1, MON, "a", 1, { fixedMin: 13 * 60 })];
    const plan = planWeek({ days: [MON], techIds: ["a"], base: SHOP, fixed, flex: [job("w1", W1, 3), job("e2", E2, 2)] });
    const route = plan.routes[0];
    expect(route.lateMin).toBe(0);
    const b = route.stops.find((s) => s.key === "b-east")!;
    expect(b.startMin).toBe(13 * 60);
  });

  it("leaves an overbooked day alone and reports it", () => {
    const fixed = [booked("big", E1, MON, "a", 9.5)];
    const plan = planWeek({ days: [MON], techIds: ["a"], base: SHOP, fixed, flex: [job("w1", W1, 1)] });
    expect(plan.routes[0].overMin).toBeGreaterThan(0);
    expect(plan.routes[0].stops.map((s) => s.key)).toEqual(["big"]);
    expect(plan.unplaced).toEqual([{ key: "w1", reason: "no-room" }]);
  });

  it("books a long job on consecutive days, around a booked day", () => {
    const fixed = [booked("tue-full", W1, TUE, "a", 8)];
    const plan = planWeek({ days: WEEK, techIds: ["a"], base: SHOP, fixed, flex: [job("deck", E1, 20)] });
    const days = plan.routes.filter((r) => r.stops.some((s) => s.key === "deck")).map((r) => r.day);
    expect(days).toEqual([WED, THU, FRI]);
    const parts = plan.routes.flatMap((r) => r.stops.filter((s) => s.key === "deck"));
    expect(parts.map((p) => p.part)).toEqual([{ n: 1, of: 3 }, { n: 2, of: 3 }, { n: 3, of: 3 }]);
    expect(parts.reduce((m, p) => m + p.durMin, 0)).toBeCloseTo(20 * 60);
  });

  it("says when a job is longer than the days being planned", () => {
    const plan = planWeek({ days: [MON, TUE], techIds: ["a"], base: SHOP, fixed: [], flex: [job("remodel", E1, 40)] });
    expect(plan.unplaced).toEqual([{ key: "remodel", reason: "too-long" }]);
  });

  it("skips a tech's day off", () => {
    const plan = planWeek({
      days: [MON, TUE], techIds: ["a"], base: SHOP, fixed: [], flex: [job("e1", E1, 1)],
      isOff: (t, d) => t === "a" && d === MON,
    });
    expect(plan.routes.map((r) => r.day)).toEqual([TUE]);
  });

  it("keeps a requested tech", () => {
    const plan = planWeek({ days: [MON], techIds: ["a", "b"], base: SHOP, fixed: [], flex: [job("e1", E1, 1, { techIds: ["b"] })] });
    expect(keysOf(plan, MON, "b")).toEqual(["e1"]);
  });

  it("books approved work before quotes when room is short", () => {
    const flex = [job("quote", W1, 6, { phase: 1 }), job("approved", E1, 6, { phase: 0 })];
    const plan = planWeek({ days: [MON], techIds: ["a"], base: SHOP, fixed: [], flex });
    expect(keysOf(plan, MON, "a")).toEqual(["approved"]);
    expect(plan.unplaced).toEqual([{ key: "quote", reason: "no-room" }]);
  });

  it("re-orders a zig-zag booked day and counts the miles saved", () => {
    const fixed = [booked("e1", E1, MON, "a", 1), booked("w1", W1, MON, "a", 1), booked("e2", E2, MON, "a", 1), booked("w2", W2, MON, "a", 1)];
    const plan = planWeek({ days: [MON], techIds: ["a"], base: SHOP, fixed, flex: [] });
    const order = keysOf(plan, MON, "a");
    // East pair together and west pair together.
    expect(Math.abs(order.indexOf("e1") - order.indexOf("e2"))).toBe(1);
    expect(Math.abs(order.indexOf("w1") - order.indexOf("w2"))).toBe(1);
    expect(plan.savedMiles).toBeGreaterThan(5);
  });

  it("keeps a crew visit on every tech's route", () => {
    const fixed = [booked("crew", E1, MON, "a", 3), booked("crew", E1, MON, "b", 3)];
    const plan = planWeek({ days: [MON], techIds: ["a", "b"], base: SHOP, fixed, flex: [] });
    expect(keysOf(plan, MON, "a")).toEqual(["crew"]);
    expect(keysOf(plan, MON, "b")).toEqual(["crew"]);
  });

  it("starts today's routes no earlier than the given time", () => {
    const plan = planWeek({ days: [MON], techIds: ["a"], base: SHOP, fixed: [], flex: [job("e1", E1, 1)], startMinByDay: { [MON]: 13 * 60 } });
    expect(plan.routes[0].leaveMin).toBe(13 * 60);
    expect(plan.routes[0].stops[0].arriveMin).toBeGreaterThan(13 * 60);
  });

  describe("crew jobs", () => {
    const crewStops = (plan: ReturnType<typeof planWeek>, key: string) =>
      plan.routes.flatMap((r) => r.stops.filter((s) => s.key === key).map((s) => ({ ...s, day: r.day, techId: r.techId })));

    it("books a 2-crew 12h job on one day for two techs at the same time", () => {
      const plan = planWeek({ days: WEEK, techIds: ["a", "b", "c"], base: SHOP, fixed: [], flex: [job("deck", E1, 12, { crew: 2 })] });
      expect(plan.unplaced).toEqual([]);
      expect(plan.shortCrew).toEqual([]);
      const parts = crewStops(plan, "deck");
      expect(parts).toHaveLength(2);
      expect(new Set(parts.map((p) => p.day))).toEqual(new Set([MON]));
      expect(new Set(parts.map((p) => p.techId)).size).toBe(2);
      expect(parts[0].startMin).toBe(parts[1].startMin);
      for (const p of parts) {
        expect(p.durMin).toBeCloseTo(6 * 60); // 12 h of work ÷ 2 people
        expect(p.crew).toEqual(parts.map((x) => x.techId));
        expect(p.part).toBeUndefined();
      }
      expect(plan.placedNew).toBe(1);
    });

    it("starts when the later tech gets there; the other waits", () => {
      const fixed = [booked("b-west", W1, MON, "b", 2, { fixedMin: 8 * 60 })];
      const plan = planWeek({ days: [MON], techIds: ["a", "b"], base: SHOP, fixed, flex: [job("deck", E1, 6, { crew: 2 })] });
      const [pa, pb] = ["a", "b"].map((t) => crewStops(plan, "deck").find((p) => p.techId === t)!);
      expect(pa.startMin).toBe(pb.startMin);
      expect(pb.startMin).toBeGreaterThan(10 * 60); // after Bo's 8–10 visit + the drive over
      expect(pa.arriveMin).toBeLessThan(pa.startMin); // Ann is early and waits
      expect(plan.routes.every((r) => r.lateMin === 0 && r.overMin === 0)).toBe(true);
    });

    it("never makes a crew member late for the crew start", () => {
      let seed = 11;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      const flex = Array.from({ length: 30 }, (_, i) =>
        job(`j${i}`, { lat: 37.6 + rnd() * 0.2, lng: -97.45 + rnd() * 0.3 }, 1 + Math.round(rnd() * 6) / 2, i % 5 === 0 ? { crew: 2 } : {}));
      const t0 = Date.now();
      const plan = planWeek({ days: WEEK, techIds: ["a", "b", "c", "d"], base: SHOP, fixed: [], flex });
      expect(Date.now() - t0).toBeLessThan(3000);
      expect(plan.placedNew).toBe(30);
      expect(plan.shortCrew).toEqual([]);
      for (const r of plan.routes) expect(r.overMin + r.lateMin).toBe(0);
      for (let i = 0; i < 30; i += 5) {
        const parts = crewStops(plan, `j${i}`);
        expect(parts).toHaveLength(2);
        expect(parts[0].day).toBe(parts[1].day);
        expect(parts[0].startMin).toBe(parts[1].startMin);
        for (const p of parts) expect(p.arriveMin).toBeLessThanOrEqual(p.startMin);
      }
    });

    it("splits a long crew job over consecutive days, same crew each day", () => {
      const plan = planWeek({ days: WEEK, techIds: ["a", "b"], base: SHOP, fixed: [], flex: [job("remodel", E1, 30, { crew: 2 })] });
      const parts = crewStops(plan, "remodel");
      expect(parts.map((p) => `${p.day}|${p.techId}`).sort()).toEqual([`${MON}|a`, `${MON}|b`, `${TUE}|a`, `${TUE}|b`]);
      expect(parts.reduce((m, p) => m + p.durMin, 0)).toBeCloseTo(30 * 60);
      for (const d of [MON, TUE]) {
        const [x, y] = parts.filter((p) => p.day === d);
        expect(x.startMin).toBe(y.startMin);
      }
    });

    it("falls back to fewer techs over more days when the crew isn't free together, and says so", () => {
      const plan = planWeek({
        days: WEEK, techIds: ["a", "b"], base: SHOP, fixed: [], flex: [job("deck", E1, 12, { crew: 2 })],
        isOff: (t) => t === "b",
      });
      expect(plan.unplaced).toEqual([]);
      expect(plan.shortCrew).toEqual([{ key: "deck", wanted: 2, got: 1, days: 2 }]);
      const parts = crewStops(plan, "deck");
      expect(parts.map((p) => `${p.day}|${p.techId}`)).toEqual([`${MON}|a`, `${TUE}|a`]);
      expect(parts.every((p) => p.crew === undefined)).toBe(true);
    });

    it("keeps the requested tech on the crew", () => {
      const plan = planWeek({ days: [MON], techIds: ["a", "b", "c"], base: SHOP, fixed: [], flex: [job("deck", E1, 8, { crew: 2, leadId: "c" })] });
      expect(crewStops(plan, "deck").map((p) => p.techId)).toContain("c");
    });

    it("says when even the full crew needs more days than planned", () => {
      const plan = planWeek({ days: [MON, TUE], techIds: ["a", "b"], base: SHOP, fixed: [], flex: [job("remodel", E1, 40, { crew: 2 })] });
      expect(plan.unplaced).toEqual([{ key: "remodel", reason: "too-long" }]);
    });

    it("leaves a crew job unplaced when nobody has room", () => {
      const fixed = [booked("fa", W1, MON, "a", 8), booked("fb", W2, MON, "b", 8)];
      const plan = planWeek({ days: [MON], techIds: ["a", "b"], base: SHOP, fixed, flex: [job("deck", E1, 6, { crew: 2 })] });
      expect(plan.unplaced).toEqual([{ key: "deck", reason: "no-room" }]);
      expect(plan.shortCrew).toEqual([]);
    });

    it("lines up a booked crew visit with no promised time", () => {
      const fixed = [
        booked("b-west", W1, MON, "b", 2, { fixedMin: 8 * 60 }),
        booked("crew", E1, MON, "a", 3), booked("crew", E1, MON, "b", 3),
      ];
      const plan = planWeek({ days: [MON], techIds: ["a", "b"], base: SHOP, fixed, flex: [job("e2", E2, 1.5), job("w2", W2, 1)] });
      const [pa, pb] = ["a", "b"].map((t) => crewStops(plan, "crew").find((p) => p.techId === t)!);
      expect(pa.startMin).toBe(pb.startMin);
      expect(pb.startMin).toBeGreaterThan(10 * 60); // Bo comes from his 8–10 visit
      expect(pa.crew).toEqual(["a", "b"]);
      expect(pb.crew).toEqual(["a", "b"]);
      expect(plan.placedNew).toBe(2);
      for (const r of plan.routes) expect(r.overMin + r.lateMin).toBe(0);
    });

    it("leaves a booked crew visit as booked when lining it up would run someone over", () => {
      const fixed = [
        booked("b-west", W1, MON, "b", 5, { fixedMin: 8 * 60 }),
        booked("crew", E1, MON, "a", 3), booked("crew", E1, MON, "b", 3),
        booked("a-more", E2, MON, "a", 3),
      ];
      const plan = planWeek({ days: [MON], techIds: ["a", "b"], base: SHOP, fixed, flex: [] });
      const [pa, pb] = ["a", "b"].map((t) => crewStops(plan, "crew").find((p) => p.techId === t)!);
      expect(pa.startMin).toBeLessThan(pb.startMin); // Ann starts without Bo instead of finishing at 8 PM
      expect(pa.crew).toEqual(["a", "b"]); // still shown as a crew visit
      for (const r of plan.routes) expect(r.overMin + r.lateMin).toBe(0);
    });

    it("spreads a job over at least its cure-time days", () => {
      const plan = planWeek({ days: WEEK, techIds: ["a"], base: SHOP, fixed: [], flex: [job("paint", E1, 4, { minDays: 2 })] });
      const parts = crewStops(plan, "paint");
      expect(parts.map((p) => p.day)).toEqual([MON, TUE]);
      expect(parts.map((p) => p.durMin)).toEqual([120, 120]);
    });

    it("takes one more day before dropping a person when a full day won't fit around the drive", () => {
      // 18 h ÷ 2 = 9 h on site: the whole 8–5 window with no time to drive.
      const plan = planWeek({ days: WEEK, techIds: ["a", "b"], base: SHOP, fixed: [], flex: [job("deck", E1, 18, { crew: 2 })] });
      expect(plan.shortCrew).toEqual([]);
      const parts = crewStops(plan, "deck");
      expect(parts.map((p) => `${p.day}|${p.techId}`).sort()).toEqual([`${MON}|a`, `${MON}|b`, `${TUE}|a`, `${TUE}|b`]);
    });
  });

  it("plans without a shop address", () => {
    const plan = planWeek({ days: [MON], techIds: ["a"], base: null, fixed: [], flex: [job("e1", E1, 1), job("e2", E2, 1)] });
    expect(plan.placedNew).toBe(2);
    expect(plan.routes[0].stops[0].driveMin).toBe(0);
  });
});

describe("clock helpers", () => {
  it("converts and rounds", () => {
    expect(hhmmToMin("14:05")).toBe(845);
    expect(hhmmToMin("")).toBeNull();
    expect(minToHhmm(845)).toBe("14:05");
    expect(minToHhmm(roundQuarter(8 * 60 + 23))).toBe("08:30");
    expect(minToHhmm(roundQuarter(8 * 60 + 7))).toBe("08:00");
  });
});
