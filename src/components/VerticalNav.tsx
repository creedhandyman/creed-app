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

const NAV_ITEMS: (NavItem | "logo")[] = [
  { id: "quests", icon: "quest", labelKey: "nav.quest" },
  { id: "ops", icon: "ops", labelKey: "nav.ops", adminOnly: true },
  { id: "time", icon: "time", labelKey: "nav.time" },
  "logo",
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
        if (item === "logo") {
          const onDash = page === "dash";
          // Logo button = Dashboard. Sized larger than its sibling nav
          // buttons so it reads as the visual anchor. Active state matches
          // the other nav buttons (gradient bg + glow), with a small label
          // below for clarity and a pulsing indicator dot on the dashboard.
          return (
            <button
              key="logo"
              onClick={() => setPage("dash")}
              className={onDash ? "act" : ""}
              aria-label="Dashboard"
              title="Dashboard"
              style={{ position: "relative", overflow: "visible", width: 52, height: 52 }}
            >
              <img
                src={LOGO}
                alt=""
                onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
                style={{
                  width: 38,
                  height: 38,
                  filter: onDash ? "drop-shadow(0 0 6px rgba(255,255,255,0.45))" : "none",
                }}
              />
              <span style={{ fontSize: 9, marginTop: 2 }}>{t("nav.home") || "Home"}</span>
              {onDash && (
                <span
                  aria-hidden
                  style={{
                    position: "absolute",
                    top: -2,
                    right: -2,
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: "var(--color-success)",
                    boxShadow: "0 0 0 2px var(--color-dark-bg), 0 0 10px rgba(0, 204, 102, 0.8)",
                    animation: "pulse 1.8s ease-in-out infinite",
                  }}
                />
              )}
            </button>
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
