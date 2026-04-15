"use client";
import { useState, useEffect } from "react";
import { useStore } from "@/lib/store";
import { t } from "@/lib/i18n";

interface Props {
  setPage: (p: string) => void;
  openSettings: () => void;
}

export default function Dashboard({ setPage, openSettings }: Props) {
  const user = useStore((s) => s.user)!;
  const isAdmin = user.role === "owner" || user.role === "manager";
  const org = useStore((s) => s.org);
  const jobs = useStore((s) => s.jobs);
  const schedule = useStore((s) => s.schedule);
  const timeEntries = useStore((s) => s.timeEntries);
  const reviews = useStore((s) => s.reviews);
  const darkMode = useStore((s) => s.darkMode);

  // ── Next Job on Schedule ──
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const upcoming = schedule
    .filter((s) => s.sched_date >= today)
    .sort((a, b) => a.sched_date.localeCompare(b.sched_date));
  const nextJob = upcoming[0];

  // ── Net Pay This Week ──
  const ws = new Date(now);
  ws.setDate(now.getDate() - now.getDay());
  ws.setHours(0, 0, 0, 0);
  const weekEntries = timeEntries.filter((e) => {
    if (e.user_id !== user.id && e.user_name !== user.name) return false;
    try {
      const parts = e.entry_date?.split("/");
      if (parts?.length === 3) {
        const d = new Date(parseInt(parts[2]), parseInt(parts[0]) - 1, parseInt(parts[1]));
        return d >= ws;
      }
      return new Date(e.entry_date) >= ws;
    } catch { return false; }
  });
  const weekHrs = weekEntries.reduce((s, e) => s + (e.hours || 0), 0);
  const weekPay = weekHrs * (user.rate || 55);

  // ── Closest Quest ──
  const completedJobs = jobs.filter((j) => j.status === "complete" || j.status === "invoiced" || j.status === "paid").length;
  const positiveReviews = reviews.filter((r) => (r.rating || 0) >= 3).length;
  const fiveStarReviews = reviews.filter((r) => r.rating === 5).length;
  const quests = [
    { name: "Review Favor", p: positiveReviews, g: 15, bonus: "$75" },
    { name: "Five Star Tech", p: fiveStarReviews, g: 10, bonus: "$100" },
    { name: "Super Handy", p: completedJobs, g: 10, bonus: "$50" },
  ];
  const incomplete = quests.filter((q) => q.p < q.g);
  const closest = incomplete.sort((a, b) => (b.p / b.g) - (a.p / a.g))[0];

  // ── Earned This Month ──
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthJobs = jobs.filter((j) => {
    if (j.status !== "complete" && j.status !== "invoiced" && j.status !== "paid") return false;
    try { return new Date(j.job_date || j.created_at) >= monthStart; } catch { return false; }
  });
  const earnedMonth = monthJobs.reduce((s, j) => s + (j.total || 0), 0);

  // Getting Started guide
  const [guideDismissed, setGuideDismissed] = useState(true);
  useEffect(() => {
    const d = localStorage.getItem("c_guide_dismissed");
    if (!d) setGuideDismissed(false);
  }, []);

  // Check if user is clocked in (for Work Vision)
  const isClocked = (() => {
    try { return JSON.parse(localStorage.getItem("c_t_on") || "false"); } catch { return false; }
  })();
  const clockedJob = (() => {
    try { return localStorage.getItem("c_t_sj") ? JSON.parse(localStorage.getItem("c_t_sj")!) : ""; } catch { return ""; }
  })();

  return (
    <div className="fi">
      {/* Header */}
      <div className="row mb" style={{ justifyContent: "space-between" }}>
        <h2 style={{ fontSize: 22, color: "var(--color-primary)" }}>{t("dash.welcome")}, {user.name}</h2>
        <button onClick={openSettings} style={{ background: "none", fontSize: 20, color: darkMode ? "#888" : "#666" }}>⚙️</button>
      </div>

      {/* Getting Started — only for new users */}
      {!guideDismissed && (
        <div className="cd mb" style={{ borderLeft: "3px solid var(--color-primary)", padding: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 18 }}>🚀</span>
              <h4 style={{ fontSize: 14, color: "var(--color-primary)" }}>{t("dash.gettingStarted")}</h4>
            </div>
            <button onClick={() => { localStorage.setItem("c_guide_dismissed", "1"); setGuideDismissed(true); }} style={{ background: "none", fontSize: 13, color: "#555" }}>✕</button>
          </div>
          <div className="dim" style={{ fontSize: 12, marginTop: 6 }}>
            Create a quote → Schedule the job → Clock in → Complete → Get paid
          </div>
        </div>
      )}

      {/* 4 Stat Cards — forced 2x2 */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
        <div className="cd" style={{ borderLeft: "3px solid var(--color-primary)", cursor: nextJob ? "pointer" : undefined }} onClick={() => nextJob && setPage("sched")}>
          <div className="sl">{t("dash.nextJob")}</div>
          {nextJob ? (
            <>
              <div className="sv" style={{ color: "var(--color-primary)", fontSize: 18 }}>{nextJob.job}</div>
              <div className="dim" style={{ fontSize: 12 }}>
                {(() => {
                  const d = new Date(nextJob.sched_date + "T12:00:00");
                  const dayStr = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
                  const timeMatch = nextJob.note?.match(/🕐\s*(\d{1,2}:\d{2})/);
                  const timeStr = timeMatch ? (() => { const [h, m] = timeMatch[1].split(":").map(Number); const ampm = h >= 12 ? "PM" : "AM"; return `${h > 12 ? h - 12 : h || 12}:${String(m).padStart(2, "0")} ${ampm}`; })() : "";
                  return `${dayStr}${timeStr ? ` · ${timeStr}` : ""}`;
                })()}
              </div>
            </>
          ) : (
            <div className="sv" style={{ color: "var(--color-primary)" }}>—</div>
          )}
        </div>

        <div className="cd" style={{ borderLeft: "3px solid var(--color-success)" }}>
          <div className="sl">{t("dash.earnedMonth")}</div>
          <div className="sv" style={{ color: "var(--color-success)" }}>${earnedMonth.toLocaleString()}</div>
        </div>

        <div className="cd" style={{ borderLeft: "3px solid var(--color-highlight)", cursor: "pointer" }} onClick={() => setPage("ops")}>
          <div className="sl">{t("dash.netPay")}</div>
          <div className="sv" style={{ color: "var(--color-highlight)" }}>${weekPay.toFixed(0)}</div>
          <div className="dim" style={{ fontSize: 12 }}>{weekHrs.toFixed(1)} hrs × ${user.rate || 55}/hr</div>
        </div>

        <div className="cd" style={{ borderLeft: "3px solid var(--color-warning)", cursor: "pointer" }} onClick={() => setPage("quests")}>
          <div className="sl">{t("dash.closestQuest")}</div>
          {closest ? (
            <>
              <div className="sv" style={{ color: "var(--color-warning)", fontSize: 16 }}>{closest.name}</div>
              <div className="dim" style={{ fontSize: 12 }}>{closest.p}/{closest.g} · {closest.bonus} bonus</div>
            </>
          ) : (
            <div className="sv" style={{ color: "var(--color-success)", fontSize: 16 }}>All done! 🎉</div>
          )}
        </div>
      </div>

      {/* Start Quote + Work Vision — side by side */}
      <div className="g2 mb">
        <div
          onClick={() => setPage("qf")}
          style={{
            background: "linear-gradient(135deg, #2E75B6, #1a4d8a)",
            borderRadius: 14, padding: "20px 16px", textAlign: "center", cursor: "pointer",
          }}
        >
          <div style={{ fontSize: 28, marginBottom: 4 }}>⚡</div>
          <h3 style={{ color: "#fff", fontSize: 16, marginBottom: 2, fontFamily: "Oswald", textTransform: "uppercase" }}>{t("dash.startQuote")}</h3>
          <p style={{ color: "#ffffffaa", fontSize: 12, fontFamily: "Source Sans 3", textTransform: "none", letterSpacing: "normal" }}>
            PDF, inspection, or manual
          </p>
        </div>

        <div
          onClick={() => setPage("workvision")}
          style={{
            background: isClocked
              ? "linear-gradient(135deg, #00cc66, #009944)"
              : "linear-gradient(135deg, #C00000, #8a0000)",
            borderRadius: 14, padding: "20px 16px", textAlign: "center", cursor: "pointer",
          }}
        >
          <div style={{ fontSize: 28, marginBottom: 4 }}>{isClocked ? "🟢" : "👷"}</div>
          <h3 style={{ color: "#fff", fontSize: 16, marginBottom: 2, fontFamily: "Oswald", textTransform: "uppercase" }}>
            {isClocked ? "Work Mode" : "Clock In"}
          </h3>
          <p style={{ color: "#ffffffaa", fontSize: 12, fontFamily: "Source Sans 3", textTransform: "none", letterSpacing: "normal" }}>
            {isClocked ? clockedJob || "Active" : "Start your day"}
          </p>
        </div>
      </div>

      {/* Mileage + Website — side by side */}
      <div className="g2 mb">
        <div className="cd" onClick={() => setPage("mileage")} style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 8, padding: 12 }}>
          <span style={{ fontSize: 20 }}>🚗</span>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{t("dash.mileage")}</div>
            <div className="dim" style={{ fontSize: 12 }}>{t("dash.trackTrips")}</div>
          </div>
        </div>

        {isAdmin ? (
          <div className="cd" onClick={() => setPage("marketing")} style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 8, padding: 12 }}>
            <span style={{ fontSize: 20 }}>📣</span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{t("dash.marketing")}</div>
              <div className="dim" style={{ fontSize: 12 }}>{org?.site_content ? "Manage site" : "Build site"}</div>
            </div>
          </div>
        ) : (
          <div className="cd" onClick={() => setPage("troubleshoot")} style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 8, padding: 12 }}>
            <span style={{ fontSize: 20 }}>🔧</span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{t("dash.troubleshoot")}</div>
              <div className="dim" style={{ fontSize: 12 }}>{t("dash.aiDiagnosis")}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
