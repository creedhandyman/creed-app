/**
 * Week route planner: the Dispatch Assistant's engine.
 *
 * Given the days to plan, the crew, the shop, the visits already on the
 * calendar and the jobs still waiting for a day, it proposes who goes where,
 * in what order and at what time, for the whole week at once:
 *
 *  1. Every (day, tech) pair is a ROUTE that leaves the shop at the day's
 *     start, visits its stops and drives back. A route has a working window
 *     (dayStartMin..dayEndMin); the last job must finish inside it.
 *  2. FIXED visits (booked work that isn't being re-planned) go in first,
 *     pinned to their day + tech. A promised time ("🕐 9:00") is a soft
 *     window: arriving early waits, arriving more than maxLateMin late counts
 *     as a violation. The planner never ADDS a violation; a day that's already
 *     overbooked stays as it is (and is reported), it just gets nothing new.
 *  3. Jobs longer than a working day take whole CONSECUTIVE days for one tech
 *     (the hours split evenly over those days).
 *  4. The rest go in by REGRET insertion: each round places the job that would
 *     cost the most to put off (best slot vs. second-best slot), at its
 *     cheapest position. Cost = extra drive minutes + dayPenaltyMin per day
 *     into the week (work lands early instead of piling up on Friday) +
 *     routeCostMin when it would put a tech on the road on an empty day.
 *     Lower `phase` goes first (approved work before quotes).
 *  5. Local search: 2-opt + or-opt inside every route, then relocating and
 *     swapping movable jobs between routes while the total cost drops.
 *
 * Distances are straight-line × ROAD_FACTOR at an average city speed: the
 * same estimate the day optimizer, mileage and closest-tech hints use (no
 * routing API, no key). PURE: no store, React or fetch, so it's unit-tested
 * in src/__tests__/route-plan.test.ts. App glue (calendar → visits → writes)
 * lives in lib/dispatch-week.ts.
 */
import { haversineMiles, ROAD_FACTOR } from "./geo";
import { addDaysYmd } from "./day-plan";

export interface LatLng { lat: number; lng: number }

export interface PlanOptions {
  /** Leave the shop at (minutes after midnight). */
  dayStartMin: number;
  /** The last job must be done by (minutes after midnight). */
  dayEndMin: number;
  /** Parking / unloading added to every drive between two different stops. */
  bufferMin: number;
  /** Average city driving speed. 28 matches geo.driveMinutes. */
  mph: number;
  /** How late a promised time may run before it counts as a violation. */
  maxLateMin: number;
  /** Cost of pushing a job one day later in the week, in drive-minutes. */
  dayPenaltyMin: number;
  /** Cost of putting a tech on the road on a day that had nothing yet, so two
   *  small jobs share a day instead of each opening its own. */
  routeCostMin: number;
}

export const DEFAULT_PLAN_OPTIONS: PlanOptions = {
  dayStartMin: 8 * 60,
  dayEndMin: 17 * 60,
  bufferMin: 10,
  mph: 28,
  maxLateMin: 15,
  dayPenaltyMin: 8,
  routeCostMin: 30,
};

/** A visit pinned to one tech's day. A crew visit is one FixedVisit per tech
 *  (same key). */
export interface FixedVisit {
  key: string;
  jobId?: string;
  entryId?: string;
  address: string;
  pt: LatLng;
  /** On-site minutes for this tech on this day. */
  durMin: number;
  /** Promised start (minutes after midnight). */
  fixedMin?: number;
  day: string;
  techId: string;
}

/** A visit the planner places. */
export interface FlexVisit {
  key: string;
  jobId?: string;
  /** Set for booked visits the planner may move (crew-less or re-planned). */
  entryId?: string;
  address: string;
  pt: LatLng;
  /** Total on-site minutes. More than a working day = multi-day. */
  totalMin: number;
  /** Promised start (single-day visits only). */
  fixedMin?: number;
  /** Days it may land on (undefined = any planned day). */
  days?: string[];
  /** Techs who may take it (undefined = anyone). */
  techIds?: string[];
  /** Not on the calendar yet. */
  isNew: boolean;
  /** Lower goes first: -1 booked, 0 approved, 1 quoted. */
  phase: number;
}

