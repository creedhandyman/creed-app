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

  // Sort work orders: HIGH first, then MED, then LOW, completed at bottom
  const priOrder: Record<string, number> = { HIGH: 0, MED: 1, LOW: 2 };
  const sortedWO = [...workOrder]
    .map((w, i) => ({ ...w, _idx: i }))
    .sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1; // unchecked first
      return (priOrder[a.pri] || 2) - (priOrder[b.pri] || 2);
    });

  const priColor = (pri: string) => pri === "HIGH" ? "var(--color-accent-red)" : pri === "MED" ? "var(--color-warning)" : "var(--color-success)";
  const priLabel = (pri: string) => pri === "HIGH" ? "URGENT" : pri === "MED" ? "NEEDED" : "MINOR";

  const [section, setSection] = useState<"tasks" | "guide" | "notes" | "photos">("tasks");

  // ── CLOCKED IN — WORK MODE ──
  return (
    <div className="fi">
      {/* Timer header — compact, always visible */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14, padding: "10px 14px", borderRadius: 12, background: darkMode ? "#0a1a0a" : "#f0fff0", border: "1px solid var(--color-success)" }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11, color: "var(--color-success)", fontFamily: "Oswald", textTransform: "uppercase", letterSpacing: ".08em" }}>
            🟢 {t("wv.clockedIn")}
          </div>
          <div style={{ fontSize: 14, fontWeight: 600, marginTop: 2 }}>{sj || "General"}</div>
          {activeJob && <div className="dim" style={{ fontSize: 12 }}>{activeJob.client}</div>}
        </div>
        <div style={{ fontSize: 28, fontFamily: "Oswald", fontWeight: 700, color: "var(--color-success)" }}>
          {fmt(el)}
        </div>
      </div>

      {/* Action buttons */}
      <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
        <button className="br" onClick={clockOut} style={{ flex: 1, fontSize: 14, padding: "10px" }}>⏹ {t("wv.clockOut")}</button>
        <button className="bg" onClick={completeJob} style={{ flex: 1, fontSize: 14, padding: "10px" }}>✅ {t("wv.completeJob")}</button>
      </div>

      {/* Job info bar */}
      {activeJob && (
        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          <div className="cd" style={{ flex: 1, padding: 10, textAlign: "center" }}>
            <div className="sl">Total</div>
            <div style={{ fontSize: 18, fontFamily: "Oswald", color: "var(--color-success)" }}>${(activeJob.total || 0).toFixed(0)}</div>
          </div>
          <div className="cd" style={{ flex: 1, padding: 10, textAlign: "center" }}>
            <div className="sl">Hours</div>
            <div style={{ fontSize: 18, fontFamily: "Oswald", color: "var(--color-primary)" }}>{(activeJob.total_hrs || 0).toFixed(1)}</div>
          </div>
          <a
            href={`https://www.google.com/maps/search/${encodeURIComponent(activeJob.property)}`}
            target="_blank" rel="noopener noreferrer"
            className="cd"
            style={{ flex: 1, padding: 10, textAlign: "center", textDecoration: "none", color: "var(--color-primary)" }}
          >
            <div style={{ fontSize: 20 }}>📍</div>
            <div style={{ fontSize: 12 }}>Maps</div>
          </a>
          <div className="cd" onClick={() => setPage("troubleshoot")} style={{ flex: 1, padding: 10, textAlign: "center", cursor: "pointer" }}>
            <div style={{ fontSize: 20 }}>🔧</div>
            <div style={{ fontSize: 12 }}>Help</div>
          </div>
        </div>
      )}

      {/* Section tabs */}
      <div style={{ display: "flex", gap: 3, marginBottom: 12 }}>
        {[
          { id: "tasks" as const, label: `✅ Tasks (${workOrder.filter((w) => !w.done).length})`, count: workOrder.length },
          { id: "guide" as const, label: "🛒 Guide", count: 0 },
          { id: "notes" as const, label: "📝 Notes", count: 0 },
          { id: "photos" as const, label: `📸 Photos (${jobData?.photos?.length || 0})`, count: 0 },
        ].map((s) => (
          <button
            key={s.id}
            onClick={() => setSection(s.id)}
            style={{
              flex: 1, padding: "6px 4px", borderRadius: 6, fontSize: 12,
              background: section === s.id ? "var(--color-primary)" : "transparent",
              color: section === s.id ? "#fff" : "#888", fontFamily: "Oswald",
            }}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* ── TASKS TAB ── */}
      {section === "tasks" && (
        <div>
          {workOrder.length > 0 && (
            <>
              {/* Progress */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <div style={{ flex: 1, height: 8, borderRadius: 4, background: border }}>
                  <div style={{ height: "100%", borderRadius: 4, background: "var(--color-success)", width: `${(workOrder.filter((w) => w.done).length / workOrder.length) * 100}%`, transition: "width .3s" }} />
                </div>
                <span style={{ fontSize: 13, fontFamily: "Oswald", color: "var(--color-success)" }}>{workOrder.filter((w) => w.done).length}/{workOrder.length}</span>
              </div>

              {/* Priority sorted work order */}
              {sortedWO.map((w) => (
                <div
                  key={w._idx}
                  onClick={() => toggleWO(w._idx)}
                  style={{
                    display: "flex", alignItems: "flex-start", gap: 10,
                    padding: "10px 8px", marginBottom: 6,
                    borderRadius: 10, cursor: "pointer",
                    background: w.done ? "transparent" : darkMode ? "#12121a" : "#fff",
                    border: w.done ? `1px solid ${border}` : `1px solid ${priColor(w.pri)}33`,
                    borderLeft: w.done ? `1px solid ${border}` : `3px solid ${priColor(w.pri)}`,
                    opacity: w.done ? 0.45 : 1,
                  }}
                >
                  <span style={{
                    width: 22, height: 22, borderRadius: 6, flexShrink: 0, marginTop: 1,
                    border: `2px solid ${w.done ? "var(--color-success)" : priColor(w.pri)}`,
                    background: w.done ? "var(--color-success)" : "transparent",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 14, color: "#fff",
                  }}>
                    {w.done && "✓"}
                  </span>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div style={{ fontSize: 14, fontWeight: 600, textDecoration: w.done ? "line-through" : "none" }}>{w.detail}</div>
                      {!w.done && (
                        <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 4, background: priColor(w.pri) + "22", color: priColor(w.pri), fontFamily: "Oswald" }}>
                          {priLabel(w.pri)}
                        </span>
                      )}
                    </div>
                    <div className="dim" style={{ fontSize: 13, marginTop: 3, lineHeight: 1.4 }}>{w.action}</div>
                    <div style={{ fontSize: 12, marginTop: 4, display: "flex", gap: 10 }}>
                      <span style={{ color: "var(--color-primary)", fontFamily: "Oswald" }}>{w.hrs}h</span>
                      <span className="dim">{w.room}</span>
                    </div>
                  </div>
                </div>
              ))}
            </>
          )}
          {workOrder.length === 0 && (
            <div className="cd" style={{ textAlign: "center", padding: 24 }}>
              <p className="dim">No work order items — check the quote</p>
            </div>
          )}
        </div>
      )}

      {/* ── GUIDE TAB — Tools + Shopping ── */}
      {section === "guide" && activeJob && (() => {
        try {
          const { makeGuide } = require("@/lib/parser");
          const roomsData = jobData?.rooms || [];
          const guide = makeGuide(roomsData);
          return (
            <div>
              <div className="cd mb">
                <h4 style={{ fontSize: 13, marginBottom: 8 }}>🔨 Tools Needed</h4>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {guide.tools.map((tool: string, i: number) => (
                    <span key={i} style={{ fontSize: 12, padding: "3px 8px", borderRadius: 6, background: darkMode ? "#1a1a28" : "#f0f0f5", border: `1px solid ${border}` }}>
                      {tool}
                    </span>
                  ))}
                </div>
              </div>
              <div className="cd">
                <h4 style={{ fontSize: 13, marginBottom: 8 }}>🛒 Shopping List (${guide.shop.reduce((s: number, i: { c: number }) => s + (i.c || 0), 0)})</h4>
                {guide.shop.map((item: { n: string; c: number; trade?: string }, i: number) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "4px 0", borderBottom: `1px solid ${border}` }}>
                    <span>{item.n}</span>
                    <span style={{ color: "var(--color-success)", fontFamily: "Oswald" }}>${item.c}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        } catch { return <div className="cd dim" style={{ padding: 20, textAlign: "center" }}>Guide unavailable</div>; }
      })()}

      {/* ── NOTES TAB ── */}
      {section === "notes" && (
        <div className="cd">
          <h4 style={{ fontSize: 13, marginBottom: 8 }}>📝 {t("wv.jobNotes")}</h4>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={t("wv.notesPlaceholder")}
            style={{ height: 120, fontSize: 14, resize: "vertical" }}
          />
          {jobData?.jobNotes && (
            <div style={{ marginTop: 8, padding: 8, borderRadius: 6, background: darkMode ? "#1a1a28" : "#f5f5f8" }}>
              <div className="sl" style={{ marginBottom: 4 }}>Previous Notes</div>
              <div style={{ fontSize: 13, whiteSpace: "pre-wrap" }}>{jobData.jobNotes}</div>
            </div>
          )}
        </div>
      )}

      {/* ── PHOTOS TAB ── */}
      {section === "photos" && (
        <div className="cd">
          <h4 style={{ fontSize: 13, marginBottom: 8 }}>📸 Job Photos</h4>
          {jobData?.photos?.length > 0 ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
              {jobData.photos.map((p: { url: string; label: string; type: string }, i: number) => (
                <div key={i} style={{ position: "relative" }}>
                  <img src={p.url} alt="" style={{ width: "100%", aspectRatio: "1", objectFit: "cover", borderRadius: 8, border: `1px solid ${border}` }} />
                  {p.type && (
                    <span style={{ position: "absolute", bottom: 2, left: 2, fontSize: 9, padding: "1px 4px", borderRadius: 3, background: p.type === "before" ? "#ff8800" : p.type === "after" ? "#00cc66" : "#2E75B6", color: "#fff" }}>
                      {p.type}
                    </span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="dim" style={{ textAlign: "center", padding: 16 }}>No photos attached to this job</p>
          )}
        </div>
      )}
    </div>
  );
}
