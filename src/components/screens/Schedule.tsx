"use client";
import { useState } from "react";
import { useStore } from "@/lib/store";
import { db } from "@/lib/supabase";
import { t } from "@/lib/i18n";

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
    return (
      <div
        key={key}
        onClick={() => setSelectedDay(isSelected ? null : ds)}
        style={{
          background: isSelected
            ? "var(--color-primary)" + "33"
            : isToday
            ? "var(--color-primary)" + "22"
            : darkMode
            ? "#12121a"
            : "#fff",
          border: `1px solid ${isSelected ? "var(--color-primary)" : isToday ? "var(--color-primary)" : darkMode ? "#1e1e2e" : "#ddd"}`,
          borderRadius: 6,
          padding: 4,
          minHeight: view === "month" ? 50 : 70,
          overflow: "hidden",
          cursor: "pointer",
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
      <h2 style={{ fontSize: 22, color: "var(--color-primary)", marginBottom: 14 }}>
        📅 {t("sched.title")}
      </h2>

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
            <span style={{ fontSize: 14 }}>💡</span>
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
              const org = useStore.getState().org;
              const orgName = org?.name || "Service Provider";
              const orgPhone = org?.phone || "";
              const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

              // Get current view range
              const viewStart = new Date(year, month, 1);
              const viewEnd = new Date(year, month + 1, 0);
              const monthName = viewStart.toLocaleDateString("en-US", { month: "long", year: "numeric" });

              // Filter schedule to this month
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
                return `<tr><td style="white-space:nowrap;font-weight:600">${dayName}</td><td>${time}</td><td style="color:#2E75B6">${s.job}</td><td>${workers}</td><td class="dim">${notes}</td></tr>`;
              }).join("");

              const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Schedule — ${monthName}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Oswald:wght@400;600;700&family=Source+Sans+3:wght@400;500;600&display=swap');
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Source Sans 3',sans-serif;color:#1a1a2a;font-size:13px}
.page{max-width:800px;margin:0 auto;padding:32px 40px}
h1{font-family:Oswald;font-size:22px;color:#2E75B6;text-transform:uppercase;letter-spacing:.05em}
.header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px;padding-bottom:12px;border-bottom:3px solid #2E75B6}
table{width:100%;border-collapse:collapse;font-size:13px}
th{font-family:Oswald;text-transform:uppercase;font-size:11px;letter-spacing:.06em;color:#fff;background:#2E75B6;padding:8px;text-align:left}
td{padding:8px;border-bottom:1px solid #e8e8e8;vertical-align:top}
.dim{color:#888}
.footer{border-top:1px solid #ddd;padding-top:8px;text-align:center;font-size:11px;color:#888;margin-top:24px}
@media print{body{padding:0}.page{padding:16px 24px}}
</style></head><body><div class="page">
<div class="header">
  <div><h1>${orgName}</h1><div style="font-size:12px;color:#666;margin-top:4px">${orgPhone}</div></div>
  <div style="text-align:right"><div style="font-family:Oswald;font-size:16px;color:#2E75B6;text-transform:uppercase">Work Schedule</div><div style="font-size:12px;color:#666">${monthName}</div><div style="font-size:12px;color:#666">Printed ${today}</div></div>
</div>
<table>
  <thead><tr><th>Date</th><th>Time</th><th>Job / Property</th><th>Workers</th><th>Notes</th></tr></thead>
  <tbody>${rows || '<tr><td colspan="5" class="dim" style="text-align:center;padding:20px">No jobs scheduled this month</td></tr>'}</tbody>
</table>
<div style="margin-top:16px;font-size:12px;color:#666">${monthEntries.length} job${monthEntries.length !== 1 ? "s" : ""} scheduled</div>
<div class="footer">${orgName}${orgPhone ? " · " + orgPhone : ""}</div>
</div></body></html>`;

              const win = window.open("", "_blank");
              if (!win) { useStore.getState().showToast("Allow popups to print schedule", "error"); return; }
              win.document.write(html);
              win.document.close();
              setTimeout(() => win.print(), 600);
            }}
            style={{ fontSize: 10 }}
          >
            🖨 {t("sched.printSchedule")}
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
          💡 Next: Start the Timer on today&apos;s scheduled job
        </p>
      </div>
    </div>
  );
}
