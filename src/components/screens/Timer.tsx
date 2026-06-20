"use client";
import { useState, useEffect, useRef } from "react";
import { useStore } from "@/lib/store";
import { db } from "@/lib/supabase";
import { t } from "@/lib/i18n";
import type { Job } from "@/lib/types";
import { Icon } from "../Icon";

// Resolve a job_id from a property/address string when stamping a new
// time_entries row. Disambiguates the case where two jobs share an
// address (e.g. callback work) by preferring active > scheduled >
// accepted > quoted > complete > invoiced > paid, with most-recently-
// created winning ties. Mirrored in WorkVision.tsx — keep in sync.
function resolveActiveJobId(jobs: Job[], address: string): string | undefined {
  if (!address || address === "General") return undefined;
  const matches = jobs.filter((j) => j.property === address);
  if (matches.length === 0) return undefined;
  if (matches.length === 1) return matches[0].id;
  const order = ["active", "scheduled", "accepted", "quoted", "complete", "invoiced", "paid", "lead", "inspection"];
  const sorted = [...matches].sort((a, b) => {
    const oa = order.indexOf(a.status);
    const ob = order.indexOf(b.status);
    if (oa !== ob) return oa - ob;
    return (b.created_at || "").localeCompare(a.created_at || "");
  });
  return sorted[0]?.id;
}

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

// Composite sort key for a time entry. entry_date may be "YYYY-MM-DD" or
// "MM/DD/YYYY"; start_time is "HH:MM AM/PM". Higher = more recent.
function recencyKey(e: { entry_date?: string; start_time?: string }): string {
  const d = e.entry_date || "";
  const isoDate = d.includes("/")
    ? (() => {
        const [m, day, y] = d.split("/");
        return `${y.padStart(4, "20")}-${m.padStart(2, "0")}-${day.padStart(2, "0")}`;
      })()
    : d;
  const t = e.start_time || "";
  const m = t.match(/(\d+):(\d+)\s*([AP]M)?/i);
  let mins = 0;
  if (m) {
    let h = parseInt(m[1]);
    const ampm = m[3]?.toUpperCase();
    if (ampm === "PM" && h !== 12) h += 12;
    if (ampm === "AM" && h === 12) h = 0;
    mins = h * 60 + parseInt(m[2]);
  }
  return `${isoDate}T${mins.toString().padStart(4, "0")}`;
}

