"use client";
import { useStore } from "@/lib/store";

interface NavItem {
  id: string;
  icon: string;
  label: string;
  adminOnly?: boolean;
}

const NAV_ITEMS: (NavItem | "logo" | "tape")[] = [
  { id: "qf", icon: "⚡", label: "Quote" },
  { id: "jobs", icon: "📋", label: "Jobs" },
  { id: "sched", icon: "📅", label: "Sched" },
  "tape",
  "logo",
  "tape",
  { id: "time", icon: "⏱", label: "Time" },
  { id: "payroll", icon: "💰", label: "Pay", adminOnly: true },
  { id: "quests", icon: "🎯", label: "Quest" },
];

interface Props {
  page: string;
  setPage: (p: string) => void;
  isAdmin?: boolean;
}

export default function VerticalNav({ page, setPage, isAdmin }: Props) {
  const org = useStore((s) => s.org);
  const navBottom = useStore((s) => s.navBottom);
  const LOGO = org?.logo_url || "/CREED_LOGO.png";
  const items = navBottom ? [...NAV_ITEMS].reverse() : NAV_ITEMS;
  return (
    <div className="vnav">
      {items.map((item, i) => {
        if (item === "tape") {
          return <div key={`tape-${i}`} className="caution-tape" />;
        }
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
