"use client";
import { useState, useEffect } from "react";
import { useStore } from "@/lib/store";
import { db } from "@/lib/supabase";

interface Props {
  setPage?: (p: string) => void;
}

function ld<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const v = localStorage.getItem("c_" + key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}
function sv(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  localStorage.setItem("c_" + key, JSON.stringify(value));
}

function fmt(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 3600).toString().padStart(2, "0")}:${Math.floor((s % 3600) / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;
}

export default function Timer({ setPage }: Props) {
  const user = useStore((s) => s.user)!;
  const profiles = useStore((s) => s.profiles);
  const jobs = useStore((s) => s.jobs);
  const schedule = useStore((s) => s.schedule);
  const timeEntries = useStore((s) => s.timeEntries);
  const loadAll = useStore((s) => s.loadAll);
  const darkMode = useStore((s) => s.darkMode);
  const isOwner = user.role === "owner" || user.role === "manager";

  const [on, setOn] = useState(() => ld("t_on", false));
  const [st, setSt] = useState(() => ld<number | null>("t_st", null));
  const [sj, setSj] = useState(() => ld("t_sj", ""));
  const [el, setEl] = useState(0);

  const [mh, setMh] = useState("");
  const [mj, setMj] = useState("");
  const [mUser, setMUser] = useState(user.id);
  const [mDate, setMDate] = useState(new Date().toISOString().split("T")[0]);

  const rate = user.rate || 55;

  // Persist timer state
  useEffect(() => sv("t_on", on), [on]);
  useEffect(() => sv("t_st", st), [st]);
  useEffect(() => sv("t_sj", sj), [sj]);

  // Tick
  useEffect(() => {
    if (!on || !st) return;
    setEl(Date.now() - st);
    const iv = setInterval(() => setEl(Date.now() - st), 1000);
    return () => clearInterval(iv);
  }, [on, st]);

  const start = () => {
    setSt(Date.now());
    setOn(true);
  };

  const fmtTime = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  const stop = async () => {
    const hrs = Math.round(el / 3600000 * 100) / 100;
    if (hrs >= 0.01) {
      await db.post("time_entries", {
        job: sj || "General",
        entry_date: new Date().toLocaleDateString(),
        hours: hrs,
        amount: Math.round(hrs * rate * 100) / 100,
        user_id: user.id,
        user_name: user.name,
        start_time: st ? fmtTime(st) : "",
        end_time: fmtTime(Date.now()),
      });
      await loadAll();
    }
    setOn(false);
    setSt(null);
    setEl(0);
  };

  const addManual = async () => {
    const h = parseFloat(mh);
    if (!h) return;
    const targetUser = profiles.find((p) => p.id === mUser) || user;
    const targetRate = targetUser.rate || 55;
    await db.post("time_entries", {
      job: mj || "General",
      entry_date: mDate,
      hours: h,
      amount: Math.round(h * targetRate * 100) / 100,
      user_id: targetUser.id,
      user_name: targetUser.name,
    });
    setMh("");
    setMj("");
    loadAll();
  };

  // Today's scheduled jobs
  const today = new Date().toISOString().split("T")[0];
  const todayJobs = schedule.filter((s) => s.sched_date === today);

  // My time entries
  const myTime = timeEntries.filter(
    (e) => e.user_id === user.id || (!e.user_id && e.user_name === user.name)
  );

  return (
    <div className="fi">
      <h2 style={{ fontSize: 22, color: "var(--color-primary)", marginBottom: 14 }}>
        ⏱ Timer
      </h2>

      {/* Today's Jobs */}
      {todayJobs.length > 0 && (
        <div className="cd mb">
          <h4 style={{ fontSize: 12, marginBottom: 6 }}>📅 Today&apos;s Jobs</h4>
          <div className="row">
            {todayJobs.map((s) => (
              <button
                key={s.id}
                onClick={() => setSj(s.job)}
                className={sj === s.job ? "bb" : "bo"}
                style={{ fontSize: 11, padding: "5px 12px" }}
              >
                {s.job}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Timer Display */}
      <div className="cd mb" style={{ textAlign: "center", padding: 20 }}>
        <div
          style={{
            fontSize: 48,
            fontFamily: "Oswald",
            fontWeight: 700,
            color: on ? "var(--color-success)" : darkMode ? "#555" : "#ccc",
          }}
        >
          {fmt(el)}
        </div>
        <select
          value={sj}
          onChange={(e) => setSj(e.target.value)}
          style={{ maxWidth: 300, margin: "10px auto", display: "block" }}
        >
          <option value="">General</option>
          {jobs.map((j) => (
            <option key={j.id} value={j.property}>
              {j.property}
            </option>
          ))}
        </select>
        {!on ? (
          <button
            className="bb"
            onClick={start}
            style={{ fontSize: 16, padding: "10px 36px" }}
          >
            ▶ Start
          </button>
        ) : (
          <button
            className="br"
            onClick={stop}
            style={{ fontSize: 16, padding: "10px 36px" }}
          >
            ⏹ Stop & Log
          </button>
        )}
        {on && (
          <div style={{ marginTop: 6, fontSize: 11, color: "var(--color-success)" }}>
            Running — persists across pages
          </div>
        )}
      </div>

      {/* Manual Entry */}
      <div className="cd mb">
        <h4 style={{ fontSize: 13, marginBottom: 6 }}>
          {isOwner ? "Log Time" : "Manual Entry"}
        </h4>
        {isOwner && (
          <div className="row" style={{ marginBottom: 6 }}>
            <span className="dim" style={{ fontSize: 11 }}>For:</span>
            <select
              value={mUser}
              onChange={(e) => setMUser(e.target.value)}
              style={{ flex: 1 }}
            >
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} (${p.rate}/hr)
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="row" style={{ marginBottom: 6 }}>
          <input
            type="date"
            value={mDate}
            onChange={(e) => setMDate(e.target.value)}
            style={{ width: 140, color: "var(--color-accent-red)", fontWeight: 600 }}
          />
          <select
            value={mj}
            onChange={(e) => setMj(e.target.value)}
            style={{ flex: 1 }}
          >
            <option value="">General</option>
            {jobs.map((j) => (
              <option key={j.id} value={j.property}>
                {j.property}
              </option>
            ))}
          </select>
        </div>
        <div className="row">
          <input
            type="number"
            value={mh}
            onChange={(e) => setMh(e.target.value)}
            placeholder="Hrs"
            step=".25"
            style={{ width: 70 }}
          />
          <button
            className="bg"
            onClick={addManual}
            style={{ fontSize: 11, padding: "7px 12px" }}
          >
            Log
          </button>
        </div>
      </div>

      {/* My Log */}
      <div className="cd">
        <h4 style={{ fontSize: 13, marginBottom: 6 }}>My Log ({myTime.length})</h4>
        {!myTime.length ? (
          <p className="dim" style={{ fontSize: 12 }}>No entries</p>
        ) : (
          myTime.map((e) => (
            <div
              key={e.id}
              className="sep"
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 12,
                alignItems: "center",
                gap: 4,
              }}
            >
              <span style={{ minWidth: 65 }}>{e.entry_date}</span>
              <span style={{ color: "var(--color-primary)", flex: 1 }}>
                {e.job}
                {(e.start_time || e.end_time) && (
                  <span className="dim" style={{ fontSize: 10, marginLeft: 4 }}>
                    {e.start_time || "?"} – {e.end_time || "?"}
                  </span>
                )}
              </span>
              <input
                type="number"
                defaultValue={e.hours}
                step=".25"
                min="0"
                style={{ width: 45, textAlign: "center", padding: "2px", fontSize: 11 }}
                onBlur={async (ev) => {
                  const newHrs = parseFloat(ev.target.value) || 0;
                  await db.patch("time_entries", e.id, {
                    hours: newHrs,
                    amount: Math.round(newHrs * rate * 100) / 100,
                  });
                  loadAll();
                }}
              />
              <span style={{ color: "var(--color-success)", minWidth: 45 }}>
                ${(e.amount || 0).toFixed(2)}
              </span>
              <button
                onClick={async () => {
                  await db.del("time_entries", e.id);
                  loadAll();
                }}
                style={{ background: "none", color: "var(--color-accent-red)", fontSize: 12 }}
              >
                ✕
              </button>
            </div>
          ))
        )}
      </div>

      <div style={{ textAlign: "center", marginTop: 16 }}>
        <p className="dim" style={{ fontSize: 12 }}>
          💡 Next: Review hours in Payroll
        </p>
      </div>
    </div>
  );
}
