"use client";
import { useState } from "react";
import { useStore } from "@/lib/store";
import { readLocalClock } from "@/lib/clock";
import { isUsersEntry } from "@/lib/pay";
import { t, getLang } from "@/lib/i18n";
import { formatHours, parseEntryDate } from "@/lib/dates";
import { statusColor } from "@/lib/status";
import { goWithIntent } from "@/lib/nav-intent";
import {
  stopsForDay, techDayStops, nextStopFrom, crewStatus, myDay, dayPhase, needMatch, needsNudge,
  balanceDue, isJobScheduled, fmtClock, localYmd, addDaysYmd, NEED_TAB,
  type DayStop, type NeedKey,
} from "@/lib/day-plan";
import type { TimeEntry } from "@/lib/types";
import { Icon, type IconName } from "./Icon";

/**
 * Home's day cards — what's today, who's out, what needs me, and the end-of-
 * day wrap-up. Presentational: every rule (stops, done-state, crew on the
 * clock, need buckets, the day phase) comes from lib/day-plan so Home always
 * agrees with the screen a card opens. Deep links ride the c_nav_intent
 * contract (lib/nav-intent) so Jobs / Schedule / Time open on the right
 * tab + filter.
 *
 * OwnerDay: Today card (or Wrap-up after hours) → Needs you (priority rows +
 * the 2x2) — or one calm "all caught up" card once nothing needs the owner.
 * TechDay: time-off answer → Your day (or Done for today).
 *
 * Nothing claims "caught up" / "nothing today" / done counts until a COMPLETE
 * sync has landed (dataReady = store.fullSyncAt, set only when every table
 * loaded) — an empty store mid-load, or a table that failed to fetch, must not
 * read as an empty day.
 */

/** Replace {placeholders} in a t() string. */
export function fill(str: string, vars: Record<string, string | number>): string {
  return str.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

const firstName = (n: string) => (n || "").trim().split(/\s+/)[0] || "";
const firstNames = (names: string[]) => Array.from(new Set(names.map(firstName).filter(Boolean))).join(", ");
const stopsPhrase = (n: number) => (n === 1 ? t("day.stopsOne") : fill(t("day.stopsMany"), { n }));
// Same flag the dashboard's Clock-in CTA reads (lib/clock owns it).
const isClockedIn = () => readLocalClock().on;
/** Date locale for weekday / month names — same rule as Payroll's dates. */
const dateLocale = () => (getLang() === "es" ? "es" : "en-US");
/** "Tomorrow" or the short weekday for a YYYY-MM-DD. */
const dayLabel = (day: string, tomorrow: string) =>
  day === tomorrow ? t("day.tomorrow") : new Date(day + "T12:00:00").toLocaleDateString(dateLocale(), { weekday: "short" });
/** "Tomorrow · 8:00 AM · 12 Oak St" — the next stop after an empty day. */
const whenLine = (next: { stop: DayStop; day: string }, tomorrow: string) =>
  [dayLabel(next.day, tomorrow), fmtClock(next.stop.time), next.stop.entry.job].filter(Boolean).join(" · ");
/** "Tomorrow: 3 stops · first 8:00 AM" — `stops` is already in visiting order. */
const tomorrowLine = (stops: DayStop[]) => fill(t("day.tomorrowLine"), {
  stops: stopsPhrase(stops.length),
  first: stops[0]?.time ? fill(t("day.firstAt"), { time: fmtClock(stops[0].time) }) : "",
});

const GREEN_CARD: React.CSSProperties = { background: "rgba(0,204,102,.08)", border: "1px solid rgba(0,204,102,.4)", padding: "13px 14px" };
const dot = (c: string): React.CSSProperties => ({ width: 8, height: 8, borderRadius: 4, background: c, flexShrink: 0 });

/** One calendar stop: status dot (✓ when done) · time · address · crew. */
function StopRow({ s, day, timeCol, showMine }: { s: DayStop; day: string; timeCol: boolean; showMine?: boolean }) {
  const done = s.state === "done";
  const crew = firstNames(s.crew);
  const timeLabel = s.time ? fmtClock(s.time) : s.entry.sched_date < day ? t("day.ongoing") : "";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "7px 0", borderTop: "1px solid var(--color-border-dark)", opacity: done ? 0.55 : 1 }}>
      {done
        ? <Icon name="check" size={14} color="var(--color-success)" style={{ flexShrink: 0 }} />
        : <span style={{ ...dot(statusColor(s.job?.status)), margin: "0 3px" }} />}
      {timeCol && <span style={{ fontFamily: "Oswald", fontWeight: 600, fontSize: 14, width: 62, flexShrink: 0, whiteSpace: "nowrap" }}>{timeLabel}</span>}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", textDecoration: done ? "line-through" : "none" }}>{s.entry.job}</div>
        {crew && <div className="dim" style={{ fontSize: 12, marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{crew}</div>}
      </div>
      {s.state === "now" && <span className="chip" style={{ background: "rgba(0,204,102,.16)", color: "#3ee08f", flexShrink: 0, fontSize: 11.5, padding: "2px 7px" }}>{t("day.inProgress")}</span>}
      {showMine && s.mine && <span className="chip" style={{ background: "rgba(46,139,255,.16)", color: "#7fb6ff", flexShrink: 0, fontSize: 11.5, padding: "2px 7px" }}>{t("day.yours")}</span>}
    </div>
  );
}