const byRecentDesc = (
  a: { entry_date?: string; start_time?: string },
  b: { entry_date?: string; start_time?: string }
) => recencyKey(b).localeCompare(recencyKey(a));

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
  // Server-side active entry so admins can see who is currently clocked in
  // from the Crew Activity tab, not just this browser's localStorage.
  const [activeId, setActiveId] = useState<string | null>(() => ld<string | null>("t_active_id", null));
  const [tab, setTab] = useState<"time" | "crew">("time");

  const [mh, setMh] = useState("");
  const [mj, setMj] = useState("");
  const [mUser, setMUser] = useState(user.id);
  const [mDate, setMDate] = useState(new Date().toISOString().split("T")[0]);
  const [expandedCrew, setExpandedCrew] = useState<string | null>(null);
  const [showManual, setShowManual] = useState(false);
  // Re-render every minute on the Crew tab so live durations tick
  const [tick, setTick] = useState(0);

  const rate = user.rate || 55;

  // Next check (this user) — unpaid hours × rate, matching the dashboard's
  // "next check" so the two screens agree. Bonuses are added at payout.
  const myUnpaid = timeEntries.filter((e) => (e.user_id === user.id || (!e.user_id && e.user_name === user.name)) && !e.paid_at);
  const checkHrs = myUnpaid.reduce((s, e) => s + (e.hours || 0), 0);
  const checkPay = checkHrs * rate;
  const initials = (name: string) => (name || "?").trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase() || "?";

  // Persist timer state
  useEffect(() => sv("t_on", on), [on]);
  useEffect(() => sv("t_st", st), [st]);
  useEffect(() => sv("t_sj", sj), [sj]);
  useEffect(() => sv("t_active_id", activeId), [activeId]);

  // Tick every 30s on Crew tab so "clocked in 1h 12m ago" stays current
  useEffect(() => {
    if (tab !== "crew") return;
    const iv = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(iv);
  }, [tab]);

  const fmtTime = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  // Tick + auto-stop after 12 hours
  const MAX_TIMER_MS = 12 * 60 * 60 * 1000; // 12 hours
  useEffect(() => {
    if (!on || !st) return;
    const elapsed = Date.now() - st;
    if (elapsed >= MAX_TIMER_MS) {
      // Auto-stop: patch the existing active entry with 12 hours.
      useStore.getState().showToast("Timer auto-stopped after 12 hours. The time has been logged.", "info");
      (async () => {
        const hrs = 12;
        const amount = Math.round(hrs * rate * 100) / 100;
        if (activeId) {
          await db.patch("time_entries", activeId, {
            hours: hrs, amount,
            end_time: fmtTime(Date.now()),
          });
        } else {
          await db.post("time_entries", {
            job: sj || "General",
            job_id: resolveActiveJobId(jobs, sj),
            entry_date: new Date().toLocaleDateString(),
            hours: hrs, amount,
            user_id: user.id, user_name: user.name,
            start_time: fmtTime(st),
            end_time: fmtTime(Date.now()),
          });
        }
        setActiveId(null);
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

  // Double-click guard. React state updates (`setOn(true)`) are async,
  // so between the synchronous call and the next render an enthusiastic
  // double-tap can squeeze a second start() through before the first
  // finishes and we end up with TWO active time_entries rows — the user
  // gets billed for double hours until someone notices. A ref updates
  // synchronously so the second call sees it set and bails immediately.
  // Same guard wraps stop() since a stuck-finger double-tap there can
  // try to patch the same row twice or delete an already-deleted row.
  const clockBusyRef = useRef(false);

  // Clock in: create an in-progress time_entries row so admins can see who
  // is currently clocked in from the Crew Activity tab (previously clock-in
  // was local-only until the user clocked out).
  const start = async () => {
    if (clockBusyRef.current || on) return;
    clockBusyRef.current = true;
    try {
    const startedAt = Date.now();
    setSt(startedAt);
    setOn(true);
    const result = await db.post<{ id: string }>("time_entries", {
      job: sj || "General",
      job_id: resolveActiveJobId(jobs, sj),
      entry_date: new Date().toLocaleDateString(),
      hours: 0,
      amount: 0,
      user_id: user.id,
      user_name: user.name,
      start_time: fmtTime(startedAt),
      // end_time intentionally omitted — present of end_time == finished
    });
    if (result && result[0]?.id) {
      setActiveId(result[0].id);
      await loadAll();
    } else {
      // DB insert failed — fall back to local-only timer. stop() will post
      // a regular entry when the user clocks out.
      setActiveId(null);
    }
    // Auto-promote the matching job from "scheduled" to "active" so the
    // workload view reflects what's actually happening on site. Skip if the
    // selected entry is "General" or doesn't match a scheduled job — we
    // don't want to flip "complete" or "paid" backwards.
    if (sj) {
      const matched = jobs.find((j) => j.property === sj && j.status === "scheduled");
      if (matched) await db.patch("jobs", matched.id, { status: "active" });
    }
    // Jump to WorkVision so the crew lands on the work order + photo upload
    // flow for their active job instead of staring at the timer screen.
    setPage?.("workvision");
    } finally {
      clockBusyRef.current = false;
    }
  };

  const stop = async () => {
    if (clockBusyRef.current || !on) return;
    clockBusyRef.current = true;
    try {
    const hrs = Math.round(el / 3600000 * 100) / 100;
    if (hrs >= 0.01) {
      if (activeId) {
        // Close out the existing active row
        await db.patch("time_entries", activeId, {
          hours: hrs,
          amount: Math.round(hrs * rate * 100) / 100,
          end_time: fmtTime(Date.now()),
          job: sj || "General",
        });
      } else {
        await db.post("time_entries", {
          job: sj || "General",
          job_id: resolveActiveJobId(jobs, sj),
          entry_date: new Date().toLocaleDateString(),
          hours: hrs,
          amount: Math.round(hrs * rate * 100) / 100,
          user_id: user.id,
          user_name: user.name,
          start_time: st ? fmtTime(st) : "",
          end_time: fmtTime(Date.now()),
        });
      }
      await loadAll();
    } else if (activeId) {
      // Timer was only running briefly; delete the in-progress row instead
      // of leaving a zero-hour ghost entry.
      await db.del("time_entries", activeId);
      await loadAll();
    }
    setOn(false);
    setSt(null);
    setEl(0);
    setActiveId(null);
    } finally {
      clockBusyRef.current = false;
    }
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
      job_id: resolveActiveJobId(jobs, mj),
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

  // My time entries — exclude the still-open active row (zero hours, no end_time)
  // from the completed log so a user mid-clock doesn't see a ghost entry.
  // Sorted newest-first by entry_date + start_time.
  const myTime = timeEntries
    .filter((e) => e.user_id === user.id || (!e.user_id && e.user_name === user.name))
    .filter((e) => !!e.end_time || (e.hours || 0) > 0)
    .slice()
    .sort(byRecentDesc);

  // Active sessions across the whole crew (end_time unset == still clocked in).
  // Used by Crew Activity tab. Ignore rows older than 24h as stale.
  const activeSessions = timeEntries.filter((e) => {
    if (e.end_time) return false;
    // Only rows that were created as active (have a start_time)
    if (!e.start_time) return false;
    return true;
  });

  // Human-readable elapsed time: "2h 14m" / "45m" / "30s"
  const elapsedFrom = (startTimeStr: string, entryDate: string) => {
    try {
      // start_time is HH:MM AM/PM. Combine with entry_date (MM/DD/YYYY or YYYY-MM-DD).
      let base: Date;
      if (entryDate?.includes("-")) {
        base = new Date(entryDate + "T00:00:00");
      } else if (entryDate?.includes("/")) {
        const [m, d, y] = entryDate.split("/");
        base = new Date(parseInt(y), parseInt(m) - 1, parseInt(d));
      } else {
        base = new Date();
      }
      // Parse "09:30 AM" into hours+mins
      const m = startTimeStr.match(/(\d+):(\d+)\s*([AP]M)?/i);
      if (m) {
        let h = parseInt(m[1]);
        const mm = parseInt(m[2]);
        const ampm = m[3]?.toUpperCase();
        if (ampm === "PM" && h < 12) h += 12;
        if (ampm === "AM" && h === 12) h = 0;
        base.setHours(h, mm, 0, 0);
      }
      const diff = Date.now() - base.getTime();
      if (diff < 0) return "–";
      const mins = Math.floor(diff / 60000);
      if (mins < 1) return "just started";
      if (mins < 60) return `${mins}m`;
      const h = Math.floor(mins / 60);
      const rem = mins % 60;
      return rem ? `${h}h ${rem}m` : `${h}h`;
    } catch { return "–"; }
  };
  // (referenced by render; `tick` re-triggers render every 30s on the crew tab)
  void tick;

  return (
    <div className="fi">
      {/* Topbar — clock + TIME; right shows the date (off) or a live chip (on) */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 11 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Icon name="time" size={19} color="#8cc0ff" />
          <span style={{ fontFamily: "Oswald", fontWeight: 700, fontSize: 20, letterSpacing: ".5px", textTransform: "uppercase" }}>{t("timer.title")}</span>
        </div>
        {on ? (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontFamily: "Oswald", fontWeight: 600, fontSize: 12, color: "#3ee08f", background: "rgba(0,204,102,.12)", border: "1px solid rgba(0,204,102,.4)", padding: "4px 9px", borderRadius: 99 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--color-success)", boxShadow: "0 0 8px var(--color-success)" }} /> {fmt(el)}
          </span>
        ) : (
          <span style={{ fontSize: 10, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--color-dim)", fontWeight: 600 }}>
            {`${new Date().toLocaleDateString("en-US", { weekday: "short" })} · ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })}`}
          </span>
        )}
      </div>

      {/* Tab switcher (Crew tab is admin-only) — segmented icon control */}
      {isOwner && (
        <div style={{ display: "flex", gap: 7, marginBottom: 14 }}>
          {([
            { id: "time" as const, icon: "time" as const, label: t("timer.myTimeTab") },
            { id: "crew" as const, icon: "worker" as const, label: t("timer.crewTab") },
          ]).map((tb) => {
            const tabOn = tab === tb.id;
            return (
              <button
                key={tb.id}
                onClick={() => setTab(tb.id)}
                style={{
                  flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
                  fontSize: 12, fontFamily: "Oswald", letterSpacing: ".04em", padding: "9px", borderRadius: 11,
                  background: tabOn ? "var(--color-primary)" : "var(--color-card-dark-2)",
                  color: tabOn ? "#fff" : "var(--color-dim)",
                  border: `1px solid ${tabOn ? "var(--color-primary)" : "var(--color-border-dark-2)"}`,
                }}
              >
                <Icon name={tb.icon} size={14} color={tabOn ? "#fff" : "var(--color-dim)"} />
                {tb.label}
                {tb.id === "crew" && activeSessions.length > 0 && (
                  <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 8, background: "var(--color-success)", color: "#fff", fontFamily: "Oswald" }}>
                    {activeSessions.length}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {tab === "time" && (<>
      {/* Next check (unpaid × rate) — same number the dashboard shows */}
      <div className="cd mb" style={{ background: "rgba(0,204,102,.08)", border: "1px solid rgba(0,204,102,.32)", borderRadius: 13, padding: "10px 12px" }}>
        <div style={{ fontSize: 9, letterSpacing: ".12em", textTransform: "uppercase", color: "#3ee08f", fontWeight: 600 }}>{t("dash.nextCheck")}</div>
        <div style={{ fontFamily: "Oswald", fontWeight: 700, fontSize: 20, color: "#3ee08f", lineHeight: 1.2 }}>${checkPay.toFixed(0)}</div>
        <div style={{ fontSize: 10, color: "var(--color-dim)" }}>{checkHrs.toFixed(1)} hrs unpaid · ${rate}/hr</div>
      </div>

      {!on ? (<>
        {/* Clock into — today's jobs as chips, plus any other property */}
        <div style={{ fontSize: 10, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--color-dim)", fontWeight: 600, margin: "2px 2px 6px" }}>Today&apos;s jobs · clock into</div>
        <div className="row" style={{ flexWrap: "wrap", gap: 6, marginBottom: 9 }}>
          {[...todayJobs.map((s) => ({ key: s.id, label: s.job, val: s.job })), { key: "general", label: t("timer.general"), val: "" }].map((c) => {
            const cOn = sj === c.val;
            return (
              <button key={c.key} onClick={() => setSj(c.val)} style={{ fontSize: 10.5, padding: "6px 10px", borderRadius: 99, fontWeight: cOn ? 600 : 400, background: cOn ? "rgba(46,139,255,.16)" : "var(--color-card-dark-2)", border: `1px solid ${cOn ? "var(--color-primary)" : "var(--color-border-dark-2)"}`, color: cOn ? "#8cc0ff" : "var(--color-dim)" }}>{c.label}</button>
            );
          })}
        </div>
        <select value={sj} onChange={(e) => setSj(e.target.value)} style={{ width: "100%", marginBottom: 11 }}>
          <option value="">{t("timer.general")}</option>
          {jobs.filter((j) => !j.archived).map((j) => (
            <option key={j.id} value={j.property}>{j.property} ({j.status})</option>
          ))}
        </select>
        {/* CLOCK IN glow CTA — starts the timer and jumps to WorkVision */}
        <div onClick={start} style={{ display: "flex", alignItems: "center", gap: 12, padding: 14, borderRadius: 18, cursor: "pointer", marginBottom: 12, color: "#fff", background: "rgba(255,91,91,.14)", border: "1.5px solid rgba(255,91,91,.8)", boxShadow: "0 0 24px -2px rgba(255,91,91,.5), inset 0 0 22px -8px rgba(255,91,91,.4)" }}>
          <div style={{ width: 42, height: 42, borderRadius: 12, background: "rgba(255,255,255,.13)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Icon name="start" size={23} color="#fff" />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: "Oswald", fontWeight: 600, fontSize: 16, letterSpacing: ".4px" }}>{t("timer.start")}</div>
            <div style={{ fontSize: 11, color: "#ffffffcc", display: "flex", alignItems: "center", gap: 5 }}><Icon name="mapPin" size={12} color="#ffffffcc" /> Into: {sj || t("timer.general")}</div>
          </div>
          <Icon name="next" size={18} color="#fff" />
        </div>
      </>) : (<>
        {/* On the clock — live timer + open work order / clock out */}
        <div className="cd mb" style={{ background: "rgba(0,204,102,.1)", border: "1px solid rgba(0,204,102,.5)", borderRadius: 18, padding: 15, textAlign: "center", boxShadow: "0 0 40px -16px rgba(0,204,102,.6)" }}>
          <div style={{ fontSize: 10, letterSpacing: ".16em", textTransform: "uppercase", color: "#3ee08f", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--color-success)", boxShadow: "0 0 9px var(--color-success)" }} /> On the clock
          </div>
          <div style={{ fontFamily: "Oswald", fontWeight: 700, fontSize: 40, letterSpacing: "1px", margin: "7px 0 2px", color: "var(--color-success)" }}>{fmt(el)}</div>
          <div className="dim" style={{ fontSize: 11.5 }}>{sj || t("timer.general")}</div>
          {sj && (
            <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(sj)}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: 10, color: "#7fb6ff", display: "inline-flex", alignItems: "center", gap: 5, marginTop: 7 }}>
              <Icon name="mapPin" size={12} color="#7fb6ff" /> Show on map
            </a>
          )}
        </div>
        <div className="row" style={{ gap: 8, marginBottom: 12 }}>
          <button onClick={() => setPage?.("workvision")} style={{ flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, fontFamily: "Oswald", fontWeight: 600, fontSize: 13, letterSpacing: ".3px", padding: "12px", borderRadius: 12, color: "#fff", background: "rgba(46,139,255,.14)", border: "1px solid rgba(46,139,255,.85)", boxShadow: "0 0 22px -4px rgba(46,139,255,.55)" }}>
            <Icon name="list" size={15} color="#fff" /> Open work order
          </button>
          <button onClick={stop} style={{ flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, fontFamily: "Oswald", fontWeight: 600, fontSize: 13, letterSpacing: ".3px", padding: "12px", borderRadius: 12, color: "#ff9d9d", background: "rgba(255,91,91,.1)", border: "1px solid rgba(255,91,91,.45)" }}>
            <Icon name="stop" size={14} color="#ff9d9d" /> {t("timer.stop")}
          </button>
        </div>
      </>)}

      {/* Manual entry — collapsed dashed row that expands the form (admin) */}
      {isOwner && !showManual && (
        <div onClick={() => setShowManual(true)} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 7, fontSize: 11.5, color: "#8cc0ff", fontWeight: 600, background: "var(--color-card-dark-2)", border: "1px dashed var(--color-border-dark-2)", borderRadius: 11, padding: 10, marginBottom: 11, cursor: "pointer" }}>
          <Icon name="add" size={15} color="#8cc0ff" /> Add time entry · manual
        </div>
      )}
      {isOwner && showManual && (
        <div className="cd mb">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <h4 style={{ fontSize: 13 }}>{t("timer.log")}</h4>
            <button onClick={() => setShowManual(false)} aria-label="Close" style={{ background: "none", border: "none", color: "var(--color-dim)", cursor: "pointer", display: "inline-flex", padding: 2 }}><Icon name="close" size={15} /></button>
          </div>
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
              {jobs.filter((j) => !j.archived).map((j) => (
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
              onClick={async () => { await addManual(); setShowManual(false); }}
              style={{ fontSize: 13, padding: "7px 12px" }}
            >
              {t("timer.log")}
            </button>
          </div>
        </div>
      )}

      {/* My Log — today summary + entry cards */}
      {(() => {
        const todayUS = new Date().toLocaleDateString("en-US");
        const todayISO = new Date().toISOString().split("T")[0];
        const myTodayHrs = myTime.filter((e) => e.entry_date === todayUS || e.entry_date === todayISO).reduce((s, e) => s + (e.hours || 0), 0);
        return (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "2px 2px 7px" }}>
              <span style={{ fontSize: 10, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--color-dim)", fontWeight: 600 }}>{t("timer.myLog")}</span>
              {myTodayHrs > 0 && <span style={{ fontSize: 10.5, fontFamily: "Oswald", color: "var(--color-success)" }}>Today · {myTodayHrs.toFixed(1)} hrs</span>}
            </div>
            {!myTime.length ? (
              <div className="cd" style={{ textAlign: "center", padding: 16 }}><p className="dim" style={{ fontSize: 12 }}>No entries</p></div>
            ) : (
              myTime.map((e) => (
                <div key={e.id} className="cd" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 11px", marginBottom: 6, gap: 8 }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 11.5, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.job || t("timer.general")}</div>
                    <div className="dim" style={{ fontSize: 9.5 }}>{e.entry_date}{(e.start_time || e.end_time) ? ` · ${e.start_time || "?"}–${e.end_time || "now"}` : ""}</div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 7, flexShrink: 0 }}>
                    <input
                      type="number"
                      defaultValue={e.hours}
                      step=".25"
                      min="0"
                      style={{ width: 48, textAlign: "center", padding: "2px 4px", fontSize: 12.5, fontFamily: "Oswald", fontWeight: 600 }}
                      onBlur={async (ev) => {
                        // Only the owner (or an admin) can edit a row.
                        if (e.user_id && e.user_id !== user.id && !isOwner) return;
                        const newHrs = parseFloat(ev.target.value) || 0;
                        if (newHrs === e.hours) return;
                        const owner = profiles.find((p) => p.id === e.user_id);
                        const ownerRate = owner?.rate || user.rate || 55;
                        await db.patch("time_entries", e.id, { hours: newHrs, amount: Math.round(newHrs * ownerRate * 100) / 100 });
                        await loadAll();
                      }}
                    />
                    <span style={{ fontFamily: "Oswald", fontWeight: 600, fontSize: 12.5, color: "var(--color-success)", minWidth: 42, textAlign: "right" }}>${(e.amount || 0).toFixed(0)}</span>
                    <button
                      onClick={async () => {
                        if (e.user_id && e.user_id !== user.id && !isOwner) return;
                        if (!await useStore.getState().showConfirm("Delete Entry", "Delete this time entry?")) return;
                        await db.del("time_entries", e.id);
                        await loadAll();
                      }}
                      style={{ background: "none", border: "none", color: "var(--color-accent-red)", fontSize: 12, cursor: "pointer", padding: 0 }}
                    >✕</button>
                  </div>
                </div>
              ))
            )}
          </>
        );
      })()}
      </>)}

      {/* ── Crew Activity tab (admin only) ── */}
      {tab === "crew" && isOwner && (<>
        {/* Currently clocked in */}
        <div className="cd mb" style={{ borderLeft: `3px solid ${activeSessions.length ? "var(--color-success)" : "#444"}` }}>
          <h4 style={{ fontSize: 13, marginBottom: 8, color: "var(--color-success)" }}>
            🟢 {t("timer.currentlyClockedIn")} ({activeSessions.length})
          </h4>
          {!activeSessions.length ? (
            <p className="dim" style={{ fontSize: 12 }}>{t("timer.noActiveSessions")}</p>
          ) : (
            activeSessions.map((e) => {
              const owner = profiles.find((p) => p.id === e.user_id) || { name: e.user_name, rate: 55 };
              const elapsed = e.start_time ? elapsedFrom(e.start_time, e.entry_date) : "–";
              return (
                <div
                  key={e.id}
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "8px 0", borderBottom: `1px solid ${darkMode ? "#1e1e2e" : "#eee"}`,
                    gap: 8,
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--color-success)", display: "inline-block", animation: "pulse 2s infinite" }} />
                      <span style={{ fontWeight: 600, fontSize: 14 }}>{owner.name}</span>
                    </div>
                    <div className="dim" style={{ fontSize: 11, marginTop: 2 }}>
                      {e.job || t("timer.general")} · {t("timer.startedAt")} {e.start_time || "?"}
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontFamily: "Oswald", fontSize: 16, color: "var(--color-success)" }}>{elapsed}</div>
                    <button
                      onClick={async () => {
                        if (!await useStore.getState().showConfirm("Force Clock-Out", `Clock out ${owner.name}? This will close the session without the employee's own clock-out.`)) return;
                        const hrs = e.start_time ? (() => {
                          const m = e.start_time.match(/(\d+):(\d+)\s*([AP]M)?/i);
                          if (!m) return 0;
                          let h = parseInt(m[1]); const mm = parseInt(m[2]);
                          const ampm = m[3]?.toUpperCase();
                          if (ampm === "PM" && h < 12) h += 12;
                          if (ampm === "AM" && h === 12) h = 0;
                          const start = new Date(); start.setHours(h, mm, 0, 0);
                          return Math.round((Date.now() - start.getTime()) / 3600000 * 100) / 100;
                        })() : 0;
                        await db.patch("time_entries", e.id, {
                          hours: hrs,
                          amount: Math.round(hrs * (owner.rate || 55) * 100) / 100,
                          end_time: fmtTime(Date.now()),
                        });
                        await loadAll();
                      }}
                      style={{ background: "none", color: "var(--color-accent-red)", fontSize: 10, padding: 0, marginTop: 2 }}
                    >
                      {t("timer.forceStop")}
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Per-employee breakdown — today / week, with drill-down */}
        <div className="cd">
          <h4 style={{ fontSize: 13, marginBottom: 8, color: "var(--color-primary)", display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Icon name="trending" size={14} color="var(--color-primary)" />
            {t("timer.crewBreakdown")}
          </h4>
          {(() => {
            const todayStr = new Date().toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" });
            const todayISO = new Date().toISOString().split("T")[0];
            // Week totals
            const weekStart = new Date();
            weekStart.setDate(weekStart.getDate() - weekStart.getDay());
            weekStart.setHours(0, 0, 0, 0);

            return profiles.map((p) => {
              const allEntries = timeEntries
                .filter((e) => e.user_id === p.id || e.user_name === p.name)
                .slice()
                .sort(byRecentDesc);
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
              const activeEntry = activeSessions.find((e) => e.user_id === p.id || (!e.user_id && e.user_name === p.name));
              const isActive = !!activeEntry;
              const activeElapsed = activeEntry?.start_time ? elapsedFrom(activeEntry.start_time, activeEntry.entry_date) : "";
              return (
                <div key={p.id} style={{ padding: "8px 0", borderBottom: `1px solid ${darkMode ? "#1e1e2e" : "#eee"}` }}>
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}
                    onClick={() => setExpandedCrew(isExpanded ? null : p.id)}
                  >
                    {/* Avatar + live status dot */}
                    <div style={{ position: "relative", width: 34, height: 34, borderRadius: "50%", background: "var(--color-card-dark-2)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Oswald", fontWeight: 600, fontSize: 12, color: "#cdd6e6", flexShrink: 0 }}>
                      {initials(p.name)}
                      <span style={{ position: "absolute", right: -1, bottom: -1, width: 11, height: 11, borderRadius: "50%", border: `2px solid ${darkMode ? "#16161f" : "#fff"}`, background: isActive ? "var(--color-success)" : "#555" }} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontFamily: "Oswald", fontWeight: 600, fontSize: 14, letterSpacing: ".3px" }}>{p.name}</div>
                      <div className="dim" style={{ fontSize: 10.5 }}>{p.role} · ${rRate}/hr</div>
                    </div>
                    <div style={{ textAlign: "right", flexShrink: 0 }}>
                      <div style={{ fontFamily: "Oswald", fontWeight: 600, fontSize: 14, color: isActive ? "var(--color-success)" : todayHrs > 0 ? "inherit" : "var(--color-dim)" }}>
                        {isActive && activeElapsed ? activeElapsed : todayHrs > 0 ? `${todayHrs.toFixed(1)}h` : "—"}
                      </div>
                      <span style={{ fontSize: 9, fontWeight: 600, padding: "2px 7px", borderRadius: 99, display: "inline-block", marginTop: 1, background: isActive ? "rgba(0,204,102,.16)" : "var(--color-card-dark-2)", color: isActive ? "#3ee08f" : "var(--color-dim)" }}>
                        {isActive ? "On the clock" : "Off"}
                      </span>
                    </div>
                    <Icon name={isExpanded ? "collapse" : "expand"} size={14} color="#888" />
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
                      <div className="dim">{t("timer.todayLabel")}: ${todayPay.toFixed(0)}</div>
                      <div className="dim">{t("timer.weekLabel")}: {weekHrs.toFixed(1)}h · ${weekPay.toFixed(0)}</div>
                    </div>
                  </div>
                  {isExpanded && (
                    <div style={{ marginTop: 8, padding: 8, background: darkMode ? "#0f0f18" : "#f7f7fa", borderRadius: 6 }}>
                      <div className="dim" style={{ fontSize: 11, marginBottom: 4 }}>
                        {t("timer.allEntries")} ({allEntries.length})
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
      </>)}

      <div style={{ textAlign: "center", marginTop: 16 }}>
        <p className="dim" style={{ fontSize: 12 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, justifyContent: "center" }}>
            <Icon name="tip" size={14} color="var(--color-highlight)" />
            Next: Review hours in Payroll
          </span>
        </p>
      </div>
    </div>
  );
}