export interface PlanInput {
  /** Days to plan, ascending YYYY-MM-DD. */
  days: string[];
  /** Techs to plan, in display order. */
  techIds: string[];
  /** The shop. null = routes start at their first stop. */
  base: LatLng | null;
  fixed: FixedVisit[];
  flex: FlexVisit[];
  /** A tech who's off that day gets no route (approved time off). */
  isOff?: (techId: string, day: string) => boolean;
  /** Later start for a day (today: not before now). */
  startMinByDay?: Record<string, number>;
  opts?: Partial<PlanOptions>;
}

export interface PlannedStop {
  key: string;
  jobId?: string;
  entryId?: string;
  address: string;
  pt: LatLng;
  durMin: number;
  fixedMin?: number;
  isNew: boolean;
  /** Can't leave this route (booked crew visit or a multi-day piece). */
  pinned: boolean;
  /** Multi-day piece n of `of`. */
  part?: { n: number; of: number };
  arriveMin: number;
  startMin: number;
  endMin: number;
  /** Drive into this stop (minutes incl. buffer, and miles). */
  driveMin: number;
  miles: number;
  /** Minutes past the promised time's grace (0 = on time). */
  lateMin: number;
}

export interface PlannedRoute {
  day: string;
  techId: string;
  stops: PlannedStop[];
  /** Whole route incl. the drive back to the shop. */
  miles: number;
  driveMin: number;
  /** Minutes on site. */
  workMin: number;
  /** Leave the shop / last job done / back at the shop. */
  leaveMin: number;
  endMin: number;
  backMin: number;
  /** Minutes the last job runs past the day's end. */
  overMin: number;
  /** Minutes of promised times missed (beyond the grace). */
  lateMin: number;
}

export type UnplacedReason = "no-room" | "too-long";

export interface WeekPlan {
  /** Routes that have stops, by day then crew order. */
  routes: PlannedRoute[];
  unplaced: { key: string; reason: UnplacedReason }[];
  /** New jobs placed (multi-day counts once). */
  placedNew: number;
  miles: number;
  driveMin: number;
  /** Miles saved by re-ordering the booked stops vs. their calendar order. */
  savedMiles: number;
}

// ── Internals ────────────────────────────────────────────────────────

interface Stop {
  key: string;
  jobId?: string;
  entryId?: string;
  address: string;
  pt: LatLng;
  /** Row/column of pt in the distance matrix. */
  pi: number;
  durMin: number;
  fixedMin?: number;
  isNew: boolean;
  pinned: boolean;
  /** Index into input.flex for movable single-day stops. */
  flexIdx?: number;
  part?: { n: number; of: number };
  /** Calendar order of booked stops (the "before" route). */
  order: number;
}

interface Route {
  day: string;
  dayIdx: number;
  techIdx: number;
  techId: string;
  startMin: number;
  stops: Stop[];
}

interface Sim { drive: number; miles: number; late: number; over: number; end: number }

/** Promised-time and overtime violations outweigh any drive saving. */
const VIOLATION_WEIGHT = 100;
const EPS = 1e-6;

const roadMiles = (a: LatLng, b: LatLng) => haversineMiles(a.lat, a.lng, b.lat, b.lng) * ROAD_FACTOR;

/** Every point's road miles to every other, computed once per plan (the
 *  search would otherwise redo the trig millions of times). base = the shop's
 *  row, -1 when there's no shop. */
interface Geo { D: Float64Array; n: number; base: number }

/** Road miles between two matrix rows (0 when either is unknown). */
const leg = (g: Geo, i: number, j: number) => (i < 0 || j < 0 ? 0 : g.D[i * g.n + j]);

