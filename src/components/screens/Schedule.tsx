"use client";
import { useState } from "react";
import { useStore } from "@/lib/store";
import { db } from "@/lib/supabase";

interface Props {
  setPage: (p: string) => void;
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export default function Schedule({ setPage }: Props) {
  const jobs = useStore((s) => s.jobs);
  const schedule = useStore((s) => s.schedule);
  const loadAll = useStore((s) => s.loadAll);
  const darkMode = useStore((s) => s.darkMode);

  const [sd, setSd] = useState("");
  const [sj, setSj] = useState("");
  const [sn, setSn] = useState("");
  const [view, setView] = useState<"week" | "month">("week");

  const addSchedule = async () => {
    if (!sd || !sj) return;
    await db.post("schedule", { sched_date: sd, job: sj, note: sn });
    setSd("");
    setSj("");
    setSn("");
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

    return (
      <div
        key={key}
        style={{
          background: isToday
            ? "var(--color-primary)" + "22"
            : darkMode
            ? "#12121a"
            : "#fff",
          border: `1px solid ${isToday ? "var(--color-primary)" : darkMode ? "#1e1e2e" : "#ddd"}`,
          borderRadius: 6,
          padding: 4,
          minHeight: view === "month" ? 50 : 70,
        }}
      >
        <div
          style={{
            fontSize: view === "month" ? 10 : 12,
            textAlign: "center",
            fontWeight: isToday ? 700 : 600,
            color: isToday ? "var(--color-primary)" : undefined,
            marginBottom: 2,
          }}
        >
          {d.getDate()}
        </div>
        {items.map((s) => (
          <div
            key={s.id}
            onClick={() => setPage("time")}
            style={{
              fontSize: view === "month" ? 7 : 8,
              background: "var(--color-primary)" + "22",
              borderRadius: 2,
              padding: "1px 3px",
              marginBottom: 1,
              color: "var(--color-primary)",
              cursor: "pointer",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {s.job}
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="fi">
      <h2 style={{ fontSize: 22, color: "var(--color-primary)", marginBottom: 14 }}>
        📅 Schedule
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
            onChange={(e) => setSj(e.target.value)}
            style={{ flex: 1 }}
          >
            <option value="">Select job</option>
            {jobs.map((j) => (
              <option key={j.id} value={j.property}>
                {j.property}
              </option>
            ))}
          </select>
          <button
            className="bg"
            onClick={addSchedule}
            style={{ fontSize: 11, padding: "6px 12px" }}
          >
            Add
          </button>
        </div>
        <input
          value={sn}
          onChange={(e) => setSn(e.target.value)}
          placeholder="Notes (optional)"
          style={{ marginTop: 6 }}
        />
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
              fontSize: 10,
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
              fontSize: 10,
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
                fontSize: 9,
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

        <div className="row mt">
          <button
            className="bo"
            onClick={() => window.print()}
            style={{ fontSize: 10 }}
          >
            🖨 Print Schedule
          </button>
          <button
            className="bb"
            onClick={() => setPage("time")}
            style={{ fontSize: 10, padding: "5px 14px" }}
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
              <span style={{ color: "var(--color-primary)", flex: 1, marginLeft: 8 }}>
                {s.job}
              </span>
              <span className="dim">{s.note}</span>
              <button
                onClick={async () => {
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
