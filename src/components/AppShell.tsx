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
import Mileage from "./screens/Mileage";
import Troubleshoot from "./screens/Troubleshoot";
import Financials from "./screens/Financials";
import Operations from "./screens/Operations";
import WorkVision from "./screens/WorkVision";
import MoreHub from "./screens/MoreHub";
import Coachmark from "./Coachmark";

export default function AppShell() {
  const [page, setPage] = useState("dash");
  const [showSettings, setShowSettings] = useState(false);
  const [editJobId, setEditJobId] = useState<string | null>(null);
  const [scheduleJobName, setScheduleJobName] = useState<string | null>(null);
  // Deep-link target for the Jobs detail screen (tapping a notification on
  // the dashboard opens that job). Jobs seeds its detail state from this on
  // mount, then clears it so a later plain nav to Jobs opens the list.
  const [jobDetailId, setJobDetailId] = useState<string | null>(null);
  // Deep-link target sub-tab for Operations (the More hub's Customers tile
  // opens Operations on its customers sub-tab).
  const [opsInitialTab, setOpsInitialTab] = useState<string | null>(null);
  const user = useStore((s) => s.user)!;
  const darkMode = useStore((s) => s.darkMode);

  const isAdmin = user.role === "owner" || user.role === "manager";

  const goToEditJob = (jobId: string) => {
    setEditJobId(jobId);
    setPage("qf");
  };

  const goToPage = (p: string) => {
    // Block restricted pages for techs/apprentices. Ops is NOT in this
    // list anymore — it's the home of the HR sub-tab, which is open to
    // everyone (per-sub-tab admin gating lives inside Operations.tsx).
    if (!isAdmin && ["payroll", "financials"].includes(p)) {
      setPage("dash");
      return;
    }
    if (p !== "qf") setEditJobId(null);
    // Scroll to top when switching screens
    window.scrollTo(0, 0);
    if (p !== "sched") setScheduleJobName(null);
    setPage(p);
  };

  // Open Operations, optionally deep-linked to a sub-tab (More hub -> Customers).
  const goToOps = (tab?: string) => {
    setOpsInitialTab(tab ?? null);
    goToPage("ops");
  };

  // Open a specific job's detail screen (from a notification).
  const goToJob = (jobId: string) => {
    setJobDetailId(jobId);
    goToPage("jobs");
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
        return <Dashboard setPage={goToPage} openSettings={() => setShowSettings(true)} openJob={goToJob} openOps={goToOps} />;
      case "qf":
        return <QuoteForge setPage={goToPage} editJobId={editJobId} clearEditJob={() => setEditJobId(null)} />;
      case "jobs":
        return <Jobs setPage={goToPage} onEditJob={isAdmin ? goToEditJob : undefined} onScheduleJob={(name: string) => { setScheduleJobName(name); goToPage("sched"); }} initialDetailJobId={jobDetailId} clearInitialDetail={() => setJobDetailId(null)} />;
      case "sched":
        return <Schedule setPage={goToPage} preSelectJob={scheduleJobName} />;
      case "time":
        return <TimerScreen setPage={goToPage} />;
      case "payroll":
        return isAdmin ? <Payroll /> : <Dashboard setPage={goToPage} openSettings={() => setShowSettings(true)} openJob={goToJob} openOps={goToOps} />;
      case "ops":
        // Open to everyone — Operations.tsx filters its sub-tabs by role
        // so non-admins only see HR (the consolidated time-off home).
        return <Operations setPage={goToPage} initialTab={opsInitialTab ?? undefined} />;
      case "workvision":
        return <WorkVision setPage={goToPage} />;
      case "quests":
        return <Quests />;
      case "mileage":
        return <Mileage setPage={goToPage} />;
      case "troubleshoot":
        return <Troubleshoot setPage={goToPage} />;
      case "financials":
        return isAdmin ? <Financials setPage={goToPage} /> : <Dashboard setPage={goToPage} openSettings={() => setShowSettings(true)} openJob={goToJob} openOps={goToOps} />;
      case "more":
        return <MoreHub setPage={goToPage} openSettings={() => setShowSettings(true)} openOps={goToOps} />;
      default:
        return <Dashboard setPage={goToPage} openSettings={() => setShowSettings(true)} openJob={goToJob} openOps={goToOps} />;
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: darkMode ? "#0a0a0f" : "#f0f2f5" }}>
      <VerticalNav page={page} setPage={goToPage} isAdmin={isAdmin} />
      <div className="mc">{renderPage()}</div>
      {/* The "quote" tip is mounted inside QuoteForge's hub (not here) so it
          doesn't float over the editor / inspection / Voice Walk sub-screens. */}
      {page === "sched" && <Coachmark id="schedule_v2" text={<>Tap <b>Dispatch</b> to see all your unscheduled jobs and hit <b>Assign</b> to drop them onto any date.</>} />}
      {page === "time" && <Coachmark id="workmode" text={<>Tap <b>Clock In</b> to start your shift — your hours roll straight to payroll.</>} />}
    </div>
  );
}
