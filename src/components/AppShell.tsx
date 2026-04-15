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
import Marketing from "./screens/Marketing";
import Troubleshoot from "./screens/Troubleshoot";
import Financials from "./screens/Financials";
import Operations from "./screens/Operations";
import WorkVision from "./screens/WorkVision";

export default function AppShell() {
  const [page, setPage] = useState("dash");
  const [showSettings, setShowSettings] = useState(false);
  const [editJobId, setEditJobId] = useState<string | null>(null);
  const [scheduleJobName, setScheduleJobName] = useState<string | null>(null);
  const user = useStore((s) => s.user)!;
  const darkMode = useStore((s) => s.darkMode);

  const isAdmin = user.role === "owner" || user.role === "manager";

  const goToEditJob = (jobId: string) => {
    setEditJobId(jobId);
    setPage("qf");
  };

  const goToPage = (p: string) => {
    // Block restricted pages for techs/apprentices
    if (!isAdmin && ["payroll", "clients", "marketing", "ops", "financials"].includes(p)) {
      setPage("dash");
      return;
    }
    if (p !== "qf") setEditJobId(null);
    if (p !== "sched") setScheduleJobName(null);
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
        return <Jobs setPage={goToPage} onEditJob={isAdmin ? goToEditJob : undefined} onScheduleJob={(name: string) => { setScheduleJobName(name); goToPage("sched"); }} />;
      case "sched":
        return <Schedule setPage={goToPage} preSelectJob={scheduleJobName} />;
      case "time":
        return <TimerScreen setPage={goToPage} />;
      case "payroll":
        return isAdmin ? <Payroll /> : <Dashboard setPage={goToPage} openSettings={() => setShowSettings(true)} />;
      case "ops":
        return isAdmin ? <Operations setPage={goToPage} /> : <Dashboard setPage={goToPage} openSettings={() => setShowSettings(true)} />;
      case "workvision":
        return <WorkVision setPage={goToPage} />;
      case "quests":
        return <Quests />;
      case "clients":
        return isAdmin ? <Clients setPage={goToPage} /> : <Dashboard setPage={goToPage} openSettings={() => setShowSettings(true)} />;
      case "mileage":
        return <Mileage setPage={goToPage} />;
      case "marketing":
        return isAdmin ? <Marketing /> : <Dashboard setPage={goToPage} openSettings={() => setShowSettings(true)} />;
      case "troubleshoot":
        return <Troubleshoot setPage={goToPage} />;
      case "financials":
        return isAdmin ? <Financials setPage={goToPage} /> : <Dashboard setPage={goToPage} openSettings={() => setShowSettings(true)} />;
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
