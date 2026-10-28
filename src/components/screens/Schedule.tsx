"use client";
import { noticesFor, sendScheduleNotices } from "@/lib/schedule-notify-client";
import { useState, useEffect } from "react";
import { useStore } from "@/lib/store";
import { db } from "@/lib/supabase";
import { peekNavIntent, clearNavIntent, goWithIntent } from "@/lib/nav-intent";
import { parseSchedTime, parseSchedCrew, entryJob, isJobScheduled } from "@/lib/day-plan";
import { stripNoteParts } from "@/lib/dispatch-week";
import type { ScheduleEntry } from "@/lib/types";
import { t } from "@/lib/i18n";
import { Icon } from "../Icon";
import TopBar from "@/components/TopBar";
import { wrapPrint, openPrint } from "@/lib/print-template";
import PropertySearch from "../PropertySearch";
import SmsNotifyButtons from "../SmsNotifyButtons";
import { statusColor } from "@/lib/status";
import { haversineMiles, ROAD_FACTOR, geocodeAddress, hasGeocodeCache, cityContext } from "@/lib/geo";
import DispatchAssistant from "./DispatchAssistant";

/* ── Day-route optimizer ────────────────────────────────────────────
   Orders the day's stops to minimize drive miles (nearest-neighbor +
   2-opt over geocoded addresses, straight-line × road factor). Display
   only — it suggests the order; it never rewrites schedule times.
   Renders nothing under 3 stops (nothing to optimize). */
type RoutePt = { addr: string; lat: number; lng: number };

