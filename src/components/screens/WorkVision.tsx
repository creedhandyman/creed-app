"use client";
import { useState, useEffect, useRef } from "react";
import { useStore } from "@/lib/store";
import { db, supabase } from "@/lib/supabase";
import { t } from "@/lib/i18n";
import { makeGuide } from "@/lib/parser";
import { Icon } from "../Icon";

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
  // Active server-side time_entries row id, shared with Timer.tsx via localStorage
  // so clock-out in either screen patches the same row instead of creating a new
  // entry and orphaning the original.
  const [activeId, setActiveId] = useState<string | null>(() => ld<string | null>("t_active_id", null));
  // Which task in the work order is expanded to show materials / photos / comment
  const [expandedTask, setExpandedTask] = useState<number | null>(null);
  // Guide tab: tap-to-check tools and shopping items, plus custom additions
  const [checkedTools, setCheckedTools] = useState<Set<string>>(() => new Set());
  const [checkedShop, setCheckedShop] = useState<Set<number>>(() => new Set());
  const [extraTools, setExtraTools] = useState<string[]>([]);
  const [extraShop, setExtraShop] = useState<{ n: string; c: number; room: string }[]>([]);
  const [newTool, setNewTool] = useState("");
  const [newShopName, setNewShopName] = useState("");
  const [newShopCost, setNewShopCost] = useState("");
  const rate = user.rate || 55;

  // Persist timer
  useEffect(() => sv("t_on", on), [on]);
  useEffect(() => sv("t_st", st), [st]);
  useEffect(() => sv("t_sj", sj), [sj]);
  useEffect(() => sv("t_active_id", activeId), [activeId]);

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

  // Clock in: create an in-progress time_entries row so admins can see who's
  // clocked in right now (same pattern Timer.tsx uses).
  const clockIn = async (job: string) => {
    const startedAt = Date.now();
    setSj(job);
    setSt(startedAt);
    setOn(true);
    setEl(0);
    const result = await db.post<{ id: string }>("time_entries", {
      job: job || "General",
      entry_date: new Date().toLocaleDateString("en-US"),
      hours: 0,
      amount: 0,
      user_id: user.id,
      user_name: user.name,
      start_time: fmtTime(startedAt),
    });
    if (result && result[0]?.id) {
      setActiveId(result[0].id);
      await loadAll();
    } else {
      setActiveId(null);
    }
    // Auto-promote the matching job from "scheduled" to "active" so the
    // workload view reflects what's actually happening. Don't flip jobs
    // already in "complete"/"paid" backwards.
    if (job) {
      const matched = jobs.find((j) => j.property === job && j.status === "scheduled");
      if (matched) await db.patch("jobs", matched.id, { status: "active" });
    }
  };

  // Clock out + save — patches the existing active row instead of inserting
  // a new entry, so "Currently Clocked In" updates correctly. Falls back to
  // patching whatever open row this user has if activeId got lost.
  const clockOut = async () => {
    if (!st) return;
    const hrs = (Date.now() - st) / (1000 * 60 * 60);
    const rounded = Math.round(hrs * 100) / 100;
    const amount = Math.round(hrs * rate * 100) / 100;
    if (hrs > 0.01) {
      if (activeId) {
        await db.patch("time_entries", activeId, {
          hours: rounded,
          amount,
          end_time: fmtTime(Date.now()),
          job: sj || "General",
        });
      } else {
        // Fallback: find this user's most-recent open active row and close it.
        const open = useStore.getState().timeEntries
          .filter((e) => e.user_id === user.id && e.start_time && !e.end_time)
          .sort((a, b) => (a.start_time || "").localeCompare(b.start_time || ""));
        const target = open[open.length - 1];
        if (target) {
          await db.patch("time_entries", target.id, {
            hours: rounded,
            amount,
            end_time: fmtTime(Date.now()),
            job: sj || "General",
          });
        } else {
          // No open row at all — last-resort: post a completed entry.
          await db.post("time_entries", {
            job: sj || "General",
            entry_date: new Date().toLocaleDateString("en-US"),
            hours: rounded,
            amount,
            user_id: user.id,
            user_name: user.name,
            start_time: fmtTime(st),
            end_time: fmtTime(Date.now()),
          });
        }
      }
    } else if (activeId) {
      // Brief in-and-out — delete the in-progress row instead of leaving a
      // zero-hour ghost entry.
      await db.del("time_entries", activeId);
    }
    setOn(false);
    setSt(null);
    setEl(0);
    setSj("");
    setActiveId(null);
    await loadAll();
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

  // Upload work photo
  const uploadWorkPhoto = async (file: File) => {
    if (!activeJob) return;
    const ext = file.name.split(".").pop() || "jpg";
    const path = `gallery/${activeJob.id}/${Date.now()}_${Math.random().toString(36).slice(2, 6)}.${ext}`;
    const { error } = await supabase.storage.from("receipts").upload(path, file);
    if (error) { useStore.getState().showToast("Photo upload failed: " + error.message, "error"); return; }
    const { data: urlData } = supabase.storage.from("receipts").getPublicUrl(path);
    if (urlData?.publicUrl) {
      // Re-read fresh job data from store to avoid stale snapshot
      const freshJob = useStore.getState().jobs.find((j) => j.id === activeJob.id);
      let freshData: Record<string, unknown> = {};
      try { freshData = freshJob ? (typeof freshJob.rooms === "string" ? JSON.parse(freshJob.rooms) : freshJob.rooms) || {} : {}; } catch { /* */ }
      if (!freshData.photos) freshData.photos = [];
      (freshData.photos as Array<{ url: string; label: string; type: string }>).push({ url: urlData.publicUrl, label: "", type: "work" });
      await db.patch("jobs", activeJob.id, { rooms: JSON.stringify(freshData) });
      await loadAll();
      useStore.getState().showToast("Photo added", "success");
    }
  };

  // Complete job
  const completeJob = async () => {
    if (!activeJob) return;
    const unchecked = workOrder.filter((w) => !w.done).length;
    if (unchecked > 0) {
      if (!await useStore.getState().showConfirm("Incomplete Items", `${unchecked} item${unchecked !== 1 ? "s" : ""} unchecked. Complete anyway?`)) return;
    }
    // Remind to take after photos
    const photoCount = jobData?.photos?.filter((p: { type: string }) => p.type === "after").length || 0;
    if (photoCount === 0) {
      if (!await useStore.getState().showConfirm("No Completion Photos", "You haven't uploaded any after photos. Take photos of your completed work before finishing?")) {
        setSection("photos");
        return;
      }
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
  const [section, setSection] = useState<"tasks" | "guide" | "notes" | "photos">("tasks");

  // Swipe between tabs
  const sections: ("tasks" | "guide" | "notes" | "photos")[] = ["tasks", "guide", "notes", "photos"];
  const touchStart = useRef<number>(0);
  const swipeTab = (dir: number) => {
    const idx = sections.indexOf(section);
    const next = idx + dir;
    if (next >= 0 && next < sections.length) setSection(sections[next]);
  };

  // Sort work orders: HIGH first, then MED, then LOW, completed at bottom
  const priOrder: Record<string, number> = { HIGH: 0, MED: 1, LOW: 2 };
  const sortedWO = [...workOrder]
    .map((w, i) => ({ ...w, _idx: i }))
    .sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1;
      return (priOrder[a.pri] || 2) - (priOrder[b.pri] || 2);
    });

  const priColor = (pri: string) => pri === "HIGH" ? "var(--color-accent-red)" : pri === "MED" ? "var(--color-warning)" : "var(--color-success)";
  const priLabel = (pri: string) => pri === "HIGH" ? t("wv.urgent") : pri === "MED" ? t("wv.needed") : t("wv.minor");

  // Pull the rich detail for a work-order task: matching quote item (so we
  // can show its materials and original inspection comment), plus any
  // inspection photos that captured the area before work started. Crews on
  // site need this context — the Tasks tab was previously just a checklist.
  type Material = { n: string; c: number };
  type QuoteItem = { detail: string; comment?: string; materials?: Material[]; laborHrs?: number };
  type Room = { name: string; items: QuoteItem[] };
  type InspectionItem = { name: string; condition?: string; comment?: string; photos?: string[] };
  type InspectionRoom = { name: string; items: InspectionItem[] };
  const enrichTask = (task: { room: string; detail: string }) => {
    const rooms: Room[] = jobData?.rooms || [];
    const room = rooms.find((r) => r.name === task.room);
    const tDetail = (task.detail || "").toLowerCase();
    const item = room?.items?.find(
      (i) => (i.detail || "").toLowerCase() === tDetail || tDetail.includes((i.detail || "").toLowerCase()) || (i.detail || "").toLowerCase().includes(tDetail),
    );
    const inspRooms: InspectionRoom[] = jobData?.inspection?.rooms || [];
    const inspRoom = inspRooms.find((r) => r.name === task.room);
    const inspItem = inspRoom?.items?.find(
      (i) => (i.name || "").toLowerCase() === tDetail || tDetail.includes((i.name || "").toLowerCase()),
    );
    return {
      materials: item?.materials || [],
      comment: item?.comment || inspItem?.comment || "",
      photos: inspItem?.photos || [],
      laborHrs: item?.laborHrs,
      condition: inspItem?.condition,
    };
  };

  // ── NOT CLOCKED IN ──
  if (!on) {
    return (
      <div className="fi">
        <div className="row mb" style={{ justifyContent: "space-between" }}>
          <h2 style={{ fontSize: 22, color: "var(--color-primary)", display: "inline-flex", alignItems: "center", gap: 8 }}>
            <Icon name="worker" size={22} color="var(--color-primary)" />
            {t("wv.title")}
          </h2>
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
          { id: "tasks" as const, label: `✅ ${t("wv.tasks")} (${workOrder.filter((w) => !w.done).length})`, count: workOrder.length },
          { id: "guide" as const, label: `🛒 ${t("wv.guide")}`, count: 0 },
          { id: "notes" as const, label: `📝 ${t("common.notes")}`, count: 0 },
          { id: "photos" as const, label: `📸 ${t("common.photos")} (${jobData?.photos?.length || 0})`, count: 0 },
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

      {/* Swipeable content area */}
      <div
        onTouchStart={(e) => { touchStart.current = e.touches[0].clientX; }}
        onTouchEnd={(e) => {
          const diff = e.changedTouches[0].clientX - touchStart.current;
          if (Math.abs(diff) > 60) swipeTab(diff < 0 ? 1 : -1);
        }}
      >

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

              {/* Priority sorted work order — tap body to expand for materials,
                  inspection comment, and before-photos. Tap the box to mark done. */}
              {sortedWO.map((w) => {
                const isOpen = expandedTask === w._idx;
                const enriched = enrichTask(w);
                const matTotal = enriched.materials.reduce((s, m) => s + (m.c || 0), 0);
                const conditionLabel =
                  enriched.condition === "D" ? t("wv.damaged") :
                  enriched.condition === "P" ? t("wv.poor") :
                  enriched.condition === "F" ? t("wv.fair") : "";
                return (
                  <div
                    key={w._idx}
                    style={{
                      marginBottom: 6,
                      borderRadius: 10,
                      background: w.done ? "transparent" : darkMode ? "#12121a" : "#fff",
                      border: w.done ? `1px solid ${border}` : `1px solid ${priColor(w.pri)}33`,
                      borderLeft: w.done ? `1px solid ${border}` : `3px solid ${priColor(w.pri)}`,
                      opacity: w.done ? 0.55 : 1,
                      overflow: "hidden",
                      transition: "opacity 200ms cubic-bezier(0.22, 1, 0.36, 1)",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 8px" }}>
                      {/* Checkbox — tap to toggle done. Stops propagation so it
                          doesn't also expand the task. */}
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleWO(w._idx); }}
                        aria-label={w.done ? "Mark not done" : "Mark done"}
                        style={{
                          width: 24, height: 24, borderRadius: 6, flexShrink: 0, marginTop: 1,
                          border: `2px solid ${w.done ? "var(--color-success)" : priColor(w.pri)}`,
                          background: w.done ? "var(--color-success)" : "transparent",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          color: "#fff", padding: 0, cursor: "pointer",
                        }}
                      >
                        {w.done && <Icon name="check" size={14} color="#fff" strokeWidth={3} />}
                      </button>
                      {/* Task body — tap to expand */}
                      <div
                        onClick={() => setExpandedTask(isOpen ? null : w._idx)}
                        style={{ flex: 1, cursor: "pointer" }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
                          <div style={{ fontSize: 14, fontWeight: 600, textDecoration: w.done ? "line-through" : "none" }}>{w.detail}</div>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                            {!w.done && (
                              <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 4, background: priColor(w.pri) + "22", color: priColor(w.pri), fontFamily: "Oswald", letterSpacing: ".06em" }}>
                                {priLabel(w.pri)}
                              </span>
                            )}
                            <Icon name={isOpen ? "collapse" : "expand"} size={14} color="#888" />
                          </div>
                        </div>
                        <div className="dim" style={{ fontSize: 13, marginTop: 3, lineHeight: 1.4 }}>{w.action}</div>
                        <div style={{ fontSize: 12, marginTop: 4, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                          <span style={{ color: "var(--color-primary)", fontFamily: "Oswald" }}>{w.hrs}h</span>
                          <span className="dim">{w.room}</span>
                          {matTotal > 0 && (
                            <span style={{ color: "var(--color-warning)", fontFamily: "Oswald" }}>
                              ${matTotal.toFixed(0)} mat
                            </span>
                          )}
                          {conditionLabel && (
                            <span
                              style={{
                                fontSize: 9,
                                padding: "1px 5px",
                                borderRadius: 3,
                                background: enriched.condition === "D" ? "var(--color-accent-red)22" : enriched.condition === "P" ? "var(--color-warning)22" : "var(--color-highlight)22",
                                color: enriched.condition === "D" ? "var(--color-accent-red)" : enriched.condition === "P" ? "var(--color-warning)" : "var(--color-highlight)",
                                fontFamily: "Oswald",
                                letterSpacing: ".06em",
                              }}
                            >
                              {conditionLabel}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    {/* Expanded detail panel */}
                    {isOpen && (
                      <div
                        style={{
                          padding: "10px 12px 12px 44px",
                          background: darkMode ? "#0d0d14" : "#f8f8fb",
                          borderTop: `1px solid ${border}`,
                        }}
                      >
                        {enriched.comment && (
                          <div style={{ marginBottom: 10 }}>
                            <div className="sl" style={{ fontSize: 10, marginBottom: 4 }}>{t("wv.inspectionNote")}</div>
                            <div style={{ fontSize: 13, color: darkMode ? "#cfd4dc" : "#333", lineHeight: 1.5 }}>
                              {enriched.comment}
                            </div>
                          </div>
                        )}
                        {enriched.materials.length > 0 && (
                          <div style={{ marginBottom: 10 }}>
                            <div className="sl" style={{ fontSize: 10, marginBottom: 4 }}>
                              {t("wv.materials")} ({matTotal > 0 ? `$${matTotal.toFixed(0)}` : "—"})
                            </div>
                            {enriched.materials.map((m, mi) => (
                              <div key={mi} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "2px 0" }}>
                                <span>{m.n}</span>
                                <span style={{ color: "var(--color-success)", fontFamily: "Oswald", flexShrink: 0, marginLeft: 8 }}>
                                  ${(m.c || 0).toFixed(0)}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                        {enriched.photos.length > 0 && (
                          <div>
                            <div className="sl" style={{ fontSize: 10, marginBottom: 4 }}>
                              {t("wv.beforePhotos")} ({enriched.photos.length})
                            </div>
                            <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 2 }}>
                              {enriched.photos.map((url, pi) => (
                                <a
                                  key={pi}
                                  href={url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  style={{ flexShrink: 0 }}
                                >
                                  <img
                                    src={url}
                                    alt=""
                                    style={{ width: 72, height: 72, objectFit: "cover", borderRadius: 6, border: `1px solid ${border}`, display: "block" }}
                                  />
                                </a>
                              ))}
                            </div>
                          </div>
                        )}
                        {!enriched.comment && enriched.materials.length === 0 && enriched.photos.length === 0 && (
                          <div className="dim" style={{ fontSize: 12, fontStyle: "italic" }}>
                            {t("wv.noContext")}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          )}
          {workOrder.length === 0 && (
            <div className="cd" style={{ textAlign: "center", padding: 24 }}>
              <p className="dim">{t("wv.noWorkOrder")}</p>
            </div>
          )}
        </div>
      )}

      {/* ── GUIDE TAB — interactive Tools + Shopping checklist (matches
            the QuoteForge Guide tab depth so the crew on site sees the
            same structure the estimator built). ── */}
      {section === "guide" && activeJob && (() => {
        try {
          const roomsData = jobData?.rooms || [];
          const guide = makeGuide(roomsData);
          const allTools = [...guide.tools, ...extraTools];
          const allShop: { n: string; c: number; room?: string; trade?: string }[] = [
            ...guide.shop,
            ...extraShop,
          ];
          const shopTotal = allShop.reduce((s, i) => s + (i.c || 0), 0);
          const shopRemaining = allShop.reduce(
            (s, i, idx) => s + (checkedShop.has(idx) ? 0 : i.c || 0),
            0,
          );
          const toggleTool = (tool: string) =>
            setCheckedTools((prev) => {
              const next = new Set(prev);
              if (next.has(tool)) next.delete(tool);
              else next.add(tool);
              return next;
            });
          const toggleShop = (i: number) =>
            setCheckedShop((prev) => {
              const next = new Set(prev);
              if (next.has(i)) next.delete(i);
              else next.add(i);
              return next;
            });

          return (
            <div>
              {/* Tools */}
              <div className="cd mb">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <h4 style={{ fontSize: 13, color: "var(--color-primary)", display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <Icon name="hammer" size={14} color="var(--color-primary)" />
                    {t("wv.toolsNeeded")} ({allTools.length})
                  </h4>
                  <span className="dim" style={{ fontSize: 11, fontFamily: "Oswald", letterSpacing: ".06em" }}>
                    {checkedTools.size}/{allTools.length} packed
                  </span>
                </div>
                {allTools.length === 0 && (
                  <div className="dim" style={{ fontSize: 12, padding: "4px 0" }}>No tools listed.</div>
                )}
                {allTools.map((tool, i) => {
                  const done = checkedTools.has(tool);
                  return (
                    <div
                      key={i}
                      onClick={() => toggleTool(tool)}
                      style={{
                        display: "flex", alignItems: "center", gap: 8,
                        fontSize: 13, padding: "6px 0",
                        borderBottom: `1px solid ${border}`,
                        cursor: "pointer",
                        textDecoration: done ? "line-through" : "none",
                        opacity: done ? 0.5 : 1,
                        transition: "opacity 200ms cubic-bezier(0.22, 1, 0.36, 1)",
                      }}
                    >
                      <span style={{
                        width: 18, height: 18, borderRadius: 4,
                        border: `2px solid ${done ? "var(--color-success)" : "#666"}`,
                        background: done ? "var(--color-success)" : "transparent",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        flexShrink: 0,
                      }}>
                        {done && <Icon name="check" size={12} color="#fff" strokeWidth={3} />}
                      </span>
                      {tool}
                    </div>
                  );
                })}
                {/* Add custom tool */}
                <div className="row" style={{ marginTop: 8 }}>
                  <input
                    value={newTool}
                    onChange={(e) => setNewTool(e.target.value)}
                    placeholder="Add tool…"
                    style={{ flex: 1, fontSize: 13, padding: "6px 10px" }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && newTool.trim()) {
                        setExtraTools((prev) => [...prev, newTool.trim()]);
                        setNewTool("");
                      }
                    }}
                  />
                  <button
                    onClick={() => {
                      if (newTool.trim()) {
                        setExtraTools((prev) => [...prev, newTool.trim()]);
                        setNewTool("");
                      }
                    }}
                    aria-label="Add tool"
                    style={{ background: "none", color: "var(--color-primary)", padding: "0 6px", display: "inline-flex" }}
                  >
                    <Icon name="add" size={18} />
                  </button>
                </div>
              </div>

              {/* Shopping */}
              <div className="cd">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <h4 style={{ fontSize: 13, color: "var(--color-warning)", display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <Icon name="cart" size={14} color="var(--color-warning)" />
                    {t("wv.shoppingList")} (${shopTotal.toFixed(0)})
                  </h4>
                  <span className="dim" style={{ fontSize: 11, fontFamily: "Oswald", letterSpacing: ".06em" }}>
                    ${shopRemaining.toFixed(0)} left
                  </span>
                </div>
                {allShop.length === 0 && (
                  <div className="dim" style={{ fontSize: 12, padding: "4px 0" }}>No shopping items.</div>
                )}
                {allShop.map((s, i) => {
                  const done = checkedShop.has(i);
                  const prevTrade = i > 0 ? allShop[i - 1].trade : null;
                  const curTrade = s.trade || "";
                  const showHeader = curTrade && curTrade !== prevTrade;
                  return (
                    <div key={i}>
                      {showHeader && (
                        <div
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            color: "var(--color-primary)",
                            marginTop: i > 0 ? 12 : 0,
                            marginBottom: 4,
                            fontFamily: "Oswald",
                            textTransform: "uppercase",
                            letterSpacing: ".08em",
                          }}
                        >
                          {curTrade}
                        </div>
                      )}
                      <div
                        onClick={() => toggleShop(i)}
                        style={{
                          display: "flex", justifyContent: "space-between", alignItems: "center",
                          fontSize: 13, padding: "6px 0 6px 4px",
                          borderBottom: `1px solid ${border}`,
                          cursor: "pointer",
                          textDecoration: done ? "line-through" : "none",
                          opacity: done ? 0.5 : 1,
                          transition: "opacity 200ms cubic-bezier(0.22, 1, 0.36, 1)",
                        }}
                      >
                        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{
                            width: 18, height: 18, borderRadius: 4,
                            border: `2px solid ${done ? "var(--color-success)" : "#666"}`,
                            background: done ? "var(--color-success)" : "transparent",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            flexShrink: 0,
                          }}>
                            {done && <Icon name="check" size={12} color="#fff" strokeWidth={3} />}
                          </span>
                          {s.n}
                        </span>
                        <span style={{ color: done ? "#888" : "var(--color-success)", fontFamily: "Oswald" }}>
                          ${(s.c || 0).toFixed(0)}
                        </span>
                      </div>
                    </div>
                  );
                })}
                {/* Add custom shop item */}
                <div className="row" style={{ marginTop: 8 }}>
                  <input
                    value={newShopName}
                    onChange={(e) => setNewShopName(e.target.value)}
                    placeholder="Item name…"
                    style={{ flex: 1, fontSize: 13, padding: "6px 10px" }}
                  />
                  <input
                    type="number"
                    value={newShopCost}
                    onChange={(e) => setNewShopCost(e.target.value)}
                    placeholder="$"
                    style={{ width: 64, fontSize: 13, padding: "6px 8px" }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && newShopName.trim()) {
                        setExtraShop((prev) => [...prev, {
                          n: newShopName.trim(),
                          c: parseFloat(newShopCost) || 0,
                          room: "Custom",
                          trade: "Added on site",
                        }]);
                        setNewShopName("");
                        setNewShopCost("");
                      }
                    }}
                  />
                  <button
                    onClick={() => {
                      if (newShopName.trim()) {
                        setExtraShop((prev) => [...prev, {
                          n: newShopName.trim(),
                          c: parseFloat(newShopCost) || 0,
                          room: "Custom",
                          trade: "Added on site",
                        }]);
                        setNewShopName("");
                        setNewShopCost("");
                      }
                    }}
                    aria-label="Add shopping item"
                    style={{ background: "none", color: "var(--color-warning)", padding: "0 6px", display: "inline-flex" }}
                  >
                    <Icon name="add" size={18} />
                  </button>
                </div>
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
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <h4 style={{ fontSize: 13 }}>📸 {t("wv.jobPhotos")}</h4>
            <div className="row" style={{ gap: 4 }}>
              <button
                className="bb"
                onClick={() => {
                  const input = document.createElement("input");
                  input.type = "file"; input.accept = "image/*"; input.capture = "environment";
                  input.onchange = () => { if (input.files?.[0]) uploadWorkPhoto(input.files[0]); };
                  input.click();
                }}
                style={{ fontSize: 12, padding: "5px 10px" }}
              >
                📷 {t("common.takePhoto")}
              </button>
              <button
                className="bo"
                onClick={() => {
                  const input = document.createElement("input");
                  input.type = "file"; input.accept = "image/*"; input.multiple = true;
                  input.onchange = async () => {
                    if (!input.files?.length) return;
                    for (const file of Array.from(input.files)) {
                      await uploadWorkPhoto(file);
                    }
                  };
                  input.click();
                }}
                style={{ fontSize: 12, padding: "5px 10px" }}
              >
                📁 {t("common.upload")}
              </button>
            </div>
          </div>

          {/* After photos prompt */}
          <div style={{ marginBottom: 10, padding: 8, borderRadius: 6, background: darkMode ? "#1a1a0a" : "#fffbe6", border: "1px solid var(--color-warning)", fontSize: 12 }}>
            💡 {t("wv.photosTip")}
          </div>

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
            <p className="dim" style={{ textAlign: "center", padding: 16 }}>{t("wv.noPhotos")}</p>
          )}
        </div>
      )}
      </div>{/* end swipeable */}
    </div>
  );
}
