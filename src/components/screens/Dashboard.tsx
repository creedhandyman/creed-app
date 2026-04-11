"use client";
import { useStore } from "@/lib/store";

interface Props {
  setPage: (p: string) => void;
  openSettings: () => void;
}

export default function Dashboard({ setPage, openSettings }: Props) {
  const user = useStore((s) => s.user)!;
  const jobs = useStore((s) => s.jobs);
  const darkMode = useStore((s) => s.darkMode);

  const active = jobs.filter((j) => j.status === "active" || j.status === "scheduled").length;
  const quoted = jobs.filter((j) => j.status === "quoted" || j.status === "accepted").length;
  const toCollect = jobs
    .filter((j) => j.status === "complete" || j.status === "invoiced")
    .reduce((s, j) => s + (j.total || 0), 0);

  // Earned this week (Sunday start)
  const now = new Date();
  const ws = new Date(now);
  ws.setDate(now.getDate() - now.getDay());
  ws.setHours(0, 0, 0, 0);
  const weekJobs = jobs.filter((j) => {
    if (j.status !== "complete" && j.status !== "invoiced" && j.status !== "paid") return false;
    try {
      return new Date(j.job_date || j.created_at) >= ws;
    } catch {
      return false;
    }
  });
  const earnedWeek = weekJobs.reduce((s, j) => s + (j.total || 0), 0);

  const stats = [
    { label: "Active Jobs", value: active, color: "var(--color-primary)" },
    { label: "Quoted", value: quoted, color: "var(--color-warning)" },
    { label: "Earned This Week", value: "$" + earnedWeek.toLocaleString(), color: "var(--color-success)" },
    { label: "To Collect", value: "$" + toCollect.toLocaleString(), color: "var(--color-highlight)" },
  ];

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
        {stats.map((s, i) => (
          <div key={i} className="cd" style={{ borderLeft: `3px solid ${s.color}` }}>
            <div className="sl">{s.label}</div>
            <div className="sv" style={{ color: s.color }}>{s.value}</div>
          </div>
        ))}
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
              <span className="dim" style={{ width: 55 }}>{j.status}</span>
              <span
                style={{
                  color: j.status === "complete" ? "var(--color-success)" : "var(--color-warning)",
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