function simulate(r: Route, stops: Stop[], g: Geo, o: PlanOptions): Sim {
  let t = r.startMin;
  let pos = g.base;
  let drive = 0;
  let miles = 0;
  let late = 0;
  for (let i = 0; i < stops.length; i++) {
    const s = stops[i];
    const m = leg(g, pos, s.pi);
    const d = (m / o.mph) * 60 + (i > 0 && m > 0.05 ? o.bufferMin : 0);
    drive += d;
    miles += m;
    const arrive = t + d;
    const start = s.fixedMin != null ? Math.max(arrive, s.fixedMin) : arrive;
    if (s.fixedMin != null) late += Math.max(0, arrive - s.fixedMin - o.maxLateMin);
    t = start + s.durMin;
    pos = s.pi;
  }
  if (stops.length && g.base >= 0) {
    const back = leg(g, pos, g.base);
    drive += (back / o.mph) * 60;
    miles += back;
  }
  return { drive, miles, late, over: stops.length ? Math.max(0, t - o.dayEndMin) : 0, end: t };
}

const penalty = (s: Sim) => s.late + s.over;
const orderCost = (s: Sim) => s.drive + VIOLATION_WEIGHT * penalty(s);

/** Cheapest feasible position for `stop` in `stops` (no new violations), as
 *  extra drive minutes. null when it fits nowhere. Positions are ranked by
 *  their detour (which IS the drive cost) and only simulated, cheapest first,
 *  to check the time windows — so the usual case costs one simulation. */
function bestInsertion(r: Route, stops: Stop[], stop: Stop, g: Geo, o: PlanOptions): { cost: number; pos: number } | null {
  const before = simulate(r, stops, g, o);
  const n = stops.length;
  const order: { pos: number; detour: number }[] = [];
  for (let p = 0; p <= n; p++) {
    const prev = p === 0 ? g.base : stops[p - 1].pi;
    const next = p === n ? g.base : stops[p].pi;
    const skip = n === 0 ? 0 : leg(g, prev, next);
    order.push({ pos: p, detour: leg(g, prev, stop.pi) + leg(g, stop.pi, next) - skip });
  }
  order.sort((x, y) => x.detour - y.detour);
  for (const { pos } of order) {
    const sim = simulate(r, [...stops.slice(0, pos), stop, ...stops.slice(pos)], g, o);
    if (penalty(sim) > penalty(before) + EPS) continue;
    return { cost: sim.drive - before.drive, pos };
  }
  return null;
}

/** 2-opt + or-opt on one route's order, never adding a violation. */
function optimizeOrder(r: Route, g: Geo, o: PlanOptions) {
  if (r.stops.length < 2) return;
  let cur = r.stops;
  let curCost = orderCost(simulate(r, cur, g, o));
  let improved = true;
  for (let guard = 0; improved && guard < 60; guard++) {
    improved = false;
    for (let i = 0; i < cur.length - 1; i++) {
      for (let k = i + 1; k < cur.length; k++) {
        const cand = [...cur.slice(0, i), ...cur.slice(i, k + 1).reverse(), ...cur.slice(k + 1)];
        const c = orderCost(simulate(r, cand, g, o));
        if (c < curCost - 0.01) { cur = cand; curCost = c; improved = true; }
      }
    }
    for (let i = 0; i < cur.length; i++) {
      for (let j = 0; j < cur.length; j++) {
        if (i === j) continue;
        const rest = cur.filter((_, x) => x !== i);
        const cand = [...rest.slice(0, j), cur[i], ...rest.slice(j)];
        const c = orderCost(simulate(r, cand, g, o));
        if (c < curCost - 0.01) { cur = cand; curCost = c; improved = true; }
      }
    }
  }
  r.stops = cur;
}

