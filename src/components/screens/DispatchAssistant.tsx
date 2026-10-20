"use client";
/**
 * Dispatch Assistant — plan the whole crew's week in one go.
 *
 *  - CREW RIGHT NOW: each tech's last GPS stamp today (clock-in/out fixes;
 *    the app doesn't track phones between them), the job they're on, and how
 *    far they are from their next stop ("Ann is ~10 min from 1436 Piatt Ave").
 *  - PLAN THE WEEK: pick the days, who's working and the hours; the route
 *    planner (lib/route-plan, glue in lib/dispatch-week) books the jobs still
 *    waiting for a day around what's already booked — who, which day, what
 *    order, what time — and re-orders booked days to cut driving.
 *  - The plan is a PROPOSAL: day tabs with a route map and each tech's stop
 *    list (Maps directions + text-the-tech links). Nothing touches the
 *    calendar until Apply, which inserts schedule rows for the new jobs (job →
 *    scheduled, like Schedule's quick-add) and gives booked visits the time /
 *    tech the plan picked (promised times and named crews are kept).
 *
 * Owners/managers only (AppShell route "dispatch"). Reached from Schedule →
 * Dispatch and the More hub.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { db } from "@/lib/supabase";
import { t, getLang } from "@/lib/i18n";
import { Icon } from "../Icon";
import TopBar from "@/components/TopBar";
import RouteMap, { type MapCrew, type MapRoute } from "@/components/RouteMap";
import { geocodeAddress, hasGeocodeCache, cityContext } from "@/lib/geo";
import { localYmd, addDaysYmd, fmtClock } from "@/lib/day-plan";
import { formatClock } from "@/lib/mileage-days";
import { peekNavIntent, clearNavIntent } from "@/lib/nav-intent";
import { planWeek, hhmmToMin, roundQuarter, type LatLng, type WeekPlan, type PlannedRoute, type PlannedStop } from "@/lib/route-plan";
import {
  collectWeek, toPlanInput, planWrites, crewNow, etaBetween, closestCrew, poolKey,
  type BookedVisit, type Crew, type PoolJob,
} from "@/lib/dispatch-week";

interface Props {
  setPage: (p: string) => void;
}

/** Same per-tech palette (and order: the profiles list) as Crew Map. */
const TECH_COLORS = ["#2E75B6", "#00cc66", "#f5b400", "#9d4edd", "#ff5fa8", "#00bcd4", "#ff8800"];
const HUE = "#ff8a3d"; // Schedule's orange
const OPTS_KEY = "c_disp_opts";

const initials = (name: string) =>
  (name || "?").trim().split(/\s+/).map((w) => w[0] || "").join("").slice(0, 2).toUpperCase() || "?";
const firstName = (name: string) => (name || "").trim().split(/\s+/)[0] || name;
const fmtDur = (min: number) =>
  min < 60 ? `${Math.round(min)}m` : `${(Math.round(min / 6) / 10).toFixed(1).replace(/\.0$/, "")}h`;
const locale = () => (getLang() === "es" ? "es" : "en-US");
/** A stop's start as the calendar will get it: a promised time as-is, else
 *  the quarter hour planWrites rounds to. */
const stopClock = (s: PlannedStop) => formatClock(s.fixedMin != null ? s.startMin : roundQuarter(s.startMin));
const dayChip = (ymd: string) => {
  const d = new Date(ymd + "T12:00:00");
  return { dow: d.toLocaleDateString(locale(), { weekday: "short" }), num: d.getDate() };
};
/** "Oct 20 – 25" / "Oct 27 – Nov 1". */
function weekLabel(from: string, to: string): string {
  const a = new Date(from + "T12:00:00"), b = new Date(to + "T12:00:00");
  const md = (d: Date) => d.toLocaleDateString(locale(), { month: "short", day: "numeric" });
  return `${md(a)} – ${a.getMonth() === b.getMonth() ? b.getDate() : md(b)}`;
}
const dayLong = (ymd: string) =>
  new Date(ymd + "T12:00:00").toLocaleDateString(locale(), { weekday: "short", month: "short", day: "numeric" });

/** Monday of the week holding `ymd`. */
function mondayOf(ymd: string): string {
  const dow = new Date(ymd + "T12:00:00").getDay();
  return addDaysYmd(ymd, dow === 0 ? -6 : 1 - dow);
}
/** First day you can still book: today until 2 PM (Schedule's rule), then tomorrow. */
const firstBookable = () => (new Date().getHours() >= 14 ? addDaysYmd(localYmd(), 1) : localYmd());
/** The week to open on — next week once only the weekend is left. */
function defaultWeek(): string {
  const f = firstBookable();
  const dow = new Date(f + "T12:00:00").getDay();
  return dow === 0 || dow === 6 ? addDaysYmd(mondayOf(f), 7) : mondayOf(f);
}
/** Mon–Fri of that week that haven't passed. */
const defaultDays = (weekStart: string) =>
  [0, 1, 2, 3, 4].map((i) => addDaysYmd(weekStart, i)).filter((d) => d >= firstBookable());

