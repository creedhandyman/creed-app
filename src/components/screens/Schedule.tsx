"use client";
import { useState, useEffect } from "react";
import { useStore } from "@/lib/store";
import { db } from "@/lib/supabase";
import { t } from "@/lib/i18n";
import { Icon } from "../Icon";
import { wrapPrint, openPrint } from "@/lib/print-template";
import PropertySearch from "../PropertySearch";
import SmsNotifyButtons from "../SmsNotifyButtons";
import { statusColor } from "@/lib/status";

interface Props {
  setPage: (p: string) => void;
  preSelectJob?: string | null;
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export default function Schedule({ setPage, preSelectJob }: Props) {
  const jobs = useStore((s) => s.jobs);
  const profiles = useStore((s) => s.profiles);
  const schedule = useStore((s) => s.schedule);
  const loadAll = useStore((s) => s.loadAll);
  const darkMode = useStore((s) => s.darkMode);

  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [view, setView] = useState<"day" | "week" | "month" | "dispatch">("week");
  const [workerFilter, setWorkerFilter] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<{ date: string; reason: string } | null>(null);
  // Quick-schedule modal state: the "armed" job + the chosen day. Opened from a
  // job's Assign button (Day-view Unscheduled) or a preSelectJob deep-link
  // (Jobs → "Schedule this job"), which defaults the day to today.
  const [armedJob, setArmedJob] = useState<string | null>(preSelectJob || null);
  const [dropTarget, setDropTarget] = useState<string | null>(preSelectJob ? new Date().toISOString().split("T")[0] : null);
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
  const [qsNote, setQsNote] = useState("");
  // Optional end day for multi-day jobs — an entry spans sched_date..end_date.
  const [endTarget, setEndTarget] = useState<string | null>(null);
  // When set, the modal is editing/moving an existing entry (patch) rather than
  // creating a new one (post).
  const [editSched, setEditSched] = useState<typeof schedule[number] | null>(null);
  // Reset the multi-day end + edit target whenever the modal closes (any path).
  useEffect(() => { if (!armedJob) { setEndTarget(null); setEditSched(null); } }, [armedJob]);

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
    const today = new Date().toISOString().split("T")[0];
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
    if (qsWorkers.length) parts.push(`👷 ${qsWorkers.join(", ")}`);
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
      await db.patch("schedule", editSched.id, patch);
    } else {
      // Only send end_date for a real range so single-day scheduling still
      // works before the `end_date` column migration runs.
      const payload: Record<string, unknown> = { sched_date: dropTarget, job: armedJob, note };
      if (endDate) payload.end_date = endDate;
      await db.post("schedule", payload);
      const matched = jobs.find((j) => j.property === armedJob && (j.status === "quoted" || j.status === "accepted"));
      if (matched) await db.patch("jobs", matched.id, { status: "scheduled" });
    }
    // Persist time + workers so the next drop pre-fills with the same
    // defaults — the common case is scheduling several jobs in a row at
    // the same start time with the same crew.
    try {
      if (typeof window !== "undefined") {
        localStorage.setItem("c_sched_lastTime", qsTime || "");
        localStorage.setItem("c_sched_lastWorkers", JSON.stringify(qsWorkers));
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
  const todayStr = now.toISOString().split("T")[0];

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
      else if (view === "week") next.setDate(prev.getDate() + dir * 7);
      else next.setMonth(prev.getMonth() + dir);
      return next;
    });
  };
  const goToday = () => setViewDate(new Date());

  // ── Schedule view helpers ──────────────────────────────────────────
  const periodLabel = view === "day"
    ? `${viewDate.toLocaleDateString("en-US", { weekday: "short" })} · ${viewDate.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
    : view === "week"
    ? `${MONTH_NAMES[ws.getMonth()].slice(0, 3)} ${ws.getDate()}–${week[6].getDate()}`
    : `${MONTH_NAMES[month]} ${year}`;
  const ymd = (d: Date) => d.toISOString().split("T")[0];
  // Workers live in the note as "👷 Name, Name"; the linked job's
  // requested_tech is a fallback so entries scheduled without a crew list
  // still filter to that tech.
  const parseWorkers = (note?: string): string[] => {
    const m = note?.match(/👷\s*([^·]+)/);
    return m ? m[1].split(",").map((s) => s.trim()).filter(Boolean) : [];
  };
  const parseTime = (note?: string): string => note?.match(/🕐\s*(\d{1,2}:\d{2})/)?.[1] || "";
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
  const jobFor = (property?: string) => property ? jobs.filter((j) => j.property === property && !j.archived).sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))[0] : undefined;
  const entryWorkers = (e: { note?: string; job?: string }): string[] => {
    const w = parseWorkers(e.note);
    const j = jobFor(e.job);
    return (j?.requested_tech && !w.includes(j.requested_tech)) ? [...w, j.requested_tech] : w;
  };
  const matchesWorker = (e: { note?: string; job?: string }) => !workerFilter || entryWorkers(e).includes(workerFilter);

  // Open the quick-schedule modal pre-filled to EDIT/MOVE an existing entry
  // (change its day(s), time, crew, notes — or unschedule it).
  const openEdit = (s: typeof schedule[number]) => {
    setEditSched(s);
    setArmedJob(s.job);
    setDropTarget(s.sched_date);
    setEndTarget(s.end_date || null);
    setQsTime(parseTime(s.note));
    setQsWorkers(parseWorkers(s.note));
    setQsNote((s.note || "").replace(/🕐\s*\d{1,2}:\d{2}\s*·?\s*/g, "").replace(/👷\s*[^·]+·?\s*/g, "").trim());
  };
  const deleteSched = async () => {
    if (!editSched) return;
    if (!await useStore.getState().showConfirm(t("sched.removeFromSchedule"), `${t("sched.unscheduleConfirm")} ${editSched.job}?`)) return;
    await db.del("schedule", editSched.id);
    setArmedJob(null); setDropTarget(null); setQsNote("");
    await loadAll();
    useStore.getState().showToast(t("sched.removedFromSchedule"), "info");
  };

  return (
    <div className="fi">
      {/* Topbar — title + date nav (tap label = today) */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 11 }}>
        <span style={{ fontFamily: "Oswald", fontWeight: 700, fontSize: 21, letterSpacing: ".5px", textTransform: "uppercase" }}>{t("sched.title")}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: "Oswald", fontWeight: 600, fontSize: 15 }}>
          <button onClick={() => stepView(-1)} aria-label={t("sched.previous")} style={{ width: 26, height: 26, borderRadius: 8, background: "var(--color-card-dark-2)", border: "1px solid var(--color-border-dark-2)", color: "var(--color-dim)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}><Icon name="back" size={14} /></button>
          <span onClick={goToday} title={t("sched.jumpToToday")} style={{ cursor: "pointer", minWidth: 96, textAlign: "center" }}>{periodLabel}</span>
          <button onClick={() => stepView(1)} aria-label={t("sched.next")} style={{ width: 26, height: 26, borderRadius: 8, background: "var(--color-card-dark-2)", border: "1px solid var(--color-border-dark-2)", color: "var(--color-dim)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}><Icon name="next" size={14} /></button>
        </div>
      </div>

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

      {/* Quick-Schedule Modal — opens from a job's "Assign" button. Centered
          via a flex container so it's reliable on mobile regardless of any
          ancestor transform. */}
      {armedJob && dropTarget && (
        <div
          onClick={() => { setArmedJob(null); setDropTarget(null); setQsTime(""); setQsWorkers([]); setQsNote(""); }}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 199,
            background: "rgba(0,0,0,.5)",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "center",
            padding: "8vh 16px",
            overflowY: "auto",
            WebkitOverflowScrolling: "touch",
          }}
        >
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            zIndex: 200,
            width: "100%",
            maxWidth: 380,
            background: darkMode ? "#12121a" : "#fff",
            border: `1px solid ${darkMode ? "#1e1e2e" : "#ddd"}`,
            borderRadius: 12, padding: 18, boxShadow: "0 8px 32px rgba(0,0,0,.5)",
          }}
        >
          <h4 style={{ fontSize: 16, color: "var(--color-primary)", marginBottom: 6 }}>{editSched ? t("sched.editMoveJob") : t("sched.scheduleJob")}</h4>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>{armedJob}</div>
          <div style={{ marginBottom: 10 }}>
            <label className="sl" style={{ fontSize: 13 }}>{t("sched.day")}</label>
            <input
              type="date"
              value={dropTarget || ""}
              onChange={(e) => setDropTarget(e.target.value)}
              style={{ marginTop: 4, color: "var(--color-primary)", fontWeight: 600 }}
            />
          </div>
          <div style={{ marginBottom: 10 }}>
            <label className="sl" style={{ fontSize: 13 }}>
              {t("sched.endDay")} <span className="dim" style={{ textTransform: "none", letterSpacing: 0, fontWeight: 400 }}>· {t("sched.endDayOptional")}</span>
            </label>
            <input
              type="date"
              value={endTarget || ""}
              min={dropTarget || undefined}
              onChange={(e) => setEndTarget(e.target.value || null)}
              style={{ marginTop: 4, color: "var(--color-primary)", fontWeight: 600 }}
            />
          </div>
          {suggestion && suggestion.date !== dropTarget && (
            <div
              onClick={() => setDropTarget(suggestion.date)}
              style={{ display: "flex", alignItems: "center", gap: 7, background: "rgba(157,78,221,.1)", border: "1px solid rgba(157,78,221,.35)", borderRadius: 10, padding: "7px 10px", marginBottom: 10, fontSize: 12.5, color: "#c9a6ff", cursor: "pointer" }}
            >
              <Icon name="sparkle" size={14} color="#c9a6ff" /> {t("sched.nearbyUse")} {new Date(suggestion.date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
            </div>
          )}
          <div style={{ marginBottom: 10 }}>
            <label className="sl" style={{ fontSize: 13 }}>{t("sched.time")}</label>
            <input
              type="time"
              value={qsTime}
              onChange={(e) => setQsTime(e.target.value)}
              style={{ marginTop: 4, color: "var(--color-primary)", fontWeight: 600 }}
            />
          </div>
          <div style={{ marginBottom: 10 }}>
            <label className="sl" style={{ fontSize: 13 }}>{t("sched.workers")}</label>
            <div className="row" style={{ marginTop: 4 }}>
              {profiles.map((p) => {
                const sel = qsWorkers.includes(p.name);
                return (
                  <button
                    key={p.id}
                    onClick={() => setQsWorkers((prev) => sel ? prev.filter((n) => n !== p.name) : [...prev, p.name])}
                    style={{
                      padding: "3px 10px", borderRadius: 16, fontSize: 14,
                      background: sel ? "var(--color-primary)" + "33" : "transparent",
                      color: sel ? "var(--color-primary)" : "#888",
                      border: `1px solid ${sel ? "var(--color-primary)" : darkMode ? "#1e1e2e" : "#ddd"}`,
                    }}
                  >
                    {p.name}
                  </button>
                );
              })}
            </div>
          </div>
          <div style={{ marginBottom: 14 }}>
            <label className="sl" style={{ fontSize: 13 }}>{t("sched.notes")}</label>
            <input
              value={qsNote}
              onChange={(e) => setQsNote(e.target.value)}
              placeholder={t("sched.optional")}
              style={{ marginTop: 4 }}
            />
          </div>
          <div className="row" style={{ gap: 8 }}>
            {editSched && (
              <button onClick={deleteSched} className="br" style={{ flex: 1, fontSize: 14 }}>
                {t("sched.unschedule")}
              </button>
            )}
            <button
              onClick={() => { setArmedJob(null); setDropTarget(null); setQsTime(""); setQsWorkers([]); setQsNote(""); }}
              className="bo"
              style={{ flex: 1, fontSize: 14 }}
            >
              {t("common.cancel")}
            </button>
            <button onClick={quickAdd} className="bg" style={{ flex: 2, fontSize: 15 }}>
              {editSched ? t("sched.saveChanges") : t("sched.scheduleAction")}
            </button>
          </div>
        </div>
        </div>
      )}

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
        const scheduledProps = new Set(schedule.map((s) => s.job));
        const unscheduled = jobs.filter((j) => !j.archived && (j.status === "accepted" || j.status === "quoted") && !scheduledProps.has(j.property));
        return (
          <div className="mb">
            {dayEntries.length === 0 && (
              <div className="cd" style={{ textAlign: "center", padding: 20, marginBottom: 8 }}><p className="dim" style={{ fontSize: 14 }}>{t("sched.noJobsThisDay")}</p></div>
            )}
            {dayEntries.map((s) => {
              const j = jobFor(s.job);
              const color = j ? statusColor(j.status) : "var(--color-primary)";
              const time = parseTime(s.note);
              const crew = entryWorkers(s);
              const meta = j ? `${j.trade || t("sched.job")} · ${(j.total_hrs || 0).toFixed(1)}h` : (s.note?.replace(/🕐\s*\d{1,2}:\d{2}\s*·?\s*/, "").replace(/👷\s*[^·]+·?\s*/, "").trim() || t("sched.scheduled"));
              return (
                <div key={s.id} style={{ display: "flex", gap: 9, marginBottom: 8 }}>
                  <div style={{ width: 44, flexShrink: 0, fontSize: 12, color: "var(--color-dim)", fontFamily: "Oswald", fontWeight: 600, paddingTop: 11, textAlign: "right" }}>{time ? fmt12(time) : "—"}</div>
                  <div onClick={() => setSelectedDay(s.sched_date)} style={{ flex: 1, position: "relative", overflow: "hidden", background: darkMode ? "#16161f" : "#fff", border: "1px solid var(--color-border-dark)", borderRadius: 13, padding: "10px 11px 10px 15px", cursor: "pointer" }}>
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
                  <button onClick={() => { setArmedJob(j.property); setDropTarget(ds); }} style={{ fontSize: 12.5, fontWeight: 600, color: "#fff", background: "var(--color-primary)", borderRadius: 8, padding: "6px 10px", border: "none", display: "flex", alignItems: "center", gap: 5, cursor: "pointer", flexShrink: 0 }}>
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
            const totalHrs = dayEntries.reduce((sum, e) => sum + (jobFor(e.job)?.total_hrs || 0), 0);
            return (
              <div key={i} onClick={() => setSelectedDay(ds)} style={{ background: darkMode ? "#16161f" : "#fff", border: `1px solid ${isToday ? "rgba(46,139,255,.5)" : "var(--color-border-dark)"}`, boxShadow: isToday ? "0 0 0 1px rgba(46,139,255,.2)" : "none", borderRadius: 13, padding: "10px 11px", marginBottom: 8, opacity: dayEntries.length ? 1 : 0.5, cursor: "pointer" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: dayEntries.length ? 7 : 0 }}>
                  <div style={{ fontFamily: "Oswald", fontWeight: 600, fontSize: 15 }}>{DAY_NAMES[d.getDay()]}<span style={{ color: "var(--color-dim)", fontWeight: 400, fontSize: 13, marginLeft: 5 }}>{MONTH_NAMES[d.getMonth()].slice(0, 3)} {d.getDate()}</span></div>
                  {dayEntries.length > 0 && <div style={{ fontSize: 11.5, color: "var(--color-dim)" }}>{dayEntries.length} {dayEntries.length !== 1 ? t("sched.jobsPlural") : t("sched.jobSingular")}{totalHrs ? ` · ${totalHrs.toFixed(1)}h` : ""}</div>}
                </div>
                {dayEntries.length === 0 ? (
                  <div style={{ fontSize: 12.5, color: "var(--color-dim)" }}>{t("sched.noJobsShort")}</div>
                ) : dayEntries.map((s) => {
                  const j = jobFor(s.job);
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
              const dots = dayEntries.slice(0, 4).map((s) => { const j = jobFor(s.job); return j ? statusColor(j.status) : "var(--color-primary)"; });
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
        const scheduledProps = new Set(schedule.map((s) => s.job));
        const needScheduling = jobs.filter((j) => !j.archived && (j.status === "accepted" || j.status === "quoted") && !scheduledProps.has(j.property));
        const weekDates = week.map((d) => ymd(d));
        const weekStart = weekDates[0];
        const weekEnd = weekDates[weekDates.length - 1];
        const weekEntries = schedule.filter((s) => (s.end_date || s.sched_date) >= weekStart && s.sched_date <= weekEnd);
        return (
          <div className="mb">
            {/* Needs scheduling — pool of unassigned jobs */}
            <div style={{ fontSize: 12.5, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--color-dim)", fontWeight: 600, margin: "2px 2px 8px", display: "flex", alignItems: "center", gap: 7 }}>
              <Icon name="folder" size={13} color="var(--color-dim)" /> {t("sched.needsScheduling")} ({needScheduling.length})
            </div>
            {needScheduling.length === 0 ? (
              <div className="cd" style={{ textAlign: "center", padding: 14, marginBottom: 10 }}><p className="dim" style={{ fontSize: 13 }}>{t("sched.everythingAssigned")} ✓</p></div>
            ) : needScheduling.map((j) => (
              <div key={j.id} style={{ display: "flex", alignItems: "center", gap: 10, background: darkMode ? "#16161f" : "#fff", border: "1px dashed var(--color-border-dark)", borderRadius: 12, padding: "9px 11px 9px 14px", position: "relative", overflow: "hidden", marginBottom: 6 }}>
                <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 4, background: statusColor(j.status), boxShadow: darkMode ? `0 0 10px ${statusColor(j.status)}, 0 0 20px -2px ${statusColor(j.status)}` : "none" }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: "Oswald", fontWeight: 600, fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{j.property}</div>
                  <div style={{ fontSize: 11.5, color: "var(--color-dim)" }}>{j.trade || t("sched.job")} · {(j.total_hrs || 0).toFixed(1)}h · {j.status}</div>
                </div>
                <button onClick={() => { setArmedJob(j.property); setDropTarget(todayStr); }} style={{ fontSize: 12.5, fontWeight: 600, color: "#fff", background: "var(--color-primary)", borderRadius: 8, padding: "6px 12px", border: "none", display: "flex", alignItems: "center", gap: 5, cursor: "pointer", flexShrink: 0 }}>
                  <Icon name="schedule" size={12} color="#fff" /> {t("sched.assign")}
                </button>
              </div>
            ))}

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
                    const j = jobFor(s.job);
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
          const dayItems = schedule.filter((s) => spansDay(s, selectedDay));
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
                  const linkedJob = jobs
                    .filter((j) => j.property === s.job && !j.archived)
                    .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))[0];
                  return (
                    <div key={s.id} className="sep" style={{ fontSize: 14, padding: "8px 0" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: linkedJob ? 6 : 0, gap: 6 }}>
                        <div style={{ minWidth: 0 }}>
                          <b
                            onClick={() => window.open(`https://www.google.com/maps/search/${encodeURIComponent(s.job)}`, "_blank")}
                            style={{ color: "var(--color-primary)", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}
                            title={t("sched.openInMaps")}
                          ><Icon name="mapPin" size={12} color="var(--color-primary)" /> {s.job}</b>
                          {(() => {
                            const time = parseTime(s.note);
                            const crew = parseWorkers(s.note);
                            const freeform = (s.note || "").replace(/🕐\s*\d{1,2}:\d{2}\s*·?\s*/, "").replace(/👷\s*[^·]+·?\s*/, "").trim();
                            const bits = [time ? fmt12(time) : "", crew.join(", "), freeform].filter(Boolean);
                            return bits.length ? <div className="dim" style={{ fontSize: 12 }}>{bits.join(" · ")}</div> : null;
                          })()}
                        </div>
                        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                          <button
                            className="bo"
                            onClick={() => openEdit(s)}
                            style={{ fontSize: 13, padding: "4px 9px", display: "inline-flex", alignItems: "center", gap: 4 }}
                          >
                            <Icon name="edit" size={12} /> {t("common.edit")}
                          </button>
                          <button
                            className="bb"
                            onClick={() => setPage("time")}
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
                  return d >= viewStart.toISOString().split("T")[0] && d <= viewEnd.toISOString().split("T")[0];
                })
                .sort((a, b) => a.sched_date.localeCompare(b.sched_date));

              const rows = monthEntries.map((s) => {
                const d = new Date(s.sched_date + "T12:00:00");
                const dayName = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
                const timeMatch = s.note?.match(/🕐\s*(\d{1,2}:\d{2})/);
                const time = timeMatch ? timeMatch[1] : "—";
                const workers = s.note?.match(/👷\s*(.+?)(?:\s*·|$)/)?.[1] || "—";
                const notes = s.note?.replace(/🕐\s*\d{1,2}:\d{2}\s*·?\s*/g, "").replace(/👷\s*.+?(?:\s*·|$)/g, "").trim() || "";
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
            onClick={() => setPage("time")}
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
