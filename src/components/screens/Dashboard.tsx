"use client";
import { useState, useEffect } from "react";
import { useStore } from "@/lib/store";

interface Props {
  setPage: (p: string) => void;
  openSettings: () => void;
}

export default function Dashboard({ setPage, openSettings }: Props) {
  const user = useStore((s) => s.user)!;
  const isAdmin = user.role === "owner" || user.role === "manager";
  const org = useStore((s) => s.org);
  const clients = useStore((s) => s.clients);
  const jobs = useStore((s) => s.jobs);
  const schedule = useStore((s) => s.schedule);
  const timeEntries = useStore((s) => s.timeEntries);
  const reviews = useStore((s) => s.reviews);
  const referrals = useStore((s) => s.referrals);
  const darkMode = useStore((s) => s.darkMode);

  // ── Next Job on Schedule ──
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const upcoming = schedule
    .filter((s) => s.sched_date >= today)
    .sort((a, b) => a.sched_date.localeCompare(b.sched_date));
  const nextJob = upcoming[0];

  // ── Max Net Pay This Week ──
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

  // ── Earned This Month ──
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthJobs = jobs.filter((j) => {
    if (j.status !== "complete" && j.status !== "invoiced" && j.status !== "paid") return false;
    try { return new Date(j.job_date || j.created_at) >= monthStart; } catch { return false; }
  });
  const earnedMonth = monthJobs.reduce((s, j) => s + (j.total || 0), 0);

  // Getting Started guide
  const [guideDismissed, setGuideDismissed] = useState(true);
  const [guideOpen, setGuideOpen] = useState(true);
  useEffect(() => {
    const d = localStorage.getItem("c_guide_dismissed");
    if (!d) setGuideDismissed(false);
  }, []);

  const dismissGuide = () => {
    localStorage.setItem("c_guide_dismissed", "1");
    setGuideDismissed(true);
  };

  const hasJobs = jobs.length > 0;
  const hasSchedule = schedule.length > 0;
  const hasTime = timeEntries.length > 0;
  const hasPaid = jobs.some((j) => j.status === "paid");
  const hasSite = !!org?.site_content;
  const hasQuests = reviews.length > 0;

  const steps = [
    { icon: "⚡", label: "Create Your First Quote", desc: "Upload a PDF or describe the job — AI does the rest", done: hasJobs, page: "qf" },
    { icon: "📅", label: "Schedule a Job", desc: "Add it to your calendar and assign workers", done: hasSchedule, page: "sched" },
    { icon: "⏱", label: "Track Time", desc: "Clock in when you start, clock out when done", done: hasTime, page: "time" },
    { icon: "💰", label: "Get Paid", desc: "Send invoice, collect via Stripe or QR code", done: hasPaid, page: "jobs" },
    { icon: "📣", label: "Build Your Website", desc: "AI creates a professional site in 60 seconds", done: hasSite, page: "marketing" },
    { icon: "🎯", label: "Earn Quest Bonuses", desc: "Complete quests to unlock bonus payouts", done: hasQuests, page: "quests" },
  ];

  const completedSteps = steps.filter((s) => s.done).length;

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

      {/* Getting Started Guide */}
      {!guideDismissed && (
        <div className="cd mb" style={{ borderLeft: "3px solid var(--color-primary)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: guideOpen ? 10 : 0 }}>
            <div
              onClick={() => setGuideOpen(!guideOpen)}
              style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}
            >
              <span style={{ fontSize: 18 }}>🚀</span>
              <div>
                <h4 style={{ fontSize: 14, color: "var(--color-primary)" }}>Getting Started</h4>
                <div className="dim" style={{ fontSize: 12 }}>{completedSteps}/{steps.length} complete</div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button
                onClick={() => setGuideOpen(!guideOpen)}
                style={{ background: "none", fontSize: 14, color: "#888" }}
              >
                {guideOpen ? "▲" : "▼"}
              </button>
              <button
                onClick={dismissGuide}
                style={{ background: "none", fontSize: 13, color: "#555" }}
              >
                ✕
              </button>
            </div>
          </div>

          {/* Progress bar */}
          {guideOpen && (
            <>
              <div style={{
                height: 4, borderRadius: 2, background: darkMode ? "#1e1e2e" : "#ddd", marginBottom: 12,
              }}>
                <div style={{
                  height: "100%", borderRadius: 2, background: "var(--color-primary)",
                  width: `${(completedSteps / steps.length) * 100}%`, transition: "width 0.3s",
                }} />
              </div>

              {steps.map((s, i) => (
                <div
                  key={i}
                  onClick={() => !s.done && setPage(s.page)}
                  style={{
                    display: "flex", alignItems: "center", gap: 10, padding: "8px 6px",
                    borderRadius: 8, cursor: s.done ? "default" : "pointer",
                    opacity: s.done ? 0.6 : 1,
                    background: !s.done ? (darkMode ? "#1a1a2811" : "#f5f5f811") : "transparent",
                    marginBottom: 2,
                  }}
                >
                  <span style={{ fontSize: 16, width: 24, textAlign: "center" }}>
                    {s.done ? "✅" : s.icon}
                  </span>
                  <div style={{ flex: 1 }}>
                    <div style={{
                      fontSize: 13, fontWeight: 600,
                      textDecoration: s.done ? "line-through" : "none",
                      color: s.done ? "#666" : (darkMode ? "#e2e2e8" : "#1a1a2a"),
                    }}>
                      {s.label}
                    </div>
                    <div className="dim" style={{ fontSize: 12 }}>{s.desc}</div>
                  </div>
                  {!s.done && (
                    <span style={{ fontSize: 12, color: "var(--color-primary)" }}>→</span>
                  )}
                </div>
              ))}
            </>
          )}
        </div>
      )}

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
              <div className="dim" style={{ fontSize: 12 }}>
                {(() => {
                  // Format date nicely
                  const d = new Date(nextJob.sched_date + "T12:00:00");
                  const dayStr = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
                  // Extract time from note (stored as 🕐 HH:MM)
                  const timeMatch = nextJob.note?.match(/🕐\s*(\d{1,2}:\d{2})/);
                  const timeStr = timeMatch ? (() => {
                    const [h, m] = timeMatch[1].split(":").map(Number);
                    const ampm = h >= 12 ? "PM" : "AM";
                    return `${h > 12 ? h - 12 : h || 12}:${String(m).padStart(2, "0")} ${ampm}`;
                  })() : "";
                  return `${dayStr}${timeStr ? ` · ${timeStr}` : ""}`;
                })()}
              </div>
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
          <div className="sl">Earned This Month</div>
          <div className="sv" style={{ color: "var(--color-success)" }}>${earnedMonth.toLocaleString()}</div>
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

      {/* Marketing */}
      {isAdmin && (
        <div
          className="cd"
          onClick={() => setPage("marketing")}
          style={{ cursor: "pointer", borderLeft: "3px solid var(--color-highlight)" }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 24 }}>📣</span>
            <div>
              <h4 style={{ fontSize: 14, marginBottom: 2 }}>Marketing &amp; Website</h4>
              <div className="dim" style={{ fontSize: 11 }}>
                {org?.site_content ? "Your site is live — manage links & reviews" : "Build a free website with AI in 60 seconds"}
              </div>
            </div>
            <span style={{ marginLeft: "auto", fontSize: 16, color: "#888" }}>→</span>
          </div>
        </div>
      )}
    </div>
  );
}
