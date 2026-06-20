"use client";
import { useState } from "react";
import { useStore } from "@/lib/store";
import { t } from "@/lib/i18n";
import { parseEntryDate } from "@/lib/dates";
import { Icon, type IconName } from "../Icon";
import DashboardCardPreview from "../DashboardCardPreview";
import UserGuideModal from "../UserGuideModal";
import NotificationsPanel from "../NotificationsPanel";

interface Props {
  setPage: (p: string) => void;
  openSettings: () => void;
  /** Deep-link to a job's detail screen — used when a notification is tapped. */
  openJob?: (jobId: string) => void;
}

export default function Dashboard({ setPage, openSettings, openJob }: Props) {
  const user = useStore((s) => s.user)!;
  const isAdmin = user.role === "owner" || user.role === "manager";
  const jobs = useStore((s) => s.jobs);
  const schedule = useStore((s) => s.schedule);
  const timeEntries = useStore((s) => s.timeEntries);
  const reviews = useStore((s) => s.reviews);
  const notifications = useStore((s) => s.notifications);
  const unreadCount = notifications.filter((n) => !n.read_at).length;

  // ── Next Job on Schedule ──
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const upcoming = schedule
    .filter((s) => s.sched_date >= today)
    .sort((a, b) => a.sched_date.localeCompare(b.sched_date));
  const nextJob = upcoming[0];

  // ── This week's pay (this user) + last week, for the tech hero card ──
  const ws = new Date(now);
  ws.setDate(now.getDate() - now.getDay());
  ws.setHours(0, 0, 0, 0);
  const lastWs = new Date(ws);
  lastWs.setDate(ws.getDate() - 7);
  // Parse via the shared local-date helper. Manual entries store "YYYY-MM-DD",
  // which the old inline parser read as UTC midnight and bucketed into the
  // previous day's week — the "couple hours off" pay drift. See lib/dates.ts.
  const entryDate = (e: { entry_date?: string }): Date | null => parseEntryDate(e.entry_date);
  const mine = timeEntries.filter((e) => e.user_id === user.id || e.user_name === user.name);
  const weekEntries = mine.filter((e) => { const d = entryDate(e); return d ? d >= ws : false; });
  const lastWeekEntries = mine.filter((e) => { const d = entryDate(e); return d ? d >= lastWs && d < ws : false; });
  const rate = user.rate || 55;
  const weekHrs = weekEntries.reduce((s, e) => s + (e.hours || 0), 0);
  const weekPay = weekHrs * rate;
  const lastWeekPay = lastWeekEntries.reduce((s, e) => s + (e.hours || 0), 0) * rate;
  const daysIn = new Set(weekEntries.map((e) => e.entry_date)).size;
  const toBeat = Math.max(0, lastWeekPay - weekPay);
  const weekProgress = lastWeekPay > 0 ? Math.min(100, (weekPay / lastWeekPay) * 100) : (weekPay > 0 ? 100 : 0);

  // ── Closest Quest ──
  const completedJobs = jobs.filter((j) => j.status === "complete" || j.status === "invoiced" || j.status === "paid").length;
  const positiveReviews = reviews.filter((r) => (r.rating || 0) >= 3).length;
  const fiveStarReviews = reviews.filter((r) => r.rating === 5).length;
  const quests = [
    { name: "Review Favor", p: positiveReviews, g: 15, bonus: "$75" },
    { name: "Five Star Tech", p: fiveStarReviews, g: 10, bonus: "$100" },
    { name: "Super Handy", p: completedJobs, g: 10, bonus: "$50" },
  ];
  const closest = quests.filter((q) => q.p < q.g).sort((a, b) => (b.p / b.g) - (a.p / a.g))[0];

  // ── Owner money + pipeline triage ──
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const earnedMonth = jobs
    .filter((j) => ["complete", "invoiced", "paid"].includes(j.status) && (() => { try { return new Date(j.job_date || j.created_at) >= monthStart; } catch { return false; } })())
    .reduce((s, j) => s + (j.total || 0), 0);
  const open = jobs.filter((j) => !j.archived);
  const toSend = open.filter((j) => j.status === "quoted").length;
  const toInvoice = open.filter((j) => j.status === "complete").length;
  const unpaid = open.filter((j) => j.status === "invoiced").length;
  const pipeline = open
    .filter((j) => ["lead", "quoted", "accepted", "scheduled", "active"].includes(j.status))
    .reduce((s, j) => s + (j.total || 0), 0);

  const isClocked = (() => { try { return JSON.parse(localStorage.getItem("c_t_on") || "false"); } catch { return false; } })();
  const clockedJob = (() => { try { return localStorage.getItem("c_t_sj") ? JSON.parse(localStorage.getItem("c_t_sj")!) : ""; } catch { return ""; } })();

  const [guideDismissed, setGuideDismissed] = useState(() => {
    if (typeof window === "undefined") return true;
    try { return !!localStorage.getItem("c_guide_dismissed"); } catch { return true; }
  });
  const [showUserGuide, setShowUserGuide] = useState(false);
  const [showNotifs, setShowNotifs] = useState(false);

  // ── Shared building blocks ──
  const Cta = ({ glow, icon, title, sub, onClick }: { glow: "blue" | "red" | "green"; icon: IconName; title: string; sub: string; onClick: () => void }) => {
    const c = glow === "blue" ? "46,139,255" : glow === "green" ? "0,204,102" : "255,91,91";
    return (
      <div
        onClick={onClick}
        style={{
          display: "flex", alignItems: "center", gap: 13, padding: 16, borderRadius: 18, cursor: "pointer", color: "#fff",
          background: `rgba(${c},0.14)`,
          border: `1.5px solid rgba(${c},0.85)`,
          boxShadow: `0 0 24px -2px rgba(${c},0.5), inset 0 0 22px -8px rgba(${c},0.45)`,
        }}
      >
        <div style={{ width: 46, height: 46, borderRadius: 13, background: "rgba(255,255,255,.13)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <Icon name={icon} size={24} color="#fff" strokeWidth={2} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: "Oswald", fontWeight: 600, fontSize: 17, letterSpacing: ".4px", textTransform: "uppercase" }}>{title}</div>
          <div style={{ fontSize: 11.5, color: "#ffffffcc" }}>{sub}</div>
        </div>
        <Icon name="next" size={19} color="#fff" />
      </div>
    );
  };
  const quoteCta = <Cta glow="blue" icon="quote" title={t("dash.startQuote")} sub="Quote · inspect · upload" onClick={() => setPage("qf")} />;
  const clockCta = isClocked
    ? <Cta glow="green" icon="worker" title="Work Mode" sub={clockedJob || "On the clock"} onClick={() => setPage("workvision")} />
    : <Cta glow="red" icon="start" title="Clock In" sub="Start your day" onClick={() => setPage("workvision")} />;

  const upNext = (
    <div>
      <div className="sl" style={{ margin: "0 2px 6px" }}>Up next</div>
      <div className="cd" onClick={() => setPage("sched")} style={{ display: "flex", alignItems: "center", gap: 12, cursor: "pointer", padding: "12px 13px" }}>
        <div style={{ width: 38, height: 38, borderRadius: 11, background: "rgba(255,204,0,.14)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <Icon name="schedule" size={19} color="#ffd84d" />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          {nextJob ? (
            <>
              <div style={{ fontFamily: "Oswald", fontWeight: 600, fontSize: 14.5, letterSpacing: ".3px" }}>{nextJob.job}</div>
              <div className="dim" style={{ fontSize: 11, marginTop: 2 }}>
                {(() => {
                  const d = new Date(nextJob.sched_date + "T12:00:00");
                  const dayStr = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
                  const tm = nextJob.note?.match(/🕐\s*(\d{1,2}:\d{2})/);
                  const timeStr = tm ? (() => { const [h, m] = tm[1].split(":").map(Number); const ap = h >= 12 ? "PM" : "AM"; return `${h > 12 ? h - 12 : h || 12}:${String(m).padStart(2, "0")} ${ap}`; })() : "";
                  return `${dayStr}${timeStr ? ` · ${timeStr}` : ""}`;
                })()}
              </div>
            </>
          ) : (
            <>
              <div style={{ fontFamily: "Oswald", fontWeight: 600, fontSize: 14, letterSpacing: ".3px" }}>{t("dash.noNextJob")}</div>
              <div className="dim" style={{ fontSize: 11, marginTop: 2 }}>Tap to schedule a job</div>
            </>
          )}
        </div>
        <Icon name="next" size={16} color="var(--color-dim)" />
      </div>
    </div>
  );

  return (
    <div className="fi" style={{ minHeight: "calc(100dvh - 150px)", display: "flex", flexDirection: "column" }}>
      {/* Topbar — greeting + name + help / settings */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <div>
          <div className="dim" style={{ fontSize: 12 }}>{isAdmin ? "Welcome back" : "Let's get it"}</div>
          <div style={{ fontFamily: "Oswald", fontWeight: 700, fontSize: 21, letterSpacing: ".8px", textTransform: "uppercase" }}>{user.name}</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => setShowNotifs(true)} aria-label="Notifications" title="Notifications" className="iconbtn" style={{ position: "relative" }}>
            <Icon name="bell" size={18} />
            {unreadCount > 0 && (
              <span style={{ position: "absolute", top: -4, right: -4, minWidth: 17, height: 17, padding: "0 4px", borderRadius: 9, background: "var(--color-accent-red)", color: "#fff", fontSize: 10, fontWeight: 700, fontFamily: "Oswald", display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1, border: "1.5px solid var(--color-dark-bg)" }}>
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </button>
          <button onClick={() => setShowUserGuide(true)} aria-label="User guide" title="User guide" className="iconbtn"><Icon name="help" size={18} /></button>
          <button onClick={openSettings} aria-label="Settings" title="Settings" className="iconbtn"><Icon name="settings" size={18} /></button>
        </div>
      </div>

      {showNotifs && <NotificationsPanel onClose={() => setShowNotifs(false)} onOpenJob={openJob} />}
      {showUserGuide && <UserGuideModal onClose={() => setShowUserGuide(false)} />}

      {!guideDismissed && (
        <div className="cd mb" style={{ borderLeft: "3px solid var(--color-primary)", padding: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Icon name="rocket" size={18} color="var(--color-primary)" />
              <h4 style={{ fontSize: 14, color: "var(--color-primary)" }}>{t("dash.gettingStarted")}</h4>
            </div>
            <button onClick={() => { localStorage.setItem("c_guide_dismissed", "1"); setGuideDismissed(true); }} aria-label="Dismiss" style={{ background: "none", padding: 4, color: "#555", display: "inline-flex", alignItems: "center" }}>
              <Icon name="close" size={16} />
            </button>
          </div>
          <div className="dim" style={{ fontSize: 12, marginTop: 6 }}>Create a quote → Schedule the job → Clock in → Complete → Get paid</div>
        </div>
      )}

      {/* Variant body — flex-grows to fill the screen; blocks distribute evenly */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between", gap: 14 }}>
        {isAdmin ? (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>{quoteCta}{clockCta}</div>
            {upNext}
            <div>
              <div className="sl" style={{ margin: "0 2px 7px" }}>Needs attention</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 9 }}>
                {[
                  { n: toSend, l: "To send", c: "#ff5b5b" },
                  { n: toInvoice, l: "To invoice", c: "#2e8bff" },
                  { n: unpaid, l: "Unpaid", c: "#7b54f0" },
                ].map((a) => (
                  <div key={a.l} className="cd" onClick={() => setPage("jobs")} style={{ position: "relative", overflow: "hidden", textAlign: "center", padding: "13px 8px", cursor: "pointer" }}>
                    <span style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: a.c }} />
                    <div style={{ fontFamily: "Oswald", fontWeight: 700, fontSize: 24, lineHeight: 1, color: a.c }}>{a.n}</div>
                    <div className="dim" style={{ fontSize: 10, marginTop: 4 }}>{a.l}</div>
                  </div>
                ))}
              </div>
            </div>
            <div className="cd" style={{ display: "flex", padding: "13px 0" }}>
              {[
                { l: "This week", v: `$${weekPay.toFixed(0)}`, green: true },
                { l: "This month", v: `$${earnedMonth.toLocaleString()}`, green: false },
                { l: "Pipeline", v: pipeline >= 1000 ? `$${(pipeline / 1000).toFixed(1)}k` : `$${pipeline.toFixed(0)}`, green: false },
              ].map((m, i) => (
                <div key={m.l} style={{ flex: 1, textAlign: "center", borderLeft: i ? "1px solid var(--color-border-dark)" : "none" }}>
                  <div className="sl" style={{ fontSize: 9.5 }}>{m.l}</div>
                  <div style={{ fontFamily: "Oswald", fontWeight: 700, fontSize: 18, marginTop: 3, color: m.green ? "var(--color-money)" : "inherit" }}>{m.v}</div>
                </div>
              ))}
            </div>
            <DashboardCardPreview />
          </>
        ) : (
          <>
            {/* Tech hero — this week's pay growing */}
            <div className="cd" style={{ background: "rgba(0,204,102,.09)", border: "1px solid rgba(0,204,102,.4)", borderRadius: 18, padding: 16, boxShadow: "0 0 30px -14px rgba(0,204,102,.5)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <div style={{ fontSize: 10, letterSpacing: ".15em", textTransform: "uppercase", color: "#3ee08f", fontWeight: 600 }}>This week&apos;s pay</div>
                  <div style={{ fontFamily: "Oswald", fontWeight: 700, fontSize: 38, color: "#3ee08f", lineHeight: 1, marginTop: 4 }}>${weekPay.toFixed(0)}</div>
                </div>
                {lastWeekPay > 0 && (
                  <span style={{ fontSize: 10, fontWeight: 600, color: "#3ee08f", background: "rgba(0,204,102,.16)", padding: "4px 9px", borderRadius: 99, display: "inline-flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}>
                    <Icon name="trending" size={12} color="#3ee08f" /> {toBeat > 0 ? "keep going" : "ahead of last week"}
                  </span>
                )}
              </div>
              <div className="dim" style={{ fontSize: 11.5, marginTop: 4 }}>{weekHrs.toFixed(1)} hrs · ${rate}/hr{daysIn > 0 ? ` · ${daysIn} ${daysIn === 1 ? "day" : "days"} in` : ""}</div>
              <div style={{ height: 8, background: "rgba(255,255,255,.07)", borderRadius: 5, overflow: "hidden", marginTop: 12 }}>
                <div style={{ height: "100%", width: `${weekProgress}%`, background: "var(--color-success)", borderRadius: 5, boxShadow: "0 0 12px -1px var(--color-success)" }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--color-dim)", marginTop: 5 }}>
                <span>Mon–Sun</span>
                <span>{lastWeekPay > 0 ? (toBeat > 0 ? `$${toBeat.toFixed(0)} to beat last week ($${lastWeekPay.toFixed(0)})` : "Beat last week!") : "Build your streak"}</span>
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>{clockCta}{quoteCta}</div>
            {upNext}

            {closest && (
              <div className="cd" onClick={() => setPage("quests")} style={{ display: "flex", alignItems: "center", gap: 11, cursor: "pointer", padding: "12px" }}>
                <div style={{ width: 34, height: 34, borderRadius: 10, background: "rgba(157,78,221,.16)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <Icon name="trophy" size={17} color="var(--color-violet)" />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600 }}>{closest.name} · {closest.bonus} bonus</div>
                  <div style={{ height: 6, background: "var(--color-card-dark-3)", borderRadius: 4, overflow: "hidden", marginTop: 5 }}>
                    <div style={{ height: "100%", width: `${Math.min(100, (closest.p / closest.g) * 100)}%`, background: "var(--color-violet)", borderRadius: 4 }} />
                  </div>
                </div>
                <div style={{ fontFamily: "Oswald", fontWeight: 700, color: "var(--color-violet)", fontSize: 13, whiteSpace: "nowrap" }}>{closest.p}/{closest.g}</div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
