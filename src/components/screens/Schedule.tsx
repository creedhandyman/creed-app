"use client";
import { useState, useEffect } from "react";
import { useStore } from "@/lib/store";
import { db } from "@/lib/supabase";
import { t } from "@/lib/i18n";
import { Icon } from "../Icon";
import { wrapPrint, openPrint } from "@/lib/print-template";
import PropertySearch from "../PropertySearch";
import SmsNotifyButtons from "../SmsNotifyButtons";

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

  const [sd, setSd] = useState("");
  const [sj, setSj] = useState(preSelectJob || "");
  const [sn, setSn] = useState("");
  const [sTime, setSTime] = useState("");
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [sTech, setSTech] = useState("");
  const [sWorkers, setSWorkers] = useState<string[]>([]);
  const [view, setView] = useState<"week" | "month">("week");
  const [suggestion, setSuggestion] = useState<{ date: string; reason: string } | null>(null);
  // Quick-schedule state: a job "armed" from the unscheduled palette, plus
  // the day the user dropped/tapped onto. Drives the modal form.
  const [armedJob, setArmedJob] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [hoverDay, setHoverDay] = useState<string | null>(null);
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
  // "All Scheduled" list collapse state — defaults closed so the page doesn't
  // grow a mile long once dozens of jobs accumulate.
  const [allOpen, setAllOpen] = useState(false);
  const [showPast, setShowPast] = useState(false);

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
          reason: `${entry.job} is nearby — schedule same day to save drive time`,
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
    await db.post("schedule", { sched_date: dropTarget, job: armedJob, note: parts.join(" · ") });
    const matched = jobs.find((j) => j.property === armedJob && (j.status === "quoted" || j.status === "accepted"));
    if (matched) await db.patch("jobs", matched.id, { status: "scheduled" });
    // Persist time + workers so the next drop pre-fills with the same
    // defaults — the common case is scheduling several jobs in a row at
    // the same start time with the same crew.
    try {
      if (typeof window !== "undefined") {
        localStorage.setItem("c_sched_lastTime", qsTime || "");
        localStorage.setItem("c_sched_lastWorkers", JSON.stringify(qsWorkers));
      }
    } catch { /* ignore quota errors */ }
    setArmedJob(null);
    setDropTarget(null);
    // Keep qsTime + qsWorkers as-is; only the note clears so it doesn't
    // get accidentally reused on the next job.
    setQsNote("");
    await loadAll();
    useStore.getState().showToast(t("sched.scheduledToast"), "success");
  };

  const addSchedule = async () => {
    if (!sd) { useStore.getState().showToast("Select a date", "warning"); return; }
    if (!sj) { useStore.getState().showToast("Select a job", "warning"); return; }
    const today = new Date().toISOString().split("T")[0];
    if (sd < today && !await useStore.getState().showConfirm("Past Date", `${sd} is in the past. Schedule anyway?`)) return;
    const parts = [];
    if (sTime) parts.push(`🕐 ${sTime}`);
    if (sWorkers.length) parts.push(`👷 ${sWorkers.join(", ")}`);
    else if (sTech) parts.push(`👷 ${sTech}`);
    if (sn) parts.push(sn);
    await db.post("schedule", { sched_date: sd, job: sj, note: parts.join(" · ") });
    // Auto-update job status to "scheduled" if currently quoted or accepted
    const matchedJob = jobs.find((j) => j.property === sj && (j.status === "quoted" || j.status === "accepted"));
    if (matchedJob) {
      await db.patch("jobs", matchedJob.id, { status: "scheduled" });
    }
    setSd("");
    setSj("");
    setSn("");
    setSTime("");
    setSTech("");
    setSWorkers([]);
    loadAll();
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
      if (view === "week") next.setDate(prev.getDate() + dir * 7);
      else next.setMonth(prev.getMonth() + dir);
      return next;
    });
  };
  const goToday = () => setViewDate(new Date());

  const renderDayCell = (d: Date | null, key: number | string) => {
    if (!d) {
      return (
        <div
          key={key}
          style={{
            background: darkMode ? "#0d0d14" : "#f5f5f5",
            borderRadius: 6,
            padding: 4,
            minHeight: view === "month" ? 50 : 70,
          }}
        />
      );
    }
    const ds = d.toISOString().split("T")[0];
    const items = schedule.filter((s) => s.sched_date === ds);
    const isToday = ds === todayStr;

    const isSelected = ds === selectedDay;
    const isHover = ds === hoverDay;
    const isSuggested = !!armedJob && suggestion?.date === ds;
    // Pull the earliest start-time out of the day's notes for a quick glance
    // at when work begins. Notes look like "🕐 09:30 · 👷 …".
    const firstTime = items.length
      ? items
          .map((it) => it.note?.match(/🕐\s*(\d{1,2}:\d{2})/)?.[1])
          .filter((x): x is string => !!x)
          .sort()[0]
      : undefined;
    return (
      <div
        key={key}
        onClick={() => {
          // If a job is armed (clicked from the palette), tapping a day opens
          // the quick-schedule modal for this day. Otherwise just select it.
          if (armedJob) {
            setDropTarget(ds);
            return;
          }
          setSelectedDay(isSelected ? null : ds);
        }}
        onDragOver={(e) => { e.preventDefault(); if (!isHover) setHoverDay(ds); }}
        onDragLeave={() => setHoverDay((h) => (h === ds ? null : h))}
        onDrop={async (e) => {
          e.preventDefault();
          setHoverDay(null);
          const payload = e.dataTransfer.getData("text/plain");
          if (!payload) return;
          // "move:<id>" = re-arrange an existing schedule entry to this day.
          // Anything else = a job property dragged from the unscheduled palette.
          if (payload.startsWith("move:")) {
            const id = payload.slice(5);
            const entry = schedule.find((s) => s.id === id);
            if (!entry || entry.sched_date === ds) return;
            await db.patch("schedule", id, { sched_date: ds });
            await loadAll();
            useStore.getState().showToast(t("sched.scheduledToast"), "success");
            return;
          }
          setArmedJob(payload);
          setDropTarget(ds);
        }}
        style={{
          background: isHover
            ? "var(--color-success)" + "55"
            : isSuggested
            ? "var(--color-highlight)" + "33"
            : armedJob
            ? "var(--color-success)" + "11"
            : isSelected
            ? "var(--color-primary)" + "33"
            : isToday
            ? "var(--color-primary)" + "22"
            : darkMode
            ? "#12121a"
            : "#fff",
          // When a job is armed, every day cell shows a dashed green outline
          // so it's obvious where to drop/tap. The suggested day gets a solid
          // gold ring to draw the eye. Hovered cell goes solid + bright.
          border: isHover
            ? `2px solid var(--color-success)`
            : isSuggested
            ? `2px solid var(--color-highlight)`
            : armedJob
            ? `1px dashed var(--color-success)`
            : `1px solid ${isSelected ? "var(--color-primary)" : isToday ? "var(--color-primary)" : darkMode ? "#1e1e2e" : "#ddd"}`,
          borderRadius: 6,
          padding: 4,
          minHeight: view === "month" ? 50 : 70,
          overflow: "hidden",
          cursor: armedJob ? "copy" : "pointer",
          transition: "background 0.1s, border-color 0.1s",
          position: "relative",
        }}
      >
        <div
          style={{
            fontSize: view === "month" ? 10 : 12,
            textAlign: "center",
            fontWeight: isToday || isSelected ? 700 : 600,
            color: isToday || isSelected ? "var(--color-primary)" : undefined,
            marginBottom: 2,
          }}
        >
          {d.getDate()}
        </div>
        {items.length > 0 && view === "month" && (
          <div style={{ fontSize: 7, textAlign: "center", color: "var(--color-primary)" }}>
            {items.length} job{items.length !== 1 ? "s" : ""}
          </div>
        )}
        {items.length > 0 && view === "week" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 2 }}>
            {firstTime && (
              <div style={{ fontSize: 9, color: "var(--color-success)", fontFamily: "Oswald", textAlign: "center" }}>
                {firstTime}
              </div>
            )}
            {/* Draggable chips for the first two jobs of the day. Drag to a
                different day cell to reschedule. Long names truncate so the
                chip stays inside the cell on narrow viewports. */}
            {items.slice(0, 2).map((it) => (
              <div
                key={it.id}
                draggable
                onDragStart={(e) => {
                  e.stopPropagation();
                  e.dataTransfer.setData("text/plain", `move:${it.id}`);
                  e.dataTransfer.effectAllowed = "move";
                }}
                onClick={(e) => e.stopPropagation()}
                title={`${it.job}${it.note ? " — " + it.note : ""}`}
                style={{
                  fontSize: 9,
                  padding: "2px 4px",
                  borderRadius: 3,
                  background: "var(--color-primary)" + "22",
                  color: "var(--color-primary)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  cursor: "grab",
                  border: "1px solid var(--color-primary)33",
                }}
              >
                {it.job}
              </div>
            ))}
            {items.length > 2 && (
              <div style={{ fontSize: 8, color: "var(--color-primary)", textAlign: "center" }}>
                +{items.length - 2} more
              </div>
            )}
          </div>
        )}
        {isSuggested && (
          <div
            aria-hidden
            title="Suggested — nearby work"
            style={{
              position: "absolute",
              top: 2,
              right: 2,
              fontSize: 10,
            }}
          >
            ⭐
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="fi">
      <h2 style={{ fontSize: 22, color: "var(--color-primary)", marginBottom: 10, display: "inline-flex", alignItems: "center", gap: 8 }}>
        <Icon name="schedule" size={22} color="var(--color-primary)" />
        {t("sched.title")}
      </h2>

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
                <b>{s.job || "(no address)"}</b>
                {s.note && <span className="dim"> · {s.note.slice(0, 40)}</span>}
              </span>
              <span style={{ fontFamily: "Oswald", color: "var(--color-primary)", fontSize: 11, flexShrink: 0 }}>
                {s.sched_date}
              </span>
            </div>
          )}
          onSelect={(s) => {
            const target = new Date(s.sched_date + "T12:00:00");
            if (!isNaN(target.getTime())) {
              setViewDate(target);
              setSelectedDay(s.sched_date);
            }
          }}
          placeholder="Search scheduled jobs by property…"
        />
      </div>

      {/* ── Quick Schedule: drag or tap-arm a job, then drop/tap a day ── */}
      {(() => {
        // Palette shows accepted (ready to schedule for the first time),
        // scheduled (already on calendar — drop to add another visit), and
        // active (mid-job — drop to add a return visit or follow-up day).
        // Archived jobs are excluded. Sorted accepted → scheduled → active
        // so the newest work is what the user sees first.
        const STATUS_ORDER: Record<string, number> = { accepted: 0, scheduled: 1, active: 2 };
        const palette = jobs
          .filter((j) => !j.archived && (j.status === "accepted" || j.status === "scheduled" || j.status === "active"))
          .sort((a, b) => (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99));
        if (palette.length === 0) return null;
        const acceptedCount = palette.filter((j) => j.status === "accepted").length;
        const scheduledCount = palette.filter((j) => j.status === "scheduled").length;
        const activeCount = palette.filter((j) => j.status === "active").length;
        return (
          <div className="cd mb" style={{ borderLeft: "3px solid var(--color-success)" }}>
            <h4 style={{ fontSize: 13, marginBottom: 6 }}>
              👆 {t("sched.quickSchedule")}
              <span className="dim" style={{ fontSize: 11, fontWeight: 400, marginLeft: 6 }}>
                ({[
                  acceptedCount && `${acceptedCount} accepted`,
                  scheduledCount && `${scheduledCount} scheduled`,
                  activeCount && `${activeCount} active`,
                ].filter(Boolean).join(", ")})
              </span>
              {armedJob && (
                <span style={{ marginLeft: 8, color: "var(--color-success)", fontSize: 11, fontFamily: "Oswald" }}>
                  • {t("sched.armed")}: {armedJob.slice(0, 30)}{armedJob.length > 30 ? "…" : ""}
                </span>
              )}
            </h4>
            <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 4 }}>
              {palette.map((j) => {
                const isArmed = armedJob === j.property;
                const isScheduled = j.status === "scheduled";
                const isActive = j.status === "active";
                // Accepted = solid green (new work, ready to schedule).
                // Scheduled = dashed primary (already on calendar; drop to
                // add another visit).
                // Active = solid highlight/yellow (mid-job; drop to schedule
                // a return or follow-up day).
                const baseColor = isActive
                  ? "var(--color-highlight)"
                  : isScheduled
                  ? "var(--color-primary)"
                  : "var(--color-success)";
                const prefix = isArmed ? "✓ " : isActive ? "⚡ " : isScheduled ? "📅 " : "";
                const tip = isActive
                  ? "In progress — drop on a day to schedule a return visit"
                  : isScheduled
                  ? "Already scheduled — drop on a day to add another visit"
                  : "Accepted — drop on a day to schedule";
                return (
                  <button
                    key={j.id}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/plain", j.property);
                      e.dataTransfer.effectAllowed = "copy";
                      setArmedJob(j.property);
                    }}
                    onDragEnd={() => setHoverDay(null)}
                    onClick={() => setArmedJob(isArmed ? null : j.property)}
                    title={tip}
                    style={{
                      padding: "6px 12px",
                      borderRadius: 16,
                      whiteSpace: "nowrap",
                      background: isArmed ? baseColor : "transparent",
                      color: isArmed ? "#fff" : baseColor,
                      border: `1px ${isScheduled && !isArmed ? "dashed" : "solid"} ${baseColor}`,
                      fontSize: 12,
                      flexShrink: 0,
                      cursor: "grab",
                      opacity: isScheduled && !isArmed ? 0.85 : 1,
                    }}
                  >
                    {prefix}
                    {j.property.length > 28 ? j.property.slice(0, 28) + "…" : j.property}
                  </button>
                );
              })}
            </div>
            {armedJob && (
              <div className="dim" style={{ fontSize: 11, marginTop: 6 }}>
                {t("sched.tapADay")}
                <button
                  onClick={() => setArmedJob(null)}
                  style={{ background: "none", color: "var(--color-accent-red)", fontSize: 11, marginLeft: 6, padding: 0 }}
                >
                  × {t("common.cancel").toLowerCase()}
                </button>
              </div>
            )}
            {armedJob && suggestion && (
              <div
                onClick={() => { setDropTarget(suggestion.date); }}
                title="Drop on the highlighted day"
                style={{
                  marginTop: 6,
                  padding: "5px 10px",
                  borderRadius: 6,
                  background: "var(--color-highlight)" + "1f",
                  border: "1px solid var(--color-highlight)",
                  fontSize: 11,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <span>⭐</span>
                <span>
                  Suggested:{" "}
                  <b>
                    {new Date(suggestion.date + "T12:00:00").toLocaleDateString("en-US", {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                    })}
                  </b>
                  <span className="dim"> — {suggestion.reason}</span>
                </span>
              </div>
            )}
          </div>
        );
      })()}

      {/* Quick-Schedule Modal — opens when a job is dropped or tapped onto a day.
          Uses a flex container so the modal is reliably centered in the viewport
          on mobile (fixed + transform-centered breaks if any ancestor has a
          transform; this layout works regardless). */}
      {armedJob && dropTarget && (
        <div
          onClick={() => { setDropTarget(null); setQsTime(""); setQsWorkers([]); setQsNote(""); }}
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
          <h4 style={{ fontSize: 14, color: "var(--color-primary)", marginBottom: 6 }}>{t("sched.scheduleJob")}</h4>
          <div style={{ fontSize: 12, marginBottom: 12 }}>
            <b>{armedJob}</b>
            <span className="dim"> on </span>
            <b>{new Date(dropTarget + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}</b>
          </div>
          <div style={{ marginBottom: 10 }}>
            <label className="sl" style={{ fontSize: 11 }}>{t("sched.time")}</label>
            <input
              type="time"
              value={qsTime}
              onChange={(e) => setQsTime(e.target.value)}
              style={{ marginTop: 4, color: "var(--color-primary)", fontWeight: 600 }}
            />
          </div>
          <div style={{ marginBottom: 10 }}>
            <label className="sl" style={{ fontSize: 11 }}>{t("sched.workers")}</label>
            <div className="row" style={{ marginTop: 4 }}>
              {profiles.map((p) => {
                const sel = qsWorkers.includes(p.name);
                return (
                  <button
                    key={p.id}
                    onClick={() => setQsWorkers((prev) => sel ? prev.filter((n) => n !== p.name) : [...prev, p.name])}
                    style={{
                      padding: "3px 10px", borderRadius: 16, fontSize: 12,
                      background: sel ? "var(--color-primary)" + "33" : "transparent",
                      color: sel ? "var(--color-primary)" : "#888",
                      border: `1px solid ${sel ? "var(--color-primary)" : darkMode ? "#1e1e2e" : "#ddd"}`,
                    }}
                  >
                    {sel ? "✓ " : ""}{p.name}
                  </button>
                );
              })}
            </div>
          </div>
          <div style={{ marginBottom: 14 }}>
            <label className="sl" style={{ fontSize: 11 }}>{t("sched.notes")}</label>
            <input
              value={qsNote}
              onChange={(e) => setQsNote(e.target.value)}
              placeholder={t("sched.optional")}
              style={{ marginTop: 4 }}
            />
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button
              onClick={() => { setDropTarget(null); setQsTime(""); setQsWorkers([]); setQsNote(""); }}
              className="bo"
              style={{ flex: 1, fontSize: 12 }}
            >
              {t("common.cancel")}
            </button>
            <button onClick={quickAdd} className="bg" style={{ flex: 2, fontSize: 13 }}>
              {t("sched.scheduleAction")}
            </button>
          </div>
        </div>
        </div>
      )}

      {/* Add to Schedule */}
      <div className="cd mb">
        <h4 style={{ fontSize: 13, marginBottom: 8 }}>Add to Schedule</h4>
        <div className="row">
          <input
            type="date"
            value={sd}
            onChange={(e) => setSd(e.target.value)}
            style={{
              width: 140,
              color: "var(--color-accent-red)",
              fontWeight: 600,
            }}
          />
          <select
            value={sj}
            onChange={(e) => { setSj(e.target.value); suggestDay(e.target.value); }}
            style={{ flex: 1 }}
          >
            <option value="">{t("sched.selectJob")}</option>
            {jobs.map((j) => (
              <option key={j.id} value={j.property}>
                {j.property} ({j.status})
              </option>
            ))}
          </select>
          <button
            className="bg"
            onClick={addSchedule}
            style={{ fontSize: 13, padding: "6px 12px" }}
          >
            {t("sched.add")}
          </button>
        </div>
        {/* Time + Notes */}
        <div className="row" style={{ marginTop: 6 }}>
          <input
            type="time"
            value={sTime}
            onChange={(e) => setSTime(e.target.value)}
            style={{ width: 110, color: "var(--color-primary)", fontWeight: 600 }}
          />
          <input
            value={sn}
            onChange={(e) => setSn(e.target.value)}
            placeholder="Notes (optional)"
            style={{ flex: 1 }}
          />
        </div>
        {/* Workers */}
        <div style={{ marginTop: 6 }}>
          <div className="dim" style={{ fontSize: 12, marginBottom: 4 }}>Assign workers:</div>
          <div className="row">
            {profiles.map((p) => {
              const selected = sWorkers.includes(p.name);
              return (
                <button
                  key={p.id}
                  onClick={() => setSWorkers((prev) => selected ? prev.filter((n) => n !== p.name) : [...prev, p.name])}
                  style={{
                    padding: "3px 10px", borderRadius: 16, fontSize: 13,
                    background: selected ? "var(--color-primary)" + "33" : "transparent",
                    color: selected ? "var(--color-primary)" : "#888",
                    border: `1px solid ${selected ? "var(--color-primary)" : darkMode ? "#1e1e2e" : "#ddd"}`,
                  }}
                >
                  {selected ? "✓ " : ""}{p.name}
                </button>
              );
            })}
          </div>
        </div>

        {/* Scheduling suggestion */}
        {suggestion && (
          <div
            onClick={() => { setSd(suggestion.date); setSuggestion(null); }}
            style={{
              marginTop: 6,
              padding: "6px 10px",
              borderRadius: 6,
              background: "var(--color-success)" + "15",
              border: "1px solid var(--color-success)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <Icon name="tip" size={14} color="var(--color-success)" />
            <div>
              <div style={{ fontSize: 13, color: "var(--color-success)", fontWeight: 600 }}>
                Suggested: {suggestion.date}
              </div>
              <div className="dim" style={{ fontSize: 10 }}>{suggestion.reason}</div>
            </div>
            <span style={{ fontSize: 13, color: "var(--color-success)", marginLeft: "auto" }}>Tap to use</span>
          </div>
        )}
      </div>

      {/* View Toggle + period nav */}
      <div className="row mb" style={{ justifyContent: "space-between", alignItems: "center", gap: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <button
            onClick={() => stepView(-1)}
            aria-label={view === "week" ? "Previous week" : "Previous month"}
            title={view === "week" ? "Previous week" : "Previous month"}
            style={{
              padding: "2px 8px",
              fontSize: 14,
              background: darkMode ? "#12121a" : "#fff",
              color: "var(--color-primary)",
              border: `1px solid ${darkMode ? "#1e1e2e" : "#ddd"}`,
              borderRadius: 4,
              lineHeight: 1,
            }}
          >◀</button>
          <span
            className="dim"
            style={{ fontSize: 12, fontFamily: "Oswald", minWidth: 110, textAlign: "center" }}
          >
            {view === "month"
              ? `${MONTH_NAMES[month]} ${year}`
              : `Week of ${MONTH_NAMES[ws.getMonth()]} ${ws.getDate()}`}
          </span>
          <button
            onClick={() => stepView(1)}
            aria-label={view === "week" ? "Next week" : "Next month"}
            title={view === "week" ? "Next week" : "Next month"}
            style={{
              padding: "2px 8px",
              fontSize: 14,
              background: darkMode ? "#12121a" : "#fff",
              color: "var(--color-primary)",
              border: `1px solid ${darkMode ? "#1e1e2e" : "#ddd"}`,
              borderRadius: 4,
              lineHeight: 1,
            }}
          >▶</button>
          <button
            onClick={goToday}
            style={{
              marginLeft: 4,
              padding: "2px 10px",
              fontSize: 11,
              fontFamily: "Oswald",
              background: "transparent",
              color: "var(--color-primary)",
              border: `1px solid var(--color-primary)`,
              borderRadius: 4,
              lineHeight: 1.4,
            }}
          >Today</button>
        </div>
        <div style={{ display: "flex", borderRadius: 6, overflow: "hidden" }}>
          <button
            onClick={() => setView("week")}
            style={{
              padding: "4px 12px",
              fontSize: 12,
              background: view === "week" ? "var(--color-primary)" : darkMode ? "#12121a" : "#fff",
              color: view === "week" ? "#fff" : "#888",
              border: `1px solid ${darkMode ? "#1e1e2e" : "#ddd"}`,
              borderRadius: "6px 0 0 6px",
              fontFamily: "Oswald",
            }}
          >
            Week
          </button>
          <button
            onClick={() => setView("month")}
            style={{
              padding: "4px 12px",
              fontSize: 12,
              background: view === "month" ? "var(--color-primary)" : darkMode ? "#12121a" : "#fff",
              color: view === "month" ? "#fff" : "#888",
              border: `1px solid ${darkMode ? "#1e1e2e" : "#ddd"}`,
              borderRadius: "0 6px 6px 0",
              fontFamily: "Oswald",
            }}
          >
            Month
          </button>
        </div>
      </div>

      {/* Calendar */}
      <div className="cd mb">
        {/* Day headers */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 3, marginBottom: 3 }}>
          {DAY_NAMES.map((d) => (
            <div
              key={d}
              style={{
                fontSize: 13,
                fontFamily: "Oswald",
                color: "#888",
                textAlign: "center",
              }}
            >
              {d}
            </div>
          ))}
        </div>

        {/* Day cells */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 3 }}>
          {view === "week"
            ? week.map((d, i) => renderDayCell(d, i))
            : monthCells.map((d, i) => renderDayCell(d, `m${i}`))}
        </div>

        {/* Day detail panel */}
        {selectedDay && (() => {
          const dayItems = schedule.filter((s) => s.sched_date === selectedDay);
          const dayDate = new Date(selectedDay + "T12:00:00");
          const dayLabel = dayDate.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
          return (
            <div style={{ marginTop: 10, padding: 10, borderTop: `2px solid var(--color-primary)` }}>
              <div className="row" style={{ justifyContent: "space-between", marginBottom: 6 }}>
                <h4 style={{ fontSize: 13, color: "var(--color-primary)" }}>{dayLabel}</h4>
                <span className="dim" style={{ fontSize: 10 }}>{dayItems.length} job{dayItems.length !== 1 ? "s" : ""}</span>
              </div>
              {dayItems.length === 0 ? (
                <p className="dim" style={{ fontSize: 11 }}>{t("sched.noJobs")}</p>
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
                    <div key={s.id} className="sep" style={{ fontSize: 12, padding: "8px 0" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: linkedJob ? 6 : 0, gap: 6 }}>
                        <div>
                          <b
                            onClick={() => window.open(`https://www.google.com/maps/search/${encodeURIComponent(s.job)}`, "_blank")}
                            style={{ color: "var(--color-primary)", cursor: "pointer" }}
                            title="Open in Google Maps"
                          >📍 {s.job}</b>
                          {s.note && <div className="dim" style={{ fontSize: 10 }}>{s.note}</div>}
                        </div>
                        <button
                          className="bb"
                          onClick={() => setPage("time")}
                          style={{ fontSize: 13, padding: "3px 8px" }}
                        >
                          ⏱ Start
                        </button>
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
              const orgName = org?.name || "Service Provider";
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
      <th style="width:120px">Date</th>
      <th style="width:80px">Time</th>
      <th>Job / Property</th>
      <th style="width:140px">Workers</th>
      <th>Notes</th>
    </tr>
  </thead>
  <tbody>${rows || '<tr><td colspan="5" class="dim" style="text-align:center;padding:20px">No jobs scheduled this month</td></tr>'}</tbody>
</table>
<div style="margin-top:14px;font-size:12px;color:#555">
  <b>${monthEntries.length}</b> job${monthEntries.length !== 1 ? "s" : ""} scheduled this month.
</div>`;

              const html = wrapPrint(
                {
                  orgName,
                  orgPhone: org?.phone,
                  orgEmail: org?.email,
                  orgAddress: org?.address,
                  orgLicense: org?.license_num,
                  orgLogo: org?.logo_url,
                  docTitle: "Work Schedule",
                  docDate: today,
                  docSubtitle: monthName,
                },
                body,
              );
              if (!openPrint(html)) {
                useStore.getState().showToast("Allow popups to print schedule", "error");
              }
            }}
            style={{ fontSize: 10 }}
          >
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4, justifyContent: "center" }}>
              <Icon name="print" size={12} />{t("sched.printSchedule")}
            </span>
          </button>
          <button
            className="bb"
            onClick={() => setPage("time")}
            style={{ fontSize: 12, padding: "5px 14px" }}
          >
            ⏱ Start Working →
          </button>
        </div>
      </div>

      {/* All Scheduled — collapsed by default to keep the page short. Inside,
          upcoming and past are split so the next jobs are always at the top
          and old entries don't bury them. */}
      {schedule.length > 0 && (() => {
        const upcoming = schedule
          .filter((s) => s.sched_date >= todayStr)
          .slice()
          .sort((a, b) => a.sched_date.localeCompare(b.sched_date));
        const past = schedule
          .filter((s) => s.sched_date < todayStr)
          .slice()
          .sort((a, b) => b.sched_date.localeCompare(a.sched_date));

        const renderRow = (s: typeof schedule[number], dim = false) => (
          <div
            key={s.id}
            className="sep"
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: 12,
              alignItems: "center",
              opacity: dim ? 0.65 : 1,
            }}
          >
            <span style={{ minWidth: 80 }}>{s.sched_date}</span>
            <span
              onClick={() => window.open(`https://www.google.com/maps/search/${encodeURIComponent(s.job)}`, "_blank")}
              style={{ color: "var(--color-primary)", flex: 1, marginLeft: 8, cursor: "pointer", textDecoration: "underline" }}
              title="Open in Google Maps"
            >
              📍 {s.job}
            </span>
            <span className="dim" style={{ fontSize: 11, marginRight: 8 }}>{s.note}</span>
            <button
              onClick={async () => {
                if (!await useStore.getState().showConfirm("Remove Entry", "Remove from schedule?")) return;
                await db.del("schedule", s.id);
                loadAll();
              }}
              style={{
                background: "none",
                color: "var(--color-accent-red)",
                fontSize: 12,
              }}
            >
              ✕
            </button>
          </div>
        );

        return (
          <div className="cd">
            <button
              onClick={() => setAllOpen((v) => !v)}
              style={{
                background: "none",
                width: "100%",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: 0,
                fontSize: 13,
                fontWeight: 600,
                color: "inherit",
              }}
              aria-expanded={allOpen}
            >
              <span>
                All Scheduled
                <span className="dim" style={{ fontWeight: 400, marginLeft: 6 }}>
                  ({upcoming.length} upcoming{past.length ? `, ${past.length} past` : ""})
                </span>
              </span>
              <span style={{ fontSize: 11, color: "var(--color-primary)" }}>
                {allOpen ? "▲ Hide" : "▼ Show"}
              </span>
            </button>
            {allOpen && (
              <div style={{ marginTop: 8 }}>
                {upcoming.length === 0 ? (
                  <p className="dim" style={{ fontSize: 12 }}>No upcoming entries.</p>
                ) : (
                  upcoming.map((s) => renderRow(s, false))
                )}
                {past.length > 0 && (
                  <>
                    <button
                      onClick={() => setShowPast((v) => !v)}
                      style={{
                        background: "none",
                        marginTop: 8,
                        fontSize: 11,
                        color: "var(--color-primary)",
                        padding: "4px 0",
                      }}
                    >
                      {showPast ? "▲ Hide past" : `▼ Show past (${past.length})`}
                    </button>
                    {showPast && past.map((s) => renderRow(s, true))}
                  </>
                )}
              </div>
            )}
          </div>
        );
      })()}

      <div style={{ textAlign: "center", marginTop: 16 }}>
        <p className="dim" style={{ fontSize: 12 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, justifyContent: "center" }}>
            <Icon name="tip" size={14} color="var(--color-highlight)" />
            Next: Start the Timer on today&apos;s scheduled job
          </span>
        </p>
      </div>
    </div>
  );
}