function pathMiles(stops: Stop[], g: Geo): number {
  let m = 0;
  let pos = g.base;
  for (const s of stops) {
    m += leg(g, pos, s.pi);
    pos = s.pi;
  }
  if (stops.length) m += leg(g, pos, g.base);
  return m;
}

/** Extra cost of a route that has no stops yet (see routeCostMin). */
const opening = (stops: Stop[], o: PlanOptions) => (stops.length ? 0 : o.routeCostMin);

const allowed = (v: FlexVisit, r: Route) =>
  (!v.days || v.days.includes(r.day)) && (!v.techIds || v.techIds.includes(r.techId));

// ── The planner ──────────────────────────────────────────────────────

export function planWeek(input: PlanInput): WeekPlan {
  const o: PlanOptions = { ...DEFAULT_PLAN_OPTIONS, ...input.opts };
  const dayLen = Math.max(30, o.dayEndMin - o.dayStartMin);
  const pts: LatLng[] = [];
  const ptIdx = new Map<string, number>();
  const pidx = (p: LatLng) => {
    const k = `${p.lat},${p.lng}`;
    let i = ptIdx.get(k);
    if (i == null) { i = pts.length; ptIdx.set(k, i); pts.push(p); }
    return i;
  };
  const baseIdx = input.base ? pidx(input.base) : -1;
  for (const f of input.fixed) pidx(f.pt);
  const flexPi = input.flex.map((v) => pidx(v.pt));
  const D = new Float64Array(pts.length * pts.length);
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) D[i * pts.length + j] = D[j * pts.length + i] = roadMiles(pts[i], pts[j]);
  }
  const g: Geo = { D, n: pts.length, base: baseIdx };
  const routes: Route[] = [];
  const byKey = new Map<string, Route>();
  const techOrder = (id: string) => {
    const i = input.techIds.indexOf(id);
    return i < 0 ? input.techIds.length : i;
  };
  const ensure = (day: string, techId: string): Route => {
    const k = `${day}|${techId}`;
    let r = byKey.get(k);
    if (!r) {
      r = {
        day,
        dayIdx: input.days.indexOf(day),
        techIdx: techOrder(techId),
        techId,
        startMin: Math.max(o.dayStartMin, input.startMinByDay?.[day] ?? o.dayStartMin),
        stops: [],
      };
      byKey.set(k, r);
      routes.push(r);
    }
    return r;
  };
  for (const day of input.days) {
    for (const t of input.techIds) if (!input.isOff?.(t, day)) ensure(day, t);
  }

  // 1. Fixed visits — booked work keeps its day + tech. Calendar order first
  //    (promised time, untimed after), then optimizeOrder tidies it.
  input.fixed.forEach((f, i) => {
    if (!input.days.includes(f.day)) return;
    ensure(f.day, f.techId).stops.push({
      key: f.key, jobId: f.jobId, entryId: f.entryId, address: f.address, pt: f.pt, pi: pidx(f.pt),
      durMin: f.durMin, fixedMin: f.fixedMin, isNew: false, pinned: true, order: i,
    });
  });
  const calOrder = (a: Stop, b: Stop) =>
    (a.fixedMin ?? Infinity) - (b.fixedMin ?? Infinity) || a.order - b.order;
  for (const r of routes) r.stops.sort(calOrder);

  const unplaced: { key: string; reason: UnplacedReason }[] = [];
  const mkStop = (v: FlexVisit, vi: number, extra?: Partial<Stop>): Stop => ({
    key: v.key, jobId: v.jobId, entryId: v.entryId, address: v.address, pt: v.pt, pi: flexPi[vi],
    durMin: v.totalMin, fixedMin: v.fixedMin, isNew: v.isNew, pinned: false, flexIdx: vi,
    order: input.fixed.length + vi, ...extra,
  });

  // 2. Multi-day jobs need consecutive days, so they go before the small ones.
  const flexIdx = input.flex.map((_, i) => i);
  const multi = flexIdx
    .filter((i) => input.flex[i].totalMin > dayLen + 0.5)
    .sort((a, b) => input.flex[a].phase - input.flex[b].phase || input.flex[b].totalMin - input.flex[a].totalMin);
  for (const vi of multi) {
    const v = input.flex[vi];
    const k = Math.ceil(v.totalMin / dayLen);
    if (k > input.days.length) { unplaced.push({ key: v.key, reason: "too-long" }); continue; }
    const per = v.totalMin / k;
    let best: { cost: number; slots: { r: Route; pos: number }[] } | null = null;
    for (const techId of v.techIds ?? input.techIds) {
      for (let i = 0; i + k <= input.days.length; i++) {
        const ds = input.days.slice(i, i + k);
        if (!ds.every((d, j) => j === 0 || addDaysYmd(ds[0], j) === d)) continue;
        if (v.days && !ds.every((d) => v.days!.includes(d))) continue;
        let cost = i * o.dayPenaltyMin;
        const slots: { r: Route; pos: number }[] = [];
        for (const d of ds) {
          const r = byKey.get(`${d}|${techId}`);
          const ins = r && bestInsertion(r, r.stops, mkStop(v, vi, { durMin: per, fixedMin: undefined }), g, o);
          if (!r || !ins) { slots.length = 0; break; }
          cost += ins.cost + opening(r.stops, o);
          slots.push({ r, pos: ins.pos });
        }
        if (slots.length === k && (!best || cost < best.cost - EPS)) best = { cost, slots };
      }
    }
    if (!best) { unplaced.push({ key: v.key, reason: "no-room" }); continue; }
    best.slots.forEach(({ r, pos }, n) => {
      r.stops.splice(pos, 0, mkStop(v, vi, { durMin: per, fixedMin: undefined, pinned: true, flexIdx: undefined, part: { n: n + 1, of: k } }));
    });
  }

  // 3. Single-day visits by regret insertion, phase by phase.
  const single = flexIdx.filter((i) => input.flex[i].totalMin <= dayLen + 0.5);
  const phases = [...new Set(single.map((i) => input.flex[i].phase))].sort((a, b) => a - b);
  // Each job's best slot per route, recomputed only for the route that just
  // changed (the others' stops are the same as last round).
  const slotCache = new Map<number, ({ cost: number; pos: number } | null)[]>();
  const slotsFor = (vi: number, changed: number) => {
    const v = input.flex[vi];
    let row = slotCache.get(vi);
    const fill = (ri: number) => {
      const r = routes[ri];
      row![ri] = allowed(v, r) ? bestInsertion(r, r.stops, mkStop(v, vi), g, o) : null;
    };
    if (!row) {
      row = new Array(routes.length).fill(null);
      slotCache.set(vi, row);
      for (let ri = 0; ri < routes.length; ri++) fill(ri);
    } else if (changed >= 0) {
      fill(changed);
    }
    return row;
  };
  for (const phase of phases) {
    let pending = single.filter((i) => input.flex[i].phase === phase);
    let changed = -1;
    while (pending.length) {
      let pick: { vi: number; r: Route; pos: number; regret: number; dur: number } | null = null;
      const dead: number[] = [];
      for (const vi of pending) {
        const v = input.flex[vi];
        const row = slotsFor(vi, changed);
        let best: { cost: number; r: Route; pos: number } | null = null;
        let second = Infinity;
        for (let ri = 0; ri < routes.length; ri++) {
          const ins = row[ri];
          if (!ins) continue;
          const r = routes[ri];
          const c = ins.cost + opening(r.stops, o) + r.dayIdx * o.dayPenaltyMin;
          if (!best || c < best.cost - EPS) {
            if (best) second = best.cost;
            best = { cost: c, r, pos: ins.pos };
          } else if (c < second) {
            second = c;
          }
        }
        if (!best) { dead.push(vi); continue; }
        const regret = second === Infinity ? 1e9 : second - best.cost;
        if (!pick || regret > pick.regret + EPS || (Math.abs(regret - pick.regret) <= EPS && v.totalMin > pick.dur)) {
          pick = { vi, r: best.r, pos: best.pos, regret, dur: v.totalMin };
        }
      }
      for (const vi of dead) unplaced.push({ key: input.flex[vi].key, reason: "no-room" });
      pending = pending.filter((i) => !dead.includes(i));
      if (!pick) break;
      pick.r.stops.splice(pick.pos, 0, mkStop(input.flex[pick.vi], pick.vi));
      changed = routes.indexOf(pick.r);
      pending = pending.filter((i) => i !== pick!.vi);
    }
  }

  // 4. Local search: tidy every route, then move jobs between routes while
  //    that saves drive (or pulls work earlier), then tidy again.
  for (const r of routes) optimizeOrder(r, g, o);
  for (let pass = 0; pass < 6; pass++) {
    let moved = false;
    for (const r of routes) {
      for (const s of [...r.stops]) {
        if (s.pinned || s.flexIdx == null) continue;
        const v = input.flex[s.flexIdx];
        const without = r.stops.filter((x) => x !== s);
        const gain = simulate(r, r.stops, g, o).drive - simulate(r, without, g, o).drive
          + opening(without, o) + r.dayIdx * o.dayPenaltyMin;
        let best: { cost: number; r: Route; pos: number } | null = null;
        for (const r2 of routes) {
          if (!allowed(v, r2)) continue;
          const into = r2 === r ? without : r2.stops;
          const ins = bestInsertion(r2, into, s, g, o);
          if (!ins) continue;
          const c = ins.cost + opening(into, o) + r2.dayIdx * o.dayPenaltyMin;
          if (c < gain - 0.5 && (!best || c < best.cost)) best = { cost: c, r: r2, pos: ins.pos };
        }
        if (best) {
          r.stops = without;
          best.r.stops.splice(best.pos, 0, s);
          moved = true;
        }
      }
    }
    // Swap two jobs between routes (a full day can't take a job without
    // giving one back, which a plain relocate never tries).
    for (let i = 0; i < routes.length; i++) {
      for (let j = i + 1; j < routes.length; j++) {
        if (swapBetween(routes[i], routes[j], input.flex, g, o)) moved = true;
      }
    }
    if (!moved) break;
  }
  for (const r of routes) optimizeOrder(r, g, o);

  // 5. Timings for the screen.
  const out: PlannedRoute[] = routes
    .filter((r) => r.stops.length)
    .sort((a, b) => a.dayIdx - b.dayIdx || a.techIdx - b.techIdx)
    .map((r) => detailRoute(r, g, o));

  let savedMiles = 0;
  for (const r of routes) {
    const booked = r.stops.filter((s) => !s.isNew);
    if (booked.length < 2) continue;
    savedMiles += pathMiles([...booked].sort(calOrder), g) - pathMiles(booked, g);
  }

  const placedNew = new Set(out.flatMap((r) => r.stops.filter((s) => s.isNew).map((s) => s.key))).size;
  return {
    routes: out,
    unplaced,
    placedNew,
    miles: round1(out.reduce((m, r) => m + r.miles, 0)),
    driveMin: Math.round(out.reduce((m, r) => m + r.driveMin, 0)),
    savedMiles: Math.max(0, round1(savedMiles)),
  };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Best improving swap of one movable stop each between two routes; applies
 *  it and returns true, or false when no swap saves drive. Swaps keep each
 *  route's stop count, so day penalties and opening costs don't change. */
