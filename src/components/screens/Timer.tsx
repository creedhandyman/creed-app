"use client";
import { useState, useEffect } from "react";
import { useStore } from "@/lib/store";
import { db } from "@/lib/supabase";
import { t } from "@/lib/i18n";

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
  const [expandedCrew, setExpandedCrew] = useState<string | null>(null);

  const rate = user.rate || 55;

  // Persist timer state
  useEffect(() => sv("t_on", on), [on]);
  useEffect(() => sv("t_st", st), [st]);
  useEffect(() => sv("t_sj", sj), [sj]);

  // Tick + auto-stop after 12 hours
  const MAX_TIMER_MS = 12 * 60 * 60 * 1000; // 12 hours
  useEffect(() => {
    if (!on || !st) return;
    const elapsed = Date.now() - st;
    if (elapsed >= MAX_TIMER_MS) {
      // Auto-stop: log 12 hours and reset
      useStore.getState().showToast("Timer auto-stopped after 12 hours. The time has been logged.", "info");
      (async () => {
        await db.post("time_entries", {
          job: sj || "General",
          entry_date: new Date().toLocaleDateString(),
          hours: 12,
          amount: Math.round(12 * rate * 100) / 100,
          user_id: user.id,
          user_name: user.name,
          start_time: fmtTime(st),
          end_time: fmtTime(Date.now()),
        });
        await loadAll();
      })();
      setOn(false);
      setSt(null);
      setEl(0);
      return;
    }
    setEl(elapsed);
    const iv = setInterval(() => {
      const now = Date.now() - st;
      if (now >= MAX_TIMER_MS) {
        clearInterval(iv);
      }
      setEl(now);
    }, 1000);
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
    if (!h || h <= 0) { useStore.getState().showToast("Enter a valid number of hours", "warning"); return; }
    if (h > 24) { useStore.getState().showToast("Cannot log more than 24 hours in a single entry", "warning"); return; }
    if (!mDate) { useStore.getState().showToast("Select a date", "warning"); return; }
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
        ⏱ {t("timer.title")}
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
                style={{ fontSize: 13, padding: "5px 12px" }}
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
          <option value="">{t("timer.general")}</option>
          {jobs.map((j) => (
            <option key={j.id} value={j.property}>
              {j.property} ({j.status})
            </option>
          ))}
        </select>
        {!on ? (
          <button
            className="bb"
            onClick={start}
            style={{ fontSize: 16, padding: "10px 36px" }}
          >
            ▶ {t("timer.start")}
          </button>
        ) : (
          <button
            className="br"
            onClick={stop}
            style={{ fontSize: 16, padding: "10px 36px" }}
          >
            ⏹ {t("timer.stop")}
          </button>
        )}
        {on && (
          <div style={{ marginTop: 6, fontSize: 13, color: "var(--color-success)" }}>
            Running — persists across pages
          </div>
        )}
      </div>

      {/* Manual Entry — admin only */}
      {isOwner && (
        <div className="cd mb">
          <h4 style={{ fontSize: 13, marginBottom: 6 }}>{t("timer.log")}</h4>
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
              <option value="">{t("timer.general")}</option>
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
              style={{ fontSize: 13, padding: "7px 12px" }}
            >
              {t("timer.log")}
            </button>
          </div>
        </div>
      )}

      {/* My Log */}
      <div className="cd">
        <h4 style={{ fontSize: 13, marginBottom: 6 }}>{t("timer.myLog")} ({myTime.length})</h4>
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
                  <span className="dim" style={{ fontSize: 12, marginLeft: 4 }}>
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
                  // Only allow editing entries owned by current user (defense-in-depth
                  // against legacy rows without user_id but matching user_name).
                  if (e.user_id && e.user_id !== user.id && !isOwner) return;
                  const newHrs = parseFloat(ev.target.value) || 0;
                  if (newHrs === e.hours) return;
                  // Use the entry-owner's rate, not the logged-in user's rate.
                  const owner = profiles.find((p) => p.id === e.user_id);
                  const ownerRate = owner?.rate || user.rate || 55;
                  await db.patch("time_entries", e.id, {
                    hours: newHrs,
                    amount: Math.round(newHrs * ownerRate * 100) / 100,
                  });
                  await loadAll();
                }}
              />
              <span style={{ color: "var(--color-success)", minWidth: 45 }}>
                ${(e.amount || 0).toFixed(2)}
              </span>
              <button
                onClick={async () => {
                  if (e.user_id && e.user_id !== user.id && !isOwner) return;
                  if (!await useStore.getState().showConfirm("Delete Entry", "Delete this time entry?")) return;
                  await db.del("time_entries", e.id);
                  await loadAll();
                }}
                style={{ background: "none", color: "var(--color-accent-red)", fontSize: 12 }}
              >
                ✕
              </button>
            </div>
          ))
        )}
      </div>

      {/* Crew Activity — owners/managers only */}
      {isOwner && profiles.length > 1 && (
        <div className="cd" style={{ marginTop: 14 }}>
          <h4 style={{ fontSize: 13, marginBottom: 8, color: "var(--color-primary)" }}>👷 {t("timer.crewActivity")}</h4>
          {(() => {
            const todayStr = new Date().toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" });
            const todayISO = new Date().toISOString().split("T")[0];
            // Week totals
            const weekStart = new Date();
            weekStart.setDate(weekStart.getDate() - weekStart.getDay());
            weekStart.setHours(0, 0, 0, 0);

            return profiles.map((p) => {
              const allEntries = timeEntries.filter((e) => e.user_id === p.id || e.user_name === p.name);
              const todayEntries = allEntries.filter((e) =>
                e.entry_date === todayStr || e.entry_date === todayISO || e.entry_date === todayStr.replace(/^0/, "")
              );
              const weekEntries = allEntries.filter((e) => {
                try {
                  const parts = e.entry_date?.split("/");
                  if (parts?.length === 3) return new Date(parseInt(parts[2]), parseInt(parts[0]) - 1, parseInt(parts[1])) >= weekStart;
                  return new Date(e.entry_date) >= weekStart;
                } catch { return false; }
              });
              const todayHrs = todayEntries.reduce((s, e) => s + (e.hours || 0), 0);
              const weekHrs = weekEntries.reduce((s, e) => s + (e.hours || 0), 0);
              const todayPay = todayHrs * (p.rate || 55);
              const weekPay = weekHrs * (p.rate || 55);
              const lastEntry = todayEntries[0];
              // Jobs worked today
              const todayJobs = [...new Set(todayEntries.map((e) => e.job).filter(Boolean))];

              const isExpanded = expandedCrew === p.id;
              const rRate = p.rate || 55;
              return (
                <div key={p.id} style={{ padding: "8px 0", borderBottom: `1px solid ${darkMode ? "#1e1e2e" : "#eee"}` }}>
                  <div
                    style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}
                    onClick={() => setExpandedCrew(isExpanded ? null : p.id)}
                  >
                    <div>
                      <span style={{ fontSize: 11, marginRight: 4 }}>{isExpanded ? "▼" : "▶"}</span>
                      <span style={{ fontWeight: 600, fontSize: 14 }}>{p.name}</span>
                      <span className="dim" style={{ marginLeft: 6, fontSize: 12 }}>{p.role} · ${rRate}/hr</span>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      {todayHrs > 0 ? (
                        <span style={{ color: "var(--color-success)", fontFamily: "Oswald", fontSize: 15 }}>{todayHrs.toFixed(1)}h today</span>
                      ) : (
                        <span className="dim" style={{ fontSize: 13 }}>Not clocked in</span>
                      )}
                    </div>
                  </div>
                  {/* Detail row */}
                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, fontSize: 12 }}>
                    <div>
                      {lastEntry && (
                        <span className="dim">
                          Last: {lastEntry.job}{lastEntry.start_time ? ` ${lastEntry.start_time}–${lastEntry.end_time || "now"}` : ""}
                        </span>
                      )}
                      {todayJobs.length > 0 && (
                        <div style={{ color: "var(--color-primary)", fontSize: 12, marginTop: 2 }}>
                          Jobs: {todayJobs.join(", ")}
                        </div>
                      )}
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div className="dim">Today: ${todayPay.toFixed(0)}</div>
                      <div className="dim">Week: {weekHrs.toFixed(1)}h · ${weekPay.toFixed(0)}</div>
                    </div>
                  </div>
                  {isExpanded && (
                    <div style={{ marginTop: 8, padding: 8, background: darkMode ? "#0f0f18" : "#f7f7fa", borderRadius: 6 }}>
                      <div className="dim" style={{ fontSize: 11, marginBottom: 4 }}>
                        All entries ({allEntries.length})
                      </div>
                      {!allEntries.length ? (
                        <p className="dim" style={{ fontSize: 12 }}>No entries</p>
                      ) : (
                        allEntries.map((en) => (
                          <div
                            key={en.id}
                            style={{
                              display: "flex", gap: 4, alignItems: "center",
                              fontSize: 12, padding: "3px 0",
                              borderBottom: `1px solid ${darkMode ? "#1e1e2e" : "#eee"}`,
                            }}
                          >
                            <span style={{ minWidth: 65 }}>{en.entry_date}</span>
                            <span style={{ color: "var(--color-primary)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {en.job}
                              {(en.start_time || en.end_time) && (
                                <span className="dim" style={{ marginLeft: 4 }}>
                                  {en.start_time || "?"}–{en.end_time || "?"}
                                </span>
                              )}
                            </span>
                            <input
                              type="number"
                              defaultValue={en.hours}
                              step=".25"
                              min="0"
                              style={{ width: 45, textAlign: "center", padding: "2px", fontSize: 11 }}
                              onBlur={async (ev) => {
                                const newHrs = parseFloat(ev.target.value) || 0;
                                if (newHrs === en.hours) return;
                                await db.patch("time_entries", en.id, {
                                  hours: newHrs,
                                  amount: Math.round(newHrs * rRate * 100) / 100,
                                });
                                loadAll();
                              }}
                            />
                            <span style={{ color: "var(--color-success)", minWidth: 45 }}>
                              ${(en.amount || 0).toFixed(2)}
                            </span>
                            <button
                              onClick={async () => {
                                if (!await useStore.getState().showConfirm("Delete Entry", `Delete this time entry for ${p.name}?`)) return;
                                await db.del("time_entries", en.id);
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
                  )}
                </div>
              );
            });
          })()}
        </div>
      )}

      <div style={{ textAlign: "center", marginTop: 16 }}>
        <p className="dim" style={{ fontSize: 12 }}>
          💡 Next: Review hours in Payroll
        </p>
      </div>
    </div>
  );
}
