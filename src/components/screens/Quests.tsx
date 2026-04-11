"use client";
import { useState } from "react";
import { useStore } from "@/lib/store";
import { db } from "@/lib/supabase";
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

  // Computed stats
  const completedJobs = jobs.filter((j) => j.status === "complete").length;
  const positiveReviews = reviews.filter((r) => (r.rating || 0) >= 3).length;
  const fiveStarReviews = reviews.filter((r) => r.rating === 5).length;
  const convertedReferrals = referrals.filter((r) => r.status === "converted").length;

  // Group jobs by client to find repeat clients with 5+ jobs
  const jobsByClient: Record<string, number> = {};
  jobs.filter((j) => j.client).forEach((j) => {
    jobsByClient[j.client] = (jobsByClient[j.client] || 0) + 1;
  });
  const repeatClients = Object.values(jobsByClient).filter((c) => c >= 5).length;

  // Big jobs (24+ hours)
  const bigJobs = jobs.filter((j) => j.status === "complete" && (j.total_hrs || 0) >= 24).length;

  // Total hours logged
  const totalHours = timeEntries.reduce((s, e) => s + (e.hours || 0), 0);

  // Skill Mastery: count completed jobs per trade
  const jobsByTrade: Record<string, number> = {};
  jobs.filter((j) => j.status === "complete" && j.trade).forEach((j) => {
    jobsByTrade[j.trade] = (jobsByTrade[j.trade] || 0) + 1;
  });
  const tradesMastered = Object.values(jobsByTrade).filter((c) => c >= 10).length;
  const bestTradeCount = Math.max(0, ...Object.values(jobsByTrade));

  // Zero Callback: count consecutive completed jobs with no callback from the end
  const completedJobsSorted = jobs
    .filter((j) => j.status === "complete")
    .sort((a, b) => (a.created_at > b.created_at ? -1 : 1));
  let zeroCallbackStreak = 0;
  for (const j of completedJobsSorted) {
    if (j.callback) break;
    zeroCallbackStreak++;
  }

  // Mr.Speed: count days where 5+ jobs were completed
  const jobsByDate: Record<string, number> = {};
  jobs.filter((j) => j.status === "complete").forEach((j) => {
    const d = j.job_date || j.created_at?.split("T")[0] || "";
    if (d) jobsByDate[d] = (jobsByDate[d] || 0) + 1;
  });
  const speedDays = Object.values(jobsByDate).filter((c) => c >= 5).length;

  // Deal Closer: count upsell jobs
  const upsellCount = jobs.filter((j) => j.is_upsell).length;

  // Repeat Machine: count unique techs requested by 3+ different clients
  const requestsByTech: Record<string, Set<string>> = {};
  jobs.filter((j) => j.requested_tech && j.client).forEach((j) => {
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

  // All quests by tier
  const tiers: { name: string; color: string; quests: Quest[] }[] = [
    {
      name: "TIER 1: FOUNDATION",
      color: "var(--color-primary)",
      quests: [
        {
          name: "Review Favor",
          desc: "Collect 15 positive testimonials (3+ stars)",
          bonus: "$75",
          progress: Math.min(positiveReviews, 15),
          goal: 15,
          unit: "reviews",
          tier: "T1",
          tierColor: "var(--color-primary)",
        },
        {
          name: "Five Star Tech",
          desc: "Collect 10 five-star reviews",
          bonus: "$100",
          progress: Math.min(fiveStarReviews, 10),
          goal: 10,
          unit: "5★",
          tier: "T1",
          tierColor: "var(--color-primary)",
        },
        {
          name: "Super Handy",
          desc: "Complete 10 work orders",
          bonus: "$50",
          progress: Math.min(completedJobs, 10),
          goal: 10,
          unit: "jobs",
          tier: "T1",
          tierColor: "var(--color-primary)",
        },
      ],
    },
    {
      name: "TIER 2: GROWTH",
      color: "var(--color-success)",
      quests: [
        {
          name: "Network Scout",
          desc: "Secure new jobs from clients — $50 per job or 3% of value",
          bonus: "$50+/job",
          progress: convertedReferrals,
          goal: 1,
          unit: "secured",
          tier: "T2",
          tierColor: "var(--color-success)",
        },
        {
          name: "Critical Referral",
          desc: "Turn 1 client into 5 jobs",
          bonus: "$150",
          progress: Math.min(repeatClients, 1),
          goal: 1,
          unit: "client",
          tier: "T2",
          tierColor: "var(--color-success)",
        },
        {
          name: "Deal Closer",
          desc: `Upsell or add scope to existing jobs — ${upsellCount} upsell${upsellCount !== 1 ? "s" : ""} logged`,
          bonus: "$25/upsell",
          progress: Math.min(upsellCount, 1),
          goal: 1,
          unit: "upsells",
          tier: "T2",
          tierColor: "var(--color-success)",
        },
        {
          name: "Repeat Machine",
          desc: `3 different clients request the same tech by name${Object.keys(requestsByTech).length ? " (" + Object.entries(requestsByTech).map(([t, c]) => `${t}: ${c.size}`).join(", ") + ")" : ""}`,
          bonus: "$100",
          progress: Math.min(techsRequestedByName, 1),
          goal: 1,
          unit: "techs",
          tier: "T2",
          tierColor: "var(--color-success)",
        },
      ],
    },
    {
      name: "TIER 3: MASTERY",
      color: "var(--color-warning)",
      quests: [
        {
          name: "Skill Mastery",
          desc: `Complete 10 jobs in one trade — ${tradesMastered} trade${tradesMastered !== 1 ? "s" : ""} mastered${Object.keys(jobsByTrade).length ? " (" + Object.entries(jobsByTrade).map(([t, c]) => `${t}: ${c}`).join(", ") + ")" : ""}`,
          bonus: "$100/trade",
          progress: Math.min(bestTradeCount, 10),
          goal: 10,
          unit: "best trade",
          tier: "T3",
          tierColor: "var(--color-warning)",
        },
        {
          name: "Make Ready Pro",
          desc: "Complete 7 vacant unit remodels (24+ hours each)",
          bonus: "$350",
          progress: Math.min(bigJobs, 7),
          goal: 7,
          unit: "turns",
          tier: "T3",
          tierColor: "var(--color-warning)",
        },
        {
          name: "Zero Callback",
          desc: "20 consecutive jobs with zero callbacks — resets on callback",
          bonus: "$150",
          progress: Math.min(zeroCallbackStreak, 20),
          goal: 20,
          unit: "streak",
          tier: "T3",
          tierColor: "var(--color-warning)",
        },
        {
          name: "Mr.Speed",
          desc: "Complete 5 work orders in one day",
          bonus: "$25",
          progress: Math.min(speedDays, 1),
          goal: 1,
          unit: "days",
          tier: "T3",
          tierColor: "var(--color-warning)",
        },
      ],
    },
    {
      name: "TIER 4: LEGEND",
      color: "var(--color-accent-red)",
      quests: [
        {
          name: "HandyKing 👑",
          desc: `Complete ALL quests + 2 Skill Mastery trades — ${handyKingProgress}/11 done${tradesMastered >= 2 ? " ✓ 2+ trades" : ""}`,
          bonus: "$750/yr",
          progress: handyKingProgress + (tradesMastered >= 2 ? 0 : 0),
          goal: 11,
          unit: "quests",
          tier: "T4",
          tierColor: "var(--color-accent-red)",
        },
      ],
    },
  ];

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
        🎯 Quest Hub
      </h2>

      {/* Sub-tabs */}
      <div style={{ display: "flex", gap: 3, marginBottom: 12 }}>
        {[
          { id: "quests", l: "🎯Quests" },
          { id: "team", l: "👷Team" },
          { id: "reviews", l: "⭐Reviews" },
          { id: "referrals", l: "🤝Referrals" },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: "5px 12px",
              borderRadius: 6,
              fontSize: 11,
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
          {/* Summary stats */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 14 }}>
            <div className="cd" style={{ textAlign: "center", padding: 12 }}>
              <div className="sl">Quests Done</div>
              <div className="sv" style={{ color: "var(--color-primary)" }}>{completedCount}</div>
              <div className="dim" style={{ fontSize: 10 }}>of {allQuests.length}</div>
            </div>
            <div className="cd" style={{ textAlign: "center", padding: 12 }}>
              <div className="sl">Bonus Earned</div>
              <div className="sv" style={{ color: "var(--color-success)" }}>${bonusEarned}</div>
            </div>
            <div className="cd" style={{ textAlign: "center", padding: 12 }}>
              <div className="sl">Hours Logged</div>
              <div className="sv" style={{ color: "var(--color-warning)" }}>{totalHours.toFixed(0)}</div>
            </div>
          </div>

          {/* Tiers */}
          {tiers.map((tier) => (
            <div key={tier.name} style={{ marginBottom: 16 }}>
              <h4
                style={{
                  fontSize: 11,
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
                        <div className="dim" style={{ fontSize: 11, marginTop: 1 }}>{q.desc}</div>
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
                      <span className="dim" style={{ fontSize: 10, minWidth: 50, textAlign: "right" }}>
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
            <div className="sl">Max Annual Payout</div>
            <div style={{ fontSize: 22, fontFamily: "Oswald", fontWeight: 700, color: "var(--color-success)" }}>
              $2,225+
            </div>
            <div className="dim" style={{ fontSize: 10 }}>
              Plus ongoing Network Scout commissions
            </div>
          </div>
        </div>
      )}

      {/* TEAM TAB */}
      {tab === "team" && (
        <div>
          {profiles.map((p) => {
            // Stats per tech
            const techJobs = jobs.filter((j) => {
              try {
                const data = typeof j.rooms === "string" ? JSON.parse(j.rooms) : j.rooms;
                return data?.workers?.some((w: { name: string }) => w.name === p.name);
              } catch { return false; }
            });
            const completedJobs = techJobs.filter((j) => j.status === "complete" || j.status === "invoiced" || j.status === "paid").length;
            const totalRevenue = techJobs.reduce((s, j) => s + (j.total || 0), 0);
            const techTime = timeEntries.filter((e) => e.user_id === p.id || e.user_name === p.name);
            const totalHrs = techTime.reduce((s, e) => s + (e.hours || 0), 0);
            const techReviews = reviews.filter((r) => r.employee_names?.includes(p.name));
            const fiveStars = techReviews.filter((r) => r.rating === 5).length;
            const avgRating = techReviews.length
              ? (techReviews.reduce((s, r) => s + (r.rating || 0), 0) / techReviews.length).toFixed(1)
              : "—";

            // Trades worked
            const trades: Record<string, number> = {};
            techJobs.filter((j) => j.trade).forEach((j) => {
              trades[j.trade] = (trades[j.trade] || 0) + 1;
            });
            const topTrade = Object.entries(trades).sort((a, b) => b[1] - a[1])[0];

            // Callbacks
            const callbacks = techJobs.filter((j) => j.callback).length;
            const callbackRate = completedJobs > 0 ? ((callbacks / completedJobs) * 100).toFixed(0) : "0";

            return (
              <div
                key={p.id}
                className="cd mb"
                style={{
                  borderLeft: `3px solid ${p.role === "owner" ? "var(--color-highlight)" : p.role === "manager" ? "var(--color-primary)" : "var(--color-success)"}`,
                  padding: 14,
                }}
              >
                {/* Header */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <div>
                    <h4 style={{ fontSize: 16, margin: 0 }}>{p.name}</h4>
                    <div style={{ fontSize: 10, fontFamily: "Oswald", textTransform: "uppercase", letterSpacing: ".08em", color: p.role === "owner" ? "var(--color-highlight)" : p.role === "manager" ? "var(--color-primary)" : "var(--color-success)" }}>
                      {p.role} · #{p.emp_num}
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 22, fontFamily: "Oswald", fontWeight: 700, color: "var(--color-highlight)" }}>
                      {avgRating}
                    </div>
                    <div className="dim" style={{ fontSize: 9 }}>avg rating</div>
                  </div>
                </div>

                {/* Stats grid */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 6, marginBottom: 10 }}>
                  <div style={{ textAlign: "center", padding: 6, background: darkMode ? "#1a1a28" : "#f5f5f8", borderRadius: 6 }}>
                    <div style={{ fontSize: 16, fontFamily: "Oswald", fontWeight: 700, color: "var(--color-primary)" }}>{completedJobs}</div>
                    <div className="dim" style={{ fontSize: 8 }}>Jobs</div>
                  </div>
                  <div style={{ textAlign: "center", padding: 6, background: darkMode ? "#1a1a28" : "#f5f5f8", borderRadius: 6 }}>
                    <div style={{ fontSize: 16, fontFamily: "Oswald", fontWeight: 700, color: "var(--color-success)" }}>{totalHrs.toFixed(0)}</div>
                    <div className="dim" style={{ fontSize: 8 }}>Hours</div>
                  </div>
                  <div style={{ textAlign: "center", padding: 6, background: darkMode ? "#1a1a28" : "#f5f5f8", borderRadius: 6 }}>
                    <div style={{ fontSize: 16, fontFamily: "Oswald", fontWeight: 700, color: "var(--color-highlight)" }}>{fiveStars}</div>
                    <div className="dim" style={{ fontSize: 8 }}>5-Star</div>
                  </div>
                  <div style={{ textAlign: "center", padding: 6, background: darkMode ? "#1a1a28" : "#f5f5f8", borderRadius: 6 }}>
                    <div style={{ fontSize: 16, fontFamily: "Oswald", fontWeight: 700, color: callbacks > 0 ? "var(--color-accent-red)" : "var(--color-success)" }}>{callbackRate}%</div>
                    <div className="dim" style={{ fontSize: 8 }}>Callback</div>
                  </div>
                </div>

                {/* Details row */}
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, flexWrap: "wrap", gap: 4 }}>
                  <span className="dim">💰 ${totalRevenue.toLocaleString()} revenue</span>
                  <span className="dim">⭐ {techReviews.length} reviews</span>
                  {topTrade && <span className="dim">🔧 {topTrade[0]} ({topTrade[1]})</span>}
                  <span className="dim">💵 ${p.rate}/hr</span>
                </div>

                {/* Trade badges */}
                {Object.keys(trades).length > 0 && (
                  <div style={{ display: "flex", gap: 4, marginTop: 8, flexWrap: "wrap" }}>
                    {Object.entries(trades).sort((a, b) => b[1] - a[1]).map(([trade, count]) => (
                      <span
                        key={trade}
                        style={{
                          fontSize: 9,
                          padding: "2px 8px",
                          borderRadius: 10,
                          background: count >= 10 ? "var(--color-success)" + "22" : "var(--color-primary)" + "22",
                          color: count >= 10 ? "var(--color-success)" : "var(--color-primary)",
                          border: `1px solid ${count >= 10 ? "var(--color-success)" : "var(--color-primary)"}`,
                        }}
                      >
                        {trade}: {count} {count >= 10 && "✓"}
                      </span>
                    ))}
                  </div>
                )}
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
                alert("Review link copied!");
              }}
              style={{ fontSize: 10, padding: "4px 12px", marginTop: 4 }}
            >
              📋 Copy Link
            </button>
          </div>

          <div className="cd mb">
            <h4 style={{ fontSize: 13, marginBottom: 8 }}>Add Review</h4>
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
                <span style={{ color: "var(--color-highlight)" }}>
                  {"★".repeat(r.rating || 0)}
                  {"☆".repeat(5 - (r.rating || 0))}
                </span>
              </div>
              {r.employee_names && (
                <div style={{ fontSize: 10, color: "var(--color-primary)", marginTop: 2 }}>
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
            <h4 style={{ fontSize: 13, marginBottom: 8 }}>Add Referral</h4>
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
                style={{ width: "auto", fontSize: 10, padding: "3px 6px" }}
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