function swapBetween(r1: Route, r2: Route, flex: FlexVisit[], g: Geo, o: PlanOptions): boolean {
  const drive1 = simulate(r1, r1.stops, g, o).drive;
  const drive2 = simulate(r2, r2.stops, g, o).drive;
  let best: { gain: number; s1: Stop[]; s2: Stop[] } | null = null;
  for (const a of r1.stops) {
    if (a.pinned || a.flexIdx == null || !allowed(flex[a.flexIdx], r2)) continue;
    const rest1 = r1.stops.filter((x) => x !== a);
    for (const b of r2.stops) {
      if (b.pinned || b.flexIdx == null || !allowed(flex[b.flexIdx], r1)) continue;
      const rest2 = r2.stops.filter((x) => x !== b);
      const in1 = bestInsertion(r1, rest1, b, g, o);
      const in2 = in1 && bestInsertion(r2, rest2, a, g, o);
      if (!in1 || !in2) continue;
      const n1 = [...rest1.slice(0, in1.pos), b, ...rest1.slice(in1.pos)];
      const n2 = [...rest2.slice(0, in2.pos), a, ...rest2.slice(in2.pos)];
      const s1 = simulate(r1, n1, g, o);
      const s2 = simulate(r2, n2, g, o);
      // bestInsertion checked against the route minus the stop; also hold
      // the line against the route as it was.
      if (penalty(s1) > penalty(simulate(r1, r1.stops, g, o)) + EPS) continue;
      if (penalty(s2) > penalty(simulate(r2, r2.stops, g, o)) + EPS) continue;
      const gain = drive1 + drive2 - s1.drive - s2.drive;
      if (gain > 0.5 && (!best || gain > best.gain)) best = { gain, s1: n1, s2: n2 };
    }
  }
  if (!best) return false;
  r1.stops = best.s1;
  r2.stops = best.s2;
  return true;
}

