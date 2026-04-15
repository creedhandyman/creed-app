"use client";
import { useState, useEffect, useRef } from "react";
import { useStore } from "@/lib/store";
import { db, supabase } from "@/lib/supabase";
import { t } from "@/lib/i18n";

function ld<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try { const v = localStorage.getItem("c_" + key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}
function sv(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  localStorage.setItem("c_" + key, JSON.stringify(value));
}
function fmt(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 3600).toString().padStart(2, "0")}:${Math.floor((s % 3600) / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;
}
function fmtTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

export default function WorkVision({ setPage }: { setPage: (p: string) => void }) {
  const user = useStore((s) => s.user)!;
  const jobs = useStore((s) => s.jobs);
  const schedule = useStore((s) => s.schedule);
  const loadAll = useStore((s) => s.loadAll);
  const darkMode = useStore((s) => s.darkMode);

  const [on, setOn] = useState(() => ld("t_on", false));
  const [st, setSt] = useState(() => ld<number | null>("t_st", null));
  const [sj, setSj] = useState(() => ld("t_sj", ""));
  const [el, setEl] = useState(0);
  const [notes, setNotes] = useState("");
  const rate = user.rate || 55;

  // Persist timer
  useEffect(() => sv("t_on", on), [on]);
  useEffect(() => sv("t_st", st), [st]);
  useEffect(() => sv("t_sj", sj), [sj]);

  // Tick
  useEffect(() => {
    if (!on || !st) return;
    const tick = () => setEl(Date.now() - st);
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, [on, st]);

  // Find the active job
  const activeJob = jobs.find((j) => j.property === sj);
  const jobData = (() => {
    try { return activeJob ? (typeof activeJob.rooms === "string" ? JSON.parse(activeJob.rooms) : activeJob.rooms) : null; }
    catch { return null; }
  })();
  const workOrder: { room: string; detail: string; action: string; pri: string; hrs: number; done: boolean }[] = jobData?.workOrder || [];

  // Today's schedule
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const todaySchedule = schedule.filter((s) => s.sched_date === todayStr);

  // Clock in
  const clockIn = (job: string) => {
    setSj(job);
    setSt(Date.now());
    setOn(true);
    setEl(0);
  };

  // Clock out + save
  const clockOut = async () => {
    if (!st) return;
    const hrs = (Date.now() - st) / (1000 * 60 * 60);
    if (hrs > 0.01) {
      await db.post("time_entries", {
        job: sj || "General",
        entry_date: new Date().toLocaleDateString("en-US"),
        hours: Math.round(hrs * 100) / 100,
        amount: Math.round(hrs * rate * 100) / 100,
        user_id: user.id,
        user_name: user.name,
        start_time: fmtTime(st),
        end_time: fmtTime(Date.now()),
      });
    }
    setOn(false);
    setSt(null);
    setEl(0);
    setSj("");
    loadAll();
    useStore.getState().showToast(`Clocked out — ${hrs.toFixed(1)} hours logged`, "success");
  };

  // Toggle work order item
  const toggleWO = async (idx: number) => {
    if (!activeJob) return;
    const updated = [...workOrder];
    updated[idx] = { ...updated[idx], done: !updated[idx].done };
    const data = { ...jobData, workOrder: updated };
    await db.patch("jobs", activeJob.id, { rooms: JSON.stringify(data) });
    loadAll();
  };

  // Complete job
  const completeJob = async () => {
    if (!activeJob) return;
    const unchecked = workOrder.filter((w) => !w.done).length;
    if (unchecked > 0) {
      if (!await useStore.getState().showConfirm("Incomplete Items", `${unchecked} item${unchecked !== 1 ? "s" : ""} unchecked. Complete anyway?`)) return;
    }
    // Save notes if any
    if (notes.trim()) {
      const data = { ...jobData, jobNotes: (jobData?.jobNotes || "") + "\n" + notes.trim() };
      await db.patch("jobs", activeJob.id, { rooms: JSON.stringify(data), status: "complete" });
    } else {
      await db.patch("jobs", activeJob.id, { status: "complete" });
    }
    // Clock out
    await clockOut();
    useStore.getState().showToast("Job completed! Great work.", "success");
    setPage("dash");
  };

  const border = darkMode ? "#1e1e2e" : "#eee";

  // ── NOT CLOCKED IN ──
  if (!on) {
    return (
      <div className="fi">
        <div className="row mb" style={{ justifyContent: "space-between" }}>
          <h2 style={{ fontSize: 22, color: "var(--color-primary)" }}>👷 {t("wv.title")}</h2>
          <button className="bo" onClick={() => setPage("dash")} style={{ fontSize: 12, padding: "4px 10px" }}>← Dashboard</button>
        </div>

        <div className="cd mb" style={{ textAlign: "center", padding: 24 }}>
          <div style={{ fontSize: 48, marginBottom: 8 }}>👷</div>
          <h3 style={{ fontSize: 16, color: "var(--color-primary)", marginBottom: 8 }}>{t("wv.readyToWork")}</h3>
          <p className="dim" style={{ fontSize: 13, marginBottom: 16 }}>{t("wv.selectJob")}</p>
        </div>

        {/* Today's Schedule */}
        {todaySchedule.length > 0 && (
          <div className="cd mb">
            <h4 style={{ fontSize: 13, marginBottom: 8 }}>{t("wv.todaySchedule")}</h4>
            {todaySchedule.map((s) => (
              <div key={s.id} className="sep" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13 }}>
                <div>
                  <b style={{ color: "var(--color-primary)" }}>{s.job}</b>
                  {s.note && <div className="dim" style={{ fontSize: 12 }}>{s.note}</div>}
                </div>
                <button className="bb" onClick={() => clockIn(s.job)} style={{ fontSize: 12, padding: "5px 12px" }}>
                  ▶ Clock In
                </button>
              </div>
            ))}
          </div>
        )}

        {/* All Jobs */}
        <div className="cd">
          <h4 style={{ fontSize: 13, marginBottom: 8 }}>{t("wv.allActive")}</h4>
          {jobs.filter((j) => !["complete", "invoiced", "paid"].includes(j.status)).length === 0 ? (
            <p className="dim" style={{ fontSize: 12 }}>{t("wv.noActive")}</p>
          ) : (
            jobs.filter((j) => !["complete", "invoiced", "paid"].includes(j.status)).map((j) => (
              <div key={j.id} className="sep" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13 }}>
                <div>
                  <b>{j.property}</b>
                  <div className="dim" style={{ fontSize: 12 }}>{j.client} · ${(j.total || 0).toFixed(0)}</div>
                </div>
                <button className="bb" onClick={() => clockIn(j.property)} style={{ fontSize: 12, padding: "5px 12px" }}>
                  ▶ Clock In
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    );
  }

  // ── CLOCKED IN — WORK MODE ──
  return (
    <div className="fi">
      {/* Timer header */}
      <div className="cd mb" style={{ textAlign: "center", padding: 16, borderLeft: "3px solid var(--color-success)", background: darkMode ? "#0a1a0a" : "#f0fff0" }}>
        <div style={{ fontSize: 12, color: "var(--color-success)", fontFamily: "Oswald", textTransform: "uppercase", letterSpacing: ".1em", marginBottom: 4 }}>
          🟢 {t("wv.clockedIn")}
        </div>
        <div style={{ fontSize: 36, fontFamily: "Oswald", fontWeight: 700, color: "var(--color-success)" }}>
          {fmt(el)}
        </div>
        <div style={{ fontSize: 14, fontWeight: 600, marginTop: 4 }}>{sj || "General"}</div>
        {activeJob && (
          <div className="dim" style={{ fontSize: 12 }}>{activeJob.client} · ${(activeJob.total || 0).toFixed(0)}</div>
        )}
        <div className="row" style={{ justifyContent: "center", gap: 8, marginTop: 10 }}>
          <button className="br" onClick={clockOut} style={{ fontSize: 13, padding: "6px 16px" }}>⏹ {t("wv.clockOut")}</button>
          <button className="bg" onClick={completeJob} style={{ fontSize: 13, padding: "6px 16px" }}>✅ {t("wv.completeJob")}</button>
        </div>
      </div>

      {/* Job Details */}
      {activeJob && (
        <div className="cd mb">
          <h4 style={{ fontSize: 13, marginBottom: 6 }}>📋 {t("wv.jobDetails")}</h4>
          <div style={{ fontSize: 13, lineHeight: 1.8 }}>
            <div><span className="dim">Property:</span> {activeJob.property}</div>
            <div><span className="dim">Client:</span> {activeJob.client || "—"}</div>
            <div><span className="dim">Total:</span> <span style={{ color: "var(--color-success)", fontFamily: "Oswald" }}>${(activeJob.total || 0).toFixed(2)}</span></div>
            <div><span className="dim">Hours:</span> {(activeJob.total_hrs || 0).toFixed(1)}h · Labor: ${(activeJob.total_labor || 0).toFixed(0)} · Mat: ${(activeJob.total_mat || 0).toFixed(0)}</div>
            {activeJob.property && (
              <a href={`https://www.google.com/maps/search/${encodeURIComponent(activeJob.property)}`} target="_blank" rel="noopener noreferrer" style={{ color: "var(--color-primary)", fontSize: 13, textDecoration: "none" }}>
                📍 Open in Maps
              </a>
            )}
          </div>
        </div>
      )}

      {/* Work Order Checklist */}
      {workOrder.length > 0 && (
        <div className="cd mb">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <h4 style={{ fontSize: 13 }}>✅ {t("wv.workOrder")}</h4>
            <span className="dim" style={{ fontSize: 12 }}>{workOrder.filter((w) => w.done).length}/{workOrder.length}</span>
          </div>
          {/* Progress bar */}
          <div style={{ height: 6, borderRadius: 3, background: border, marginBottom: 8 }}>
            <div style={{ height: "100%", borderRadius: 3, background: "var(--color-success)", width: `${(workOrder.filter((w) => w.done).length / workOrder.length) * 100}%`, transition: "width .3s" }} />
          </div>
          {workOrder.map((w, i) => (
            <div
              key={i}
              onClick={() => toggleWO(i)}
              style={{
                display: "flex", alignItems: "flex-start", gap: 8, padding: "6px 4px",
                borderBottom: `1px solid ${border}`, cursor: "pointer",
                opacity: w.done ? 0.5 : 1,
              }}
            >
              <span style={{
                width: 18, height: 18, borderRadius: 4, flexShrink: 0, marginTop: 1,
                border: `2px solid ${w.done ? "var(--color-success)" : "#555"}`,
                background: w.done ? "var(--color-success)" : "transparent",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 14, color: "#fff",
              }}>
                {w.done && "✓"}
              </span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, textDecoration: w.done ? "line-through" : "none" }}>{w.detail}</div>
                <div className="dim" style={{ fontSize: 12 }}>{w.action}</div>
                <div style={{ fontSize: 12, marginTop: 2 }}>
                  <span style={{ color: "var(--color-primary)" }}>{w.hrs}h</span>
                  <span className="dim" style={{ marginLeft: 6 }}>{w.room}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Shopping List */}
      {jobData?.photos?.length > 0 && (
        <div className="cd mb">
          <h4 style={{ fontSize: 13, marginBottom: 6 }}>📸 Job Photos</h4>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {jobData.photos.slice(0, 10).map((p: { url: string }, i: number) => (
              <img key={i} src={p.url} alt="" style={{ width: 60, height: 60, objectFit: "cover", borderRadius: 6, border: `1px solid ${border}` }} />
            ))}
          </div>
        </div>
      )}

      {/* Job Notes */}
      <div className="cd mb">
        <h4 style={{ fontSize: 13, marginBottom: 6 }}>📝 {t("wv.jobNotes")}</h4>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={t("wv.notesPlaceholder")}
          style={{ height: 70, fontSize: 13, resize: "vertical" }}
        />
        {jobData?.jobNotes && (
          <div className="dim" style={{ fontSize: 12, marginTop: 4 }}>
            Previous notes: {jobData.jobNotes.slice(0, 100)}...
          </div>
        )}
      </div>

      {/* Quick Actions */}
      <div className="g2">
        <button className="bo" onClick={() => setPage("troubleshoot")} style={{ padding: 12, fontSize: 13 }}>🔧 Troubleshoot</button>
        <button className="bo" onClick={() => setPage("dash")} style={{ padding: 12, fontSize: 13 }}>← Dashboard</button>
      </div>
    </div>
  );
}
