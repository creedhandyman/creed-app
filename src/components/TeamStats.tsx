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

    return {
      totalHours,
      totalEarned,
      jobsWorked,
      tenureDays,
      tenureLabel,
      topTrades,
      reviewCount: techReviews.length,
      avgRating,
    };
  };

  const StatPill = ({ label, value, color }: { label: string; value: string; color: string }) => (
    <div style={{ flex: 1, minWidth: 80, padding: "6px 8px", background: darkMode ? "#0d0d14" : "#f7f7fa", borderRadius: 6, textAlign: "center" }}>
      <div className="dim" style={{ fontSize: 10, fontFamily: "Oswald", letterSpacing: ".06em" }}>{label}</div>
      <div style={{ fontSize: 14, fontFamily: "Oswald", fontWeight: 700, color, marginTop: 2 }}>{value}</div>
    </div>
  );

  return (
    <div className="cd">
      {/* Invite code (admin only) — preserved from TeamSettings */}
      {isOwner && user.org_id && (
        <div
          style={{
            marginBottom: 12,
            padding: 10,
            background: darkMode ? "#1a1a28" : "#f0f4f8",
            borderRadius: 8,
          }}
        >
          <div className="sl" style={{ marginBottom: 4 }}>
            Invite Code (share with team)
          </div>
          <div style={{ fontFamily: "monospace", fontSize: 13, color: "var(--color-primary)", wordBreak: "break-all" }}>
            {user.org_id}
          </div>
          <button
            onClick={() => {
              navigator.clipboard.writeText(user.org_id);
              useStore.getState().showToast("Copied!", "success");
            }}
            style={{ fontSize: 12, marginTop: 4, background: "none", color: "var(--color-primary)", padding: 0, textDecoration: "underline" }}
          >
            Copy to clipboard
          </button>
        </div>
      )}

      <h4 style={{ fontSize: 14, marginBottom: 8, display: "inline-flex", alignItems: "center", gap: 6 }}>
        <Icon name="clients" size={15} color="var(--color-primary)" />
        Team ({profiles.length}) <span className="dim" style={{ fontSize: 11, fontWeight: 400 }}>· tap a row for career stats</span>
      </h4>

      {profiles.map((u: Profile) => {
        const stats = careerStats(u);
        const isOpen = expanded === u.id;
        return (
          <div key={u.id} className="sep" style={{ fontSize: 13 }}>
            <div className="row" style={{ justifyContent: "space-between", cursor: "pointer" }} onClick={() => setExpanded(isOpen ? null : u.id)}>
              <div className="row" style={{ gap: 8 }}>
                {/* Avatar (click to upload, owner-or-self) */}
                <label
                  onClick={(e) => e.stopPropagation()}
                  title={isOwner || u.id === user.id ? "Click to change photo" : ""}
                  style={{
                    width: 36, height: 36, borderRadius: "50%",
                    background: u.photo_url ? `url(${u.photo_url}) center/cover` : "var(--color-primary)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    color: "#fff", fontFamily: "Oswald", fontSize: 14, fontWeight: 700,
                    cursor: isOwner || u.id === user.id ? "pointer" : "default",
                    flexShrink: 0, border: "2px solid var(--color-border-dark)", overflow: "hidden",
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
                        if (error) {
                          useStore.getState().showToast("Photo upload failed: " + error.message, "error");
                          return;
                        }
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
                <div>
                  <b>{u.name}</b> <span className="dim">#{u.emp_num}</span>
                  <div className="dim" style={{ fontSize: 11 }}>
                    {u.role} · {stats.tenureLabel} on team{stats.totalHours > 0 ? ` · ${stats.totalHours.toFixed(0)}h all-time` : ""}
                  </div>
                </div>
              </div>
              {isOwner ? (
                <div className="row" onClick={(e) => e.stopPropagation()}>
                  <select
                    defaultValue={u.role}
                    style={{ width: "auto", fontSize: 12, padding: "2px 4px" }}
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
                    style={{ width: 55, padding: "2px 4px", fontSize: 12 }}
                    onBlur={async (e) => {
                      const newRate = parseFloat(e.target.value) || 0;
                      await db.patch("profiles", u.id, { rate: newRate });
                      await loadAll();
                      if (u.id === user.id) setUser({ ...user, rate: newRate });
                    }}
                  />
                  <span style={{ fontSize: 11 }}>/hr</span>
                  {u.id !== user.id && (
                    <button
                      onClick={async () => {
                        if (!(await useStore.getState().showConfirm("Remove Team Member", `Remove ${u.name} from the team?`))) return;
                        await db.del("profiles", u.id);
                        loadAll();
                      }}
                      aria-label={`Remove ${u.name}`}
                      style={{ background: "none", color: "var(--color-accent-red)", padding: "0 4px", display: "inline-flex", alignItems: "center" }}
                    >
                      <Icon name="close" size={14} />
                    </button>
                  )}
                </div>
              ) : (
                <span>${u.id === user.id ? user.rate : "—"}/hr</span>
              )}
            </div>

            {/* Career stats — expanded view */}
            {isOpen && (
              <div style={{ marginTop: 8, padding: 10, background: darkMode ? "#0a0a10" : "#fafbfc", borderRadius: 8, borderLeft: `3px solid var(--color-primary)` }}>
                <div className="dim" style={{ fontSize: 10, fontFamily: "Oswald", letterSpacing: ".06em", marginBottom: 6 }}>
                  ALL-TIME CAREER STATS · NEVER RESETS
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                  <StatPill label="HOURS" value={stats.totalHours.toFixed(1)} color="var(--color-primary)" />
                  <StatPill label="EARNED" value={`$${Math.round(stats.totalEarned).toLocaleString()}`} color="var(--color-success)" />
                  <StatPill label="JOBS" value={String(stats.jobsWorked)} color="var(--color-warning)" />
                  <StatPill label="TENURE" value={stats.tenureLabel} color="var(--color-highlight)" />
                </div>

                {/* Employee number + start date — editable by owner */}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, fontSize: 12, marginBottom: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <span className="dim">Emp #</span>
                    {isOwner ? (
                      <input
                        defaultValue={u.emp_num}
                        style={{ width: 70, padding: "2px 4px", fontSize: 12 }}
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
                        style={{ padding: "2px 4px", fontSize: 12 }}
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
                    <div className="dim" style={{ fontSize: 10, fontFamily: "Oswald", letterSpacing: ".06em", marginBottom: 4 }}>
                      TOP TRADES (by hours)
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                      {stats.topTrades.map((t) => (
                        <span
                          key={t.trade}
                          style={{
                            fontSize: 11, padding: "2px 8px", borderRadius: 10,
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
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
                    <span className="dim">Client rating</span>
                    <span style={{ fontFamily: "Oswald", color: "var(--color-highlight)", fontSize: 14 }}>
                      ★ {stats.avgRating.toFixed(1)}
                    </span>
                    <span className="dim">· {stats.reviewCount} review{stats.reviewCount === 1 ? "" : "s"}</span>
                  </div>
                )}

                {stats.totalHours === 0 && stats.reviewCount === 0 && (
                  <div className="dim" style={{ fontSize: 11, fontStyle: "italic", padding: "4px 0" }}>
                    Career stats build as {u.name?.split(/\s+/)[0] || "this tech"} clocks in and works jobs. Numbers here will never reset.
                  </div>
                )}

                <div style={{ marginTop: 6, paddingTop: 6, borderTop: `1px solid ${border}` }}>
                  <div className="dim" style={{ fontSize: 10, fontFamily: "Oswald", letterSpacing: ".06em" }}>
                    {u.email}
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
