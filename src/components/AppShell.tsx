"use client";
import { useState } from "react";
import { useStore } from "@/lib/store";
import VerticalNav from "./VerticalNav";
import Settings from "./Settings";
import Dashboard from "./screens/Dashboard";
import QuoteForge from "./screens/QuoteForge";
import Jobs from "./screens/Jobs";
import Schedule from "./screens/Schedule";
import TimerScreen from "./screens/Timer";
import Payroll from "./screens/Payroll";
import Quests from "./screens/Quests";
import Clients from "./screens/Clients";
import Mileage from "./screens/Mileage";

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
        return <Schedule setPage={goToPage} />;
      case "time":
        return <TimerScreen setPage={goToPage} />;
      case "payroll":
        return <Payroll />;
      case "quests":
        return <Quests />;
      case "clients":
        return <Clients setPage={goToPage} />;
      case "mileage":
        return <Mileage setPage={goToPage} />;
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
