"use client";
import { useState } from "react";
import { useStore } from "@/lib/store";
import { db } from "@/lib/supabase";
import { t } from "@/lib/i18n";
import { QRCodeSVG } from "qrcode.react";

interface Quest {
  name: string;
  desc: string;
  bonus: string;
  progress: number;
  goal: number;
  unit: string;
  tier: string;
  tierColor: string;
}

export default function Quests() {
  const user = useStore((s) => s.user)!;
  const org = useStore((s) => s.org);
  const profiles = useStore((s) => s.profiles);
  const jobs = useStore((s) => s.jobs);
  const reviews = useStore((s) => s.reviews);
  const referrals = useStore((s) => s.referrals);
  const timeEntries = useStore((s) => s.timeEntries);
  const loadAll = useStore((s) => s.loadAll);
  const darkMode = useStore((s) => s.darkMode);

  const [tab, setTab] = useState("quests");

  // Review form
  const [rn, setRn] = useState("");
  const [rt, setRt] = useState("");
  const [rr, setRr] = useState(5);

  // Referral form
  const [fn, setFn] = useState("");
  const [fs, setFs] = useState("");

  // 6-month quest cycle
  const now = new Date();
  const cycleStart = new Date(now.getFullYear(), now.getMonth() < 6 ? 0 : 6, 1);
  const cycleEnd = new Date(cycleStart.getFullYear(), cycleStart.getMonth() + 6, 1);
  const cycleLabel = `${cycleStart.toLocaleDateString("en-US", { month: "short" })} \u2013 ${new Date(cycleStart.getFullYear(), cycleStart.getMonth() + 6, 0).toLocaleDateString("en-US", { month: "short", year: "numeric" })}`;

  // Countdown to reset
  const msLeft = cycleEnd.getTime() - now.getTime();
  const daysLeft = Math.floor(msLeft / (1000 * 60 * 60 * 24));
  const hoursLeft = Math.floor((msLeft % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const inCycle = (dateStr?: string) => {
    if (!dateStr) return false;
    try { return new Date(dateStr) >= cycleStart; } catch { return false; }
  };

  // Computed stats — filtered to current 6-month cycle
  const cycleJobs = jobs.filter((j) => inCycle(j.created_at));
  const completedJobs = cycleJobs.filter((j) => j.status === "complete" || j.status === "invoiced" || j.status === "paid").length;
  const positiveReviews = reviews.filter((r) => (r.rating || 0) >= 3 && inCycle(r.created_at)).length;
  const fiveStarReviews = reviews.filter((r) => r.rating === 5 && inCycle(r.created_at)).length;
  const convertedReferrals = referrals.filter((r) => r.status === "converted" && inCycle(r.created_at)).length;

  // Group jobs by client to find repeat clients with 5+ jobs (cycle)
  const jobsByClient: Record<string, number> = {};
  cycleJobs.filter((j) => j.client).forEach((j) => {
    jobsByClient[j.client] = (jobsByClient[j.client] || 0) + 1;
  });
  const repeatClients = Object.values(jobsByClient).filter((c) => c >= 5).length;

  // Big jobs (24+ hours, cycle)
  const bigJobs = cycleJobs.filter((j) => (j.status === "complete" || j.status === "paid") && (j.total_hrs || 0) >= 24).length;

  // Total hours logged
  const totalHours = timeEntries.reduce((s, e) => s + (e.hours || 0), 0);

  // Skill Mastery: count completed jobs per trade (cycle)
  const jobsByTrade: Record<string, number> = {};
  cycleJobs.filter((j) => (j.status === "complete" || j.status === "paid") && j.trade).forEach((j) => {
    jobsByTrade[j.trade] = (jobsByTrade[j.trade] || 0) + 1;
  });
  const tradesMastered = Object.values(jobsByTrade).filter((c) => c >= 10).length;
  const bestTradeCount = Math.max(0, ...Object.values(jobsByTrade));

  // Zero Callback: consecutive completed jobs with no callback (cycle)
  const completedJobsSorted = cycleJobs
    .filter((j) => j.status === "complete" || j.status === "paid")
    .sort((a, b) => (a.created_at > b.created_at ? -1 : 1));
  let zeroCallbackStreak = 0;
  for (const j of completedJobsSorted) {
    if (j.callback) break;
    zeroCallbackStreak++;
  }

  // Mr.Speed: days with 5+ completed jobs (cycle)
  const jobsByDate: Record<string, number> = {};
  cycleJobs.filter((j) => j.status === "complete" || j.status === "paid").forEach((j) => {
    const d = j.job_date || j.created_at?.split("T")[0] || "";
    if (d) jobsByDate[d] = (jobsByDate[d] || 0) + 1;
  });
  const speedDays = Object.values(jobsByDate).filter((c) => c >= 5).length;

  // Deal Closer: upsell jobs (cycle)
  const upsellCount = cycleJobs.filter((j) => j.is_upsell).length;

  // Repeat Machine: unique techs requested by 3+ different clients (cycle)
  const requestsByTech: Record<string, Set<string>> = {};
  cycleJobs.filter((j) => j.requested_tech && j.client).forEach((j) => {
    if (!requestsByTech[j.requested_tech]) requestsByTech[j.requested_tech] = new Set();
    requestsByTech[j.requested_tech].add(j.client);
  });
  const techsRequestedByName = Object.values(requestsByTech).filter((clients) => clients.size >= 3).length;

  // HandyKing: count how many of the other 11 quests are complete
  const handyKingProgress = [
    positiveReviews >= 15,
    fiveStarReviews >= 10,
    completedJobs >= 10,
    convertedReferrals >= 1,
    repeatClients >= 1,
    upsellCount >= 1,
    techsRequestedByName >= 1,
    bestTradeCount >= 10,
    bigJobs >= 7,
    zeroCallbackStreak >= 20,
    speedDays >= 1,
  ].filter(Boolean).length;

  // Read quest config from org
  let questConfig: Record<string, { enabled: boolean; bonus: number }> = {};
  try { questConfig = org?.quest_config ? JSON.parse(org.quest_config) : {}; } catch { /* */ }
  const defaults: Record<string, number> = {
    review_favor: 75, five_star: 100, super_handy: 50, network_scout: 50,
    critical_referral: 150, deal_closer: 25, repeat_machine: 100,
    skill_mastery: 100, make_ready: 350, zero_callback: 150, mr_speed: 25, handy_king: 750,
  };
  const qBonus = (key: string) => questConfig[key]?.bonus ?? defaults[key] ?? 0;
  const qEnabled = (key: string) => questConfig[key]?.enabled !== false;

  // All quests by tier
  const tiers: { name: string; color: string; quests: Quest[] }[] = [
    {
      name: "TIER 1: FOUNDATION",
      color: "var(--color-primary)",
      quests: [
        qEnabled("review_favor") && { name: "Review Favor", desc: "Collect 15 positive testimonials (3+ stars)", bonus: "$" + qBonus("review_favor"), progress: Math.min(positiveReviews, 15), goal: 15, unit: "reviews", tier: "T1", tierColor: "var(--color-primary)" },
        qEnabled("five_star") && { name: "Five Star Tech", desc: "Collect 10 five-star reviews", bonus: "$" + qBonus("five_star"), progress: Math.min(fiveStarReviews, 10), goal: 10, unit: "5★", tier: "T1", tierColor: "var(--color-primary)" },
        qEnabled("super_handy") && { name: "Super Handy", desc: "Complete 10 work orders", bonus: "$" + qBonus("super_handy"), progress: Math.min(completedJobs, 10), goal: 10, unit: "jobs", tier: "T1", tierColor: "var(--color-primary)" },
      ].filter(Boolean) as Quest[],
    },
    {
      name: "TIER 2: GROWTH",
      color: "var(--color-success)",
      quests: [
        qEnabled("network_scout") && { name: "Network Scout", desc: "Secure new jobs from clients", bonus: "$" + qBonus("network_scout"), progress: convertedReferrals, goal: 1, unit: "secured", tier: "T2", tierColor: "var(--color-success)" },
        qEnabled("critical_referral") && { name: "Critical Referral", desc: "Turn 1 client into 5 jobs", bonus: "$" + qBonus("critical_referral"), progress: Math.min(repeatClients, 1), goal: 1, unit: "client", tier: "T2", tierColor: "var(--color-success)" },
        qEnabled("deal_closer") && { name: "Deal Closer", desc: `Upsell on existing jobs — ${upsellCount} logged`, bonus: "$" + qBonus("deal_closer"), progress: Math.min(upsellCount, 1), goal: 1, unit: "upsells", tier: "T2", tierColor: "var(--color-success)" },
        qEnabled("repeat_machine") && { name: "Repeat Machine", desc: `3 clients request tech by name${Object.keys(requestsByTech).length ? " (" + Object.entries(requestsByTech).map(([t, c]) => `${t}: ${c.size}`).join(", ") + ")" : ""}`, bonus: "$" + qBonus("repeat_machine"), progress: Math.min(techsRequestedByName, 1), goal: 1, unit: "techs", tier: "T2", tierColor: "var(--color-success)" },
      ].filter(Boolean) as Quest[],
    },
    {
      name: "TIER 3: MASTERY",
      color: "var(--color-warning)",
      quests: [
        qEnabled("skill_mastery") && { name: "Skill Mastery", desc: `10 jobs in your best trade${bestTradeCount > 0 ? " \u2014 " + Object.entries(jobsByTrade).sort((a, b) => b[1] - a[1]).map(([t, c]) => `${t}: ${c}`).join(", ") : ""}`, bonus: "$" + qBonus("skill_mastery"), progress: Math.min(bestTradeCount, 10), goal: 10, unit: "jobs", tier: "T3", tierColor: "var(--color-warning)" },
        qEnabled("make_ready") && { name: "Make Ready Pro", desc: "7 unit turns (24+ hrs each)", bonus: "$" + qBonus("make_ready"), progress: Math.min(bigJobs, 7), goal: 7, unit: "turns", tier: "T3", tierColor: "var(--color-warning)" },
        qEnabled("zero_callback") && { name: "Zero Callback", desc: "20 consecutive jobs, no callbacks", bonus: "$" + qBonus("zero_callback"), progress: Math.min(zeroCallbackStreak, 20), goal: 20, unit: "streak", tier: "T3", tierColor: "var(--color-warning)" },
        qEnabled("mr_speed") && { name: "Mr.Speed", desc: "5 work orders in one day", bonus: "$" + qBonus("mr_speed"), progress: Math.min(speedDays, 1), goal: 1, unit: "days", tier: "T3", tierColor: "var(--color-warning)" },
      ].filter(Boolean) as Quest[],
    },
    {
      name: "TIER 4: LEGEND",
      color: "var(--color-accent-red)",
      quests: [
        qEnabled("handy_king") && {
          name: "HandyKing 👑",
          desc: `Complete ALL other quests — ${handyKingProgress}/11 done`,
          bonus: "$" + qBonus("handy_king"),
          progress: handyKingProgress,
          goal: 11,
          unit: "quests",
          tier: "T4",
          tierColor: "var(--color-accent-red)",
        },
      ].filter(Boolean) as Quest[],
    },
  ];

  // Remove empty tiers
  const activeTiers = tiers.filter((t) => t.quests.length > 0);

  // Calculate total max bonus
  const allQuests2 = activeTiers.flatMap((t) => t.quests);
  const maxPayout = allQuests2.reduce((s, q) => s + (parseInt(q.bonus.replace(/[^0-9]/g, "")) || 0), 0);

  // Calculate total bonus earned
  const allQuests = tiers.flatMap((t) => t.quests);
  const completedCount = allQuests.filter((q) => q.progress >= q.goal).length;
  const bonusEarned = allQuests
    .filter((q) => q.progress >= q.goal)
    .reduce((s, q) => {
      const num = parseInt(q.bonus.replace(/[^0-9]/g, "")) || 0;
      return s + num;
    }, 0);


  const addReview = async () => {
    if (!rn || !rt) return;
    await db.post("reviews", { client_name: rn, review_text: rt, rating: rr });
    setRn("");
    setRt("");
    setRr(5);
    loadAll();
  };

  const addReferral = async () => {
    if (!fn) return;
    await db.post("referrals", {
      name: fn,
      source: fs,
      status: "pending",
      ref_date: new Date().toLocaleDateString(),
    });
    setFn("");
    setFs("");
    loadAll();
  };

  return (
    <div className="fi">
      <h2 style={{ fontSize: 22, color: "var(--color-primary)", marginBottom: 14 }}>
        🎯 {t("quest.title")} <span className="dim" style={{ fontSize: 13, fontWeight: 400 }}>{cycleLabel}</span>
      </h2>

      {/* Sub-tabs */}
      <div style={{ display: "flex", gap: 3, marginBottom: 12 }}>
        {[
          { id: "quests", l: `🎯${t("quest.quests")}` },
          { id: "team", l: `👷${t("quest.team")}` },
          { id: "reviews", l: `⭐${t("quest.reviews")}` },
          { id: "referrals", l: `🤝${t("quest.referrals")}` },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: "5px 12px",
              borderRadius: 6,
              fontSize: 13,
              background: tab === t.id ? "var(--color-primary)" : "transparent",
              color: tab === t.id ? "#fff" : "#888",
              fontFamily: "Oswald",
            }}
          >
            {t.l}
          </button>
        ))}
      </div>

      {/* QUESTS TAB */}
      {tab === "quests" && (
        <div>
          {/* Countdown to reset */}
          <div className="cd mb" style={{ textAlign: "center", padding: 8, borderLeft: "3px solid var(--color-highlight)" }}>
            <div className="row" style={{ justifyContent: "center", gap: 12 }}>
              <div>
                <span style={{ fontFamily: "Oswald", fontSize: 16, fontWeight: 700, color: daysLeft <= 14 ? "var(--color-accent-red)" : "var(--color-highlight)" }}>{daysLeft}</span>
                <span className="dim" style={{ fontSize: 12, marginLeft: 3 }}>days</span>
              </div>
              <div>
                <span style={{ fontFamily: "Oswald", fontSize: 16, fontWeight: 700, color: daysLeft <= 14 ? "var(--color-accent-red)" : "var(--color-highlight)" }}>{hoursLeft}</span>
                <span className="dim" style={{ fontSize: 12, marginLeft: 3 }}>hrs</span>
              </div>
              <span className="dim" style={{ fontSize: 12 }}>{t("quest.untilReset")} · {cycleLabel}</span>
            </div>
          </div>

          {/* Summary stats */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8, marginBottom: 14 }}>
            <div className="cd" style={{ textAlign: "center", padding: 10 }}>
              <div className="sl">{t("quest.done")}</div>
              <div className="sv" style={{ color: "var(--color-primary)", fontSize: 20 }}>{completedCount}</div>
              <div className="dim" style={{ fontSize: 12 }}>of {allQuests.length}</div>
            </div>
            <div className="cd" style={{ textAlign: "center", padding: 10 }}>
              <div className="sl">{t("quest.earned")}</div>
              <div className="sv" style={{ color: "var(--color-success)", fontSize: 20 }}>${bonusEarned}</div>
            </div>
            <div className="cd" style={{ textAlign: "center", padding: 10 }}>
              <div className="sl">{t("quest.maxPayout")}</div>
              <div className="sv" style={{ color: "var(--color-warning)", fontSize: 20 }}>${maxPayout}</div>
              <div className="dim" style={{ fontSize: 12 }}>this cycle</div>
            </div>
            <div className="cd" style={{ textAlign: "center", padding: 10 }}>
              <div className="sl">{t("quest.hours")}</div>
              <div className="sv" style={{ color: "var(--color-highlight)", fontSize: 20 }}>{totalHours.toFixed(0)}</div>
            </div>
          </div>

          {/* Tiers */}
          {activeTiers.map((tier) => (
            <div key={tier.name} style={{ marginBottom: 16 }}>
              <h4
                style={{
                  fontSize: 13,
                  color: tier.color,
                  marginBottom: 8,
                  fontFamily: "Oswald",
                  letterSpacing: ".08em",
                  borderBottom: `1px solid ${darkMode ? "#1e1e2e" : "#eee"}`,
                  paddingBottom: 4,
                }}
              >
                {tier.name}
              </h4>

              {tier.quests.map((q) => {
                const isDone = q.progress >= q.goal;
                const pct = Math.min(100, (q.progress / q.goal) * 100);

                return (
                  <div
                    key={q.name}
                    className="cd"
                    style={{
                      marginBottom: 6,
                      borderLeft: `3px solid ${isDone ? "var(--color-success)" : q.tierColor}`,
                      padding: 12,
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
                      <div>
                        <span style={{ fontSize: 13, fontWeight: 600 }}>
                          {isDone ? "✅" : "⏳"} {q.name}
                        </span>
                        <div className="dim" style={{ fontSize: 13, marginTop: 1 }}>{q.desc}</div>
                      </div>
                      <span
                        style={{
                          fontFamily: "Oswald",
                          fontSize: 13,
                          color: isDone ? "var(--color-success)" : "var(--color-warning)",
                          whiteSpace: "nowrap",
                          marginLeft: 8,
                        }}
                      >
                        {q.bonus}
                      </span>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div
                        style={{
                          flex: 1,
                          height: 6,
                          background: darkMode ? "#1e1e2e" : "#eee",
                          borderRadius: 3,
                        }}
                      >
                        <div
                          style={{
                            height: 6,
                            background: isDone ? "var(--color-success)" : q.tierColor,
                            borderRadius: 3,
                            width: `${pct}%`,
                            transition: "width 0.3s",
                          }}
                        />
                      </div>
                      <span className="dim" style={{ fontSize: 12, minWidth: 50, textAlign: "right" }}>
                        {q.progress}/{q.goal} {q.unit}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}

          {/* Max payout note */}
          <div className="cd" style={{ textAlign: "center", padding: 12, borderLeft: "3px solid var(--color-accent-red)" }}>
            <div className="sl">{t("quest.maxAnnual")}</div>
            <div style={{ fontSize: 22, fontFamily: "Oswald", fontWeight: 700, color: "var(--color-success)" }}>
              ${(maxPayout * 2).toLocaleString()}+
            </div>
            <div className="dim" style={{ fontSize: 12 }}>
              ${maxPayout.toLocaleString()} {t("quest.perCycle")} × 2 {t("quest.cyclesYear")}
            </div>
          </div>
        </div>
      )}

      {/* TEAM TAB */}
      {tab === "team" && (
        <div>
          <div className="dim" style={{ fontSize: 11, marginBottom: 8, fontFamily: "Oswald", textTransform: "uppercase", letterSpacing: ".08em" }}>
            Stats reflect current cycle: {cycleLabel}
          </div>
          {profiles.map((p) => {
            // ── Stats per tech, scoped to the current 6-month cycle ──
            // Previously these were lifetime totals on a per-cycle screen,
            // which made hours look "wrong" because they kept piling up.
            const techJobsLifetime = jobs.filter((j) => {
              try {
                const data = typeof j.rooms === "string" ? JSON.parse(j.rooms) : j.rooms;
                return data?.workers?.some((w: { name: string }) => w.name === p.name);
              } catch { return false; }
            });
            const techJobs = techJobsLifetime.filter((j) => inCycle(j.created_at));
            const completedJobs = techJobs.filter((j) => j.status === "complete" || j.status === "invoiced" || j.status === "paid").length;
            const totalRevenue = techJobs.reduce((s, j) => s + (j.total || 0), 0);
            const techTime = timeEntries
              .filter((e) => e.user_id === p.id || e.user_name === p.name)
              .filter((e) => inCycle(e.entry_date) && (e.end_time || (e.hours || 0) > 0));
            const totalHrs = techTime.reduce((s, e) => s + (e.hours || 0), 0);
            const lifetimeHrs = timeEntries
              .filter((e) => (e.user_id === p.id || e.user_name === p.name) && (e.end_time || (e.hours || 0) > 0))
              .reduce((s, e) => s + (e.hours || 0), 0);
            const techReviews = reviews.filter((r) => r.employee_names?.includes(p.name) && inCycle(r.created_at || ""));
            const fiveStars = techReviews.filter((r) => r.rating === 5).length;
            const avgRating = techReviews.length
              ? (techReviews.reduce((s, r) => s + (r.rating || 0), 0) / techReviews.length).toFixed(1)
              : "—";

            // Trades worked (in cycle)
            const trades: Record<string, number> = {};
            techJobs.filter((j) => j.trade).forEach((j) => {
              trades[j.trade] = (trades[j.trade] || 0) + 1;
            });
            const topTrade = Object.entries(trades).sort((a, b) => b[1] - a[1])[0];

            // Callbacks (in cycle)
            const callbacks = techJobs.filter((j) => j.callback).length;
            const callbackRate = completedJobs > 0 ? ((callbacks / completedJobs) * 100).toFixed(0) : "0";

            const accentColor = p.role === "owner" ? "var(--color-highlight)" : p.role === "manager" ? "var(--color-primary)" : "var(--color-success)";
            const initials = (p.name || "?").split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();

            return (
              <div
                key={p.id}
                className="cd mb"
                style={{
                  padding: 0,
                  overflow: "hidden",
                  borderTop: `4px solid ${accentColor}`,
                }}
              >
                {/* ── Card header: photo + name + role + rating ── */}
                <div
                  style={{
                    display: "flex",
                    gap: 12,
                    padding: 14,
                    background: `linear-gradient(135deg, ${darkMode ? "#0d0d18" : "#f5f7fa"} 0%, ${darkMode ? "#12121a" : "#fff"} 100%)`,
                    borderBottom: `1px solid ${darkMode ? "#1e1e2e" : "#e0e0e5"}`,
                  }}
                >
                  {/* Photo / initials */}
                  <div
                    style={{
                      width: 78,
                      height: 78,
                      borderRadius: 8,
                      background: p.photo_url
                        ? `url(${p.photo_url}) center/cover`
                        : `linear-gradient(135deg, ${accentColor}, ${darkMode ? "#1a1a28" : "#cfd4dc"})`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "#fff",
                      fontFamily: "Oswald",
                      fontSize: 28,
                      fontWeight: 700,
                      flexShrink: 0,
                      border: `2px solid ${accentColor}`,
                      letterSpacing: ".05em",
                    }}
                  >
                    {!p.photo_url && initials}
                  </div>
                  {/* Name + role + rating */}
                  <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
                    <div>
                      <h4 style={{ fontSize: 18, margin: 0, lineHeight: 1.1, fontFamily: "Oswald", letterSpacing: ".03em" }}>
                        {p.name}
                      </h4>
                      <div
                        style={{
                          fontSize: 11,
                          fontFamily: "Oswald",
                          textTransform: "uppercase",
                          letterSpacing: ".12em",
                          color: accentColor,
                          marginTop: 2,
                        }}
                      >
                        {p.role}
                        {p.emp_num && ` · #${p.emp_num}`}
                      </div>
                      {topTrade && (
                        <div className="dim" style={{ fontSize: 11, marginTop: 4 }}>
                          🔧 {topTrade[0]} specialist
                        </div>
                      )}
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginTop: 6 }}>
                      <span className="dim" style={{ fontSize: 11 }}>💵 ${p.rate}/hr</span>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: 22, fontFamily: "Oswald", fontWeight: 700, color: "var(--color-highlight)", lineHeight: 1 }}>
                          {avgRating}
                        </div>
                        <div className="dim" style={{ fontSize: 9, fontFamily: "Oswald", letterSpacing: ".1em", textTransform: "uppercase" }}>
                          {techReviews.length} reviews
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* ── Stat block (baseball-card style) ── */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 1, background: darkMode ? "#1e1e2e" : "#e0e0e5" }}>
                  {[
                    { label: "Jobs", value: completedJobs, color: "var(--color-primary)" },
                    { label: "Hours", value: totalHrs.toFixed(0), color: "var(--color-success)" },
                    { label: "5-Star", value: fiveStars, color: "var(--color-highlight)" },
                    { label: "Callback", value: callbackRate + "%", color: callbacks > 0 ? "var(--color-accent-red)" : "var(--color-success)" },
                  ].map((s) => (
                    <div key={s.label} style={{ background: darkMode ? "#12121a" : "#fff", textAlign: "center", padding: "10px 4px" }}>
                      <div style={{ fontSize: 22, fontFamily: "Oswald", fontWeight: 700, color: s.color, lineHeight: 1 }}>
                        {s.value}
                      </div>
                      <div className="dim" style={{ fontSize: 9, fontFamily: "Oswald", letterSpacing: ".12em", textTransform: "uppercase", marginTop: 4 }}>
                        {s.label}
                      </div>
                    </div>
                  ))}
                </div>

                {/* ── Footer: revenue + lifetime hours + trade badges ── */}
                <div style={{ padding: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, flexWrap: "wrap", gap: 6, marginBottom: Object.keys(trades).length ? 8 : 0 }}>
                    <span className="dim">💰 ${totalRevenue.toLocaleString()} cycle</span>
                    {lifetimeHrs > totalHrs && (
                      <span className="dim">⏱ {lifetimeHrs.toFixed(0)}h lifetime</span>
                    )}
                  </div>
                  {Object.keys(trades).length > 0 && (
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                      {Object.entries(trades).sort((a, b) => b[1] - a[1]).map(([trade, count]) => (
                        <span
                          key={trade}
                          style={{
                            fontSize: 11,
                            padding: "2px 8px",
                            borderRadius: 10,
                            background: count >= 10 ? "var(--color-success)" + "22" : "var(--color-primary)" + "22",
                            color: count >= 10 ? "var(--color-success)" : "var(--color-primary)",
                            border: `1px solid ${count >= 10 ? "var(--color-success)" : "var(--color-primary)"}`,
                            fontFamily: "Oswald",
                            letterSpacing: ".05em",
                          }}
                        >
                          {trade}: {count}{count >= 10 && " ✓"}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* REVIEWS TAB */}
      {tab === "reviews" && (
        <div>
          {/* QR Code for client reviews */}
          <div className="cd mb" style={{ textAlign: "center", padding: 16 }}>
            <h4 style={{ fontSize: 13, marginBottom: 8 }}>📱 Client Review QR Code</h4>
            <div style={{ background: "#fff", display: "inline-block", padding: 12, borderRadius: 8, marginBottom: 8 }}>
              <QRCodeSVG
                value={typeof window !== "undefined" ? `${window.location.origin}/review${user.org_id ? "?org=" + user.org_id : ""}` : "/review"}
                size={140}
                level="M"
              />
            </div>
            <p className="dim" style={{ fontSize: 11 }}>
              Scan to leave a review — share with clients after a job
            </p>
            <button
              className="bo"
              onClick={() => {
                const url = `${window.location.origin}/review${user.org_id ? "?org=" + user.org_id : ""}`;
                navigator.clipboard.writeText(url);
                useStore.getState().showToast("Review link copied!", "success");
              }}
              style={{ fontSize: 12, padding: "4px 12px", marginTop: 4 }}
            >
              📋 {t("quest.copyLink")}
            </button>
          </div>

          <div className="cd mb">
            <h4 style={{ fontSize: 13, marginBottom: 8 }}>{t("quest.addReview")}</h4>
            <div className="row mb">
              <input
                value={rn}
                onChange={(e) => setRn(e.target.value)}
                placeholder="Client"
                style={{ flex: 1 }}
              />
              <select
                value={rr}
                onChange={(e) => setRr(Number(e.target.value))}
                style={{ width: 60 }}
              >
                {[5, 4, 3, 2, 1].map((x) => (
                  <option key={x} value={x}>{x}★</option>
                ))}
              </select>
            </div>
            <textarea
              value={rt}
              onChange={(e) => setRt(e.target.value)}
              placeholder="Review..."
              style={{ height: 50, marginBottom: 6 }}
            />
            <button className="bb" onClick={addReview} style={{ fontSize: 11 }}>
              Add
            </button>
          </div>

          {/* Stats */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 14 }}>
            <div className="cd" style={{ textAlign: "center" }}>
              <div className="sl">Total</div>
              <div className="sv" style={{ color: "var(--color-primary)" }}>{reviews.length}</div>
            </div>
            <div className="cd" style={{ textAlign: "center" }}>
              <div className="sl">5-Star</div>
              <div className="sv" style={{ color: "var(--color-highlight)" }}>{fiveStarReviews}</div>
            </div>
            <div className="cd" style={{ textAlign: "center" }}>
              <div className="sl">Avg Rating</div>
              <div className="sv" style={{ color: "var(--color-success)" }}>
                {reviews.length ? (reviews.reduce((s, r) => s + (r.rating || 0), 0) / reviews.length).toFixed(1) : "—"}
              </div>
            </div>
          </div>

          {reviews.map((r) => (
            <div key={r.id} className="cd mb">
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <b style={{ fontSize: 13 }}>{r.client_name}</b>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ color: "var(--color-highlight)" }}>
                    {"★".repeat(r.rating || 0)}
                    {"☆".repeat(5 - (r.rating || 0))}
                  </span>
                  <button
                    onClick={async () => {
                      if (!await useStore.getState().showConfirm("Delete Review", `Delete review from ${r.client_name}?`)) return;
                      await db.del("reviews", r.id);
                      loadAll();
                    }}
                    style={{ background: "none", color: "var(--color-accent-red)", fontSize: 13, padding: "0 4px" }}
                  >
                    ✕
                  </button>
                </div>
              </div>
              {r.employee_names && (
                <div style={{ fontSize: 12, color: "var(--color-primary)", marginTop: 2 }}>
                  👷 {r.employee_names}
                </div>
              )}
              <p className="dim" style={{ fontSize: 12, marginTop: 3 }}>
                &ldquo;{r.review_text}&rdquo;
              </p>
            </div>
          ))}
        </div>
      )}

      {/* REFERRALS TAB */}
      {tab === "referrals" && (
        <div>
          <div className="cd mb">
            <h4 style={{ fontSize: 13, marginBottom: 8 }}>{t("quest.addReferral")}</h4>
            <div className="row">
              <input
                value={fn}
                onChange={(e) => setFn(e.target.value)}
                placeholder="Name"
                style={{ flex: 1 }}
              />
              <input
                value={fs}
                onChange={(e) => setFs(e.target.value)}
                placeholder="Referred by"
                style={{ flex: 1 }}
              />
              <button className="bb" onClick={addReferral} style={{ fontSize: 11 }}>
                Add
              </button>
            </div>
          </div>

          {/* Stats */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 14 }}>
            <div className="cd" style={{ textAlign: "center" }}>
              <div className="sl">Total</div>
              <div className="sv" style={{ color: "var(--color-primary)" }}>{referrals.length}</div>
            </div>
            <div className="cd" style={{ textAlign: "center" }}>
              <div className="sl">Contacted</div>
              <div className="sv" style={{ color: "var(--color-warning)" }}>
                {referrals.filter((r) => r.status === "contacted").length}
              </div>
            </div>
            <div className="cd" style={{ textAlign: "center" }}>
              <div className="sl">Converted</div>
              <div className="sv" style={{ color: "var(--color-success)" }}>{convertedReferrals}</div>
            </div>
          </div>

          {referrals.map((r) => (
            <div
              key={r.id}
              className="cd mb"
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div>
                <b style={{ fontSize: 13 }}>{r.name}</b>
                <div style={{ fontSize: 11 }} className="dim">
                  {r.source} · {r.ref_date}
                </div>
              </div>
              <select
                value={r.status}
                onChange={async (e) => {
                  await db.patch("referrals", r.id, { status: e.target.value });
                  loadAll();
                }}
                style={{ width: "auto", fontSize: 12, padding: "3px 6px" }}
              >
                <option value="pending">Pending</option>
                <option value="contacted">Contacted</option>
                <option value="converted">Converted</option>
              </select>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
