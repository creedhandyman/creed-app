"use client";
import { useStore } from "@/lib/store";

interface NavItem {
  id: string;
  icon: string;
  label: string;
  adminOnly?: boolean;
}

const NAV_ITEMS: (NavItem | "logo")[] = [
  { id: "quests", icon: "🎯", label: "Quest" },
  { id: "payroll", icon: "💰", label: "Pay", adminOnly: true },
  { id: "time", icon: "⏱", label: "Time" },
  "logo",
  { id: "sched", icon: "📅", label: "Sched" },
  { id: "jobs", icon: "📋", label: "Jobs" },
  { id: "qf", icon: "⚡", label: "Quote" },
];

interface Props {
  page: string;
  setPage: (p: string) => void;
  isAdmin?: boolean;
}

export default function VerticalNav({ page, setPage, isAdmin }: Props) {
  const org = useStore((s) => s.org);
  const LOGO = org?.logo_url || "/CREED_LOGO.png";
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
        // Hide admin-only nav items from techs/apprentices
        if (item.adminOnly && !isAdmin) return null;
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