function loadOpts(): { crewOff?: string[]; start?: string; end?: string } {
  try { return JSON.parse(localStorage.getItem(OPTS_KEY) || "{}") || {}; } catch { return {}; }
}

interface Result {
  plan: WeekPlan;
  noLocation: string[];
  booked: BookedVisit[];
  pool: PoolJob[];
  crew: Crew[];
  replan: boolean;
  base: LatLng | null;
  poolCount: number;
}

export default function DispatchAssistant({ setPage }: Props) {
  const profiles = useStore((s) => s.profiles);
  const jobs = useStore((s) => s.jobs);
  const schedule = useStore((s) => s.schedule);
  const timeEntries = useStore((s) => s.timeEntries);
  const timeOff = useStore((s) => s.timeOffRequests);
  const org = useStore((s) => s.org);
  const loadAll = useStore((s) => s.loadAll);
  const darkMode = useStore((s) => s.darkMode);

  const today = localYmd();
  const [weekStart, setWeekStart] = useState(() => {
    const i = peekNavIntent("dispatch");
    const w = i?.page === "dispatch" ? i.week : undefined;
    if (!w || !/^\d{4}-\d{2}-\d{2}$/.test(w)) return defaultWeek();
    // A week that's already over (Schedule paged back) opens on the next one.
    return addDaysYmd(mondayOf(w), 5) < firstBookable() ? defaultWeek() : mondayOf(w);
  });
  useEffect(() => { if (peekNavIntent("dispatch")) clearNavIntent(); }, []);
  const weekDays = useMemo(() => [0, 1, 2, 3, 4, 5].map((i) => addDaysYmd(weekStart, i)), [weekStart]);
  const [dayOn, setDayOn] = useState<string[]>(() => defaultDays(weekStart));
  const firstWeek = useRef(true);
  useEffect(() => {
    if (firstWeek.current) { firstWeek.current = false; return; }
    setDayOn(defaultDays(weekStart));
  }, [weekStart]);

  const saved = useMemo(loadOpts, []);
  // Who's NOT working (so a new teammate is in by default).
  const [crewOff, setCrewOff] = useState<string[]>(saved.crewOff || []);
  const [startHHMM, setStartHHMM] = useState(saved.start || "08:00");
  const [endHHMM, setEndHHMM] = useState(saved.end || "17:00");
  useEffect(() => {
    try { localStorage.setItem(OPTS_KEY, JSON.stringify({ crewOff, start: startHHMM, end: endHHMM })); } catch { /* */ }
  }, [crewOff, startHHMM, endHHMM]);
  const [includeQuoted, setIncludeQuoted] = useState(false);
  const [replan, setReplan] = useState(false);
  const [leaveOut, setLeaveOut] = useState<string[]>([]);
  const [showPool, setShowPool] = useState(false);

  const [coords, setCoords] = useState<Map<string, LatLng | null>>(() => new Map());
  const coordsRef = useRef(coords);
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const [busy, setBusy] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [selDay, setSelDay] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);

  const crewSel: Crew[] = useMemo(
    () => profiles.filter((p) => !crewOff.includes(p.id)).map((p) => ({ id: p.id, name: p.name })),
    [profiles, crewOff],
  );
  const colorOf = (id: string) => {
    const i = profiles.findIndex((p) => p.id === id);
    return TECH_COLORS[(i < 0 ? 0 : i) % TECH_COLORS.length];
  };
  const nameOf = (id: string) => profiles.find((p) => p.id === id)?.name || "";
  const startMin = hhmmToMin(startHHMM) ?? 480;
  const endMin = hhmmToMin(endHHMM) ?? 1020;
  const dayMin = Math.max(60, endMin - startMin);
  const days = weekDays.filter((d) => dayOn.includes(d));

  const week = useMemo(
    () => collectWeek({ jobs, schedule, timeEntries, crew: crewSel, days, includeQuoted, dayMin }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [jobs, schedule, timeEntries, crewSel, days.join(), includeQuoted, dayMin],
  );
  const quotedWaiting = useMemo(
    () => collectWeek({ jobs, schedule, timeEntries: [], crew: [], days: [], includeQuoted: true, dayMin }).pool
      .filter((p) => p.job.status === "quoted").length,
    [jobs, schedule, dayMin],
  );

  // Any option change makes a shown plan stale. Store data is deliberately
  // NOT a dependency — the 15s refresh would wipe the plan you're reading.
  useEffect(() => { setResult(null); }, [weekStart, dayOn, crewOff, startHHMM, endHHMM, includeQuoted, replan]);

  /** Geocode addresses one at a time (Nominatim: ~1 req/s for uncached),
   *  serialized so the crew card and a plan never race each other. */
  const locate = (addrs: string[], onStep?: (i: number, n: number) => void): Promise<Map<string, LatLng | null>> => {
    const run = async () => {
      const out = new Map(coordsRef.current);
      const todo = [...new Set(addrs.map((a) => a.trim()).filter(Boolean))].filter((a) => !out.has(a));
      const ctx = cityContext(org?.address);
      for (let i = 0; i < todo.length; i++) {
        onStep?.(i + 1, todo.length);
        const had = hasGeocodeCache(todo[i]);
        out.set(todo[i], await geocodeAddress(todo[i], ctx));
        if (!had && i < todo.length - 1) await new Promise((r) => setTimeout(r, 1100));
      }
      coordsRef.current = out;
      setCoords(out);
      return out;
    };
    const p = chain.current.then(run, run);
    chain.current = p;
    return p;
  };
  const pt = (addr?: string | null) => (addr ? coords.get(addr.trim()) ?? null : null);

  // ── Crew right now ──
  const live = useMemo(() => crewNow({ crew: profiles, timeEntries, schedule, jobs }), [profiles, timeEntries, schedule, jobs]);
  const liveAddrs = live.flatMap((c) => [c.next?.address, c.fix ? undefined : c.onJob?.address]).filter((a): a is string => !!a);
  useEffect(() => {
    if (liveAddrs.length) void locate(liveAddrs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveAddrs.join("|")]);
  const locOf = (c: (typeof live)[number]): LatLng | null => (c.fix ? { lat: c.fix.lat, lng: c.fix.lng } : pt(c.onJob?.address));
  const crewLocs = live
    .map((c) => ({ id: c.id, name: c.name, pt: locOf(c), busy: !!c.onJob }))
    .filter((c): c is { id: string; name: string; pt: LatLng; busy: boolean } => !!c.pt);
  const showLive = live.some((c) => c.fix || c.onJob || c.next);

  // ── Plan ──
  const runPlan = async (lo: string[] = leaveOut) => {
    if (!crewSel.length || !days.length || busy) return;
    setResult(null);
    const { pool, booked } = week;
    const baseAddr = (org?.address || "").trim();
    const addrs = [
      ...(baseAddr ? [baseAddr] : []),
      ...booked.filter((b) => !b.external).map((b) => b.entry.job),
      ...pool.filter((p) => !lo.includes(p.job.id)).map((p) => p.job.property),
    ];
    try {
      setBusy(t("disp.locating") + "…");
      const found = await locate(addrs, (i, n) => setBusy(`${t("disp.locating")} ${i}/${n}…`));
      setBusy(t("disp.planning"));
      await new Promise((r) => setTimeout(r, 30)); // let the busy line paint
      const base = baseAddr ? found.get(baseAddr) ?? null : null;
      const now = new Date();
      const nowMin = now.getHours() * 60 + now.getMinutes();
      const startMinByDay = days.includes(today) ? { [today]: Math.ceil((nowMin + 15) / 15) * 15 } : undefined;
      const { input, noLocation } = toPlanInput({
        pool, booked, coords: (a) => found.get(a.trim()), days, crew: crewSel, replanBooked: replan,
        leaveOut: lo, base, timeOff, startMinByDay, opts: { dayStartMin: startMin, dayEndMin: endMin },
      });
      const plan = planWeek(input);
      setResult({ plan, noLocation, booked, pool, crew: crewSel, replan, base, poolCount: pool.filter((p) => !lo.includes(p.job.id)).length });
      setSelDay(plan.routes[0]?.day ?? days[0]);
    } finally {
      setBusy("");
    }
  };

  const leaveOutJob = (jobId: string) => {
    const lo = [...leaveOut, jobId];
    setLeaveOut(lo);
    if (result) void runPlan(lo);
  };

  const apply = async () => {
    if (!result || applying) return;
    const { posts, patches } = planWrites(result.plan, { booked: result.booked, crew: result.crew, replanBooked: result.replan });
    if (!posts.length && !patches.length) {
      useStore.getState().showToast(t("disp.nothingChanged"), "info");
      return;
    }
    const moved = patches.filter((p) => p.moved).length;
    const touched = patches.filter((p) => !p.moved).length;
    const lines = [
      posts.length ? `${t("disp.bookNew")} ${posts.length} ${t("disp.newJobs")}` : "",
      moved ? `${t("disp.move")} ${moved} ${t("disp.bookedVisits")}` : "",
      touched ? `${t("disp.setTimes")} ${touched} ${t("disp.bookedVisits")}` : "",
    ].filter(Boolean);
    const ok = await useStore.getState().showConfirm(t("disp.applyTitle"), lines.join(" · "), { confirmLabel: t("disp.apply") });
    if (!ok) return;
    setApplying(true);
    let done = 0, failed = 0;
    try {
      for (const p of posts) {
        const row: Record<string, unknown> = { sched_date: p.sched_date, job: p.job, job_id: p.jobId, note: p.note };
        // Only send end_date for a real range (works before that column's migration).
        if (p.end_date) row.end_date = p.end_date;
        if (await db.post("schedule", row) === null) { failed++; continue; }
        done++;
        const j = jobs.find((x) => x.id === p.jobId);
        if (j && (j.status === "accepted" || j.status === "quoted")) await db.patch("jobs", j.id, { status: "scheduled" });
      }
      for (const p of patches) {
        if (await db.patch("schedule", p.entryId, p.patch)) done++;
        else failed++;
      }
      await loadAll();
      setResult(null);
      setLeaveOut([]);
      useStore.getState().showToast(
        failed ? `${done} ${t("disp.saved")} · ${failed} ${t("disp.failed")}` : t("disp.applied"),
        failed ? "warning" : "success",
      );
    } finally {
      setApplying(false);
    }
  };

  // ── Render helpers ──
  const card = darkMode ? "#16161f" : "#fff";
  const pill = (on: boolean, color = HUE): React.CSSProperties => ({
    minHeight: 34, padding: "5px 12px", borderRadius: 99, fontSize: 13.5, fontWeight: 600, cursor: "pointer",
    display: "inline-flex", alignItems: "center", gap: 6,
    background: on ? `color-mix(in srgb, ${color} 18%, transparent)` : "transparent",
    color: on ? color : "var(--color-dim)",
    border: `1px solid ${on ? color : "var(--color-border-dark)"}`,
  });
  const avatar = (id: string, name: string, size = 30) => (
    <span style={{ width: size, height: size, borderRadius: "50%", background: colorOf(id), color: "#fff", flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", fontFamily: "Oswald", fontWeight: 600, fontSize: size * 0.42 }}>
      {initials(name)}
    </span>
  );
  const jobFor = (id?: string) => (id ? jobs.find((j) => j.id === id) : undefined);
  const why = (r: string) => t("disp.why_" + r);
  const keyLabel = (key: string) => {
    if (!result) return key;
    if (key.startsWith("job:")) return result.pool.find((p) => poolKey(p.job.id) === key)?.job.property || key;
    return result.booked.find((b) => b.key === key)?.entry.job || key;
  };

  const mapsUrl = (r: PlannedRoute) => {
    const base = (org?.address || "").trim();
    const stops = r.stops.map((s) => s.address);
    const origin = base || stops[0];
    const destination = base || stops[stops.length - 1];
    const way = base ? stops : stops.slice(1, -1);
    return `https://www.google.com/maps/dir/?api=1&travelmode=driving&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}${way.length ? `&waypoints=${way.map(encodeURIComponent).join("%7C")}` : ""}`;
  };
  const smsUrl = (r: PlannedRoute) => {
    const phone = (profiles.find((p) => p.id === r.techId)?.phone || "").replace(/[^\d+]/g, "");
    if (!phone) return null;
    const body = [
      `${t("disp.routeText")} ${dayLong(r.day)}:`,
      ...r.stops.map((s, i) => `${i + 1}. ${stopClock(s)} ${s.address} (${fmtDur(s.durMin)})`),
      mapsUrl(r),
    ].join("\n");
    return `sms:${phone}?&body=${encodeURIComponent(body)}`;
  };

  const plan = result?.plan;
  const dayRoutes = plan && selDay ? plan.routes.filter((r) => r.day === selDay) : [];
  const mapRoutes: MapRoute[] = dayRoutes.map((r) => ({
    color: colorOf(r.techId),
    stops: r.stops.map((s, i) => ({
      lat: s.pt.lat, lng: s.pt.lng, n: i + 1, isNew: s.isNew,
      title: s.address,
      sub: `${firstName(nameOf(r.techId))} · ${stopClock(s)} · ${fmtDur(s.durMin)}${s.isNew ? ` · ${t("disp.new")}` : ""}`,
    })),
  }));
  const mapCrew: MapCrew[] = selDay === today
    ? crewLocs.filter((c) => dayRoutes.some((r) => r.techId === c.id)).map((c) => ({ ...c.pt, initials: initials(c.name), color: colorOf(c.id), title: c.name }))
    : [];

  const poolShown = week.pool;
  const poolIncluded = poolShown.filter((p) => !leaveOut.includes(p.job.id));
  const poolHrs = poolIncluded.reduce((h, p) => h + p.totalMin, 0) / 60;
  const bookedOurs = week.booked.filter((b) => !b.external);
  const bookedExternal = new Set(week.booked.filter((b) => b.external).map((b) => b.entry.id)).size;
  // The previous week's Saturday has passed → nothing left to plan there.
  const prevWeekGone = addDaysYmd(weekStart, -2) < firstBookable();
  const canPlan = crewSel.length > 0 && days.length > 0 && (poolIncluded.length > 0 || bookedOurs.length > 0);

  return (
    <div className="fi">
      <TopBar title={t("disp.title")} icon="navigation" color={HUE} onBack={() => window.history.back()} />

      {/* ── Crew right now ── */}
      {showLive && (
        <div className="section">
          <div className="seclabel" style={{ justifyContent: "space-between" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}><Icon name="gps" size={13} /> {t("disp.crewNow")}</span>
            <button type="button" onClick={() => setPage("map")} style={{ background: "none", border: "none", color: "var(--color-primary)", fontSize: 12.5, fontWeight: 600, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4, letterSpacing: 0, textTransform: "none", fontFamily: "inherit" }}>
              <Icon name="map" size={12} color="var(--color-primary)" /> {t("disp.crewMap")}
            </button>
          </div>
          {live.filter((c) => c.fix || c.onJob || c.next).map((c) => {
            const here = locOf(c);
            const nextPt = pt(c.next?.address);
            const eta = here && nextPt ? etaBetween(here, nextPt) : null;
            const status = c.onJob
              ? `${t("disp.onClockAt")} ${c.onJob.address}${c.onJob.since ? ` · ${t("disp.since")} ${c.onJob.since}` : ""}`
              : c.fix
                ? `${t("disp.lastSeen")} ${c.fix.time} (${c.fix.kind === "out" ? t("disp.clockedOut") : t("disp.clockedIn")})`
                : t("disp.noLocation");
            return (
              <div key={c.id} className="drow" style={{ alignItems: "flex-start", justifyContent: "flex-start", gap: 10 }}>
                {avatar(c.id, c.name, 30)}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 600, fontSize: 14 }}>
                    {c.name}
                    {c.onJob && <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--color-success)", boxShadow: "0 0 6px var(--color-success)" }} />}
                  </div>
                  <div className="dim" style={{ fontSize: 12.5, lineHeight: 1.4, overflow: "hidden", textOverflow: "ellipsis" }}>{status}</div>
                  {c.next && (
                    <div style={{ fontSize: 13, marginTop: 3, color: eta ? "#8cc0ff" : "var(--color-dim)", lineHeight: 1.35, display: "flex", alignItems: "baseline", gap: 5 }}>
                      <span style={{ flexShrink: 0, alignSelf: "center", display: "inline-flex" }}><Icon name="navigation" size={11} color={eta ? "#8cc0ff" : "var(--color-dim)"} /></span>
                      <span>
                        {eta
                          ? <><b style={{ fontWeight: 600 }}>{firstName(c.name)} {t("disp.is")} ~{eta.min} {t("disp.minFrom")}</b> {c.next.address}</>
                          : <>{t("disp.nextStop")}: {c.next.address}</>}
                        {c.next.time ? <span className="dim"> · {fmtClock(c.next.time)}</span> : null}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          <div className="dim" style={{ fontSize: 11.5, padding: "6px 0 2px", lineHeight: 1.4 }}>{t("disp.gpsNote")}</div>
        </div>
      )}

      {/* ── Plan the week: options ── */}
      <div className="section">
        <div className="seclabel" style={{ justifyContent: "space-between" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}><Icon name="schedule" size={13} /> {t("disp.planWeek")}</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, letterSpacing: 0, textTransform: "none", fontFamily: "Oswald", fontSize: 14, color: "var(--color-text, inherit)" }}>
            <button type="button" className="iconbtn" aria-label={t("sched.previous")} onClick={() => setWeekStart((w) => addDaysYmd(w, -7))} disabled={prevWeekGone} style={{ width: 30, height: 30, opacity: prevWeekGone ? 0.35 : 1 }}><Icon name="back" size={14} /></button>
            <span style={{ minWidth: 96, textAlign: "center" }}>{weekLabel(weekDays[0], weekDays[5])}</span>
            <button type="button" className="iconbtn" aria-label={t("sched.next")} onClick={() => setWeekStart((w) => addDaysYmd(w, 7))} style={{ width: 30, height: 30 }}><Icon name="next" size={14} /></button>
          </span>
        </div>

        <div className="dim" style={{ fontSize: 12.5, margin: "8px 0 6px" }}>{t("disp.days")}</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {weekDays.map((d) => {
            const past = d < firstBookable();
            const on = dayOn.includes(d);
            const c = dayChip(d);
            return (
              <button key={d} type="button" disabled={past} onClick={() => setDayOn((p) => on ? p.filter((x) => x !== d) : [...p, d])} style={{ ...pill(on), opacity: past ? 0.35 : 1, padding: "5px 10px" }}>
                {c.dow} {c.num}
              </button>
            );
          })}
        </div>

        <div className="dim" style={{ fontSize: 12.5, margin: "12px 0 6px" }}>{t("disp.whosWorking")}</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {profiles.map((p) => {
            const on = !crewOff.includes(p.id);
            const offDays = days.filter((d) => timeOff.some((r) => r.status === "approved" && r.user_id === p.id && r.start_date <= d && d <= r.end_date));
            return (
              <button key={p.id} type="button" onClick={() => setCrewOff((x) => on ? [...x, p.id] : x.filter((y) => y !== p.id))} style={pill(on, colorOf(p.id))}>
                {on && <Icon name="check" size={13} />}{p.name}
                {on && offDays.length > 0 && <span style={{ fontSize: 11, fontWeight: 500, opacity: 0.85 }}>· {t("disp.off")} {offDays.map((d) => dayChip(d).dow).join(", ")}</span>}
              </button>
            );
          })}
        </div>

        <div className="dim" style={{ fontSize: 12.5, margin: "12px 0 6px" }}>{t("disp.hours")}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input type="time" value={startHHMM} onChange={(e) => e.target.value && setStartHHMM(e.target.value)} style={{ flex: 1, fontWeight: 600 }} />
          <span className="dim">–</span>
          <input type="time" value={endHHMM} onChange={(e) => e.target.value && setEndHHMM(e.target.value)} style={{ flex: 1, fontWeight: 600 }} />
        </div>

        <label style={{ display: "flex", alignItems: "flex-start", gap: 10, marginTop: 12, fontSize: 14, cursor: "pointer" }}>
          <input type="checkbox" checked={includeQuoted} onChange={(e) => setIncludeQuoted(e.target.checked)} style={{ width: 19, height: 19, minHeight: 0, padding: 0, marginTop: 1, flexShrink: 0, accentColor: HUE }} />
          <span>{t("disp.includeQuoted")} <span className="dim">({quotedWaiting})</span></span>
        </label>
        <label style={{ display: "flex", alignItems: "flex-start", gap: 10, marginTop: 10, fontSize: 14, cursor: "pointer" }}>
          <input type="checkbox" checked={replan} onChange={(e) => setReplan(e.target.checked)} style={{ width: 19, height: 19, minHeight: 0, padding: 0, marginTop: 1, flexShrink: 0, accentColor: HUE }} />
          <span>{t("disp.replanBooked")}<br /><span className="dim" style={{ fontSize: 12.5 }}>{t("disp.replanBookedSub")}</span></span>
        </label>

        {/* What goes in */}
        <div className="linkrow" onClick={() => setShowPool((v) => !v)} style={{ marginTop: 10, borderTop: "1px solid var(--color-border-dark)" }}>
          <span className="lf"><span className="ic"><Icon name="folder" size={15} /></span>
            <span><b style={{ fontWeight: 600 }}>{t("disp.toBook")}: {poolIncluded.length} {poolIncluded.length === 1 ? t("disp.job") : t("disp.jobs")}</b>{poolIncluded.length ? <span className="dim"> · {fmtDur(poolHrs * 60)}</span> : null}</span>
          </span>
          <Icon name={showPool ? "collapse" : "expand"} size={15} color="var(--color-dim)" />
        </div>
        {showPool && poolShown.map((p) => {
          const inc = !leaveOut.includes(p.job.id);
          const jp = pt(p.job.property);
          const near = jp && crewLocs.length ? closestCrew(jp, crewLocs, 1)[0] : null;
          return (
            <label key={p.job.id} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "7px 0", borderBottom: "1px solid var(--color-border-dark)", cursor: "pointer", opacity: inc ? 1 : 0.55 }}>
              <input type="checkbox" checked={inc} onChange={() => { setLeaveOut((x) => inc ? [...x, p.job.id] : x.filter((y) => y !== p.job.id)); setResult(null); }} style={{ width: 18, height: 18, minHeight: 0, padding: 0, marginTop: 2, flexShrink: 0, accentColor: HUE }} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontWeight: 600, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.job.property}</span>
                <span className="dim" style={{ fontSize: 12.5 }}>
                  {fmtDur(p.totalMin)}{p.estimated ? ` (${t("disp.estHours")})` : ""} · {p.job.status === "accepted" ? t("disp.approved") : t("disp.quoted")}
                  {p.techId ? ` · ${t("disp.requested")}: ${firstName(nameOf(p.techId))}` : ""}
                </span>
                {near && <span style={{ display: "block", fontSize: 12, color: "#8cc0ff" }}>{t("disp.closestNow")} {firstName(near.name)} ~{near.min} min{near.busy ? ` (${t("disp.onAJob")})` : ""}</span>}
              </span>
            </label>
          );
        })}
        <div className="drow">
          <span className="l">{t("disp.alreadyBooked")}</span>
          <span className="v">{new Set(bookedOurs.map((b) => b.entry.id)).size} {t("disp.visits")}</span>
        </div>
        {bookedExternal > 0 && <div className="dim" style={{ fontSize: 12, paddingBottom: 4 }}>+{bookedExternal} {t("disp.leftAsIs")}</div>}

        {!org?.address?.trim() && (
          <div style={{ display: "flex", gap: 7, fontSize: 12.5, color: "var(--color-warning, #f5b400)", margin: "8px 0 2px", lineHeight: 1.4 }}>
            <Icon name="warn" size={14} color="var(--color-warning, #f5b400)" /> {t("disp.noBase")}
          </div>
        )}

        <button type="button" className="bb" disabled={!canPlan || !!busy} onClick={() => runPlan()} style={{ width: "100%", marginTop: 12, padding: 12, fontSize: 15, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, opacity: !canPlan || busy ? 0.6 : 1 }}>
          <Icon name={busy ? "refresh" : "sparkle"} size={15} color="#fff" />
          {busy || (result ? t("disp.planAgain") : t("disp.planWeek"))}
        </button>
        {!crewSel.length || !days.length
          ? <div className="dim" style={{ fontSize: 12.5, textAlign: "center", marginTop: 6 }}>{t("disp.pickCrew")}</div>
          : !canPlan && <div className="dim" style={{ fontSize: 12.5, textAlign: "center", marginTop: 6 }}>{t("disp.nothingToPlan")}</div>}
      </div>

      {/* ── The plan ── */}
      {result && plan && (<>
        <div className="section" style={{ borderColor: `color-mix(in srgb, ${HUE} 45%, transparent)` }}>
          <div style={{ padding: "10px 0 4px" }}>
            <div style={{ fontFamily: "Oswald", fontWeight: 600, fontSize: 20, letterSpacing: ".3px" }}>
              {result.poolCount
                ? `${plan.placedNew} ${t("disp.of")} ${result.poolCount} ${t("disp.jobsPlaced")}`
                : t("disp.routesReady")}
            </div>
            <div className="dim" style={{ fontSize: 13.5, marginTop: 2 }}>
              ~{plan.miles} mi · ~{fmtDur(plan.driveMin)} {t("disp.driving")} · {plan.routes.length} {t("disp.techDays")}
            </div>
            {plan.savedMiles >= 1 && (
              <div style={{ fontSize: 13.5, marginTop: 4, color: "var(--color-success)", display: "flex", alignItems: "center", gap: 5 }}>
                <Icon name="check" size={12} color="var(--color-success)" /> {t("disp.saves")} ~{plan.savedMiles} mi
              </div>
            )}
          </div>
          {[...plan.unplaced.map((u) => ({ key: u.key, reason: u.reason as string })), ...result.noLocation.map((key) => ({ key, reason: "no-location" }))].map((u) => (
            <div key={u.key} style={{ display: "flex", gap: 7, fontSize: 12.5, color: "var(--color-warning, #f5b400)", padding: "3px 0", lineHeight: 1.4 }}>
              <Icon name="warn" size={13} color="var(--color-warning, #f5b400)" />
              <span><b style={{ fontWeight: 600 }}>{keyLabel(u.key)}</b> — {why(u.reason)}</span>
            </div>
          ))}
          {plan.routes.filter((r) => r.overMin > 0 || r.lateMin > 0).map((r) => (
            <div key={`${r.day}|${r.techId}`} style={{ display: "flex", gap: 7, fontSize: 12.5, color: "var(--color-accent-red, #ff5b5b)", padding: "3px 0", lineHeight: 1.4 }}>
              <Icon name="alert" size={13} color="var(--color-accent-red, #ff5b5b)" />
              <span>
                <b style={{ fontWeight: 600 }}>{firstName(nameOf(r.techId))} · {dayLong(r.day)}</b> —{" "}
                {r.overMin > 0 ? `${t("disp.runs")} ${fmtDur(r.overMin)} ${t("disp.past")} ${formatClock(endMin)}` : ""}
                {r.overMin > 0 && r.lateMin > 0 ? " · " : ""}
                {r.lateMin > 0 ? `${t("disp.lateBy")} ${r.lateMin} min` : ""}
              </span>
            </div>
          ))}
        </div>

        {/* Day tabs */}
        <div style={{ display: "flex", gap: 6, overflowX: "auto", marginBottom: 10, paddingBottom: 2 }}>
          {days.map((d) => {
            const n = plan.routes.filter((r) => r.day === d).reduce((s, r) => s + r.stops.length, 0);
            const on = selDay === d;
            const c = dayChip(d);
            return (
              <button key={d} type="button" onClick={() => setSelDay(d)} style={{ ...pill(on), flexShrink: 0, opacity: n ? 1 : 0.55 }}>
                {c.dow} {c.num} <span style={{ fontSize: 11.5, opacity: 0.8 }}>· {n}</span>
              </button>
            );
          })}
        </div>

        {dayRoutes.length > 0 ? (<>
          <RouteMap base={result.base} routes={mapRoutes} crew={mapCrew} height={280} />
          <div style={{ height: 10 }} />
          {dayRoutes.map((r) => {
            const sms = smsUrl(r);
            return (
              <div key={r.techId} style={{ background: card, border: "1px solid var(--color-border-dark)", borderRadius: 14, padding: "10px 12px", marginBottom: 9, position: "relative", overflow: "hidden" }}>
                <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 4, background: colorOf(r.techId) }} />
                <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 6 }}>
                  {avatar(r.techId, nameOf(r.techId), 32)}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: "Oswald", fontWeight: 600, fontSize: 15.5 }}>{nameOf(r.techId)}</div>
                    <div className="dim" style={{ fontSize: 12 }}>
                      {r.stops.length} {r.stops.length === 1 ? t("disp.stop") : t("disp.stops")} · ~{r.miles} mi · {t("disp.back")} ~{formatClock(r.backMin)}
                    </div>
                  </div>
                  <a className="bo" href={mapsUrl(r)} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12.5, padding: "5px 9px", display: "inline-flex", alignItems: "center", gap: 4, textDecoration: "none" }}>
                    <Icon name="external" size={12} /> {t("disp.openMaps")}
                  </a>
                  {sms && (
                    <a className="bo" href={sms} style={{ fontSize: 12.5, padding: "5px 9px", display: "inline-flex", alignItems: "center", gap: 4, textDecoration: "none" }}>
                      <Icon name="send" size={12} /> {t("disp.textRoute")}
                    </a>
                  )}
                </div>
                <div className="dim" style={{ fontSize: 12, padding: "2px 0 4px 2px", display: "flex", alignItems: "center", gap: 5 }}>
                  <Icon name="home" size={11} /> {formatClock(r.leaveMin)} {t("disp.leave")}
                </div>
                {r.stops.map((s, i) => {
                  const j = jobFor(s.jobId);
                  const promised = s.fixedMin != null ? `${t("disp.promised")} ${formatClock(s.fixedMin)}` : "";
                  return (
                    <div key={s.key + i} style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "6px 0", borderTop: "1px solid var(--color-border-dark)" }}>
                      <span style={{ width: 22, height: 22, borderRadius: "50%", flexShrink: 0, marginTop: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 11.5, fontWeight: 700, fontFamily: "Oswald", background: s.isNew ? "transparent" : colorOf(r.techId), color: s.isNew ? colorOf(r.techId) : "#fff", border: `2px solid ${colorOf(r.techId)}` }}>{i + 1}</span>
                      <span style={{ width: 62, flexShrink: 0, fontFamily: "Oswald", fontWeight: 600, fontSize: 13.5, paddingTop: 2 }}>{stopClock(s)}</span>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: "block", fontWeight: 600, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.address}</span>
                        <span className="dim" style={{ fontSize: 12, display: "flex", flexWrap: "wrap", gap: "2px 6px", alignItems: "center" }}>
                          <span>{fmtDur(s.durMin)}</span>
                          {s.driveMin > 0 && <span>· {s.driveMin} min {t("disp.drive")}</span>}
                          {j?.trade && <span>· {j.trade}</span>}
                          {s.part && <span>· {t("disp.dayPart")} {s.part.n} {t("disp.of")} {s.part.of}</span>}
                          {promised && <span>· {promised}</span>}
                          {s.isNew && <span className="chip" style={{ background: "color-mix(in srgb, #ffcc00 20%, transparent)", color: "#ffcc00", padding: "1px 7px", fontSize: 11 }}>{t("disp.new")}</span>}
                          {s.lateMin > 0 && <span style={{ color: "var(--color-accent-red, #ff5b5b)" }}>· {t("disp.lateBy")} {s.lateMin} min</span>}
                        </span>
                      </span>
                      {s.isNew && s.jobId && (
                        <button type="button" className="iconbtn" title={t("disp.leaveOut")} aria-label={t("disp.leaveOut")} onClick={() => leaveOutJob(s.jobId!)} style={{ width: 30, height: 30, flexShrink: 0 }}>
                          <Icon name="close" size={13} />
                        </button>
                      )}
                    </div>
                  );
                })}
                <div className="dim" style={{ fontSize: 12, padding: "5px 0 0 2px", borderTop: "1px solid var(--color-border-dark)", display: "flex", alignItems: "center", gap: 5 }}>
                  <Icon name="home" size={11} /> ~{formatClock(r.backMin)} {t("disp.backAtShop")}
                </div>
              </div>
            );
          })}
        </>) : (
          <div className="cd" style={{ textAlign: "center", padding: 18, marginBottom: 10 }}><p className="dim" style={{ fontSize: 13.5 }}>{t("disp.noStopsDay")}</p></div>
        )}

        <button type="button" className="bg" disabled={applying} onClick={apply} style={{ width: "100%", padding: 13, fontSize: 15.5, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, marginTop: 4 }}>
          <Icon name="checkCircle" size={16} color="#fff" /> {applying ? t("disp.applying") : t("disp.apply")}
        </button>
        <div className="dim" style={{ fontSize: 12, textAlign: "center", margin: "6px 0 4px" }}>{t("disp.applyNote")}</div>
        <div className="dim" style={{ fontSize: 11.5, textAlign: "center", marginBottom: 12, lineHeight: 1.4 }}>{t("disp.distanceNote")}</div>
      </>)}
    </div>
  );
}
