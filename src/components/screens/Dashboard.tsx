"use client";
import { useState } from "react";
import { useStore } from "@/lib/store";
import { t } from "@/lib/i18n";
import { parseEntryDate, formatHours } from "@/lib/dates";
import { Icon, type IconName } from "../Icon";
import DashboardCardPreview from "../DashboardCardPreview";
import NotificationsPanel from "../NotificationsPanel";
import GettingStarted from "../GettingStarted";
import BrandFooter from "../BrandFooter";
import { OwnerDay, TechDay, fill } from "../DayCards";
import CountUp from "@/components/CountUp";
import { useBackLayer } from "@/lib/back-layer";
import { computeQuests, parseQuestConfig } from "@/lib/quests";
import { goWithIntent } from "@/lib/nav-intent";
import { stopsForDay, fmtClock, localYmd } from "@/lib/day-plan";

interface Props {
  setPage: (p: string) => void;
  openSettings: () => void;
  /** Deep-link to a job's detail screen — used when a notification is tapped. */
  openJob?: (jobId: string) => void;
  /** Open Operations on a specific sub-tab — used by the getting-started card. */
  openOps?: (tab?: string) => void;
}

export default function Dashboard({ setPage, openSettings, openJob, openOps }: Props) {
  const user = useStore((s) => s.user)!;
  const org = useStore((s) => s.org);
  const isAdmin = user.role === "owner" || user.role === "manager";
  const jobs = useStore((s) => s.jobs);
  const darkMode = useStore((s) => s.darkMode);
  const schedule = useStore((s) => s.schedule);
  const timeEntries = useStore((s) => s.timeEntries);
  const reviews = useStore((s) => s.reviews);
  const referrals = useStore((s) => s.referrals);
  const payHistory = useStore((s) => s.payHistory);
  const notifications = useStore((s) => s.notifications);
  const unreadCount = notifications.filter((n) => !n.read_at).length;

  const now = new Date();

  // ── Your next check (this user) ──
  // Mirrors what Run Payroll actually pays: every UNPAID time entry × rate,
  // with NO week window — so the dashboard number always agrees with the
  // check (payroll pays all unpaid hours, not a calendar week). Approved
  // quest bonuses are added by the admin at payout time, so they're
  // intentionally not previewed here. The user-match mirrors payroll's
  // self-run claim (by id, or legacy name when the row predates the
  // user_id column) so the same entries are counted.
  const rate = user.rate || 55;
  // No rate on file yet (new joiners start at 0) → show HOURS, never a
  // made-up $55/hr figure. `rate` above stays for the math.
  const rateSet = (user.rate || 0) > 0;
  const mine = timeEntries.filter((e) => e.user_id === user.id || (!e.user_id && e.user_name === user.name));
  const unpaidMine = mine.filter((e) => !e.paid_at);
  const checkHrs = unpaidMine.reduce((s, e) => s + (e.hours || 0), 0);
  const checkPay = checkHrs * rate;
  // Most recent payout (store loads pay_history newest-first) labels the
  // period — the unpaid entries are exactly everything since that date.
  const myPays = payHistory.filter((p) => p.user_id === user.id);
  const lastPayRaw = myPays.length ? myPays[0].pay_date : null;
  const lastPayDate = lastPayRaw
    ? parseEntryDate(lastPayRaw)?.toLocaleDateString("en-US", { month: "short", day: "numeric" }) || lastPayRaw
    : null;
  // This-week vs last-week pay — the "watch it grow / beat last week" hook.
  // parseEntryDate keeps manual (ISO-dated) entries in the right week.
  const ws = new Date(now); ws.setDate(now.getDate() - now.getDay()); ws.setHours(0, 0, 0, 0);
  const lastWs = new Date(ws); lastWs.setDate(ws.getDate() - 7);
  const hrsBetween = (from: Date, to: Date | null) =>
    mine.filter((e) => { const d = parseEntryDate(e.entry_date); return d ? d >= from && (!to || d < to) : false; })
      .reduce((s, e) => s + (e.hours || 0), 0);
  const weekHrs = hrsBetween(ws, null);
  const lastWeekHrs = hrsBetween(lastWs, ws);
  const weekPay = weekHrs * rate;
  const lastWeekPay = lastWeekHrs * rate;
  const toBeat = Math.max(0, lastWeekPay - weekPay);
  const weekProgress = lastWeekPay > 0 ? Math.min(100, (weekPay / lastWeekPay) * 100) : (weekPay > 0 ? 100 : 0);

  // ── Closest Quest ──
  // The shared quest engine with the Quests screen's exact inputs (this user,
  // this 6-month cycle, the org's toggles + shop quests), so the card's
  // progress always matches the Quests tab.
  const { config: questConfig, custom: customQuests } = parseQuestConfig(org?.quest_config);
  const cycleStart = new Date(now.getFullYear(), now.getMonth() < 6 ? 0 : 6, 1);
  const { allQuests } = computeQuests({
    userId: user.id,
    userName: user.name,
    jobs, reviews, referrals, timeEntries,
    questConfig,
    cycleStart,
    customQuests,
  });
  const closest = allQuests
    .filter((q) => q.progress < q.goal && q.key !== "handy_king")
    .sort((a, b) => (b.progress / (b.goal || 1)) - (a.progress / (a.goal || 1)))[0];

  // ── Owner money + pipeline triage ──
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  // Bucket by job/created date with parseEntryDate (LOCAL — same as the week
  // stats above). Raw `new Date("YYYY-MM-DD")` parses as UTC midnight, which in
  // any US time zone is the PREVIOUS evening, so jobs dated on the 1st (and the
  // boundary) were dropping out of "this month" and undercounting the figure.
  // Must stay the same revenue rule as lib/financials profitSnapshot (earned
  // statuses, non-archived, month-to-date) so this figure = Ops hub = Financials.
  const earnedMonth = jobs
    .filter((j) => {
      if (j.archived) return false;
      if (!["complete", "invoiced", "paid"].includes(j.status)) return false;
      const d = parseEntryDate(j.job_date || j.created_at);
      return d ? d >= monthStart : false;
    })
    .reduce((s, j) => s + (j.total || 0), 0);
  const open = jobs.filter((j) => !j.archived);
  // The Needs-attention buckets (to send / waiting / to invoice / unpaid)
  // live in lib/day-plan needMatch, rendered by DayCards' OwnerDay.
  const pipeline = open
    .filter((j) => ["lead", "quoted", "accepted", "scheduled", "active"].includes(j.status))
    .reduce((s, j) => s + (j.total || 0), 0);

  const isClocked = (() => { try { return JSON.parse(localStorage.getItem("c_t_on") || "false"); } catch { return false; } })();
  const clockedJob = (() => { try { return localStorage.getItem("c_t_sj") ? JSON.parse(localStorage.getItem("c_t_sj")!) : ""; } catch { return ""; } })();

  const [showNotifs, setShowNotifs] = useState(false);
  useBackLayer(showNotifs, () => setShowNotifs(false));

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
  // Off the clock, the Clock-in CTA names the next stop still to do today
  // (mine first) — "8:00 AM · 12 Oak St" — else the plain prompt.
  const myNextStop = isClocked ? undefined
    : stopsForDay({ schedule, jobs, timeEntries, day: localYmd(now), me: user.name }).find((s) => s.state !== "done");
  const quoteCta = <Cta glow="blue" icon="quote" title={t("dash.startQuote")} sub={t("dash.quoteInspectUpload")} onClick={() => setPage("qf")} />;
  const clockCta = isClocked
    ? <Cta glow="green" icon="worker" title={t("wv.workMode")} sub={clockedJob || t("dash.onTheClock")} onClick={() => setPage("workvision")} />
    : <Cta glow="red" icon="start" title={t("wv.clockIn")} sub={myNextStop ? [fmtClock(myNextStop.time), myNextStop.entry.job].filter(Boolean).join(" · ") : t("wv.startDay")} onClick={() => setPage("workvision")} />;

  return (
    <div className="fi" style={{ minHeight: "calc(100dvh - 150px)", display: "flex", flexDirection: "column" }}>
      {/* Topbar — plain, no banner: greeting + name (left) · the business
          logo (center) · bell + settings (right). Equal side columns keep
          the logo dead center. No logo yet → the business's initials. */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", gap: 6, marginBottom: 14 }}>
        <div style={{ minWidth: 0 }}>
          <div className="dim" style={{ fontSize: 13 }}>{isAdmin ? t("dash.welcomeBack") : t("dash.letsGetIt")}</div>
          <div style={{ fontFamily: "Oswald", fontWeight: 700, fontSize: 18, letterSpacing: ".4px", textTransform: "uppercase", lineHeight: 1.1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{user.name.trim().split(/\s+/)[0]}</div>
        </div>
        <div style={{ height: 110, maxWidth: 170, display: "flex", alignItems: "center", justifyContent: "center" }}>
          {org?.logo_url ? (
            <img src={org.logo_url} alt={org.name || ""} style={{ height: "100%", width: "auto", maxWidth: "100%", objectFit: "contain", display: "block" }} />
          ) : (
            <span style={{ fontFamily: "Oswald", fontWeight: 700, fontSize: 24, color: "var(--color-primary)" }}>
              {(org?.name || user.name || "?").split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase()}
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
          <button onClick={() => setShowNotifs(true)} aria-label={t("notif.title")} title={t("notif.title")} className="iconbtn" style={{ position: "relative" }}>
            <Icon name="bell" size={18} />
            {unreadCount > 0 && (
              <span style={{ position: "absolute", top: -4, right: -4, minWidth: 17, height: 17, padding: "0 4px", borderRadius: 9, background: "var(--color-accent-red)", color: "#fff", fontSize: 12, fontWeight: 700, fontFamily: "Oswald", display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1, border: "1.5px solid var(--color-dark-bg)" }}>
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </button>
          <button onClick={openSettings} aria-label={t("settings.title")} title={t("settings.title")} className="iconbtn"><Icon name="settings" size={18} /></button>
        </div>
      </div>

      {showNotifs && <NotificationsPanel onClose={() => setShowNotifs(false)} onOpenJob={openJob} onOpenOps={openOps} />}

      {isAdmin && openOps && <GettingStarted setPage={setPage} openOps={openOps} />}

      {/* Variant body — flex-grows to fill the screen; blocks distribute evenly */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between", gap: 14 }}>
        {isAdmin ? (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>{quoteCta}{clockCta}</div>
            {/* Today (or Wrap-up after hours) → Needs you — order never changes */}
            <OwnerDay setPage={setPage} openJob={openJob} openOps={openOps} />
            <div className="cd" style={{ display: "flex", padding: "13px 0" }}>
              {[
                { k: "myCheck", l: t("dash.myCheck"), v: `$${checkPay.toFixed(0)}`, green: true, go: () => setPage("time") },
                { k: "thisMonth", l: t("dash.thisMonth"), v: `$${earnedMonth.toLocaleString()}`, green: false, go: () => openOps?.("financials") },
                { k: "pipeline", l: t("dash.pipeline"), v: pipeline >= 1000 ? `$${(pipeline / 1000).toFixed(1)}k` : `$${pipeline.toFixed(0)}`, green: false, go: () => goWithIntent(setPage, { page: "jobs", tab: "active" }) },
              ].map((m, i) => (
                // A button that keeps the plain cell look (global button styles reset).
                <button key={m.k} onClick={m.go} style={{ flex: 1, textAlign: "center", borderTop: "none", borderRight: "none", borderBottom: "none", borderLeft: i ? "1px solid var(--color-border-dark)" : "none", background: "none", borderRadius: 0, padding: 0, color: "inherit", font: "inherit", textTransform: "none", letterSpacing: "normal", cursor: "pointer" }}>
                  <div className="sl" style={{ fontSize: 11.5 }}>{m.l}</div>
                  <div style={{ fontFamily: "Oswald", fontWeight: 700, fontSize: 20, marginTop: 3, color: m.green ? "var(--color-money)" : "inherit" }}>{m.v}</div>
                </button>
              ))}
            </div>
            <DashboardCardPreview />
          </>
        ) : (
          <>
            {/* Tech hero — next check (grows as you log) + beat-last-week hook */}
            <div className="cd" style={{ background: "rgba(0,204,102,.09)", border: "1px solid rgba(0,204,102,.4)", borderRadius: 18, padding: 16, boxShadow: darkMode ? "0 0 30px -14px rgba(0,204,102,.5)" : "none" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <div style={{ fontSize: 12, letterSpacing: ".15em", textTransform: "uppercase", color: "#3ee08f", fontWeight: 600 }}>{t("dash.nextCheck")}</div>
                  <div style={{ fontFamily: "Oswald", fontWeight: 700, fontSize: 38, color: "#3ee08f", lineHeight: 1, marginTop: 4 }}>{rateSet ? <CountUp value={checkPay} prefix="$" /> : formatHours(checkHrs)}</div>
                </div>
                <span style={{ fontSize: 12, fontWeight: 600, color: "#3ee08f", background: "rgba(0,204,102,.16)", padding: "4px 9px", borderRadius: 99, display: "inline-flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}>
                  <Icon name="trending" size={12} color="#3ee08f" /> {lastWeekPay > 0 ? (toBeat > 0 ? t("dash.keepGoing") : t("dash.aheadOfLastWeek")) : formatHours(checkHrs)}
                </span>
              </div>
              <div className="dim" style={{ fontSize: 13.5, marginTop: 6 }}>
                {rateSet
                  ? `${formatHours(checkHrs)} ${t("dash.unpaid")} · $${rate}/hr${lastPayDate ? ` · ${t("dash.since")} ${lastPayDate}` : ""}`
                  : `${formatHours(checkHrs)} ${t("dash.unpaid")} · ${t("settings.rateNotSet")}`}
              </div>
              {/* This week vs last week — the come-back-tomorrow incentive */}
              <div style={{ height: 8, background: "rgba(255,255,255,.07)", borderRadius: 5, overflow: "hidden", marginTop: 12 }}>
                <div style={{ height: "100%", width: `${weekProgress}%`, background: "var(--color-success)", borderRadius: 5, boxShadow: darkMode ? "0 0 12px -1px var(--color-success)" : "none" }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--color-dim)", marginTop: 5 }}>
                <span>{t("dash.thisWeek")} {rateSet ? `$${weekPay.toFixed(0)}` : formatHours(weekHrs)}</span>
                <span>
                  {lastWeekPay > 0
                    ? (toBeat > 0
                      ? (rateSet
                        ? fill(t("dash.toBeatLastWeek"), { amt: toBeat.toFixed(0), last: lastWeekPay.toFixed(0) })
                        : fill(t("dash.toBeatLastWeekHrs"), { amt: formatHours(Math.max(0, lastWeekHrs - weekHrs)), last: formatHours(lastWeekHrs) }))
                      : t("dash.beatLastWeek"))
                    : t("dash.buildStreak")}
                </span>
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>{clockCta}{quoteCta}</div>
            <TechDay setPage={setPage} openOps={openOps} />

            {closest && (
              <div className="cd" onClick={() => setPage("quests")} style={{ display: "flex", alignItems: "center", gap: 11, cursor: "pointer", padding: "12px" }}>
                <div style={{ width: 34, height: 34, borderRadius: 10, background: "rgba(157,78,221,.16)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <Icon name="trophy" size={17} color="var(--color-violet)" />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14.5, fontWeight: 600 }}>{closest.name} · {closest.bonus} {t("dash.bonus")}</div>
                  <div style={{ height: 6, background: "var(--color-card-dark-3)", borderRadius: 4, overflow: "hidden", marginTop: 5 }}>
                    <div style={{ height: "100%", width: `${Math.min(100, (closest.progress / (closest.goal || 1)) * 100)}%`, background: "var(--color-violet)", borderRadius: 4 }} />
                  </div>
                </div>
                <div style={{ fontFamily: "Oswald", fontWeight: 700, color: "var(--color-violet)", fontSize: 15, whiteSpace: "nowrap" }}>{closest.progress}/{closest.goal}</div>
              </div>
            )}
          </>
        )}
        <BrandFooter />
      </div>
    </div>
  );
}