function RouteOptimizer({ addresses }: { addresses: string[] }) {
  const org = useStore((s) => s.org);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [result, setResult] = useState<{ order: string[]; miles: number; currentMiles: number } | null>(null);

  if (addresses.length < 3) return null;

  const optimize = async () => {
    setBusy(true);
    setNote("");
    setResult(null);
    try {
      const base = (org?.address || "").trim();
      const uniq: string[] = [];
      for (const a of addresses) {
        if (a && !uniq.some((u) => u.toLowerCase() === a.toLowerCase())) uniq.push(a);
      }
      const pts: RoutePt[] = [];
      for (const a of (base ? [base, ...uniq] : uniq)) {
        const had = hasGeocodeCache(a);
        const c = await geocodeAddress(a, cityContext(org?.address));
        if (c) pts.push({ addr: a, lat: c.lat, lng: c.lng });
        // Nominatim policy: ~1 req/s for real (uncached) lookups only.
        if (!had) await new Promise((r) => setTimeout(r, 1100));
      }
      const start = base && pts[0]?.addr === base ? pts[0] : null;
      const stops = start ? pts.slice(1) : pts;
      if (stops.length < 3) {
        setNote(t("loc.cantLocate"));
        return;
      }
      const dist = (a: RoutePt, b: RoutePt) => haversineMiles(a.lat, a.lng, b.lat, b.lng);
      const pathMiles = (order: RoutePt[]) => {
        const path = start ? [start, ...order, start] : order;
        let m = 0;
        for (let i = 1; i < path.length; i++) m += dist(path[i - 1], path[i]);
        return m;
      };
      // Nearest neighbor from the base (or the first stop)…
      const remaining = [...stops];
      const route: RoutePt[] = [];
      let cur: RoutePt = start || remaining[0];
      if (!start) route.push(remaining.shift()!);
      while (remaining.length) {
        let bi = 0;
        for (let i = 1; i < remaining.length; i++) {
          if (dist(cur, remaining[i]) < dist(cur, remaining[bi])) bi = i;
        }
        cur = remaining.splice(bi, 1)[0];
        route.push(cur);
      }
      // …then 2-opt passes until no segment swap improves the total.
      let improved = true;
      while (improved) {
        improved = false;
        for (let i = 0; i < route.length - 1; i++) {
          for (let k = i + 1; k < route.length; k++) {
            const cand = [...route.slice(0, i), ...route.slice(i, k + 1).reverse(), ...route.slice(k + 1)];
            if (pathMiles(cand) < pathMiles(route) - 0.05) {
              route.splice(0, route.length, ...cand);
              improved = true;
            }
          }
        }
      }
      const rt = (m: number) => Math.round(m * ROAD_FACTOR * 10) / 10;
      setResult({ order: route.map((p) => p.addr), miles: rt(pathMiles(route)), currentMiles: rt(pathMiles(stops)) });
    } finally {
      setBusy(false);
    }
  };

  const saved = result ? Math.round((result.currentMiles - result.miles) * 10) / 10 : 0;
  return (
    <div className="cd" style={{ padding: "10px 12px", marginBottom: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Icon name="navigation" size={14} color="var(--color-primary)" />
        <span style={{ fontSize: 13.5, fontWeight: 600, flex: 1 }}>{t("loc.route")} ({addresses.length} {t("loc.stops")})</span>
        <button className="bo" onClick={optimize} disabled={busy} style={{ fontSize: 13, padding: "4px 12px" }}>
          {busy ? t("loc.optimizing") : result ? t("loc.rerun") : t("loc.optimizeRoute")}
        </button>
      </div>
      {note && <div className="dim" style={{ fontSize: 12.5, marginTop: 6 }}>{note}</div>}
      {result && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 12.5, color: saved >= 0.5 ? "var(--color-success)" : "var(--color-dim)", marginBottom: 6 }}>
            {saved >= 0.5
              ? `${t("loc.bestOrder")} ~${result.miles} mi ${t("loc.vsScheduled")} ~${result.currentMiles} mi ${t("loc.saves")} ~${saved} mi.`
              : `${t("loc.alreadyEfficient")} (~${result.currentMiles} mi).`}
          </div>
          {saved >= 0.5 && result.order.map((a, i) => (
            <div key={i} className="dim" style={{ fontSize: 12.5, padding: "1px 0" }}>
              {i + 1}. {a}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface Props {
  setPage: (p: string) => void;
  preSelectJob?: string | null;
  /** The exact job behind preSelectJob (Jobs → Schedule), so the entry links
   *  to it instead of whatever job last had that address. */
  preSelectJobId?: string | null;
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// Local calendar date as YYYY-MM-DD. toISOString() formats in UTC, so any
// evening in a US timezone (already the next day in UTC) produced the wrong
// day — the day-view showed tomorrow's jobs and "today" highlighted the wrong
// cell. Local getters keep the string on the user's own calendar day, matching
// the toLocaleDateString labels and the sched_date values a date picker writes.
const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// Booking default: after 2 PM the next open slot is realistically tomorrow.
const defaultDay = () => { const d = new Date(); if (d.getHours() >= 14) d.setDate(d.getDate() + 1); return ymd(d); };

// One-shot "open on this view" hint another screen leaves via lib/nav-intent
// (e.g. Home → today's Day view). Stale after 15s so a later visit opens normally.

export default function Schedule({ setPage, preSelectJob, preSelectJobId }: Props) {
  const jobs = useStore((s) => s.jobs);
  const profiles = useStore((s) => s.profiles);
  const schedule = useStore((s) => s.schedule);
  const loadAll = useStore((s) => s.loadAll);
  const darkMode = useStore((s) => s.darkMode);
  const user = useStore((s) => s.user);
  const isAdmin = user?.role === "owner" || user?.role === "manager";

  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [view, setView] = useState<"day" | "week" | "month" | "dispatch">(() => { const v = peekNavIntent("sched")?.tab; return v === "day" || v === "week" || v === "month" || v === "dispatch" ? v : "week"; });
  // The nav intent is single-use — drop it once read so a later visit opens on Week.
  useEffect(() => {
    clearNavIntent("sched");
  }, []);
  // Crew open pre-filtered to themselves — but only when they're actually on
  // the calendar (named in an entry's 👷 crew list or the linked job's
  // requested tech); otherwise everyone's work, as before. Admins always see all.
  const [workerFilter, setWorkerFilter] = useState<string | null>(() => {
    const me = user?.name;
    if (isAdmin || !me) return null;
    const mine = schedule.some((e) => parseSchedCrew(e.note).includes(me) || entryJob(e, jobs)?.requested_tech === me);
    return mine ? me : null;
  });
  const [suggestion, setSuggestion] = useState<{ date: string; reason: string } | null>(null);
  // Quick-schedule modal state: the "armed" job + the chosen day. Opened from a
  // job's Assign button (Day-view Unscheduled) or a preSelectJob deep-link
  // (Jobs → "Schedule this job"), which defaults the day to today (tomorrow
  // after 2 PM — see defaultDay).
  const [armedJob, setArmedJob] = useState<string | null>(preSelectJob || null);
  // The exact job being scheduled (schedule.job_id). null = address-only
  // (legacy entry being edited, or a job we couldn't identify).
  const [armedJobId, setArmedJobId] = useState<string | null>(preSelectJobId || null);
  const arm = (j: { id: string; property: string }) => { setArmedJob(j.property); setArmedJobId(j.id); };
  const [dropTarget, setDropTarget] = useState<string | null>(preSelectJob ? defaultDay() : null);
  // Last-used time and workers persist between drops so back-to-back
  // scheduling sessions don't require re-typing the same defaults.
  const loadStr = (k: string, fb: string) => {
    if (typeof window === "undefined") return fb;
    try { return localStorage.getItem("c_sched_" + k) || fb; } catch { return fb; }
  };
  const loadList = (k: string): string[] => {
    if (typeof window === "undefined") return [];
    try { return JSON.parse(localStorage.getItem("c_sched_" + k) || "[]"); } catch { return []; }
  };
  const [qsTime, setQsTime] = useState(() => loadStr("lastTime", ""));
  const [qsWorkers, setQsWorkers] = useState<string[]>(() => loadList("lastWorkers"));
  // Crew can only be people on THIS team. The remembered list is phone-wide,
  // so after switching accounts on a phone it held the other business's names
  // (and they had no pill to un-pick them, so every visit got them).
  const teamNames = new Set(profiles.map((p) => p.name));
  const onTeam = (names: string[]) => (profiles.length ? names.filter((n) => teamNames.has(n)) : names);
  useEffect(() => {
    if (!profiles.length) return;
    setQsWorkers((prev) => { const kept = prev.filter((n) => teamNames.has(n)); return kept.length === prev.length ? prev : kept; });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profiles]);
  const [qsNote, setQsNote] = useState("");
  // Optional end day for multi-day jobs — an entry spans sched_date..end_date.
  const [endTarget, setEndTarget] = useState<string | null>(null);
  // When set, the modal is editing/moving an existing entry (patch) rather than
  // creating a new one (post).
  const [editSched, setEditSched] = useState<typeof schedule[number] | null>(null);
  // Reset the multi-day end + edit target whenever the modal closes (any path).
  useEffect(() => { if (!armedJob) { setEndTarget(null); setEditSched(null); setArmedJobId(null); } }, [armedJob]);

  // When a job is armed via the drag palette, re-run the day-suggestion
  // logic so the user immediately sees a "schedule near nearby work" hint.
  useEffect(() => {
    if (armedJob) suggestDay(armedJob);
    else setSuggestion(null);
    // suggestDay closes over `schedule`, so re-run if schedule changes too
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [armedJob, schedule]);

  // Suggest a day based on nearby scheduled jobs
  const suggestDay = (jobProperty: string) => {
    if (!jobProperty) { setSuggestion(null); return; }

    // Extract street name for matching
    const getStreet = (addr: string) => {
      const parts = addr.toLowerCase().replace(/[,]/g, "").split(/\s+/);
      // Skip house number, get street name words
      const words = parts.filter((w) => !/^\d+$/.test(w) && w.length > 1);
      return words.slice(0, 3).join(" ");
    };

    const selectedStreet = getStreet(jobProperty);
    if (!selectedStreet) { setSuggestion(null); return; }

    // Find scheduled jobs on streets that match
    const today = ymd(new Date());
    const upcoming = schedule.filter((s) => s.sched_date >= today);

    for (const entry of upcoming) {
      // Skip the same job — suggesting "schedule near yourself" is useless.
      if (entry.job === jobProperty) continue;
      const entryStreet = getStreet(entry.job);
      // Check if streets share words (same area)
      const selectedWords = selectedStreet.split(" ");
      const entryWords = entryStreet.split(" ");
      const shared = selectedWords.filter((w) => entryWords.includes(w) && w.length > 2);

      if (shared.length >= 1) {
        setSuggestion({
          date: entry.sched_date,
          reason: `${entry.job} ${t("sched.isNearby")}`,
        });
        return;
      }
    }
    setSuggestion(null);
  };

  // Quick-add used by the drag/drop + tap-to-arm flow — writes a schedule
  // entry from the modal's time/workers/notes state without requiring the
  // user to re-pick the job and date that were already chosen.
  const quickAdd = async () => {
    if (!armedJob || !dropTarget) return;
    const parts = [];
    if (qsTime) parts.push(`🕐 ${qsTime}`);
    const crew = onTeam(qsWorkers);
    if (crew.length) parts.push(`👷 ${crew.join(", ")}`);
    if (qsNote) parts.push(qsNote);
    const note = parts.join(" · ");
    // Multi-day jobs span sched_date..end_date.
    const endDate = endTarget && endTarget > dropTarget ? endTarget : null;
    if (editSched) {
      // Edit / move an existing entry.
      const patch: Record<string, unknown> = { sched_date: dropTarget, note };
      // Set end_date for a multi-day range, or clear it when an existing
      // multi-day entry is shortened to a single day. Left untouched for
      // single→single edits so the column isn't referenced pre-migration.
      if (endDate) patch.end_date = endDate;
      else if (editSched.end_date) patch.end_date = null;
      // Failed write (already toasted) — keep the modal open to retry.
      if (!await db.patch("schedule", editSched.id, patch)) return;
      // Tell the crew: added → booked, moved → changed, dropped → taken off.
      sendScheduleNotices(noticesFor(editSched, { ...editSched, sched_date: dropTarget, note, end_date: endDate }));
    } else {
      // Only send end_date for a real range so single-day scheduling still
      // works before the `end_date` column migration runs.
      const payload: Record<string, unknown> = { sched_date: dropTarget, job: armedJob, note };
      if (armedJobId) payload.job_id = armedJobId;
      if (endDate) payload.end_date = endDate;
      // Only bump the job to "scheduled" once the calendar entry exists —
      // otherwise it drops out of Unscheduled with nothing on the calendar.
      if (await db.post("schedule", payload) === null) return;
      sendScheduleNotices(noticesFor(null, { job: armedJob, job_id: armedJobId, sched_date: dropTarget, end_date: endDate, note }));
      const matched = armedJobId
        ? jobs.find((j) => j.id === armedJobId && (j.status === "quoted" || j.status === "accepted"))
        : jobs.find((j) => j.property === armedJob && (j.status === "quoted" || j.status === "accepted"));
      if (matched) await db.patch("jobs", matched.id, { status: "scheduled" });
    }
    // Persist time + workers so the next drop pre-fills with the same
    // defaults — the common case is scheduling several jobs in a row at
    // the same start time with the same crew.
    try {
      if (typeof window !== "undefined") {
        localStorage.setItem("c_sched_lastTime", qsTime || "");
        localStorage.setItem("c_sched_lastWorkers", JSON.stringify(onTeam(qsWorkers)));
      }
    } catch { /* ignore quota errors */ }
    const wasEdit = !!editSched;
    setArmedJob(null);
    setDropTarget(null);
    // Keep qsTime + qsWorkers as-is; only the note clears so it doesn't
    // get accidentally reused on the next job.
    setQsNote("");
    await loadAll();
    useStore.getState().showToast(wasEdit ? t("sched.scheduleUpdated") : t("sched.scheduledToast"), "success");
  };

  const now = new Date();
  const todayStr = ymd(now);

  // viewDate drives which week/month is on screen. Anchored to today on
  // mount; the prev/next/Today header controls move it. A separate `now`
  // stays around so today's cell stays highlighted regardless of where the
  // user is paged to.
  const [viewDate, setViewDate] = useState(() => new Date());

  // Week data
  const ws = new Date(viewDate);
  ws.setDate(viewDate.getDate() - viewDate.getDay());
  ws.setHours(0, 0, 0, 0);
  const week = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(ws);
    d.setDate(ws.getDate() + i);
    return d;
  });

  // Month data
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthCells: (Date | null)[] = [];
  for (let i = 0; i < firstDay; i++) monthCells.push(null);
  for (let d = 1; d <= daysInMonth; d++) monthCells.push(new Date(year, month, d));
  // Pad to fill last row
  while (monthCells.length % 7 !== 0) monthCells.push(null);

  // Step the viewDate by one week or one month depending on current view.
  const stepView = (dir: -1 | 1) => {
    setViewDate((prev) => {
      const next = new Date(prev);
      if (view === "day") next.setDate(prev.getDate() + dir);
      else if (view === "week" || view === "dispatch") next.setDate(prev.getDate() + dir * 7);
      else next.setMonth(prev.getMonth() + dir);
      return next;
    });
  };
  const goToday = () => setViewDate(new Date());

  // ── Schedule view helpers ──────────────────────────────────────────
  const periodLabel = view === "day"
    ? `${viewDate.toLocaleDateString("en-US", { weekday: "short" })} · ${viewDate.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
    : view === "week" || view === "dispatch"
    ? `${MONTH_NAMES[ws.getMonth()].slice(0, 3)} ${ws.getDate()}–${week[6].getDate()}`
    : `${MONTH_NAMES[month]} ${year}`;
  // Workers live in the note as "👷 Name, Name"; the linked job's
  // requested_tech is a fallback so entries scheduled without a crew list
  // still filter to that tech. Note parsing is day-plan's (parseSchedCrew /
  // parseSchedTime — the latter also reads AppFolio's "🕐 2:30pm" as 14:30).
  const parseWorkers = parseSchedCrew;
  const parseTime = parseSchedTime;
  const fmt12 = (hhmm: string): string => {
    if (!hhmm) return "";
    const [h, m] = hhmm.split(":").map(Number);
    return `${h % 12 || 12}:${String(m).padStart(2, "0")}${h >= 12 ? "p" : "a"}`;
  };
  // Multi-day: an entry covers every day from sched_date..end_date (end_date
  // defaults to sched_date for single-day jobs, including pre-migration rows).
  const spansDay = (s: { sched_date: string; end_date?: string }, day: string) =>
    day >= s.sched_date && day <= (s.end_date || s.sched_date);
  // "Day k of N" badge data — null for single-day entries.
  const dayOfSpan = (s: { sched_date: string; end_date?: string }, day: string): { idx: number; total: number } | null => {
    const end = s.end_date || s.sched_date;
    if (end <= s.sched_date) return null;
    const DAY = 86400000;
    const start = new Date(s.sched_date + "T12:00:00").getTime();
    const total = Math.round((new Date(end + "T12:00:00").getTime() - start) / DAY) + 1;
    const idx = Math.round((new Date(day + "T12:00:00").getTime() - start) / DAY) + 1;
    return total > 1 ? { idx, total } : null;
  };
  const initialsOf = (name: string): string => (name || "?").trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase() || "?";
  // An entry's job (linked, else the latest job at that address) and "is this
  // job on the calendar" — day-plan's entryJob / isJobScheduled.
  const jobForEntry = (e: Pick<ScheduleEntry, "job" | "job_id">) => entryJob(e, jobs);
  const isScheduled = (j: { id: string; property: string; created_at?: string }) => isJobScheduled(j, schedule);
  const entryWorkers = (e: Pick<ScheduleEntry, "note" | "job" | "job_id">): string[] => {
    const w = parseWorkers(e.note);
    const j = jobForEntry(e);
    return (j?.requested_tech && !w.includes(j.requested_tech)) ? [...w, j.requested_tech] : w;
  };
  const matchesWorker = (e: Pick<ScheduleEntry, "note" | "job" | "job_id">) => !workerFilter || entryWorkers(e).includes(workerFilter);

  // Open the quick-schedule modal pre-filled to EDIT/MOVE an existing entry
  // (change its day(s), time, crew, notes — or unschedule it).
  const openEdit = (s: typeof schedule[number]) => {
    setEditSched(s);
    setArmedJob(s.job);
    setArmedJobId(s.job_id || null);
    setDropTarget(s.sched_date);
    setEndTarget(s.end_date || null);
    setQsTime(parseTime(s.note));
    setQsWorkers(parseWorkers(s.note));
    setQsNote(stripNoteParts(s.note));
  };
  const deleteSched = async () => {
    if (!editSched) return;
    if (!await useStore.getState().showConfirm(t("sched.removeFromSchedule"), `${t("sched.unscheduleConfirm")} ${editSched.job}?`)) return;
    await db.del("schedule", editSched.id);
    sendScheduleNotices(noticesFor(editSched, null));
    setArmedJob(null); setDropTarget(null); setQsNote("");
    await loadAll();
    useStore.getState().showToast(t("sched.removedFromSchedule"), "info");
  };

  return (
    <div className="fi">
      {/* Topbar — title + date nav (tap label = today) */}
      <TopBar title={t("sched.title")} icon="schedule" color="#ff8a3d" right={
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: "Oswald", fontWeight: 600, fontSize: 15 }}>
          <button onClick={() => stepView(-1)} aria-label={t("sched.previous")} style={{ width: 34, height: 34, borderRadius: 8, background: "var(--color-card-dark-2)", border: "1px solid var(--color-border-dark-2)", color: "var(--color-dim)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}><Icon name="back" size={14} /></button>
          <span onClick={goToday} title={t("sched.jumpToToday")} style={{ cursor: "pointer", minWidth: 96, textAlign: "center" }}>{periodLabel}</span>
          <button onClick={() => stepView(1)} aria-label={t("sched.next")} style={{ width: 34, height: 34, borderRadius: 8, background: "var(--color-card-dark-2)", border: "1px solid var(--color-border-dark-2)", color: "var(--color-dim)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}><Icon name="next" size={14} /></button>
        </div>
      } />

      {/* Property typeahead — searches scheduled entries by job address.
          Selecting a suggestion jumps the calendar to that entry's date
          and highlights the day. */}
      <div style={{ marginBottom: 10 }}>
        <PropertySearch<typeof schedule[number]>
          items={schedule}
          getKey={(s) => s.id}
          match={(s) => `${s.job || ""} ${s.note || ""}`}
          render={(s) => (
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                <b>{s.job || t("sched.noAddress")}</b>
                {s.note && <span className="dim"> · {s.note.slice(0, 40)}</span>}
              </span>
              <span style={{ fontFamily: "Oswald", color: "var(--color-primary)", fontSize: 13, flexShrink: 0 }}>
                {s.sched_date}
              </span>
            </div>
          )}
          onSelect={(s) => {
            const target = new Date(s.sched_date + "T12:00:00");
            if (isNaN(target.getTime())) return;
            // Switch to month view first — week view only shows 7 days,
            // so jumping to a date a few weeks out wouldn't show
            // anything visible. Month always shows the picked date.
            setView("month");
            setViewDate(target);
            setSelectedDay(s.sched_date);
            // Defer scroll until React commits the day-detail panel
            // (rendered conditionally on selectedDay being set).
            setTimeout(() => {
              const el = document.getElementById("schedule-day-detail");
              el?.scrollIntoView({ behavior: "smooth", block: "center" });
            }, 60);
          }}
          placeholder={t("sched.searchByProperty")}
        />
      </div>

      {/* Quick-Schedule sheet — opens from a job's "Assign" / a calendar entry.
          Shared pop-up style (.sheet-overlay / .sheet): bottom sheet on phones,
          centered card on wide screens. */}
      {armedJob && dropTarget && (() => {
        const close = () => { setArmedJob(null); setDropTarget(null); setQsTime(""); setQsWorkers([]); setQsNote(""); };
        // Pill toggle — same look for day chips and crew chips.
        const pill = (sel: boolean): React.CSSProperties => ({
          minHeight: 36, padding: "6px 14px", borderRadius: 99, fontSize: 14, fontWeight: 600,
          display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer",
          background: sel ? "color-mix(in srgb, var(--color-primary) 18%, transparent)" : "transparent",
          color: sel ? "var(--color-primary)" : "var(--color-dim)",
          border: `1px solid ${sel ? "var(--color-primary)" : "var(--color-border-dark)"}`,
        });
        const field: React.CSSProperties = { marginTop: 4, width: "100%", fontWeight: 600 };
        return (
          <div onClick={close} className="sheet-overlay">
            <div onClick={(e) => e.stopPropagation()} className="cd sheet" style={{ maxWidth: 440, paddingTop: 18 }}>
              {/* Header — title + close, the job underneath */}
              <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 14 }}>
                <div style={{ width: 38, height: 38, borderRadius: 11, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "color-mix(in srgb, var(--color-primary) 16%, transparent)" }}>
                  <Icon name="schedule" size={19} color="var(--color-primary)" />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <h3 style={{ fontFamily: "Oswald", fontSize: 19, textTransform: "uppercase", lineHeight: 1.15 }}>
                    {editSched ? t("sched.editMoveJob") : t("sched.scheduleJob")}
                  </h3>
                  <div className="dim" style={{ fontSize: 13.5, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{armedJob}</div>
                </div>
                <button className="iconbtn" onClick={close} aria-label={t("common.close")}><Icon name="close" size={16} /></button>
              </div>

              {/* Day — one-tap Today · Tomorrow · the day after, or pick a date */}
              <div className="section" style={{ marginBottom: 12 }}>
                <label className="sl" style={{ fontSize: 12.5 }}>{t("sched.day")}</label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                  {[0, 1, 2].map((n) => {
                    const d = new Date();
                    d.setDate(d.getDate() + n);
                    const ds = ymd(d);
                    return (
                      <button key={n} type="button" onClick={() => setDropTarget(ds)} style={pill(dropTarget === ds)}>
                        {n === 0 ? t("sched.chipToday") : n === 1 ? t("sched.chipTomorrow") : DAY_NAMES[d.getDay()]}
                      </button>
                    );
                  })}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 10 }}>
                  <div>
                    <div className="dim" style={{ fontSize: 12 }}>{t("sched.day")}</div>
                    <input type="date" value={dropTarget || ""} onChange={(e) => setDropTarget(e.target.value)} style={{ ...field, color: "var(--color-primary)" }} />
                  </div>
                  <div>
                    <div className="dim" style={{ fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={t("sched.endDayOptional")}>{t("sched.endDay")} · {t("sched.optional").toLowerCase()}</div>
                    <input type="date" value={endTarget || ""} min={dropTarget || undefined} onChange={(e) => setEndTarget(e.target.value || null)} style={field} />
                  </div>
                </div>
                {suggestion && suggestion.date !== dropTarget && (
                  <button
                    type="button"
                    onClick={() => setDropTarget(suggestion.date)}
                    style={{ width: "100%", display: "flex", alignItems: "center", gap: 7, background: "rgba(157,78,221,.1)", border: "1px solid rgba(157,78,221,.35)", borderRadius: 10, padding: "9px 11px", marginTop: 10, fontSize: 13, color: "#c9a6ff", cursor: "pointer", textAlign: "left" }}
                  >
                    <Icon name="sparkle" size={14} color="#c9a6ff" /> {t("sched.nearbyUse")} {new Date(suggestion.date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                  </button>
                )}
              </div>

              {/* Time + crew */}
              <div className="section" style={{ marginBottom: 12 }}>
                <label className="sl" style={{ fontSize: 12.5 }}>{t("sched.time")}</label>
                <input type="time" value={qsTime} onChange={(e) => setQsTime(e.target.value)} style={{ ...field, color: "var(--color-primary)" }} />
                <label className="sl" style={{ fontSize: 12.5, display: "block", marginTop: 12 }}>{t("sched.workers")}</label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                  {profiles.map((p) => {
                    const sel = qsWorkers.includes(p.name);
                    return (
                      <button key={p.id} type="button" onClick={() => setQsWorkers((prev) => sel ? prev.filter((n) => n !== p.name) : [...prev, p.name])} style={pill(sel)}>
                        {sel && <Icon name="check" size={13} />}{p.name}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div style={{ marginBottom: 16 }}>
                <label className="sl" style={{ fontSize: 12.5 }}>{t("sched.notes")}</label>
                <input value={qsNote} onChange={(e) => setQsNote(e.target.value)} placeholder={t("sched.optional")} style={{ marginTop: 4, width: "100%" }} />
              </div>

              {/* Actions — primary full width, secondary underneath */}
              <button onClick={quickAdd} className="bg" style={{ width: "100%", fontSize: 15, padding: 12, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7 }}>
                {editSched ? t("sched.saveChanges") : t("sched.scheduleAction")}
              </button>
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                {editSched && (
                  <button onClick={deleteSched} className="bo" style={{ flex: 1, fontSize: 14, color: "var(--color-accent-red)" }}>
                    {t("sched.unschedule")}
                  </button>
                )}
                <button onClick={close} className="bo" style={{ flex: 1, fontSize: 14 }}>{t("common.cancel")}</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* View toggle (Day / Week / Month) */}
      <div style={{ display: "flex", gap: 5, marginBottom: 11 }}>
        {(["day", "week", "month", "dispatch"] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            style={{
              flex: 1, textAlign: "center", padding: 8, borderRadius: 10, fontSize: 14,
              fontFamily: "Oswald", fontWeight: 600, letterSpacing: ".04em", textTransform: "capitalize",
              background: view === v ? "var(--color-primary)" : "var(--color-card-dark-2)",
              color: view === v ? "#fff" : "var(--color-dim)",
              border: `1px solid ${view === v ? "var(--color-primary)" : "var(--color-border-dark-2)"}`,
            }}
          >
            {t("sched.view_" + v)}
          </button>
        ))}
      </div>

      {/* Worker filter — ALL + each tech (filters every view) */}
      <div style={{ display: "flex", gap: 9, marginBottom: 12, overflowX: "auto", paddingBottom: 2 }}>
        {[{ id: null as string | null, short: t("sched.crew"), badge: t("sched.all") }, ...profiles.map((p) => ({ id: p.name, short: p.name.split(" ")[0], badge: initialsOf(p.name) }))].map((w) => {
          const wOn = workerFilter === w.id;
          const isAll = w.id === null;
          return (
            <button key={w.id || "all"} onClick={() => setWorkerFilter(w.id)} style={{ flexShrink: 0, textAlign: "center", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
              <div style={{ width: 38, height: 38, borderRadius: "50%", margin: "0 auto 3px", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Oswald", fontWeight: 600, fontSize: 14, background: isAll ? "var(--color-primary)" : "var(--color-card-dark-2)", color: isAll ? "#fff" : darkMode ? (wOn ? "#fff" : "#cdd6e6") : (wOn ? "#1a1a2a" : "#5a6175"), border: `2px solid ${wOn ? "var(--color-primary)" : "transparent"}`, boxShadow: wOn ? "0 0 14px -4px rgba(46,139,255,.85)" : "none" }}>{w.badge}</div>
              <div style={{ fontSize: 10.5, color: wOn ? "inherit" : "var(--color-dim)" }}>{w.short}</div>
            </button>
          );
        })}
      </div>

      {/* ── DAY VIEW — time-rail blocks + Unscheduled ── */}
      {view === "day" && (() => {
        const ds = ymd(viewDate);
        const dayEntries = schedule.filter((s) => spansDay(s, ds) && matchesWorker(s))
          .sort((a, b) => (parseTime(a.note) || "99:99").localeCompare(parseTime(b.note) || "99:99"));
        const unscheduled = jobs.filter((j) => !j.archived && (j.status === "accepted" || j.status === "quoted") && !isScheduled(j));
        return (
          <div className="mb">
            {dayEntries.length === 0 && (
              <div className="cd" style={{ textAlign: "center", padding: 20, marginBottom: 8 }}><p className="dim" style={{ fontSize: 14 }}>{t("sched.noJobsThisDay")}</p></div>
            )}
            {/* Route optimizer — suggests the least-driving stop order (3+ stops). */}
            <RouteOptimizer addresses={dayEntries.map((s) => s.job).filter(Boolean)} />
            {dayEntries.map((s) => {
              const j = jobForEntry(s);
              const color = j ? statusColor(j.status) : "var(--color-primary)";
              const time = parseTime(s.note);
              const crew = entryWorkers(s);
              const meta = j ? `${j.trade || t("sched.job")} · ${(j.total_hrs || 0).toFixed(1)}h` : (stripNoteParts(s.note) || t("sched.scheduled"));
              return (
                <div key={s.id} style={{ display: "flex", gap: 9, marginBottom: 8 }}>
                  <div style={{ width: 44, flexShrink: 0, fontSize: 12, color: "var(--color-dim)", fontFamily: "Oswald", fontWeight: 600, paddingTop: 11, textAlign: "right" }}>{time ? fmt12(time) : "—"}</div>
                  {/* Open the VIEWED day's detail (not sched_date — that jumped a
                      multi-day job back to its first day), then scroll to it. */}
                  <div onClick={() => { setSelectedDay(ds); setTimeout(() => document.getElementById("schedule-day-detail")?.scrollIntoView({ behavior: "smooth", block: "center" }), 60); }} style={{ flex: 1, position: "relative", overflow: "hidden", background: darkMode ? "#16161f" : "#fff", border: "1px solid var(--color-border-dark)", borderRadius: 13, padding: "10px 11px 10px 15px", cursor: "pointer" }}>
                    <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 4, background: color, boxShadow: darkMode ? `0 0 10px ${color}, 0 0 20px -2px ${color}` : "none" }} />
                    <div style={{ fontFamily: "Oswald", fontWeight: 600, fontSize: 15, letterSpacing: ".3px" }}>{s.job}</div>
                    <div style={{ fontSize: 12, color: "var(--color-dim)", marginTop: 2 }}>{meta}{(() => { const sp = dayOfSpan(s, ds); return sp ? ` · ${t("sched.day")} ${sp.idx} ${t("sched.ofDay")} ${sp.total}` : ""; })()}</div>
                    {crew.length > 0 && (
                      <div style={{ display: "flex", marginTop: 7 }}>
                        {crew.map((wn, ci) => (
                          <span key={ci} title={wn} style={{ width: 21, height: 21, borderRadius: "50%", background: "var(--color-card-dark-2)", border: `1.5px solid ${darkMode ? "#16161f" : "#fff"}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10.5, fontWeight: 600, color: darkMode ? "#cdd6e6" : "#5a6175", marginLeft: ci ? -5 : 0 }}>{initialsOf(wn)}</span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            {unscheduled.length > 0 && (<>
              <div style={{ fontSize: 12.5, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--color-dim)", fontWeight: 600, margin: "13px 2px 8px", display: "flex", alignItems: "center", gap: 7 }}><Icon name="folder" size={13} color="var(--color-dim)" /> {t("sched.unscheduled")}</div>
              {suggestion && (
                <div style={{ display: "flex", alignItems: "center", gap: 9, background: "rgba(157,78,221,.1)", border: "1px solid rgba(157,78,221,.35)", borderRadius: 12, padding: "9px 11px", marginBottom: 8, fontSize: 12.5, color: "#c9a6ff" }}>
                  <Icon name="sparkle" size={15} color="#c9a6ff" /> {suggestion.reason}
                </div>
              )}
              {unscheduled.map((j) => (
                <div key={j.id} style={{ display: "flex", alignItems: "center", gap: 10, background: darkMode ? "#16161f" : "#fff", border: "1px dashed var(--color-border-dark)", borderRadius: 12, padding: "9px 11px 9px 14px", position: "relative", overflow: "hidden", marginBottom: 6 }}>
                  <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 4, background: statusColor(j.status), boxShadow: darkMode ? `0 0 10px ${statusColor(j.status)}, 0 0 20px -2px ${statusColor(j.status)}` : "none" }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: "Oswald", fontWeight: 600, fontSize: 14 }}>{j.property}</div>
                    <div style={{ fontSize: 11.5, color: "var(--color-dim)", textTransform: "capitalize" }}>{j.status} · {t("sched.noDayYet")}</div>
                  </div>
                  <button onClick={() => { arm(j); setDropTarget(ds); }} style={{ fontSize: 12.5, fontWeight: 600, color: "#fff", background: "var(--color-primary)", borderRadius: 8, padding: "6px 10px", border: "none", display: "flex", alignItems: "center", gap: 5, cursor: "pointer", flexShrink: 0 }}>
                    <Icon name="schedule" size={12} color="#fff" /> {t("sched.assign")}
                  </button>
                </div>
              ))}
            </>)}
          </div>
        );
      })()}

      {/* ── WEEK VIEW — day-row list ── */}
      {view === "week" && (
        <div className="mb">
          {week.map((d, i) => {
            const ds = ymd(d);
            const dayEntries = schedule.filter((s) => spansDay(s, ds) && matchesWorker(s)).sort((a, b) => (parseTime(a.note) || "99:99").localeCompare(parseTime(b.note) || "99:99"));
            const isToday = ds === todayStr;
            const totalHrs = dayEntries.reduce((sum, e) => sum + (jobForEntry(e)?.total_hrs || 0), 0);
            return (
              // Tap a day row → drill into that day in Day view.
              <div key={i} onClick={() => { setView("day"); setViewDate(new Date(d)); window.scrollTo({ top: 0, behavior: "smooth" }); }} style={{ background: darkMode ? "#16161f" : "#fff", border: `1px solid ${isToday ? "rgba(46,139,255,.5)" : "var(--color-border-dark)"}`, boxShadow: isToday ? "0 0 0 1px rgba(46,139,255,.2)" : "none", borderRadius: 13, padding: "10px 11px", marginBottom: 8, opacity: dayEntries.length ? 1 : 0.5, cursor: "pointer" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: dayEntries.length ? 7 : 0 }}>
                  <div style={{ fontFamily: "Oswald", fontWeight: 600, fontSize: 15 }}>{DAY_NAMES[d.getDay()]}<span style={{ color: "var(--color-dim)", fontWeight: 400, fontSize: 13, marginLeft: 5 }}>{MONTH_NAMES[d.getMonth()].slice(0, 3)} {d.getDate()}</span></div>
                  {dayEntries.length > 0 && <div style={{ fontSize: 11.5, color: "var(--color-dim)" }}>{dayEntries.length} {dayEntries.length !== 1 ? t("sched.jobsPlural") : t("sched.jobSingular")}{totalHrs ? ` · ${totalHrs.toFixed(1)}h` : ""}</div>}
                </div>
                {dayEntries.length === 0 ? (
                  <div style={{ fontSize: 12.5, color: "var(--color-dim)" }}>{t("sched.noJobsShort")}</div>
                ) : dayEntries.map((s) => {
                  const j = jobForEntry(s);
                  const color = j ? statusColor(j.status) : "var(--color-primary)";
                  const time = parseTime(s.note);
                  const crew = entryWorkers(s);
                  let wlabel = "";
                  if (workerFilter) { const others = crew.filter((n) => n !== workerFilter); wlabel = others.length ? `+${others.map((n) => n.split(" ")[0]).join(", ")}` : t("sched.solo"); }
                  else { wlabel = crew.map((n) => initialsOf(n)).join(" "); }
                  return (
                    <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13, padding: "5px 8px", borderRadius: 8, background: "var(--color-card-dark-2)", marginBottom: 4 }}>
                      <span style={{ width: 7, height: 7, borderRadius: "50%", background: color, boxShadow: `0 0 6px ${color}`, flexShrink: 0 }} />
                      <span style={{ flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.job}{time ? ` · ${fmt12(time)}` : ""}{(() => { const sp = dayOfSpan(s, ds); return sp ? ` · ${t("sched.dayShort")}${sp.idx}/${sp.total}` : ""; })()}</span>
                      {wlabel && <span style={{ fontSize: 11, color: "var(--color-dim)", whiteSpace: "nowrap", flexShrink: 0 }}>{wlabel}</span>}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}

      {/* ── MONTH VIEW — dot grid ── */}
      {view === "month" && (
        <div className="mb">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 4, marginBottom: 5 }}>
            {t("sched.dayInitials").split(",").map((d, i) => <div key={i} style={{ textAlign: "center", fontSize: 10.5, color: "var(--color-dim)", fontWeight: 600 }}>{d}</div>)}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 4 }}>
            {monthCells.map((d, i) => {
              if (!d) return <div key={`e${i}`} style={{ aspectRatio: ".92", borderRadius: 8, background: darkMode ? "#0d0d14" : "#f5f5f5", opacity: 0.28 }} />;
              const ds = ymd(d);
              const dayEntries = schedule.filter((s) => spansDay(s, ds) && matchesWorker(s));
              const isToday = ds === todayStr;
              const isSel = ds === selectedDay;
              const dots = dayEntries.slice(0, 4).map((s) => { const j = jobForEntry(s); return j ? statusColor(j.status) : "var(--color-primary)"; });
              return (
                <div key={i} onClick={() => setSelectedDay(isSel ? null : ds)} style={{ aspectRatio: ".92", borderRadius: 8, padding: "3px 2px", display: "flex", flexDirection: "column", alignItems: "center", cursor: "pointer", background: isSel ? "rgba(46,139,255,.16)" : (darkMode ? "#16161f" : "#fff"), border: `1px solid ${isSel || isToday ? "var(--color-primary)" : "var(--color-border-dark)"}` }}>
                  <div style={{ fontSize: 11.5, color: isToday ? "var(--color-primary)" : "inherit", fontWeight: isToday ? 700 : 400 }}>{d.getDate()}</div>
                  <div style={{ display: "flex", gap: 2, marginTop: "auto", flexWrap: "wrap", justifyContent: "center", paddingBottom: 1 }}>
                    {dots.map((c, di) => <i key={di} style={{ width: 5, height: 5, borderRadius: "50%", background: c, boxShadow: `0 0 5px ${c}`, display: "block" }} />)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── DISPATCH VIEW — assign jobs to days + techs ── */}
      {view === "dispatch" && (() => {
        const needScheduling = jobs.filter((j) => !j.archived && (j.status === "accepted" || j.status === "quoted") && !isScheduled(j));
        // Approved work is ready to book — list it ahead of quotes still waiting on the customer.
        const approvedJobs = needScheduling.filter((j) => j.status === "accepted");
        const quotedJobs = needScheduling.filter((j) => j.status === "quoted");
        const groupHeader = (label: string) => (
          <div style={{ fontSize: 11, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--color-dim)", fontWeight: 600, margin: "8px 2px 6px" }}>{label}</div>
        );
        const dispatchRow = (j: typeof jobs[number]) => (
          <div key={j.id} style={{ display: "flex", alignItems: "center", gap: 10, background: darkMode ? "#16161f" : "#fff", border: "1px dashed var(--color-border-dark)", borderRadius: 12, padding: "9px 11px 9px 14px", position: "relative", overflow: "hidden", marginBottom: 6 }}>
            <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 4, background: statusColor(j.status), boxShadow: darkMode ? `0 0 10px ${statusColor(j.status)}, 0 0 20px -2px ${statusColor(j.status)}` : "none" }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: "Oswald", fontWeight: 600, fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{j.property}</div>
              <div style={{ fontSize: 11.5, color: "var(--color-dim)" }}>{j.trade || t("sched.job")} · {(j.total_hrs || 0).toFixed(1)}h · {j.status}</div>
            </div>
            <button onClick={() => { arm(j); setDropTarget(defaultDay()); }} style={{ fontSize: 12.5, fontWeight: 600, color: "#fff", background: "var(--color-primary)", borderRadius: 8, padding: "6px 12px", border: "none", display: "flex", alignItems: "center", gap: 5, cursor: "pointer", flexShrink: 0 }}>
              <Icon name="schedule" size={12} color="#fff" /> {t("sched.assign")}
            </button>
          </div>
        );
        const weekDates = week.map((d) => ymd(d));
        const weekStart = weekDates[0];
        const weekEnd = weekDates[weekDates.length - 1];
        const weekEntries = schedule.filter((s) => (s.end_date || s.sched_date) >= weekStart && s.sched_date <= weekEnd);
        return (
          <div className="mb">
            {/* Dispatch Assistant (admins) — crew right now + plan the viewed
                week's routes. The week follows the arrows up top (its Monday). */}
            {isAdmin && <DispatchAssistant setPage={setPage} week={weekDates[1]} onNextWeek={() => stepView(1)} />}
            {/* Needs scheduling — pool of unassigned jobs (book one by hand) */}
            <div style={{ fontSize: 12.5, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--color-dim)", fontWeight: 600, margin: isAdmin ? "16px 2px 8px" : "2px 2px 8px", display: "flex", alignItems: "center", gap: 7 }}>
              <Icon name="folder" size={13} color="var(--color-dim)" /> {t("sched.needsScheduling")} ({needScheduling.length})
            </div>
            {needScheduling.length === 0 ? (
              <div className="cd" style={{ textAlign: "center", padding: 14, marginBottom: 10 }}><p className="dim" style={{ fontSize: 13 }}>{t("sched.everythingAssigned")} ✓</p></div>
            ) : (<>
              {approvedJobs.length > 0 && groupHeader(t("sched.approvedReady"))}
              {approvedJobs.map(dispatchRow)}
              {quotedJobs.length > 0 && groupHeader(t("sched.quotedWaiting"))}
              {quotedJobs.map(dispatchRow)}
            </>)}

            {/* This week, grouped by tech — tap a job to edit / move it */}
            <div style={{ fontSize: 12.5, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--color-dim)", fontWeight: 600, margin: "16px 2px 8px", display: "flex", alignItems: "center", gap: 7 }}>
              <Icon name="worker" size={13} color="var(--color-dim)" /> {t("sched.thisWeekByTech")}
            </div>
            {profiles.map((p) => {
              const mine = weekEntries.filter((s) => entryWorkers(s).includes(p.name)).sort((a, b) => a.sched_date.localeCompare(b.sched_date));
              return (
                <div key={p.id} className="cd" style={{ padding: "9px 11px", marginBottom: 7 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: mine.length ? 7 : 0 }}>
                    <span style={{ fontFamily: "Oswald", fontWeight: 600, fontSize: 14, display: "inline-flex", alignItems: "center", gap: 7 }}>
                      <span style={{ width: 22, height: 22, borderRadius: "50%", background: "var(--color-card-dark-2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 600, color: darkMode ? "#cdd6e6" : "#5a6175" }}>{initialsOf(p.name)}</span>
                      {p.name}
                    </span>
                    <span className="dim" style={{ fontSize: 11.5 }}>{mine.length ? `${mine.length} ${mine.length !== 1 ? t("sched.jobsPlural") : t("sched.jobSingular")}` : t("sched.available")}</span>
                  </div>
                  {mine.map((s) => {
                    const j = jobForEntry(s);
                    const multi = !!(s.end_date && s.end_date > s.sched_date);
                    const dlabel = multi
                      ? `${new Date(s.sched_date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}–${new Date((s.end_date as string) + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
                      : new Date(s.sched_date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", day: "numeric" });
                    return (
                      <div key={s.id} onClick={() => openEdit(s)} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13, padding: "5px 8px", borderRadius: 8, background: "var(--color-card-dark-2)", marginBottom: 4, cursor: "pointer" }}>
                        <span style={{ width: 7, height: 7, borderRadius: "50%", background: j ? statusColor(j.status) : "var(--color-primary)", boxShadow: `0 0 6px ${j ? statusColor(j.status) : "var(--color-primary)"}`, flexShrink: 0 }} />
                        <span style={{ flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.job}</span>
                        <span style={{ fontSize: 11, color: "var(--color-dim)", whiteSpace: "nowrap", flexShrink: 0 }}>{dlabel}</span>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* Selected-day detail + actions */}
      <div className="cd mb">

        {/* Day detail panel */}
        {selectedDay && (() => {
          const dayItems = schedule.filter((s) => spansDay(s, selectedDay) && matchesWorker(s));
          const dayDate = new Date(selectedDay + "T12:00:00");
          const dayLabel = dayDate.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
          return (
            <div id="schedule-day-detail" style={{ marginTop: 10, padding: 10, borderTop: `2px solid var(--color-primary)` }}>
              <div className="row" style={{ justifyContent: "space-between", marginBottom: 6 }}>
                <h4 style={{ fontSize: 15, color: "var(--color-primary)" }}>{dayLabel}</h4>
                <span className="dim" style={{ fontSize: 12 }}>{dayItems.length} {dayItems.length !== 1 ? t("sched.jobsPlural") : t("sched.jobSingular")}</span>
              </div>
              {dayItems.length === 0 ? (
                <p className="dim" style={{ fontSize: 13 }}>{t("sched.noJobs")}</p>
              ) : (
                dayItems.map((s) => {
                  // Match the schedule entry's free-text property string back
                  // to a real Job row so we can wire SMS notifications. Last-
                  // updated wins on duplicates so the most recent quote at
                  // that address is what we text about.
                  const linkedJob = jobForEntry(s);
                  return (
                    <div key={s.id} className="sep" style={{ fontSize: 14, padding: "8px 0" }}>
                      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", marginBottom: linkedJob ? 6 : 0, gap: 6 }}>
                        <div style={{ minWidth: 0 }}>
                          <b
                            onClick={() => window.open(`https://www.google.com/maps/search/${encodeURIComponent(s.job)}`, "_blank")}
                            style={{ color: "var(--color-primary)", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}
                            title={t("sched.openInMaps")}
                          ><Icon name="mapPin" size={12} color="var(--color-primary)" /> {s.job}</b>
                          {(() => {
                            const time = parseTime(s.note);
                            const crew = parseWorkers(s.note);
                            const freeform = stripNoteParts(s.note);
                            const bits = [time ? fmt12(time) : "", crew.join(", "), freeform].filter(Boolean);
                            return bits.length ? <div className="dim" style={{ fontSize: 12 }}>{bits.join(" · ")}</div> : null;
                          })()}
                        </div>
                        {/* marginLeft auto keeps the buttons right-aligned when
                            a long address wraps them onto their own line. */}
                        <div style={{ display: "flex", gap: 6, flexShrink: 0, marginLeft: "auto" }}>
                          <button
                            className="bo"
                            onClick={() => openEdit(s)}
                            style={{ fontSize: 13, padding: "4px 9px", display: "inline-flex", alignItems: "center", gap: 4 }}
                          >
                            <Icon name="edit" size={12} /> {t("common.edit")}
                          </button>
                          {linkedJob && (
                            <button
                              className="bo"
                              onClick={() => {
                                // Jobs reads this to open straight to the job's detail.
                                goWithIntent(setPage, { page: "jobs", jobId: linkedJob.id });
                              }}
                              style={{ fontSize: 13, padding: "4px 9px", display: "inline-flex", alignItems: "center", gap: 4 }}
                            >
                              <Icon name="jobs" size={12} /> {t("sched.openJob")}
                            </button>
                          )}
                          <button
                            className="bb"
                            onClick={() => setPage("workvision")}
                            style={{ fontSize: 14, padding: "4px 10px", display: "inline-flex", alignItems: "center", gap: 5 }}
                          >
                            <Icon name="start" size={12} color="#fff" /> {t("sched.start")}
                          </button>
                        </div>
                      </div>
                      {linkedJob && <SmsNotifyButtons jobId={linkedJob.id} compact />}
                    </div>
                  );
                })
              )}
            </div>
          );
        })()}

        <div className="row mt">
          <button
            className="bo"
            onClick={() => {
              const esc = (s: string) =>
                String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
              const org = useStore.getState().org;
              const orgName = org?.name || t("sched.serviceProvider");
              const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

              const viewStart = new Date(year, month, 1);
              const viewEnd = new Date(year, month + 1, 0);
              const monthName = viewStart.toLocaleDateString("en-US", { month: "long", year: "numeric" });

              const monthEntries = schedule
                .filter((s) => {
                  const d = s.sched_date;
                  return d >= ymd(viewStart) && d <= ymd(viewEnd);
                })
                .sort((a, b) => a.sched_date.localeCompare(b.sched_date));

              const rows = monthEntries.map((s) => {
                const d = new Date(s.sched_date + "T12:00:00");
                const dayName = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
                const time = parseSchedTime(s.note) || "—";
                const workers = parseSchedCrew(s.note).join(", ") || "—";
                const notes = stripNoteParts(s.note);
                return `<tr><td style="white-space:nowrap;font-weight:600">${esc(dayName)}</td><td>${esc(time)}</td><td style="color:#2E75B6">${esc(s.job)}</td><td>${esc(workers)}</td><td class="dim">${esc(notes)}</td></tr>`;
              }).join("");

              const body = `
<table>
  <thead>
    <tr>
      <th style="width:120px">${t("sched.printDate")}</th>
      <th style="width:80px">${t("sched.printTime")}</th>
      <th>${t("sched.printJobProperty")}</th>
      <th style="width:140px">${t("sched.printWorkers")}</th>
      <th>${t("sched.printNotes")}</th>
    </tr>
  </thead>
  <tbody>${rows || `<tr><td colspan="5" class="dim" style="text-align:center;padding:20px">${t("sched.printNoJobsMonth")}</td></tr>`}</tbody>
</table>
<div style="margin-top:14px;font-size:12px;color:#555">
  <b>${monthEntries.length}</b> ${monthEntries.length !== 1 ? t("sched.jobsPlural") : t("sched.jobSingular")} ${t("sched.printScheduledThisMonth")}
</div>`;

              const html = wrapPrint(
                {
                  orgName,
                  orgPhone: org?.phone,
                  orgEmail: org?.email,
                  orgAddress: org?.address,
                  orgLicense: org?.license_num,
                  orgLogo: org?.logo_url,
                  accent: org?.brand_color,
                  accent2: org?.brand_color_2,
                  docTitle: t("sched.workSchedule"),
                  docDate: today,
                  docSubtitle: monthName,
                },
                body,
              );
              if (!openPrint(html)) {
                useStore.getState().showToast(t("sched.allowPopups"), "error");
              }
            }}
            style={{ fontSize: 12 }}
          >
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4, justifyContent: "center" }}>
              <Icon name="print" size={12} />{t("sched.printSchedule")}
            </span>
          </button>
          <button
            className="bb"
            onClick={() => setPage("workvision")}
            style={{ fontSize: 14, padding: "5px 14px", display: "inline-flex", alignItems: "center", gap: 5 }}
          >
            <Icon name="start" size={13} color="#fff" /> {t("sched.startWorking")}
          </button>
        </div>
      </div>

      <div style={{ textAlign: "center", marginTop: 16 }}>
        <p className="dim" style={{ fontSize: 14 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, justifyContent: "center" }}>
            <Icon name="tip" size={14} color="var(--color-highlight)" />
            {t("sched.timerTip")}
          </span>
        </p>
      </div>
    </div>
  );
}
