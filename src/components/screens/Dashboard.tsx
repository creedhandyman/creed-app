"use client";
import { useStore } from "@/lib/store";

interface Props {
  setPage: (p: string) => void;
  openSettings: () => void;
}

export default function Dashboard({ setPage, openSettings }: Props) {
  const user = useStore((s) => s.user)!;
  const isAdmin = user.role === "owner" || user.role === "manager";
  const clients = useStore((s) => s.clients);
  const jobs = useStore((s) => s.jobs);
  const schedule = useStore((s) => s.schedule);
  const timeEntries = useStore((s) => s.timeEntries);
  const reviews = useStore((s) => s.reviews);
  const referrals = useStore((s) => s.referrals);
  const darkMode = useStore((s) => s.darkMode);

  // ── Next Job on Schedule ──
  const today = new Date().toISOString().split("T")[0];
  const upcoming = schedule
    .filter((s) => s.sched_date >= today)
    .sort((a, b) => a.sched_date.localeCompare(b.sched_date));
  const nextJob = upcoming[0];

  // ── Max Net Pay This Week ──
  const now = new Date();
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

  // ── Closest Quest to Completion ──
  const completedJobs = jobs.filter((j) => j.status === "complete" || j.status === "invoiced" || j.status === "paid").length;
  const positiveReviews = reviews.filter((r) => (r.rating || 0) >= 3).length;
  const fiveStarReviews = reviews.filter((r) => r.rating === 5).length;
  const convertedReferrals = referrals.filter((r) => r.status === "converted").length;
  const bigJobs = jobs.filter((j) => (j.status === "complete" || j.status === "paid") && (j.total_hrs || 0) >= 24).length;

  const quests = [
    { name: "Review Favor", p: positiveReviews, g: 15, bonus: "$75" },
    { name: "Five Star Tech", p: fiveStarReviews, g: 10, bonus: "$100" },
    { name: "Super Handy", p: completedJobs, g: 10, bonus: "$50" },
    { name: "Critical Referral", p: Math.min(Object.values(
      jobs.filter((j) => j.client).reduce((acc: Record<string, number>, j) => {
        acc[j.client] = (acc[j.client] || 0) + 1; return acc;
      }, {})
    ).filter((c) => c >= 5).length, 1), g: 1, bonus: "$150" },
    { name: "Make Ready Pro", p: bigJobs, g: 7, bonus: "$350" },
  ];

  const incomplete = quests.filter((q) => q.p < q.g);
  const closest = incomplete.sort((a, b) => (b.p / b.g) - (a.p / a.g))[0];

  // ── Earned This Week ──
  const weekJobs = jobs.filter((j) => {
    if (j.status !== "complete" && j.status !== "invoiced" && j.status !== "paid") return false;
    try { return new Date(j.job_date || j.created_at) >= ws; } catch { return false; }
  });
  const earnedWeek = weekJobs.reduce((s, j) => s + (j.total || 0), 0);

  return (
    <div className="fi">
      {/* Header */}
      <div className="row mb" style={{ justifyContent: "space-between" }}>
        <h2 style={{ fontSize: 22, color: "var(--color-primary)" }}>Welcome, {user.name}</h2>
        <button
          onClick={openSettings}
          style={{ background: "none", fontSize: 20, color: darkMode ? "#888" : "#666" }}
        >
          ⚙️
        </button>
      </div>

      {/* Stat cards */}
      <div className="g2 mb">
        {/* Next Job */}
        <div
          className="cd"
          style={{ borderLeft: "3px solid var(--color-primary)", cursor: nextJob ? "pointer" : undefined }}
          onClick={() => nextJob && setPage("sched")}
        >
          <div className="sl">Next Job</div>
          {nextJob ? (
            <>
              <div className="sv" style={{ color: "var(--color-primary)", fontSize: 18 }}>
                {nextJob.job}
              </div>
              <div className="dim" style={{ fontSize: 10 }}>{nextJob.sched_date}{nextJob.note ? ` · ${nextJob.note}` : ""}</div>
            </>
          ) : (
            <div className="sv" style={{ color: "var(--color-primary)" }}>—</div>
          )}
        </div>

        {/* Closest Quest */}
        <div
          className="cd"
          style={{ borderLeft: "3px solid var(--color-warning)", cursor: "pointer" }}
          onClick={() => setPage("quests")}
        >
          <div className="sl">Closest Quest</div>
          {closest ? (
            <>
              <div className="sv" style={{ color: "var(--color-warning)", fontSize: 16 }}>
                {closest.name}
              </div>
              <div className="dim" style={{ fontSize: 10 }}>
                {closest.p}/{closest.g} · {closest.bonus} bonus
              </div>
            </>
          ) : (
            <div className="sv" style={{ color: "var(--color-success)", fontSize: 16 }}>All done! 🎉</div>
          )}
        </div>

        {/* Earned This Week */}
        <div className="cd" style={{ borderLeft: "3px solid var(--color-success)" }}>
          <div className="sl">Earned This Week</div>
          <div className="sv" style={{ color: "var(--color-success)" }}>${earnedWeek.toLocaleString()}</div>
        </div>

        {/* Max Net Pay */}
        <div
          className="cd"
          style={{ borderLeft: "3px solid var(--color-highlight)", cursor: "pointer" }}
          onClick={() => setPage("payroll")}
        >
          <div className="sl">Net Pay This Week</div>
          <div className="sv" style={{ color: "var(--color-highlight)" }}>${weekPay.toFixed(0)}</div>
          <div className="dim" style={{ fontSize: 10 }}>{weekHrs.toFixed(1)} hrs × ${user.rate || 55}/hr</div>
        </div>
      </div>

      {/* Big QuoteForge CTA */}
      <div
        onClick={() => setPage("qf")}
        style={{
          background: "linear-gradient(135deg, #2E75B6, #1a4d8a)",
          borderRadius: 16,
          padding: "28px 20px",
          textAlign: "center",
          cursor: "pointer",
          marginBottom: 16,
        }}
      >
        <div style={{ fontSize: 36, marginBottom: 4 }}>⚡</div>
        <h2 style={{ color: "#fff", fontSize: 22, marginBottom: 4 }}>Start a Quote</h2>
        <p
          style={{
            color: "#ffffffaa",
            fontSize: 13,
            fontFamily: "Source Sans 3",
            textTransform: "none",
            letterSpacing: "normal",
          }}
        >
          Upload a PDF, paste an inspection, or build from scratch
        </p>
      </div>

      {/* Quick links */}
      <div className="row mb">
        {isAdmin && (
          <div
            className="cd"
            onClick={() => setPage("clients")}
            style={{ flex: 1, cursor: "pointer", display: "flex", alignItems: "center", gap: 8, padding: 12 }}
          >
            <span style={{ fontSize: 20 }}>👥</span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>Clients</div>
              <div className="dim" style={{ fontSize: 10 }}>{clients.length} contacts</div>
            </div>
          </div>
        )}
        <div
          className="cd"
          onClick={() => setPage("mileage")}
          style={{ flex: 1, cursor: "pointer", display: "flex", alignItems: "center", gap: 8, padding: 12 }}
        >
          <span style={{ fontSize: 20 }}>🚗</span>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Mileage</div>
            <div className="dim" style={{ fontSize: 10 }}>Track trips</div>
          </div>
        </div>
      </div>

      {/* Pipeline */}
      {jobs.length > 0 && (
        <div className="cd">
          <h4 style={{ fontSize: 14, marginBottom: 8 }}>Pipeline</h4>
          {jobs.slice(0, 6).map((j) => (
            <div
              key={j.id}
              className="sep"
              style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}
            >
              <span style={{ flex: 1 }}>{j.property}</span>
              <span className="dim" style={{ width: 65 }}>{j.status}</span>
              <span
                style={{
                  color: j.status === "paid" ? "var(--color-success)" : j.status === "complete" || j.status === "invoiced" ? "#00cc66" : "var(--color-warning)",
                  fontFamily: "Oswald",
                  width: 65,
                  textAlign: "right",
                }}
              >
                ${(j.total || 0).toFixed(0)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
