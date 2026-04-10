"use client";

const LOGO = "/CREED_LOGO.png";

interface NavItem {
  id: string;
  icon: string;
  label: string;
}

const NAV_ITEMS: (NavItem | "logo")[] = [
  { id: "quests", icon: "🎯", label: "Quest" },
  { id: "payroll", icon: "💰", label: "Pay" },
  { id: "time", icon: "⏱", label: "Time" },
  "logo",
  { id: "sched", icon: "📅", label: "Sched" },
  { id: "jobs", icon: "📋", label: "Jobs" },
  { id: "qf", icon: "⚡", label: "Quote" },
];

interface Props {
  page: string;
  setPage: (p: string) => void;
}

export default function VerticalNav({ page, setPage }: Props) {
  return (
    <div className="vnav">
      {NAV_ITEMS.map((item, i) => {
        if (item === "logo") {
          return (
            <img
              key="logo"
              src={LOGO}
              alt=""
              onClick={() => setPage("dash")}
              onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
              title="Dashboard"
            />
          );
        }
        return (
          <button
            key={i}
            className={page === item.id ? "act" : ""}
            onClick={() => setPage(item.id)}
          >
            <span style={{ fontSize: 15 }}>{item.icon}</span>
            <span>{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}
