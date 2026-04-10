"use client";
import { useState } from "react";
import { useStore } from "@/lib/store";
import VerticalNav from "./VerticalNav";
import Settings from "./Settings";
import Dashboard from "./screens/Dashboard";
import QuoteForge from "./screens/QuoteForge";
import Jobs from "./screens/Jobs";
import ComingSoon from "./screens/ComingSoon";

export default function AppShell() {
  const [page, setPage] = useState("dash");
  const [showSettings, setShowSettings] = useState(false);
  const [editJobId, setEditJobId] = useState<string | null>(null);
  const darkMode = useStore((s) => s.darkMode);

  const goToEditJob = (jobId: string) => {
    setEditJobId(jobId);
    setPage("qf");
  };

  const goToPage = (p: string) => {
    if (p !== "qf") setEditJobId(null);
    setPage(p);
  };

  if (showSettings) {
    return (
      <div style={{ minHeight: "100vh", background: darkMode ? "#0a0a0f" : "#f0f2f5" }}>
        <Settings onClose={() => setShowSettings(false)} />
      </div>
    );
  }

  const renderPage = () => {
    switch (page) {
      case "dash":
        return <Dashboard setPage={goToPage} openSettings={() => setShowSettings(true)} />;
      case "qf":
        return <QuoteForge setPage={goToPage} editJobId={editJobId} clearEditJob={() => setEditJobId(null)} />;
      case "jobs":
        return <Jobs setPage={goToPage} onEditJob={goToEditJob} />;
      case "sched":
        return <ComingSoon title="📅 Schedule" label="Scheduling coming soon" />;
      case "time":
        return <ComingSoon title="⏱ Timer" label="Time tracking coming soon" />;
      case "payroll":
        return <ComingSoon title="💰 Payroll" label="Payroll coming soon" />;
      case "quests":
        return <ComingSoon title="🎯 Quest Hub" label="Quests, reviews & referrals coming soon" />;
      default:
        return <Dashboard setPage={goToPage} openSettings={() => setShowSettings(true)} />;
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: darkMode ? "#0a0a0f" : "#f0f2f5" }}>
      <VerticalNav page={page} setPage={goToPage} />
      <div className="mc">{renderPage()}</div>
    </div>
  );
}
