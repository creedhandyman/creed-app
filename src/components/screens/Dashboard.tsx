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
  const payHistory = useStore((s) => s.payHistory);
  const notifications = useStore((s) => s.notifications);
  const unreadCount = notifications.filter((n) => !n.read_at).length;

  // ── Next Job on Schedule ──
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const upcoming = schedule
    .filter((s) => s.sched_date >= today)
    .sort((a, b) => a.sched_date.localeCompare(b.sched_date));
  const nextJob = upcoming[0];

  // ── Your next check (this user) ──
  // Mirrors what Run Payroll actually pays: every UNPAID time entry × rate,
  // with NO week window — so the dashboard number always agrees with the
  // check (payroll pays all unpaid hours, not a calendar week). Approved
  // quest bonuses are added by the admin at payout time, so they're
  // intentionally not previewed here. The user-match mirrors payroll's
  // self-run claim (by id, or legacy name when the row predates the
  // user_id column) so the same entries are counted.
  const rate = user.rate || 55;
  const mine = timeEntries.filter((e) => e.user_id === user.id || (!e.user_id && e.user_name === user.name));
  const unpaidMine = mine.filter((e) => !e.paid_at);
  const checkHrs = unpaidMine.reduce((s, e) => s + (e.hours || 0), 0);
  const checkPay = checkHrs * rate;
  // Most recent payout (store loads pay_history newest-first) labels the
  // period — the unpaid entries are exactly everything since that date.
  const myPays = payHistory.filter((p) => p.user_id === user.id);
  const lastPayDate = myPays.length ? myPays[0].pay_date : null;
  // This-week vs last-week pay — the "watch it grow / beat last week" hook.
  // parseEntryDate keeps manual (ISO-dated) entries in the right week.
  const ws = new Date(now); ws.setDate(now.getDate() - now.getDay()); ws.setHours(0, 0, 0, 0);
  const lastWs = new Date(ws); lastWs.setDate(ws.getDate() - 7);
  const hrsBetween = (from: Date, to: Date | null) =>
    mine.filter((e) => { const d = parseEntryDate(e.entry_date); return d ? d >= from && (!to || d < to) : false; })
      .reduce((s, e) => s + (e.hours || 0), 0);
  const weekPay = hrsBetween(ws, null) * rate;
  const lastWeekPay = hrsBetween(lastWs, ws) * rate;
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
  // Bucket by job/created date with parseEntryDate (LOCAL — same as the week
  // stats above). Raw `new Date("YYYY-MM-DD")` parses as UTC midnight, which in
  // any US time zone is the PREVIOUS evening, so jobs dated on the 1st (and the
  // boundary) were dropping out of "this month" and undercounting the figure.
  const earnedMonth = jobs
    .filter((j) => {
      if (!["complete", "invoiced", "paid"].includes(j.status)) return false;
      const d = parseEntryDate(j.job_date || j.created_at);
      return d ? d >= monthStart : false;
    })
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
  // Glow CTA — layout + hue live in globals.css (.cta / .glow-*) so every
  // screen draws the same button. See app/globals.css "GLOW CTA".
  const Cta = ({ glow, icon, title, sub, onClick }: { glow: "blue" | "red" | "green"; icon: IconName; title: string; sub: string; onClick: () => void }) => (
    <div onClick={onClick} className={`cta glow-${glow}`}>
      <div className="ic"><Icon name={icon} size={24} color="#fff" strokeWidth={2} /></div>
      <div className="tx">
        <b>{title}</b>
        <small>{sub}</small>
      </div>
      <Icon name="next" size={19} color="#fff" />
    </div>
  );
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
              <div style={{ fontFamily: "Oswald", fontWeight: 600, fontSize: 16.5, letterSpacing: ".3px" }}>{nextJob.job}</div>
              <div className="dim" style={{ fontSize: 13, marginTop: 2 }}>
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
              <div style={{ fontFamily: "Oswald", fontWeight: 600, fontSize: 16, letterSpacing: ".3px" }}>{t("dash.noNextJob")}</div>
              <div className="dim" style={{ fontSize: 13, marginTop: 2 }}>Tap to schedule a job</div>
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
          <div className="dim" style={{ fontSize: 14 }}>{isAdmin ? "Welcome back" : "Let's get it"}</div>
          <div style={{ fontFamily: "Oswald", fontWeight: 700, fontSize: 23, letterSpacing: ".8px", textTransform: "uppercase" }}>{user.name}</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => setShowNotifs(true)} aria-label="Notifications" title="Notifications" className="iconbtn" style={{ position: "relative" }}>
            <Icon name="bell" size={18} />
            {unreadCount > 0 && (
              <span style={{ position: "absolute", top: -4, right: -4, minWidth: 17, height: 17, padding: "0 4px", borderRadius: 9, background: "var(--color-accent-red)", color: "#fff", fontSize: 12, fontWeight: 700, fontFamily: "Oswald", display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1, border: "1.5px solid var(--color-dark-bg)" }}>
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
        <div className="cd mb statusstrip" style={{ ["--c" as any]: "var(--color-primary)", padding: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Icon name="rocket" size={18} color="var(--color-primary)" />
              <h4 style={{ fontSize: 16, color: "var(--color-primary)" }}>{t("dash.gettingStarted")}</h4>
            </div>
            <button onClick={() => { localStorage.setItem("c_guide_dismissed", "1"); setGuideDismissed(true); }} aria-label="Dismiss" style={{ background: "none", padding: 4, color: "#555", display: "inline-flex", alignItems: "center" }}>
              <Icon name="close" size={16} />
            </button>
          </div>
          <div className="dim" style={{ fontSize: 14, marginTop: 6 }}>Create a quote → Schedule the job → Clock in → Complete → Get paid</div>
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
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {[
                  { n: toSend, l: "To send", c: "#ff5b5b" },
                  { n: toInvoice, l: "To invoice", c: "#2e8bff" },
                  { n: unpaid, l: "Unpaid", c: "#7b54f0" },
                ].map((a) => (
                  <div key={a.l} className="cd statusstrip" onClick={() => setPage("jobs")} style={{ ["--c" as any]: a.c, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", cursor: "pointer" }}>
                    <div className="dim" style={{ fontSize: 13.5 }}>{a.l}</div>
                    <div style={{ fontFamily: "Oswald", fontWeight: 700, fontSize: 22, lineHeight: 1, color: a.c }}>{a.n}</div>
                  </div>
                ))}
              </div>
            </div>
            <div className="cd" style={{ display: "flex", padding: "13px 0" }}>
              {[
                { l: "My check", v: `$${checkPay.toFixed(0)}`, green: true },
                { l: "This month", v: `$${earnedMonth.toLocaleString()}`, green: false },
                { l: "Pipeline", v: pipeline >= 1000 ? `$${(pipeline / 1000).toFixed(1)}k` : `$${pipeline.toFixed(0)}`, green: false },
              ].map((m, i) => (
                <div key={m.l} style={{ flex: 1, textAlign: "center", borderLeft: i ? "1px solid var(--color-border-dark)" : "none" }}>
                  <div className="sl" style={{ fontSize: 11.5 }}>{m.l}</div>
                  <div style={{ fontFamily: "Oswald", fontWeight: 700, fontSize: 20, marginTop: 3, color: m.green ? "var(--color-money)" : "inherit" }}>{m.v}</div>
                </div>
              ))}
            </div>
            <DashboardCardPreview />
          </>
        ) : (
          <>
            {/* Tech hero — next check (grows as you log) + beat-last-week hook */}
            <div className="cd" style={{ background: "rgba(0,204,102,.09)", border: "1px solid rgba(0,204,102,.4)", borderRadius: 18, padding: 16, boxShadow: "0 0 30px -14px rgba(0,204,102,.5)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <div style={{ fontSize: 12, letterSpacing: ".15em", textTransform: "uppercase", color: "#3ee08f", fontWeight: 600 }}>{t("dash.nextCheck")}</div>
                  <div style={{ fontFamily: "Oswald", fontWeight: 700, fontSize: 38, color: "#3ee08f", lineHeight: 1, marginTop: 4 }}>${checkPay.toFixed(0)}</div>
                </div>
                <span style={{ fontSize: 12, fontWeight: 600, color: "#3ee08f", background: "rgba(0,204,102,.16)", padding: "4px 9px", borderRadius: 99, display: "inline-flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}>
                  <Icon name="trending" size={12} color="#3ee08f" /> {lastWeekPay > 0 ? (toBeat > 0 ? "keep going" : "ahead of last week") : `${checkHrs.toFixed(1)} hrs`}
                </span>
              </div>
              <div className="dim" style={{ fontSize: 13.5, marginTop: 6 }}>{checkHrs.toFixed(1)} hrs unpaid · ${rate}/hr{lastPayDate ? ` · since ${lastPayDate}` : ""}</div>
              {/* This week vs last week — the come-back-tomorrow incentive */}
              <div style={{ height: 8, background: "rgba(255,255,255,.07)", borderRadius: 5, overflow: "hidden", marginTop: 12 }}>
                <div style={{ height: "100%", width: `${weekProgress}%`, background: "var(--color-success)", borderRadius: 5, boxShadow: "0 0 12px -1px var(--color-success)" }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--color-dim)", marginTop: 5 }}>
                <span>This week ${weekPay.toFixed(0)}</span>
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
                  <div style={{ fontSize: 14.5, fontWeight: 600 }}>{closest.name} · {closest.bonus} bonus</div>
                  <div style={{ height: 6, background: "var(--color-card-dark-3)", borderRadius: 4, overflow: "hidden", marginTop: 5 }}>
                    <div style={{ height: "100%", width: `${Math.min(100, (closest.p / closest.g) * 100)}%`, background: "var(--color-violet)", borderRadius: 4 }} />
                  </div>
                </div>
                <div style={{ fontFamily: "Oswald", fontWeight: 700, color: "var(--color-violet)", fontSize: 15, whiteSpace: "nowrap" }}>{closest.p}/{closest.g}</div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
