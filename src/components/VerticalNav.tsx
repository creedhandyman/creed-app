"use client";
import { useStore } from "@/lib/store";
import { t } from "@/lib/i18n";
import { Icon, type IconName } from "./Icon";

interface NavItem {
  id: string;
  icon: IconName;
  labelKey: string;
  adminOnly?: boolean;
}

const NAV_ITEMS: (NavItem | "logo" | "tape")[] = [
  { id: "quests", icon: "quest", labelKey: "nav.quest" },
  { id: "ops", icon: "ops", labelKey: "nav.ops", adminOnly: true },
  { id: "time", icon: "time", labelKey: "nav.time" },
  "tape",
  "logo",
  "tape",
  { id: "sched", icon: "schedule", labelKey: "nav.sched" },
  { id: "jobs", icon: "jobs", labelKey: "nav.jobs" },
  { id: "qf", icon: "quote", labelKey: "nav.quote" },
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
        if (item.adminOnly && !isAdmin) return null;
        const active = page === item.id;
        return (
          <button
            key={i}
            className={active ? "act" : ""}
            onClick={() => setPage(item.id)}
            aria-label={t(item.labelKey)}
          >
            <Icon name={item.icon} size={20} strokeWidth={active ? 2 : 1.75} />
            <span style={{ fontSize: 9, marginTop: 2 }}>{t(item.labelKey)}</span>
          </button>
        );
      })}
    </div>
  );
}
