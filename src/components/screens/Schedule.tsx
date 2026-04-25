"use client";
import { useState } from "react";
import { useStore } from "@/lib/store";
import { db } from "@/lib/supabase";
import { t } from "@/lib/i18n";
import { Icon } from "../Icon";
import { wrapPrint, openPrint } from "@/lib/print-template";

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
  const [qsTime, setQsTime] = useState("");
  const [qsWorkers, setQsWorkers] = useState<string[]>([]);
  const [qsNote, setQsNote] = useState("");

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
    setArmedJob(null);
    setDropTarget(null);
    setQsTime("");
    setQsWorkers([]);
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

  // Week data
  const ws = new Date(now);
  ws.setDate(now.getDate() - now.getDay());
  ws.setHours(0, 0, 0, 0);
  const week = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(ws);
    d.setDate(ws.getDate() + i);
    return d;
  });

  // Month data
  const year = now.getFullYear();
  const month = now.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthCells: (Date | null)[] = [];
  for (let i = 0; i < firstDay; i++) monthCells.push(null);
  for (let d = 1; d <= daysInMonth; d++) monthCells.push(new Date(year, month, d));
  // Pad to fill last row
  while (monthCells.length % 7 !== 0) monthCells.push(null);

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
        onDrop={(e) => {
          e.preventDefault();
          const job = e.dataTransfer.getData("text/plain");
          if (!job) return;
          setArmedJob(job);
          setDropTarget(ds);
          setHoverDay(null);
        }}
        style={{
          background: isHover
            ? "var(--color-success)" + "55"
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
          // so it's obvious where to drop/tap. Hovered cell goes solid + bright.
          border: isHover
            ? `2px solid var(--color-success)`
            : armedJob
            ? `1px dashed var(--color-success)`
            : `1px solid ${isSelected ? "var(--color-primary)" : isToday ? "var(--color-primary)" : darkMode ? "#1e1e2e" : "#ddd"}`,
          borderRadius: 6,
          padding: 4,
          minHeight: view === "month" ? 50 : 70,
          overflow: "hidden",
          cursor: armedJob ? "copy" : "pointer",
          transition: "background 0.1s, border-color 0.1s",
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
        {items.length > 0 && (
          <div style={{ fontSize: view === "month" ? 7 : 9, textAlign: "center", color: "var(--color-primary)" }}>
            {items.length} job{items.length !== 1 ? "s" : ""}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="fi">
      <h2 style={{ fontSize: 22, color: "var(--color-primary)", marginBottom: 14, display: "inline-flex", alignItems: "center", gap: 8 }}>
        <Icon name="schedule" size={22} color="var(--color-primary)" />
        {t("sched.title")}
      </h2>

      {/* ── Quick Schedule: drag or tap-arm an unscheduled job, then drop/tap a day ── */}
      {(() => {
        // Jobs that could use scheduling: quoted/accepted with no entry on the
        // schedule yet. Include "scheduled" too so re-arranging is easy.
        const futureSched = new Set(schedule.map((s) => s.job));
        const unscheduled = jobs.filter((j) =>
          ["quoted", "accepted", "scheduled"].includes(j.status) &&
          !futureSched.has(j.property)
        );
        if (unscheduled.length === 0) return null;
        return (
          <div className="cd mb" style={{ borderLeft: "3px solid var(--color-success)" }}>
            <h4 style={{ fontSize: 13, marginBottom: 6 }}>
              👆 {t("sched.quickSchedule")}
              {armedJob && (
                <span style={{ marginLeft: 8, color: "var(--color-success)", fontSize: 11, fontFamily: "Oswald" }}>
                  • {t("sched.armed")}: {armedJob.slice(0, 30)}{armedJob.length > 30 ? "…" : ""}
                </span>
              )}
            </h4>
            <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 4 }}>
              {unscheduled.map((j) => {
                const isArmed = armedJob === j.property;
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
                    style={{
                      padding: "6px 12px",
                      borderRadius: 16,
                      whiteSpace: "nowrap",
                      background: isArmed ? "var(--color-success)" : "transparent",
                      color: isArmed ? "#fff" : "var(--color-primary)",
                      border: `1px solid ${isArmed ? "var(--color-success)" : "var(--color-primary)"}`,
                      fontSize: 12,
                      flexShrink: 0,
                      cursor: "grab",
                    }}
                  >
                    {isArmed && "✓ "}{j.property.length > 28 ? j.property.slice(0, 28) + "…" : j.property}
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

      {/* View Toggle */}
      <div className="row mb" style={{ justifyContent: "space-between" }}>
        <span className="dim" style={{ fontSize: 12, fontFamily: "Oswald" }}>
          {view === "month"
            ? `${MONTH_NAMES[month]} ${year}`
            : `Week of ${MONTH_NAMES[ws.getMonth()]} ${ws.getDate()}`}
        </span>
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
                dayItems.map((s) => (
                  <div key={s.id} className="sep" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12 }}>
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
                ))
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

      {/* All Scheduled */}
      {schedule.length > 0 && (
        <div className="cd">
          <h4 style={{ fontSize: 13, marginBottom: 6 }}>All Scheduled</h4>
          {schedule.map((s) => (
            <div
              key={s.id}
              className="sep"
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 12,
                alignItems: "center",
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
              <span className="dim">{s.note}</span>
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
                  marginLeft: 8,
                }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

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