function detailRoute(r: Route, g: Geo, o: PlanOptions): PlannedRoute {
  let t = r.startMin;
  let pos = g.base;
  let late = 0;
  const stops: PlannedStop[] = r.stops.map((s, i) => {
    const m = leg(g, pos, s.pi);
    const d = (m / o.mph) * 60 + (i > 0 && m > 0.05 ? o.bufferMin : 0);
    const arrive = t + d;
    const start = s.fixedMin != null ? Math.max(arrive, s.fixedMin) : arrive;
    const lateMin = s.fixedMin != null ? Math.max(0, arrive - s.fixedMin - o.maxLateMin) : 0;
    late += lateMin;
    t = start + s.durMin;
    pos = s.pi;
    return {
      key: s.key, jobId: s.jobId, entryId: s.entryId, address: s.address, pt: s.pt,
      durMin: s.durMin, fixedMin: s.fixedMin, isNew: s.isNew, pinned: s.pinned, part: s.part,
      arriveMin: Math.round(arrive), startMin: Math.round(start), endMin: Math.round(t),
      driveMin: Math.round(d), miles: round1(m), lateMin: Math.round(lateMin),
    };
  });
  const back = r.stops.length ? leg(g, pos, g.base) : 0;
  const backDrive = (back / o.mph) * 60;
  const sim = simulate(r, r.stops, g, o);
  return {
    day: r.day,
    techId: r.techId,
    stops,
    miles: round1(sim.miles),
    driveMin: Math.round(sim.drive),
    workMin: Math.round(r.stops.reduce((w, s) => w + s.durMin, 0)),
    leaveMin: r.startMin,
    endMin: Math.round(t),
    backMin: Math.round(t + backDrive),
    overMin: Math.round(Math.max(0, t - o.dayEndMin)),
    lateMin: Math.round(late),
  };
}

// ── Clock helpers ────────────────────────────────────────────────────

/** "14:05" → 845 (null when blank / malformed). */
export function hhmmToMin(hhmm?: string | null): number | null {
  const m = (hhmm || "").match(/^(\d{1,2}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** 845 → "14:05". */
export function minToHhmm(min: number): string {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** Nearest quarter hour, the times written to the calendar. */
export const roundQuarter = (min: number) => Math.round(min / 15) * 15;
