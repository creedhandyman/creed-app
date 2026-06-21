"use client";
import { useState } from "react";
import { useStore } from "@/lib/store";
import { db, supabase } from "@/lib/supabase";
import type { Profile } from "@/lib/types";
import { Icon } from "./Icon";

/**
 * Team Stats — supersets the old TeamSettings panel. Keeps every admin
 * action that was there (invite code, photo upload, role/rate edit, remove,
 * employee number) AND adds an "all-time career stats" expansion per tech:
 * total hours logged ever, total earnings, distinct jobs worked, tenure,
 * top trades by hours, average review rating.
 *
 * The career numbers come from time_entries / jobs / reviews already in the
 * store — they're computed live, never stored, and never reset. Period
 * filters (week/month/quarter on Payroll/Financials) are display filters,
 * not data resets, so a tech's all-time history is always intact.
 */
export default function TeamStats() {
  const user = useStore((s) => s.user)!;
  const profiles = useStore((s) => s.profiles);
  const timeEntries = useStore((s) => s.timeEntries);
  const jobs = useStore((s) => s.jobs);
  const reviews = useStore((s) => s.reviews);
  const questPayouts = useStore((s) => s.questPayouts);
  const setUser = useStore((s) => s.setUser);
  const loadAll = useStore((s) => s.loadAll);
  const darkMode = useStore((s) => s.darkMode);
  const isOwner = user.role === "owner" || user.role === "manager";

  const [expanded, setExpanded] = useState<string | null>(null);

  const border = darkMode ? "#1e1e2e" : "#eee";

  /** All-time career stats for one profile — never reset, sums every
   *  time_entry the user ever logged. Other periodic views in the app
   *  (Payroll, Timer, Financials) filter for display but don't touch the
   *  underlying data. */
  const careerStats = (p: Profile) => {
    const allEntries = timeEntries.filter((e) => e.user_id === p.id || (!e.user_id && e.user_name === p.name));
    const totalHours = allEntries.reduce((s, e) => s + (e.hours || 0), 0);
    const totalEarned = allEntries.reduce((s, e) => s + (e.amount || 0), 0);
    const distinctJobs = new Set(allEntries.map((e) => e.job).filter((x): x is string => !!x && x !== "General"));
    const jobsWorked = distinctJobs.size;

    // Tenure (days since start_date)
    let tenureDays = 0;
    let tenureLabel = "—";
    try {
      if (p.start_date) {
        const start = new Date(p.start_date);
        if (!isNaN(start.getTime())) {
          tenureDays = Math.max(0, Math.floor((Date.now() - start.getTime()) / (24 * 60 * 60 * 1000)));
          if (tenureDays >= 365) {
            const y = Math.floor(tenureDays / 365);
            const m = Math.floor((tenureDays % 365) / 30);
            tenureLabel = m > 0 ? `${y}y ${m}mo` : `${y}y`;
          } else if (tenureDays >= 30) {
            tenureLabel = `${Math.floor(tenureDays / 30)}mo`;
          } else {
            tenureLabel = `${tenureDays}d`;
          }
        }
      }
    } catch { /* */ }

    // Top trades — match each job by property string, pull job.trade
    const tradeHours: Record<string, number> = {};
    allEntries.forEach((e) => {
      const job = jobs.find((j) => j.property === e.job);
      const trade = job?.trade || "General";
      tradeHours[trade] = (tradeHours[trade] || 0) + (e.hours || 0);
    });
    const topTrades = Object.entries(tradeHours)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([trade, hrs]) => ({ trade, hrs }));

    // Reviews where this employee's name was tagged on the review
    const techReviews = reviews.filter((r) => {
      if (!r.employee_names) return false;
      const names = r.employee_names.split(",").map((n) => n.trim().toLowerCase());
      return p.name && names.includes(p.name.toLowerCase());
    });
    const avgRating = techReviews.length
      ? techReviews.reduce((s, r) => s + (r.rating || 0), 0) / techReviews.length
      : 0;

    // Quests won (distinct paid quest keys) + no-callback rate over the
    // tech's completed jobs (matched by job_id or property name).
    const questsWon = new Set(questPayouts.filter((qp) => qp.user_id === p.id).map((qp) => qp.quest_key)).size;
    const jobIds = new Set(allEntries.map((e) => e.job_id).filter((x): x is string => !!x));
    const jobNames = new Set(allEntries.map((e) => e.job).filter((x): x is string => !!x && x !== "General"));
    const techJobs = jobs.filter((j) => jobIds.has(j.id) || (!!j.property && jobNames.has(j.property)));
    const completedTechJobs = techJobs.filter((j) => ["complete", "invoiced", "paid"].includes(j.status));
    const callbacks = completedTechJobs.filter((j) => j.callback).length;
    const noCallbackPct = completedTechJobs.length > 0 ? Math.round((1 - callbacks / completedTechJobs.length) * 100) : 100;

    return {
      totalHours,
      totalEarned,
      jobsWorked,
      tenureDays,
      tenureLabel,
      topTrades,
      reviewCount: techReviews.length,
      avgRating,
      questsWon,
      noCallbackPct,
    };
  };

  const StatPill = ({ label, value, color }: { label: string; value: string; color: string }) => (
    <div style={{ flex: 1, minWidth: 80, padding: "6px 8px", background: darkMode ? "#0d0d14" : "#f7f7fa", borderRadius: 6, textAlign: "center" }}>
      <div className="dim" style={{ fontSize: 12, fontFamily: "Oswald", letterSpacing: ".06em" }}>{label}</div>
      <div style={{ fontSize: 16, fontFamily: "Oswald", fontWeight: 700, color, marginTop: 2 }}>{value}</div>
    </div>
  );

  // Photo avatar with inline upload (owner or self). Reused by the baseball
  // card and the compact rows.
  const photoAvatar = (u: Profile, size: number, fontSize: number) => (
    <label
      onClick={(e) => e.stopPropagation()}
      title={isOwner || u.id === user.id ? "Change photo" : ""}
      style={{
        width: size, height: size, borderRadius: "50%",
        background: u.photo_url ? `url(${u.photo_url}) center/cover` : "var(--color-primary)",
        display: "flex", alignItems: "center", justifyContent: "center",
        color: "#fff", fontFamily: "Oswald", fontSize, fontWeight: 700,
        cursor: isOwner || u.id === user.id ? "pointer" : "default",
        flexShrink: 0, overflow: "hidden",
      }}
    >
      {!u.photo_url && (u.name?.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase() || "?")}
      {(isOwner || u.id === user.id) && (
        <input
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const ext = file.name.split(".").pop() || "jpg";
            const path = `avatars/${u.id}_${Date.now()}.${ext}`;
            const { error } = await supabase.storage.from("receipts").upload(path, file);
            if (error) { useStore.getState().showToast("Photo upload failed: " + error.message, "error"); return; }
            const { data } = supabase.storage.from("receipts").getPublicUrl(path);
            await db.patch("profiles", u.id, { photo_url: data.publicUrl });
            await loadAll();
            if (u.id === user.id) setUser({ ...user, photo_url: data.publicUrl });
            useStore.getState().showToast("Photo updated", "success");
            e.target.value = "";
          }}
        />
      )}
    </label>
  );

  // Rank by lifetime earnings — the top earner gets the baseball card.
  const ranked = profiles
    .map((p) => ({ p, stats: careerStats(p) }))
    .sort((a, b) => b.stats.totalEarned - a.stats.totalEarned);

  // Shared editable controls (role / rate / remove) — owner only.
  const editControls = (u: Profile) => (
    <div className="row" style={{ gap: 6, marginBottom: 10, flexWrap: "wrap" }} onClick={(e) => e.stopPropagation()}>
      <select
        defaultValue={u.role}
        style={{ width: "auto", fontSize: 14, padding: "3px 6px" }}
        onChange={async (e) => {
          if (u.id === user.id && (e.target.value === "tech" || e.target.value === "apprentice")) {
            if (!(await useStore.getState().showConfirm("Warning", "Demoting yourself will lock you out of admin settings. Are you sure?"))) {
              e.target.value = u.role;
              return;
            }
          }
          await db.patch("profiles", u.id, { role: e.target.value });
          if (u.id === user.id) setUser({ ...user, role: e.target.value as Profile["role"] });
          loadAll();
        }}
      >
        <option value="apprentice">Apprentice</option>
        <option value="tech">Tech</option>
        <option value="manager">Manager</option>
        <option value="owner">Owner</option>
      </select>
      <span>$</span>
      <input
        type="number"
        defaultValue={u.rate}
        style={{ width: 60, padding: "3px 6px", fontSize: 14 }}
        onBlur={async (e) => {
          const newRate = parseFloat(e.target.value) || 0;
          await db.patch("profiles", u.id, { rate: newRate });
          await loadAll();
          if (u.id === user.id) setUser({ ...user, rate: newRate });
        }}
      />
      <span style={{ fontSize: 13 }}>/hr</span>
      {u.id !== user.id && (
        <button
          onClick={async () => {
            if (!(await useStore.getState().showConfirm("Remove Team Member", `Remove ${u.name} from the team?`))) return;
            await db.del("profiles", u.id);
            loadAll();
          }}
          aria-label={`Remove ${u.name}`}
          style={{ marginLeft: "auto", background: "none", color: "var(--color-accent-red)", padding: "0 4px", display: "inline-flex", alignItems: "center", gap: 4, fontSize: 13 }}
        >
          <Icon name="close" size={14} /> Remove
        </button>
      )}
    </div>
  );

  return (
    <div>
      {/* Invite CTA */}
      {isOwner && user.org_id && (
        <div
          onClick={() => { navigator.clipboard.writeText(user.org_id); useStore.getState().showToast("Invite code copied!", "success"); }}
          style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, background: "rgba(46,139,255,.12)", border: "1.5px dashed rgba(46,139,255,.5)", borderRadius: 13, padding: 12, fontFamily: "Oswald", fontWeight: 600, fontSize: 13, color: "#8cc0ff", marginBottom: 13, cursor: "pointer" }}
        >
          <Icon name="clients" size={16} color="#8cc0ff" /> Invite teammate · tap to copy code
        </div>
      )}

      {ranked.map(({ p: u, stats }, idx) => {
        const isOpen = expanded === u.id;
        const isTop = idx === 0 && stats.totalEarned > 0;
        return (
          <div key={u.id} style={{ marginBottom: 8 }}>
            {isTop ? (
              /* ── Baseball card (top earner) ── */
              <div style={{ background: "linear-gradient(165deg,#1c2746,#0f1320)", border: "1px solid #2c3a5e", borderRadius: 20, overflow: "hidden", boxShadow: "0 0 42px -16px rgba(46,139,255,.55)" }}>
                <div style={{ height: 54, background: "linear-gradient(120deg,#2e8bff,#1a4d8a)", position: "relative" }}>
                  <span style={{ position: "absolute", right: 14, top: 11, fontFamily: "Oswald", fontWeight: 700, fontSize: 10, letterSpacing: ".1em", color: "#cfe4ff", background: "rgba(0,0,0,.22)", padding: "3px 9px", borderRadius: 99 }}>★ TOP EARNER</span>
                </div>
                <div style={{ display: "flex", gap: 12, padding: "0 16px" }}>
                  <div style={{ marginTop: -34, border: "3px solid #0f1320", borderRadius: "50%", flexShrink: 0 }}>{photoAvatar(u, 70, 26)}</div>
                  <div style={{ paddingTop: 9, minWidth: 0 }}>
                    <div style={{ fontFamily: "Oswald", fontWeight: 700, fontSize: 18, letterSpacing: ".4px" }}>{u.name}</div>
                    <div style={{ fontSize: 10, color: "#8cc0ff", marginTop: 1, textTransform: "capitalize" }}>{u.role}{u.emp_num ? ` · #${u.emp_num}` : ""} · ${u.rate}/hr</div>
                    <div style={{ fontSize: 9.5, color: "var(--color-dim)", marginTop: 3 }}>{u.start_date ? `Since ${new Date(u.start_date).toLocaleDateString("en-US", { month: "short", year: "numeric" })} · ` : ""}{stats.tenureLabel} on team</div>
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 1, background: "var(--color-border-dark-2)", marginTop: 13, borderTop: "1px solid var(--color-border-dark-2)" }}>
                  {[
                    { v: stats.totalHours.toFixed(0), l: "Lifetime hrs", c: "inherit" },
                    { v: stats.totalEarned >= 1000 ? `$${(stats.totalEarned / 1000).toFixed(1)}k` : `$${Math.round(stats.totalEarned)}`, l: "Earned", c: "var(--color-money)" },
                    { v: String(stats.jobsWorked), l: "Jobs", c: "inherit" },
                    { v: stats.avgRating > 0 ? `${stats.avgRating.toFixed(1)}★` : "—", l: "Avg rating", c: "#f5b400" },
                    { v: String(stats.questsWon), l: "Quests won", c: "#c9a6ff" },
                    { v: `${stats.noCallbackPct}%`, l: "No callback", c: "inherit" },
                  ].map((s) => (
                    <div key={s.l} style={{ background: "#12172a", padding: "11px 6px", textAlign: "center" }}>
                      <div style={{ fontFamily: "Oswald", fontWeight: 700, fontSize: 18, lineHeight: 1, color: s.c }}>{s.v}</div>
                      <div style={{ fontSize: 8, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--color-dim)", marginTop: 3 }}>{s.l}</div>
                    </div>
                  ))}
                </div>
                {stats.topTrades.length > 0 && (
                  <div style={{ padding: "11px 16px 0" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--color-dim)", marginBottom: 5 }}>
                      <span>Top trade</span>
                      <b style={{ fontFamily: "Oswald", fontWeight: 600 }}>{stats.topTrades[0].trade} · {stats.topTrades[0].hrs.toFixed(0)}h</b>
                    </div>
                    <div style={{ height: 7, background: "#1c2740", borderRadius: 5, overflow: "hidden" }}>
                      <div style={{ height: "100%", borderRadius: 5, background: "linear-gradient(90deg,#2e8bff,#9d4edd)", width: `${Math.min(100, stats.totalHours > 0 ? (stats.topTrades[0].hrs / stats.totalHours) * 100 : 0)}%` }} />
                    </div>
                  </div>
                )}
                {isOwner && (
                  <div style={{ padding: 14 }}>
                    <button
                      onClick={() => setExpanded(isOpen ? null : u.id)}
                      style={{ width: "100%", fontSize: 10.5, fontWeight: 600, padding: 9, borderRadius: 10, border: "1px solid var(--color-border-dark-2)", background: "rgba(255,255,255,.04)", color: "inherit", cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6 }}
                    >
                      <Icon name={isOpen ? "collapse" : "edit"} size={13} /> {isOpen ? "Close" : "Rate / role · details"}
                    </button>
                  </div>
                )}
              </div>
            ) : (
              /* ── Compact row ── */
              <div onClick={() => setExpanded(isOpen ? null : u.id)} style={{ display: "flex", alignItems: "center", gap: 11, background: "var(--color-card-dark-3)", border: "1px solid var(--color-border-dark-2)", borderRadius: 13, padding: "10px 12px", cursor: "pointer" }}>
                {photoAvatar(u, 34, 13)}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: "Oswald", fontWeight: 600, fontSize: 13 }}>{u.name}</div>
                  <div style={{ fontSize: 9.5, color: "var(--color-dim)", textTransform: "capitalize" }}>{u.role}{u.emp_num ? ` · #${u.emp_num}` : ""}</div>
                </div>
                <span style={{ fontFamily: "Oswald", fontWeight: 600, fontSize: 12, color: "var(--color-dim)" }}>${(isOwner || u.id === user.id) ? u.rate : "—"}/hr</span>
                <Icon name={isOpen ? "collapse" : "next"} size={15} color="var(--color-dim)" />
              </div>
            )}

            {/* ── Expanded: edits + career detail ── */}
            {isOpen && (
              <div style={{ marginTop: 8, padding: 12, background: "var(--color-card-dark-2)", borderRadius: 13, border: "1px solid var(--color-border-dark-2)" }}>
                {isOwner && editControls(u)}

                {!isTop && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                    <StatPill label="HOURS" value={stats.totalHours.toFixed(1)} color="var(--color-primary)" />
                    <StatPill label="EARNED" value={`$${Math.round(stats.totalEarned).toLocaleString()}`} color="var(--color-success)" />
                    <StatPill label="JOBS" value={String(stats.jobsWorked)} color="var(--color-warning)" />
                    <StatPill label="TENURE" value={stats.tenureLabel} color="var(--color-highlight)" />
                  </div>
                )}

                {/* Employee number + start date — editable by owner */}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, fontSize: 14, marginBottom: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <span className="dim">Emp #</span>
                    {isOwner ? (
                      <input
                        defaultValue={u.emp_num}
                        style={{ width: 70, padding: "2px 4px", fontSize: 14 }}
                        onBlur={async (e) => {
                          if (e.target.value !== u.emp_num) {
                            await db.patch("profiles", u.id, { emp_num: e.target.value });
                            await loadAll();
                          }
                        }}
                      />
                    ) : (
                      <span style={{ fontFamily: "Oswald" }}>{u.emp_num || "—"}</span>
                    )}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <span className="dim">Start date</span>
                    {isOwner ? (
                      <input
                        type="date"
                        defaultValue={u.start_date || ""}
                        style={{ padding: "2px 4px", fontSize: 14 }}
                        onChange={async (e) => {
                          await db.patch("profiles", u.id, { start_date: e.target.value });
                          await loadAll();
                        }}
                      />
                    ) : (
                      <span style={{ fontFamily: "Oswald" }}>{u.start_date || "—"}</span>
                    )}
                  </div>
                </div>

                {/* Top trades */}
                {stats.topTrades.length > 0 && (
                  <div style={{ marginBottom: 6 }}>
                    <div className="dim" style={{ fontSize: 12, fontFamily: "Oswald", letterSpacing: ".06em", marginBottom: 4 }}>
                      TOP TRADES (by hours)
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                      {stats.topTrades.map((t) => (
                        <span
                          key={t.trade}
                          style={{
                            fontSize: 13, padding: "2px 8px", borderRadius: 10,
                            background: "var(--color-primary)15",
                            color: "var(--color-primary)",
                            fontFamily: "Oswald", letterSpacing: ".04em",
                          }}
                        >
                          {t.trade} · {t.hrs.toFixed(0)}h
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Review rating */}
                {stats.reviewCount > 0 && (
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14 }}>
                    <span className="dim">Client rating</span>
                    <span style={{ fontFamily: "Oswald", color: "var(--color-highlight)", fontSize: 16 }}>
                      ★ {stats.avgRating.toFixed(1)}
                    </span>
                    <span className="dim">· {stats.reviewCount} review{stats.reviewCount === 1 ? "" : "s"}</span>
                  </div>
                )}

                {stats.totalHours === 0 && stats.reviewCount === 0 && (
                  <div className="dim" style={{ fontSize: 13, fontStyle: "italic", padding: "4px 0" }}>
                    Career stats build as {u.name?.split(/\s+/)[0] || "this tech"} clocks in and works jobs. Numbers here will never reset.
                  </div>
                )}

                {u.email && (
                  <div style={{ marginTop: 6, paddingTop: 6, borderTop: `1px solid ${border}` }}>
                    <div className="dim" style={{ fontSize: 12, fontFamily: "Oswald", letterSpacing: ".06em" }}>
                      {u.email}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