/** Up to 3 stops + "+N more". */
function StopList({ stops, day, showMine }: { stops: DayStop[]; day: string; showMine?: boolean }) {
  const shown = stops.slice(0, 3);
  const timeCol = shown.some((s) => s.time || s.entry.sched_date < day);
  return (
    <div style={{ marginTop: 6 }}>
      {shown.map((s) => <StopRow key={s.entry.id} s={s} day={day} timeCol={timeCol} showMine={showMine} />)}
      {stops.length > 3 && <div className="dim" style={{ fontSize: 12.5, paddingTop: 4 }}>{fill(t("day.moreStops"), { n: stops.length - 3 })}</div>}
    </div>
  );
}

/** Card header: icon + "TODAY · 3 STOPS" (+ an optional right-hand note). */
function DayHead({ title, n, right }: { title: string; n: number; right?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
      <div className="sl" style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
        <Icon name="schedule" size={15} color="#ffd84d" />
        <span>{n ? `${title} · ${stopsPhrase(n)}` : title}</span>
      </div>
      {right && <span className="dim" style={{ fontSize: 12.5, whiteSpace: "nowrap" }}>{right}</span>}
    </div>
  );
}

/** ✓ / ○ marker for the wrap-up rows. */
function Mark({ ok }: { ok: boolean }) {
  return (
    <span style={{ width: 20, height: 20, borderRadius: 10, border: `1.6px solid ${ok ? "var(--color-success)" : "var(--color-border-dark-2)"}`, background: ok ? "var(--color-success)" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
      {ok && <Icon name="check" size={12} color="#fff" />}
    </span>
  );
}

/** Plain "Log today's drives" link row. */
function DrivesRow({ setPage }: { setPage: (p: string) => void }) {
  return (
    <div className="linkrow" onClick={(e) => { e.stopPropagation(); setPage("mileage"); }}>
      <span className="lf"><span className="ic"><Icon name="mileage" size={15} /></span>{t("day.logDrives")}</span>
      <Icon name="next" size={15} color="var(--color-dim)" />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// OWNER / MANAGER
// ─────────────────────────────────────────────────────────────────────

export function OwnerDay({ setPage, openJob, openOps }: {
  setPage: (p: string) => void;
  openJob?: (jobId: string) => void;
  openOps?: (tab?: string) => void;
}) {
  const user = useStore((s) => s.user)!;
  const org = useStore((s) => s.org);
  const jobs = useStore((s) => s.jobs);
  const schedule = useStore((s) => s.schedule);
  const timeEntries = useStore((s) => s.timeEntries);
  const profiles = useStore((s) => s.profiles);
  const pendingMembers = useStore((s) => s.pendingMembers);
  const timeOffRequests = useStore((s) => s.timeOffRequests);
  const loading = useStore((s) => s.loading);
  const fullSyncAt = useStore((s) => s.fullSyncAt);
  const dataReady = !loading && fullSyncAt !== null;
  // Offline = a saved snapshot that may be hours old: who's on the clock RIGHT
  // NOW can't be confirmed (same honesty as Time → Crew).
  const usingOfflineData = useStore((s) => s.usingOfflineData);

  const now = new Date();
  const today = localYmd(now);
  const tomorrow = addDaysYmd(today, 1);
  const stops = stopsForDay({ schedule, jobs, timeEntries, day: today });
  const doneN = stops.filter((s) => s.state === "done").length;
  const { onClock, stale } = crewStatus(timeEntries, profiles, now);
  const mine = myDay(timeEntries, user, today);
  const phase = dataReady
    ? dayPhase({ hour: now.getHours(), clockedIn: isClockedIn(), admin: true, todoStops: stops.length - doneN, clockedOutToday: mine.clockedOutToday })
    : "start";

  // ── Needs-you counts ──
  const bucket = (k: NeedKey) => jobs.filter((j) => needMatch(k, j));
  const leads = bucket("lead");
  const toSend = bucket("toSend");
  const waiting = bucket("waiting");
  const toInvoice = bucket("toInvoice");
  const unpaid = bucket("unpaid");
  const toSchedule = jobs.filter((j) => j.status === "accepted" && !j.archived && !isJobScheduled(j, schedule));
  const pendingTimeOff = timeOffRequests.filter((r) => r.status === "pending");
  const actionable = stale.length + leads.length + pendingMembers.length + pendingTimeOff.length + toSchedule.length + toSend.length + toInvoice.length;
  const caughtUp = dataReady && actionable === 0;

  // What's out with customers (not on you) — the caught-up card's sub-line.
  const outLine = [
    waiting.length ? (waiting.length === 1 ? t("day.quotesOutOne") : fill(t("day.quotesOutMany"), { n: waiting.length })) : "",
    unpaid.length ? (unpaid.length === 1 ? t("day.invoicesOutOne") : fill(t("day.invoicesOutMany"), { n: unpaid.length })) : "",
  ].filter(Boolean).join(" · ");
  const outTap = unpaid.length
    ? () => goWithIntent(setPage, { page: "jobs", tab: "billing", filter: "unpaid" })
    : waiting.length
    ? () => goWithIntent(setPage, { page: "jobs", tab: "active", filter: "waiting" })
    : undefined;

  const toScheduleText = toSchedule.length === 1 ? t("day.toScheduleOne") : fill(t("day.toScheduleMany"), { n: toSchedule.length });
  const goDispatch = () => goWithIntent(setPage, { page: "sched", tab: "dispatch" });
  const goCrew = () => goWithIntent(setPage, { page: "time", tab: "crew" });
  const tomorrowStops = stopsForDay({ schedule, jobs, timeEntries, day: tomorrow }).filter((s) => s.state !== "done");
  const tomorrowText = tomorrowStops.length ? tomorrowLine(tomorrowStops) : t("day.tomorrowNothing");

  // ── Day card ──
  let dayCard: React.ReactNode;
  // True once the wrap-up folds into one calm line — only then does it stand
  // in for the caught-up card below.
  let wrapCollapsed = false;
  if (phase === "wrap") {
    type Row = { key: string; ok: boolean; text: string; go?: () => void };
    const rows: Row[] = [];
    rows.push(onClock.length
      ? { key: "crew", ok: false, text: fill(t("day.stillOn"), { names: firstNames(onClock.map((c) => c.name)) }), go: goCrew }
      : usingOfflineData
        ? { key: "crew", ok: false, text: t("timer.crewNotSynced"), go: goCrew }
        : { key: "crew", ok: true, text: t("day.crewOff") });
    if (tomorrowStops.length) rows.push({ key: "tomorrow", ok: true, text: tomorrowText });
    if (toSchedule.length) rows.push({ key: "toSchedule", ok: false, text: toScheduleText, go: goDispatch });
    else if (!tomorrowStops.length) rows.push({ key: "tomorrow", ok: true, text: t("day.tomorrowNothing") });
    // Payday — only on the org's payroll weekday (default Friday).
    if (now.getDay() === (org?.auto_payroll_day ?? 5)) {
      if (org?.auto_payroll_enabled) {
        rows.push({ key: "payday", ok: true, text: t("day.autoPayToday") });
      } else {
        const owed = profiles.filter((p) => timeEntries.some((e) =>
          isUsersEntry(e, p) && !e.paid_at && (e.hours || 0) > 0)).length;
        if (owed) rows.push({ key: "payday", ok: false, text: owed === 1 ? t("day.paydayOne") : fill(t("day.paydayMany"), { n: owed }), go: () => openOps?.("payroll") });
      }
    }

    if (rows.every((r) => r.ok) && actionable === 0) {
      // Everything's handled — one calm line instead of a checklist.
      wrapCollapsed = true;
      dayCard = (
        <div className="cd" onClick={outTap} style={{ ...GREEN_CARD, cursor: outTap ? "pointer" : "default" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Icon name="checkCircle" size={24} color="var(--color-success)" />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 15.5 }}>{t("day.enjoyEvening")}</div>
              <div className="dim" style={{ fontSize: 13, marginTop: 2 }}>{tomorrowText}</div>
              {outLine && <div className="dim" style={{ fontSize: 13, marginTop: 2 }}>{outLine}</div>}
            </div>
          </div>
          {mine.workedJobToday && <div style={{ marginTop: 8, borderTop: "1px solid var(--color-border-dark)" }}><DrivesRow setPage={setPage} /></div>}
        </div>
      );
    } else {
      dayCard = (
        <div className="section" style={{ marginBottom: 0 }}>
          <div className="seclabel"><Icon name="checkCircle" size={14} />{t("day.wrapTitle")}</div>
          {rows.map((r) => (
            <div key={r.key} className="linkrow" onClick={r.go} style={{ cursor: r.go ? "pointer" : "default" }}>
              <span className="lf" style={{ minWidth: 0 }}>
                <Mark ok={r.ok} />
                <span style={{ color: r.ok ? "var(--color-dim)" : "inherit" }}>{r.text}</span>
              </span>
              {r.go && <Icon name="next" size={15} color="var(--color-dim)" />}
            </div>
          ))}
          {mine.workedJobToday && <DrivesRow setPage={setPage} />}
        </div>
      );
    }
  } else {
    const next = stops.length ? null : nextStopFrom({ schedule, jobs, timeEntries, fromDay: tomorrow });
    dayCard = (
      <div className="cd" onClick={() => goWithIntent(setPage, { page: "sched", tab: "day" })} style={{ cursor: "pointer", padding: "12px 13px" }}>
        <DayHead
          title={t("day.today")}
          n={stops.length}
          right={dataReady && stops.length ? fill(t("day.doneCount"), { done: doneN, total: stops.length }) : undefined}
        />
        {/* Empty-day copy waits for a complete sync — mid-load the header stands alone. */}
        {stops.length ? (
          <StopList stops={stops} day={today} />
        ) : dataReady ? (
          <div style={{ marginTop: 6 }}>
            <div style={{ fontSize: 15, fontWeight: 600 }}>{t("day.nothingToday")}</div>
            {next && <div className="dim" style={{ fontSize: 13, marginTop: 2 }}>{fill(t("day.nextOn"), { when: whenLine(next, tomorrow) })}</div>}
          </div>
        ) : null}
        {/* Crew line — who's out right now (taps through to Time → Crew). */}
        {(dataReady || onClock.length > 0) && (
          <div
            onClick={(e) => { e.stopPropagation(); goCrew(); }}
            style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--color-border-dark)", fontSize: 13, cursor: "pointer" }}
          >
            {onClock.length ? (
              <>
                <span style={dot("var(--color-success)")} />
                <span style={{ flex: 1, minWidth: 0 }}>{fill(t("day.onClock"), { names: firstNames(onClock.map((c) => c.name)) })}</span>
              </>
            ) : (
              <span className="dim" style={{ flex: 1, minWidth: 0 }}>{usingOfflineData ? t("timer.crewNotSynced") : t("day.noOneOnClock")}</span>
            )}
            <Icon name="next" size={14} color="var(--color-dim)" />
          </div>
        )}
      </div>
    );
  }

  // ── Needs you ──
  let needsYou: React.ReactNode = null;
  if (caughtUp) {
    // A collapsed wrap-up already says it (+ the quotes/invoices-out line). An
    // open checklist (someone still on the clock, payday owed) must not sit
    // over "You're all caught up" — keep only what's out with customers.
    if (phase === "wrap" && !wrapCollapsed) {
      if (outLine) {
        needsYou = (
          <div className="cd" onClick={outTap} style={{ ...GREEN_CARD, display: "flex", alignItems: "center", gap: 12, cursor: outTap ? "pointer" : "default" }}>
            <Icon name="checkCircle" size={20} color="var(--color-success)" />
            <div style={{ flex: 1, minWidth: 0, fontSize: 14 }}>{outLine}</div>
            {outTap && <Icon name="next" size={15} color="var(--color-dim)" />}
          </div>
        );
      }
    } else if (phase !== "wrap") {
      needsYou = (
        <div className="cd" onClick={outTap} style={{ ...GREEN_CARD, display: "flex", alignItems: "center", gap: 12, cursor: outTap ? "pointer" : "default" }}>
          <Icon name="checkCircle" size={24} color="var(--color-success)" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 15.5 }}>{t("day.allCaughtUp")}</div>
            <div className="dim" style={{ fontSize: 13, marginTop: 2 }}>{outLine || t("day.nothingNeedsYou")}</div>
          </div>
        </div>
      );
    }
  } else {
    const staleName = (e: TimeEntry) =>
      firstName((profiles.find((p) => p.id === e.user_id) || profiles.find((p) => p.name === e.user_name))?.name || e.user_name || "");
    // Fixed rank — most time-sensitive first. Rendered only when > 0.
    const prio: { key: string; n: number; c: string; icon: IconName; text: string; go: () => void }[] = [
      {
        key: "stale", n: stale.length, c: "#ffb15e", icon: "warn", go: goCrew,
        text: stale.length === 1
          ? fill(t("day.openShiftOne"), { name: staleName(stale[0]), day: parseEntryDate(stale[0].entry_date)?.toLocaleDateString(dateLocale(), { weekday: "long" }) || stale[0].entry_date })
          : fill(t("day.openShiftMany"), { n: stale.length }),
      },
      {
        key: "leads", n: leads.length, c: "#ff3d6e", icon: "star",
        text: leads.length === 1 ? t("day.newLeadOne") : fill(t("day.newLeadMany"), { n: leads.length }),
        go: () => {
          if (leads.length === 1 && openJob) openJob(leads[0].id);
          else if (leads.length === 1) goWithIntent(setPage, { page: "jobs", jobId: leads[0].id });
          else goWithIntent(setPage, { page: "jobs", tab: "active", filter: "lead" });
        },
      },
      {
        key: "join", n: pendingMembers.length, c: "#8cc0ff", icon: "clients", go: () => openOps?.("team"),
        text: pendingMembers.length === 1 ? t("day.joinOne") : fill(t("day.joinMany"), { n: pendingMembers.length }),
      },
      {
        key: "timeOff", n: pendingTimeOff.length, c: "#3ee08f", icon: "leaf", go: () => openOps?.("hr"),
        text: pendingTimeOff.length === 1 ? t("day.timeOffOne") : fill(t("day.timeOffMany"), { n: pendingTimeOff.length }),
      },
      // In the evening the Wrap-up card's Tomorrow row already asks for this — don't say it twice.
      { key: "toSchedule", n: phase === "wrap" ? 0 : toSchedule.length, c: "#ff9f43", icon: "schedule", text: toScheduleText, go: goDispatch },
    ].filter((r) => r.n > 0);

    const sum = (list: typeof jobs) => Math.round(list.reduce((s, j) => s + balanceDue(j), 0));
    const nudgeN = waiting.filter((j) => needsNudge(j, now)).length;
    const invoiceAmt = sum(toInvoice);
    const unpaidAmt = sum(unpaid);
    const tiles: { k: Exclude<NeedKey, "lead">; n: number; l: string; c: string; sub: string }[] = [
      { k: "toSend", n: toSend.length, l: t("dash.toSend"), c: "#ff5b5b", sub: "" },
      { k: "waiting", n: waiting.length, l: t("dash.waitingOnCustomer"), c: "#ff9f43", sub: nudgeN ? fill(t("day.needNudge"), { n: nudgeN }) : "" },
      { k: "toInvoice", n: toInvoice.length, l: t("dash.toInvoice"), c: "#2e8bff", sub: invoiceAmt > 0 ? fill(t("day.amtDue"), { amt: invoiceAmt.toLocaleString() }) : "" },
      { k: "unpaid", n: unpaid.length, l: t("dash.unpaid"), c: "#7b54f0", sub: unpaidAmt > 0 ? fill(t("day.amtDue"), { amt: unpaidAmt.toLocaleString() }) : "" },
    ];

    needsYou = (
      <div>
        <div className="sl" style={{ margin: "0 2px 7px" }}>{t("dash.needsAttention")}</div>
        {prio.length > 0 && (
          <div className="section" style={{ marginBottom: 8 }}>
            {prio.map((r) => (
              <div key={r.key} className="linkrow" onClick={r.go}>
                <span className="lf" style={{ minWidth: 0, flex: 1 }}>
                  <span className="ic" style={{ background: `${r.c}22`, color: r.c }}><Icon name={r.icon} size={15} color={r.c} /></span>
                  <span style={{ lineHeight: 1.3 }}>{r.text}</span>
                </span>
                <span className="chip" style={{ background: `${r.c}22`, color: r.c, flexShrink: 0 }}>{r.n}</span>
              </div>
            ))}
          </div>
        )}
        <div className="needgrid">
          {tiles.map((a) => (
            // A zero tile drops the statusstrip (no breathing glow) and dims.
            <div
              key={a.k}
              className={a.n ? "cd statusstrip top" : "cd"}
              onClick={() => goWithIntent(setPage, { page: "jobs", tab: NEED_TAB[a.k], filter: a.k })}
              style={{ ["--c" as any]: a.c, padding: "14px 10px 12px", cursor: "pointer", textAlign: "center", opacity: a.n ? 1 : 0.55 }}
            >
              <div style={{ fontFamily: "Oswald", fontWeight: 700, fontSize: 24, lineHeight: 1, color: a.n ? a.c : "var(--color-dim)" }}>{a.n}</div>
              <div className="dim" style={{ fontSize: 12, marginTop: 5 }}>{a.l}</div>
              {a.sub && <div className="dim" style={{ fontSize: 11.5, marginTop: 3 }}>{a.sub}</div>}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <>
      {dayCard}
      {needsYou}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────
// TECH / APPRENTICE
// ─────────────────────────────────────────────────────────────────────

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** "Oct 20–22", "Oct 30 – Nov 2", or "Oct 20" for a single day. */
function fmtRange(start: string, end?: string): string {
  const s = parseEntryDate(start);
  const e = parseEntryDate(end || start);
  if (!s || !e) return start;
  const md = (d: Date) => d.toLocaleDateString(dateLocale(), { month: "short", day: "numeric" });
  if (s.getTime() === e.getTime()) return md(s);
  // "Oct 20–22" only reads right month-first (Spanish puts the day first).
  if (getLang() !== "es" && s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear()) return `${md(s)}–${e.getDate()}`;
  return `${md(s)} – ${md(e)}`;
}

export function TechDay({ setPage, openOps }: {
  setPage: (p: string) => void;
  openOps?: (tab?: string) => void;
}) {
  const user = useStore((s) => s.user)!;
  const jobs = useStore((s) => s.jobs);
  const schedule = useStore((s) => s.schedule);
  const timeEntries = useStore((s) => s.timeEntries);
  const timeOffRequests = useStore((s) => s.timeOffRequests);
  const loading = useStore((s) => s.loading);
  const fullSyncAt = useStore((s) => s.fullSyncAt);
  const dataReady = !loading && fullSyncAt !== null;
  const uid = user.id;
  const seenKey = `creed_to_seen_${uid}`;
  // The time-off answer the tech already dismissed (one card per decision).
  const [seenTo, setSeenTo] = useState<string>(() => { try { return localStorage.getItem(seenKey) || ""; } catch { return ""; } });

  const me = user.name;
  const now = new Date();
  const today = localYmd(now);
  const tomorrow = addDaysYmd(today, 1);
  // Today's stops still to do — mine when I have ANY today (done or not), else
  // everyone's. Once my own stops are done the list is empty, so the card wraps.
  const list = techDayStops(stopsForDay({ schedule, jobs, timeEntries, day: today, me }));
  const mine = myDay(timeEntries, user, today);
  const phase = dataReady
    ? dayPhase({ hour: now.getHours(), clockedIn: isClockedIn(), admin: false, todoStops: list.length, clockedOutToday: mine.clockedOutToday })
    : "start";

  // ── Time-off answer (newest decision in the last week, until dismissed) ──
  const decided = timeOffRequests
    .filter((r) => r.user_id === uid && (r.status === "approved" || r.status === "denied") && !!r.decided_at
      && now.getTime() - Date.parse(r.decided_at) <= WEEK_MS)
    .sort((a, b) => (b.decided_at || "").localeCompare(a.decided_at || ""))[0];
  const ackTo = () => {
    if (!decided) return;
    try { localStorage.setItem(seenKey, decided.id); } catch { /* blocked storage — hides for this visit */ }
    setSeenTo(decided.id);
  };
  let timeOffCard: React.ReactNode = null;
  if (decided && decided.id !== seenTo) {
    const ok = decided.status === "approved";
    const c = ok ? "#3ee08f" : "#ffb15e";
    const dates = fmtRange(decided.start_date, decided.end_date);
    timeOffCard = (
      <div className="cd" onClick={() => openOps?.()} style={{ display: "flex", alignItems: "center", gap: 11, padding: "12px", cursor: "pointer", border: `1px solid ${ok ? "rgba(0,204,102,.4)" : "rgba(255,177,94,.45)"}` }}>
        <Icon name="leaf" size={18} color={c} style={{ flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 600, color: c }}>
          {ok ? fill(t("day.timeOffApproved"), { dates }) : fill(t("day.timeOffDenied"), { dates, who: decided.decided_by || t("day.theOffice") })}
        </div>
        <button onClick={(e) => { e.stopPropagation(); ackTo(); }} aria-label={t("dash.dismiss")} style={{ background: "none", border: "none", color: "var(--color-dim)", cursor: "pointer", padding: 2, display: "inline-flex", flexShrink: 0 }}>
          <Icon name="close" size={15} />
        </button>
      </div>
    );
  }

  // ── Day card ──
  let dayCard: React.ReactNode;
  if (phase === "wrap") {
    const myTomorrow = stopsForDay({ schedule, jobs, timeEntries, day: tomorrow, me }).filter((s) => s.mine && s.state !== "done");
    dayCard = (
      <div className="cd" style={GREEN_CARD}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Icon name="checkCircle" size={24} color="var(--color-success)" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 15.5 }}>
              {t("day.doneForToday")} <span className="dim" style={{ fontWeight: 500, fontSize: 13.5 }}>· {fill(t("day.hoursToday"), { hrs: formatHours(mine.hoursToday) })}</span>
            </div>
            <div className="dim" style={{ fontSize: 13, marginTop: 2 }}>{myTomorrow.length ? tomorrowLine(myTomorrow) : t("day.tomorrowNothingYours")}</div>
          </div>
        </div>
        {mine.workedJobToday && <div style={{ marginTop: 8, borderTop: "1px solid var(--color-border-dark)" }}><DrivesRow setPage={setPage} /></div>}
      </div>
    );
  } else {
    const next = list.length ? null : nextStopFrom({ schedule, jobs, timeEntries, fromDay: tomorrow, me });
    dayCard = (
      <div className="cd" onClick={() => setPage("workvision")} style={{ cursor: "pointer", padding: "12px 13px" }}>
        <DayHead title={t("day.yourDay")} n={list.length} />
        {/* Empty-day copy waits for a complete sync — mid-load the header stands alone. */}
        {list.length ? (
          <StopList stops={list} day={today} showMine />
        ) : dataReady ? (
          <div style={{ marginTop: 6 }}>
            <div style={{ fontSize: 15, fontWeight: 600 }}>{t("day.nothingYoursToday")}</div>
            {next && <div className="dim" style={{ fontSize: 13, marginTop: 2 }}>{fill(t("day.nextOn"), { when: whenLine(next, tomorrow) })}</div>}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <>
      {timeOffCard}
      {dayCard}
    </>
  );
}
