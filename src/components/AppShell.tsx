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
  const user = useStore((s) => s.user)!;
  const darkMode = useStore((s) => s.darkMode);

  const isAdmin = user.role === "owner" || user.role === "manager";

  const goToEditJob = (jobId: string) => {
    setEditJobId(jobId);
    setPage("qf");
  };

  const goToPage = (p: string) => {
    // Block restricted pages for techs/apprentices
    if (!isAdmin && ["payroll", "clients"].includes(p)) {
      setPage("dash");
      return;
    }
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
        return <Jobs setPage={goToPage} onEditJob={isAdmin ? goToEditJob : undefined} />;
      case "sched":
        return <Schedule setPage={goToPage} />;
      case "time":
        return <TimerScreen setPage={goToPage} />;
      case "payroll":
        return isAdmin ? <Payroll /> : <Dashboard setPage={goToPage} openSettings={() => setShowSettings(true)} />;
      case "quests":
        return <Quests />;
      case "clients":
        return isAdmin ? <Clients setPage={goToPage} /> : <Dashboard setPage={goToPage} openSettings={() => setShowSettings(true)} />;
      case "mileage":
        return <Mileage setPage={goToPage} />;
      default:
        return <Dashboard setPage={goToPage} openSettings={() => setShowSettings(true)} />;
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: darkMode ? "#0a0a0f" : "#f0f2f5" }}>
      <VerticalNav page={page} setPage={goToPage} isAdmin={isAdmin} />
      <div className="mc">{renderPage()}</div>
    </div>
  );
}
