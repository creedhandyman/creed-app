"use client";
import { useStore } from "@/lib/store";
import { t } from "@/lib/i18n";

interface NavItem {
  id: string;
  icon: string;
  labelKey: string;
  adminOnly?: boolean;
}

const NAV_ITEMS: (NavItem | "logo" | "tape")[] = [
  { id: "quests", icon: "🎯", labelKey: "nav.quest" },
  { id: "payroll", icon: "💰", labelKey: "nav.pay", adminOnly: true },
  { id: "time", icon: "⏱", labelKey: "nav.time" },
  "tape",
  "logo",
  "tape",
  { id: "sched", icon: "📅", labelKey: "nav.sched" },
  { id: "jobs", icon: "📋", labelKey: "nav.jobs" },
  { id: "qf", icon: "⚡", labelKey: "nav.quote" },
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
            <span>{t(item.labelKey)}</span>
          </button>
        );
      })}
    </div>
  );
}
