"use client";
import { useState, useEffect, useMemo } from "react";
import { useStore } from "@/lib/store";
import { db } from "@/lib/supabase";
import { t } from "@/lib/i18n";
import { QRCodeSVG } from "qrcode.react";
import { Icon } from "../Icon";
import { computeQuests, type QuestDef as Quest } from "@/lib/quests";

export default function Quests() {
  const user = useStore((s) => s.user)!;
  const org = useStore((s) => s.org);
  const profiles = useStore((s) => s.profiles);
  const jobs = useStore((s) => s.jobs);
  const reviews = useStore((s) => s.reviews);
  const referrals = useStore((s) => s.referrals);
  const questPayouts = useStore((s) => s.questPayouts);
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
  const cycleLabel = `${cycleStart.toLocaleDateString("en-US", { month: "short" })} – ${new Date(cycleStart.getFullYear(), cycleStart.getMonth() + 6, 0).toLocaleDateString("en-US", { month: "short", year: "numeric" })}`;

  // Countdown to reset
  const msLeft = cycleEnd.getTime() - now.getTime();
  const daysLeft = Math.floor(msLeft / (1000 * 60 * 60 * 24));
  const hoursLeft = Math.floor((msLeft % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const inCycle = (dateStr?: string) => {
    if (!dateStr) return false;
    try { return new Date(dateStr) >= cycleStart; } catch { return false; }
  };

  // Quest progress AND the Reviews/Referrals chip counts both come from the
  // shared engine (lib/quests) — one source of truth, so this screen,
  // Payroll, and the chips can never drift. `metrics` is the per-tech,
  // per-cycle stat bag (completedJobs, fiveStarReviews, convertedReferrals,
  // repeatClients, …); the per-user job/review attribution (time-entry join,
  // legacy job-name fallback, review name-tag) all lives in the engine now.
  let questConfig: Record<string, { enabled?: boolean; bonus?: number }> = {};
  try { questConfig = org?.quest_config ? JSON.parse(org.quest_config) : {}; } catch { /* */ }
  const { tiers, metrics } = computeQuests({
    userId: user.id,
    userName: user.name,
    jobs, reviews, referrals, timeEntries,
    questConfig,
    cycleStart,
  });

  // Remove empty tiers
  const activeTiers = tiers.filter((tr) => tr.quests.length > 0);

  // Calculate total max bonus
  const allQuests2 = activeTiers.flatMap((tr) => tr.quests);
  const maxPayout = allQuests2.reduce((s, q) => s + (parseInt(q.bonus.replace(/[^0-9]/g, "")) || 0), 0);

  // Calculate total bonus earned
  const allQuests = tiers.flatMap((tr) => tr.quests);
  const completedCount = allQuests.filter((q) => q.progress >= q.goal).length;
  const bonusEarned = allQuests
    .filter((q) => q.progress >= q.goal)
    .reduce((s, q) => {
      const num = parseInt(q.bonus.replace(/[^0-9]/g, "")) || 0;
      return s + num;
    }, 0);

  // ── Team leaderboard (battle-pass style). Ranked by actual quest
  // bonus dollars paid this cycle (quest_payouts), with 5★ as the
  // tiebreaker so strong reviewers still surface before any payout lands.
  const cycleQuestPayouts = questPayouts.filter((qp) => inCycle(qp.paid_date || qp.created_at));
  const teamBoard = profiles
    .map((p) => {
      const mine = cycleQuestPayouts.filter((qp) => qp.user_id === p.id);
      const earned = mine.reduce((s, qp) => s + (qp.bonus_amount || 0), 0);
      const fiveStars = reviews.filter(
        (r) => r.rating === 5 && inCycle(r.created_at) && r.employee_names?.toLowerCase().includes((p.name || "").toLowerCase()),
      ).length;
      const initials = (p.name || "?").split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
      return { id: p.id, name: p.name || "—", role: p.role, earned, quests: mine.length, fiveStars, initials };
    })
    .sort((a, b) => b.earned - a.earned || b.fiveStars - a.fiveStars || a.name.localeCompare(b.name));
  const teamTotal = cycleQuestPayouts.reduce((s, qp) => s + (qp.bonus_amount || 0), 0);

  // Org-wide review hero numbers (per-user quest progress lives in chips).
  const reviewAvg = reviews.length
    ? reviews.reduce((s, r) => s + (r.rating || 0), 0) / reviews.length
    : 0;
  const fiveStarCycleAll = reviews.filter((r) => r.rating === 5 && inCycle(r.created_at)).length;

  // Referral-flavored quest dollars paid this cycle.
  const referralPayout = cycleQuestPayouts
    .filter((qp) => qp.quest_key === "network_scout" || qp.quest_key === "critical_referral")
    .reduce((s, qp) => s + (qp.bonus_amount || 0), 0);

  // ── Quest-complete celebration. Fires ONE confetti overlay the first time a
  // quest crosses into "done" this cycle, then never again. Two guards:
  //  1. It's acked the moment it's SHOWN (not on dismiss) and the whole
  //     current completed batch is acked at once — so it can't loop if the
  //     user never taps, and a backlog of several finished quests shows a
  //     single celebration, not a string of them.
  //  2. Bonuses already PAID this cycle are filtered out entirely (matched by
  //     quest_key) — paid is the server-side source of truth (survives a
  //     localStorage clear), so a paid quest won't pop again until reset.
  const completedQuests = allQuests.filter((q) => q.progress >= q.goal);
  const paidKeys = new Set(
    questPayouts
      .filter((qp) => qp.user_id === user.id && inCycle(qp.paid_date || qp.created_at))
      .map((qp) => qp.quest_key)
  );
  const celebratable = completedQuests.filter((q) => !paidKeys.has(q.key));
  const completedKey = celebratable.map((q) => q.key).join("|");
  const ackKey = `creed_quest_seen_${user.id}_${cycleStart.getFullYear()}_${cycleStart.getMonth()}`;
  const [celebrate, setCelebrate] = useState<Quest | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    let seen: string[] = [];
    try { seen = JSON.parse(localStorage.getItem(ackKey) || "[]"); } catch { /* */ }
    const fresh = celebratable.find((q) => !seen.includes(q.key));
    if (!fresh) return;
    // Ack the whole current completed batch up front so it shows once and
    // never re-fires this cycle.
    const merged = Array.from(new Set([...seen, ...completedQuests.map((q) => q.key)]));
    try { localStorage.setItem(ackKey, JSON.stringify(merged)); } catch { /* */ }
    setCelebrate(fresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completedKey, ackKey]);
  const dismissCelebrate = () => setCelebrate(null);
  // Generated once so positions don't jitter on re-render.
  const confetti = useMemo(
    () =>
      Array.from({ length: 60 }, (_, i) => ({
        left: Math.random() * 100,
        bg: ["#f5b400", "#9d4edd", "#00cc66", "#2e8bff", "#ff5b8a", "#ffd76b"][i % 6],
        w: 5 + Math.random() * 5,
        h: 9 + Math.random() * 8,
        dur: 2.2 + Math.random() * 2.6,
        delay: Math.random() * 3.5,
        op: 0.75 + Math.random() * 0.25,
      })),
    [],
  );

  // The green "Refer a client" CTA opens the add form (mockup leads with
  // the CTA, not an always-open form).
  const [showRefForm, setShowRefForm] = useState(false);

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
      // Stamp the referrer so Network Scout credits THIS tech, not the org.
      referred_by_user_id: user.id,
    });
    setFn("");
    setFs("");
    loadAll();
  };

  const VIOLET = "#9d4edd";
  // Inline dark tokens are fixed values — they don't flip for light mode.
  // These surface helpers keep cards/rows/tracks/avatars readable (no
  // black-on-black) when the theme is light.
  const surf = darkMode ? "var(--color-card-dark-3)" : "var(--color-card-light)";
  const surfBorder = darkMode ? "var(--color-border-dark-2)" : "var(--color-border-light)";
  const track = darkMode ? "var(--color-border-dark)" : "var(--color-border-light)";
  const avatarBg = darkMode ? "var(--color-border-dark)" : "var(--color-border-light-2)";
  const avatarFg = darkMode ? "#cdd6e6" : "#5a6175";

  return (
    <div className="fi">
      {/* Topbar — QUEST HUB + trophy */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <h2 style={{ fontSize: 22, fontFamily: "Oswald", fontWeight: 700, letterSpacing: ".5px", margin: 0, textTransform: "uppercase" }}>
          {t("quest.title")}
        </h2>
        <div style={{ width: 34, height: 34, borderRadius: 10, background: "rgba(157,78,221,.14)", border: "1px solid rgba(157,78,221,.4)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Icon name="trophy" size={17} color={VIOLET} />
        </div>
      </div>

      {/* Sub-tabs (violet-active) */}
      <div style={{ display: "flex", gap: 5, marginBottom: 12 }}>
        {[
          { id: "quests", l: t("quest.quests") },
          { id: "team", l: t("quest.team") },
          { id: "reviews", l: t("quest.reviews") },
          { id: "referrals", l: t("quest.referrals") },
        ].map((x) => {
          const on = tab === x.id;
          return (
            <button
              key={x.id}
              onClick={() => setTab(x.id)}
              style={{
                flex: 1,
                textAlign: "center",
                fontFamily: "Oswald",
                fontWeight: 600,
                fontSize: 12.5,
                padding: "8px 2px",
                borderRadius: 9,
                border: `1px solid ${on ? VIOLET : surfBorder}`,
                background: on ? VIOLET : surf,
                color: on ? "#fff" : "var(--color-dim)",
                boxShadow: on ? "0 0 16px -5px rgba(157,78,221,.8)" : "none",
              }}
            >
              {x.l}
            </button>
          );
        })}
      </div>

      {/* QUESTS TAB */}
      {tab === "quests" && (
        <div>
          {/* Battle-pass hero */}
          <div style={{ position: "relative", overflow: "hidden", borderRadius: 20, padding: 15, marginBottom: 12, ...(darkMode ? { background: "linear-gradient(135deg, rgba(124,58,237,.32), rgba(45,24,90,.55))", border: "1px solid rgba(157,78,221,.55)", boxShadow: "0 0 52px -12px rgba(157,78,221,.85), inset 0 0 46px -18px rgba(157,78,221,.5)" } : { background: "linear-gradient(135deg,#7c3aed,#4c1d95)", border: "1px solid #7c3aed", boxShadow: "0 0 17px -2px rgba(124,58,237,.6), 0 4px 12px -7px rgba(0,0,0,.22)" }) }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11.5, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: "#c9a6ff" }}>
              <span>{cycleLabel}</span>
              <span style={{ color: "#ffd76b", display: "inline-flex", alignItems: "center", gap: 4, background: "rgba(245,180,0,.12)", border: "1px solid rgba(245,180,0,.3)", borderRadius: 99, padding: "2px 8px", boxShadow: "0 0 14px -3px rgba(245,180,0,.6)" }}>
                <Icon name="time" size={11} color="#ffd76b" /> {daysLeft}d {hoursLeft}h
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, margin: "9px 0 2px" }}>
              <div style={{ fontFamily: "Oswald", fontWeight: 700, fontSize: 34, color: "#fff", lineHeight: 1 }}>${bonusEarned}</div>
              <div style={{ fontSize: 13.5, color: "#c9a6ff" }}>{t("quest.ofMax").replace("{max}", maxPayout.toLocaleString())}</div>
            </div>
            <div style={{ display: "flex", gap: 3, marginTop: 11 }}>
              {allQuests.map((q, i) => (
                <span key={i} style={{ flex: 1, height: 8, borderRadius: 3, background: i < completedCount ? "linear-gradient(90deg,#9d4edd,#f5b400)" : "rgba(255,255,255,.09)", boxShadow: i < completedCount ? "0 0 8px -1px rgba(245,180,0,.7)" : "none" }} />
              ))}
            </div>
            <div style={{ fontFamily: "Oswald", fontWeight: 600, fontSize: 12, color: "#c9a6ff", marginTop: 7, letterSpacing: ".06em" }}>
              {completedCount} / {allQuests.length} {t("quest.questsCompleteLabel")}
            </div>
          </div>

          {/* Tiers */}
          {activeTiers.map((tier) => {
            const doneInTier = tier.quests.filter((q) => q.progress >= q.goal).length;
            const badge = tier.quests[0]?.tier || "T";
            const tname = tier.name.split(":")[1]?.trim() || tier.name;
            return (
              <div key={tier.name} style={{ marginBottom: 6 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "12px 1px 8px" }}>
                  <span style={{ fontFamily: "Oswald", fontWeight: 700, fontSize: 11, letterSpacing: ".06em", padding: "3px 8px", borderRadius: 7, color: "#0d0d15", background: tier.color }}>{badge}</span>
                  <span style={{ fontFamily: "Oswald", fontWeight: 600, fontSize: 13, letterSpacing: ".12em", color: "var(--color-dim)" }}>{tname}</span>
                  <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--color-dim)" }}>{doneInTier} / {tier.quests.length}</span>
                </div>

                {tier.quests.map((q) => {
                  const isDone = q.progress >= q.goal;
                  const isPaid = isDone && paidKeys.has(q.key);
                  const pct = Math.min(100, (q.progress / q.goal) * 100);
                  return (
                    <div key={q.name} className="statusstrip" style={{ ["--c" as any]: isDone ? "#f5b400" : q.tierColor, background: surf, border: `1px solid ${isDone ? "rgba(245,180,0,.5)" : surfBorder}`, borderRadius: 15, padding: "12px 13px", marginBottom: 9, boxShadow: isDone ? "0 0 24px -11px rgba(245,180,0,.7)" : "none" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                        <div style={{ display: "inline-flex", alignItems: "center", gap: 7, flexWrap: "wrap", minWidth: 0 }}>
                          <span style={{ fontFamily: "Oswald", fontWeight: 600, fontSize: 15.5, letterSpacing: ".3px" }}>{q.name}</span>
                          {isPaid && (
                            <span style={{ fontFamily: "Oswald", fontWeight: 700, fontSize: 10, letterSpacing: ".08em", color: "#1a1030", background: "linear-gradient(135deg,#d8b6ff,#9d4edd)", borderRadius: 99, padding: "2px 8px", boxShadow: "0 0 12px -3px rgba(157,78,221,.7)" }}>PAID</span>
                          )}
                        </div>
                        <span style={{ fontFamily: "Oswald", fontWeight: 700, fontSize: 14, color: "#5a3d00", background: "linear-gradient(135deg,#ffe08a,#f5b400)", borderRadius: 99, padding: "4px 10px", whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", gap: 3, boxShadow: "0 0 14px -3px rgba(245,180,0,.6)" }}>
                          <Icon name="money" size={11} color="#5a3d00" /> {q.bonus}
                        </span>
                      </div>
                      <div style={{ fontSize: 12, color: "var(--color-dim)", margin: "2px 0 9px" }}>{q.desc}</div>
                      <div style={{ height: 7, background: track, borderRadius: 5, overflow: "hidden" }}>
                        <div style={{ height: "100%", borderRadius: 5, width: `${pct}%`, background: isDone ? "#f5b400" : q.tierColor, transition: "width .3s" }} />
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, color: "var(--color-dim)", marginTop: 5 }}>
                        {isPaid ? (
                          <span style={{ color: "#c9a6ff", fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 4 }}>
                            <Icon name="checkCircle" size={12} color="#c9a6ff" /> {t("quest.paid")} ✓
                          </span>
                        ) : isDone ? (
                          <span style={{ color: "#3ee08f", fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 4 }}>
                            <Icon name="checkCircle" size={12} color="#3ee08f" /> {t("quest.donePending")}
                          </span>
                        ) : (
                          <span>{q.progress} {t("quest.of")} {q.goal} {q.unit}</span>
                        )}
                        <span>{isDone ? `${q.goal}/${q.goal}` : `${Math.round(pct)}%`}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}

          {/* Annual potential */}
          <div style={{ textAlign: "center", fontSize: 12, color: "var(--color-dim)", marginTop: 6 }}>
            {t("quest.maxAnnual")} · <b style={{ fontFamily: "Oswald", color: "#f5b400", fontSize: 15 }}>${(maxPayout * 2).toLocaleString()}+</b>
          </div>
        </div>
      )}

      {/* TEAM TAB — leaderboard */}
      {tab === "team" && (
        <div>
          {teamBoard.length === 0 ? (
            <div className="dim" style={{ textAlign: "center", fontSize: 14, padding: 20 }}>{t("quest.noTeamYet")}</div>
          ) : (
            <>
              {/* Podium (top 3) */}
              <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "center", gap: 10, margin: "6px 0 16px" }}>
                {[teamBoard[1], teamBoard[0], teamBoard[2]].map((m, idx) => {
                  if (!m) return <div key={idx} style={{ flex: 1 }} />;
                  const first = m === teamBoard[0];
                  const place = first ? 1 : m === teamBoard[1] ? 2 : 3;
                  const avBg = first
                    ? "radial-gradient(circle at 35% 30%,#ffe08a,#f5b400)"
                    : place === 2
                    ? "linear-gradient(135deg,#dfe4ee,#aab2c0)"
                    : "linear-gradient(135deg,#e8b187,#b9763f)";
                  const sz = first ? 56 : 46;
                  return (
                    <div key={idx} style={{ textAlign: "center", flex: 1 }}>
                      <div style={{ position: "relative", width: sz, height: sz, borderRadius: "50%", margin: "0 auto 6px", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Oswald", fontWeight: 700, fontSize: first ? 16 : 14, color: "#1a1305", background: avBg, boxShadow: first ? "0 0 24px -3px rgba(245,180,0,.85)" : "none" }}>
                        {first && (
                          <span style={{ position: "absolute", top: -16, left: "50%", transform: "translateX(-50%)" }}>
                            <Icon name="trophy" size={16} color="#f5b400" />
                          </span>
                        )}
                        {m.initials}
                      </div>
                      <div style={{ fontFamily: "Oswald", fontWeight: 600, fontSize: 13 }}>{m.name.split(/\s+/)[0]}</div>
                      <div style={{ fontFamily: "Oswald", fontWeight: 700, fontSize: 15, color: "#f5b400" }}>${m.earned.toLocaleString()}</div>
                      <div style={{ fontSize: 11, color: "var(--color-dim)" }}>{first ? t("quest.leader") : place === 2 ? t("quest.secondPlace") : t("quest.thirdPlace")}</div>
                    </div>
                  );
                })}
              </div>

              {/* Rows 4+ */}
              {teamBoard.slice(3).map((m, i) => (
                <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 11, background: surf, border: `1px solid ${surfBorder}`, borderRadius: 12, padding: "9px 12px", marginBottom: 7 }}>
                  <span style={{ fontFamily: "Oswald", fontWeight: 700, fontSize: 15, color: "var(--color-dim)", width: 18 }}>{i + 4}</span>
                  <span style={{ width: 30, height: 30, borderRadius: "50%", background: avatarBg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 600, color: avatarFg }}>{m.initials}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14.5, fontWeight: 500 }}>{m.name}</div>
                    <div style={{ fontSize: 11.5, color: "var(--color-dim)" }}>
                      {m.quests} {m.quests === 1 ? t("quest.questSingular") : t("quest.questPlural")}{m.fiveStars ? ` · 5★ ×${m.fiveStars}` : ""}
                    </div>
                  </div>
                  <span style={{ fontFamily: "Oswald", fontWeight: 700, fontSize: 15, color: "#f5b400" }}>${m.earned.toLocaleString()}</span>
                </div>
              ))}

              <div style={{ textAlign: "center", fontSize: 12, color: "var(--color-dim)", marginTop: 4 }}>
                {t("quest.teamCyclePayout")} · <b style={{ fontFamily: "Oswald", color: "#f5b400", fontSize: 15 }}>${teamTotal.toLocaleString()}</b>
              </div>
            </>
          )}
        </div>
      )}

      {/* REVIEWS TAB */}
      {tab === "reviews" && (
        <div>
          {/* Star hero */}
          <div style={{ background: "linear-gradient(135deg,#4a3712,#1c1409)", border: "1px solid rgba(245,180,0,.5)", borderRadius: 20, padding: 15, marginBottom: 12, textAlign: "center", boxShadow: "0 0 50px -12px rgba(245,180,0,.8), inset 0 0 42px -18px rgba(245,180,0,.6)" }}>
            <div style={{ fontFamily: "Oswald", fontWeight: 700, fontSize: 40, color: "#f5b400", lineHeight: 1, filter: "drop-shadow(0 0 16px rgba(245,180,0,.85))" }}>{reviews.length ? reviewAvg.toFixed(1) : "—"}</div>
            <div style={{ color: "#f5b400", fontSize: 17, letterSpacing: 2, margin: "4px 0", textShadow: "0 0 14px rgba(245,180,0,.8)" }}>
              {"★".repeat(Math.round(reviewAvg))}{"☆".repeat(Math.max(0, 5 - Math.round(reviewAvg)))}
            </div>
            <div style={{ fontSize: 12.5, color: "#e9c879" }}>{reviews.length} {t("quest.reviewsLower")} · {fiveStarCycleAll} {t("quest.fiveStarThisCycle")}</div>
          </div>

          {/* Review quest chips */}
          <div style={{ display: "flex", gap: 7, marginBottom: 11 }}>
            <QuestChip label={t("quest.fiveStarTech")} value={`${metrics.fiveStarReviews} / 10`} done={metrics.fiveStarReviews >= 10} color="#8cc0ff" />
            <QuestChip label={t("quest.reviewFavor")} value={`${metrics.positiveReviews} / 15`} done={metrics.positiveReviews >= 15} color="#f5b400" />
          </div>

          {/* Reviews list */}
          {reviews.map((r) => (
            <div key={r.id} style={{ background: surf, border: `1px solid ${surfBorder}`, borderRadius: 13, padding: "11px 12px", marginBottom: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ color: (r.rating || 0) >= 5 ? "#f5b400" : "#888", fontSize: 14, letterSpacing: 1, textShadow: (r.rating || 0) >= 4 ? "0 0 10px rgba(245,180,0,.6)" : "none" }}>
                  {"★".repeat(r.rating || 0)}{"☆".repeat(5 - (r.rating || 0))}
                </span>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {r.created_at && (
                    <span style={{ fontSize: 10.5, color: "#ffd76b", background: "rgba(245,180,0,.1)", border: "1px solid rgba(245,180,0,.28)", borderRadius: 99, padding: "2px 8px", boxShadow: "0 0 12px -3px rgba(245,180,0,.55)" }}>
                      {new Date(r.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </span>
                  )}
                  <button
                    onClick={async () => {
                      if (!await useStore.getState().showConfirm(t("quest.deleteReview"), `${t("quest.deleteReviewFrom")} ${r.client_name}?`)) return;
                      await db.del("reviews", r.id);
                      loadAll();
                    }}
                    style={{ background: "none", border: 0, color: "var(--color-accent-red)", padding: "0 2px", cursor: "pointer", display: "inline-flex" }}
                  >
                    <Icon name="close" size={13} color="var(--color-accent-red)" />
                  </button>
                </div>
              </div>
              <div style={{ fontFamily: "Oswald", fontWeight: 600, fontSize: 14, marginTop: 5 }}>
                {r.client_name}{r.employee_names ? ` · ${r.employee_names}` : ""}
              </div>
              {r.review_text && (
                <div style={{ fontSize: 12.5, color: "var(--color-dim)", marginTop: 3, fontStyle: "italic", lineHeight: 1.5 }}>
                  &ldquo;{r.review_text}&rdquo;
                </div>
              )}
            </div>
          ))}

          {/* Collect via QR (function preserved) */}
          <div className="cd mb" style={{ textAlign: "center", padding: 16, marginTop: 4 }}>
            <h4 style={{ fontSize: 15, marginBottom: 8, display: "inline-flex", alignItems: "center", gap: 6 }}>
              <Icon name="qr" size={15} /> {t("quest.clientReviewQr")}
            </h4>
            <div style={{ background: "#fff", display: "inline-block", padding: 12, borderRadius: 8, marginBottom: 8 }}>
              <QRCodeSVG
                value={typeof window !== "undefined" ? `${window.location.origin}/review${user.org_id ? "?org=" + user.org_id : ""}` : "/review"}
                size={140}
                level="M"
              />
            </div>
            <p className="dim" style={{ fontSize: 13 }}>{t("quest.scanToReview")}</p>
            <button
              className="bo"
              onClick={() => {
                const url = `${window.location.origin}/review${user.org_id ? "?org=" + user.org_id : ""}`;
                navigator.clipboard.writeText(url);
                useStore.getState().showToast(t("quest.reviewLinkCopied"), "success");
              }}
              style={{ fontSize: 14, padding: "4px 12px", marginTop: 4, display: "inline-flex", alignItems: "center", gap: 6 }}
            >
              <Icon name="link" size={13} /> {t("quest.copyLink")}
            </button>
          </div>

          {/* Manual add (function preserved) */}
          <div className="cd mb">
            <h4 style={{ fontSize: 15, marginBottom: 8 }}>{t("quest.addReview")}</h4>
            <div className="row mb">
              <input value={rn} onChange={(e) => setRn(e.target.value)} placeholder={t("quest.client")} style={{ flex: 1 }} />
              <select value={rr} onChange={(e) => setRr(Number(e.target.value))} style={{ width: 60 }}>
                {[5, 4, 3, 2, 1].map((x) => (
                  <option key={x} value={x}>{x}★</option>
                ))}
              </select>
            </div>
            <textarea value={rt} onChange={(e) => setRt(e.target.value)} placeholder={t("quest.reviewPlaceholder")} style={{ height: 50, marginBottom: 6 }} />
            <button className="bb" onClick={addReview} style={{ fontSize: 13 }}>{t("common.add")}</button>
          </div>
        </div>
      )}

      {/* REFERRALS TAB */}
      {tab === "referrals" && (
        <div>
          {/* Referral quest chips */}
          <div style={{ display: "flex", gap: 7, marginBottom: 11 }}>
            <QuestChip label="Network Scout" value={`${metrics.convertedReferrals} / 1`} done={metrics.convertedReferrals >= 1} color="#3ee08f" />
            <QuestChip label="Critical Referral" value={`${metrics.repeatClients} / 1`} done={metrics.repeatClients >= 1} color="#00cc66" />
          </div>

          {/* Refer CTA (opens the add form) */}
          <button
            onClick={() => setShowRefForm((v) => !v)}
            style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, background: "rgba(0,204,102,.13)", border: "1.5px solid rgba(0,204,102,.6)", borderRadius: 14, padding: 13, fontFamily: "Oswald", fontWeight: 600, fontSize: 16, letterSpacing: ".4px", color: "#fff", marginBottom: 12, boxShadow: "0 0 24px -8px rgba(0,204,102,.5)", cursor: "pointer" }}
          >
            <Icon name="link" size={17} color="#3ee08f" /> {t("quest.addReferral")}
          </button>

          {showRefForm && (
            <div className="cd mb">
              <div className="row">
                <input value={fn} onChange={(e) => setFn(e.target.value)} placeholder="Name" style={{ flex: 1 }} />
                <input value={fs} onChange={(e) => setFs(e.target.value)} placeholder="Referred by" style={{ flex: 1 }} />
                <button className="bb" onClick={addReferral} style={{ fontSize: 13 }}>Add</button>
              </div>
            </div>
          )}

          {/* Referral rows */}
          {referrals.map((r) => {
            const initials = (r.name || "?").split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
            const chip =
              r.status === "converted"
                ? { bg: "rgba(0,204,102,.16)", c: "#3ee08f" }
                : r.status === "contacted"
                ? { bg: "rgba(46,139,255,.16)", c: "#8cc0ff" }
                : { bg: track, c: "var(--color-dim)" };
            return (
              <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 10, background: surf, border: `1px solid ${surfBorder}`, borderRadius: 13, padding: "10px 12px", marginBottom: 8 }}>
                <span style={{ width: 34, height: 34, borderRadius: "50%", background: avatarBg, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Oswald", fontWeight: 600, fontSize: 14, color: avatarFg, flex: "none" }}>{initials}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: "Oswald", fontWeight: 600, fontSize: 15 }}>{r.name}</div>
                  <div style={{ fontSize: 11.5, color: "var(--color-dim)" }}>{r.source || "—"}{r.ref_date ? ` · ${r.ref_date}` : ""}</div>
                </div>
                <select
                  value={r.status}
                  onChange={async (e) => {
                    await db.patch("referrals", r.id, { status: e.target.value });
                    loadAll();
                  }}
                  style={{ width: "auto", fontSize: 11, fontWeight: 600, padding: "4px 9px", borderRadius: 99, border: "none", background: chip.bg, color: chip.c, fontFamily: "Oswald", letterSpacing: ".04em" }}
                >
                  <option value="pending">Pending</option>
                  <option value="contacted">Contacted</option>
                  <option value="converted">Converted</option>
                </select>
              </div>
            );
          })}

          <div style={{ textAlign: "center", fontSize: 12, color: "var(--color-dim)", marginTop: 4 }}>
            Referral payout this cycle · <b style={{ fontFamily: "Oswald", color: "#f5b400", fontSize: 15 }}>${referralPayout.toLocaleString()}</b>
          </div>
        </div>
      )}

      {/* Quest-complete celebration overlay */}
      {celebrate && (
        <div
          onClick={dismissCelebrate}
          style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(8,6,15,.92)", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", cursor: "pointer" }}
        >
          <style>{`@keyframes qfall{0%{transform:translateY(-24px) rotate(0);opacity:1}100%{transform:translateY(105vh) rotate(760deg);opacity:.85}}@keyframes qpop{0%{transform:scale(.4);opacity:0}60%{transform:scale(1.12)}100%{transform:scale(1);opacity:1}}`}</style>
          <div style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" }}>
            {confetti.map((c, i) => (
              <span key={i} style={{ position: "absolute", top: -24, left: `${c.left}%`, width: c.w, height: c.h, background: c.bg, borderRadius: 2, opacity: c.op, animation: `qfall ${c.dur}s linear ${c.delay}s infinite` }} />
            ))}
          </div>
          <div style={{ position: "relative", zIndex: 2, textAlign: "center", padding: 20 }}>
            <div style={{ width: 88, height: 88, borderRadius: "50%", margin: "0 auto 16px", background: "radial-gradient(circle at 40% 35%,#ffe08a,#f5b400 65%,#b67d00)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 0 50px -6px rgba(245,180,0,.9)", animation: "qpop .6s ease-out 1" }}>
              <Icon name="trophy" size={42} color="#5a3d00" />
            </div>
            <div style={{ fontFamily: "Oswald", fontWeight: 700, fontSize: 15, letterSpacing: ".2em", color: "#3ee08f" }}>QUEST COMPLETE</div>
            <div style={{ fontFamily: "Oswald", fontWeight: 700, fontSize: 26, letterSpacing: ".5px", margin: "4px 0", background: "linear-gradient(90deg,#d8b6ff,#ffd76b)", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>{celebrate.name}</div>
            <div style={{ fontSize: 15, color: "#f1f2f6", marginBottom: 14 }}>{celebrate.desc}</div>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 7, fontFamily: "Oswald", fontWeight: 700, fontSize: 24, color: "#5a3d00", background: "linear-gradient(135deg,#ffe08a,#f5b400)", borderRadius: 99, padding: "8px 22px", boxShadow: "0 0 28px -4px rgba(245,180,0,.8)" }}>
              <Icon name="money" size={18} color="#5a3d00" /> +{celebrate.bonus}
            </div>
            <div style={{ marginTop: 18, fontSize: 13, color: "var(--color-dim)" }}>Bonus pending approval · tap to continue</div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Small battle-pass quest chip (Reviews / Referrals tabs). */
function QuestChip({ label, value, done, color }: { label: string; value: string; done: boolean; color: string }) {
  const darkMode = useStore((s) => s.darkMode);
  return (
    <div style={{ flex: 1, background: darkMode ? "var(--color-card-dark-3)" : "var(--color-card-light)", border: `1px solid ${darkMode ? "var(--color-border-dark-2)" : "var(--color-border-light)"}`, borderRadius: 11, padding: 8, textAlign: "center" }}>
      <div style={{ fontSize: 11, color: "var(--color-dim)" }}>{label}</div>
      <div style={{ fontFamily: "Oswald", fontWeight: 600, fontSize: 14, marginTop: 2, color }}>
        {value}{done ? " ✓" : ""}
      </div>
    </div>
  );
}
