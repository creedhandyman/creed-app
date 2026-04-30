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
  // Pending leads light up a dot on the Jobs nav button so Bernard
  // notices them without having to open Jobs first.
  const leadCount = useStore((s) =>
    s.jobs.filter((j) => j.status === "lead" && !j.archived).length
  );
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
              {/* Aligned to the other nav labels' baseline. The button's
                  flex content is center-justified, so a larger font here
                  pushes the label visually lower (taller content row).
                  fontSize 10 keeps the height delta to ~1px while still
                  reading as the row anchor; marginTop 0 + bold pulls
                  the label up to the same Y as Quote/Jobs/Sched/etc. */}
              <span style={{ fontSize: 10, marginTop: 0, fontWeight: 700 }}>{t("nav.home") || "Home"}</span>
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
        const showLeadDot = item.id === "jobs" && leadCount > 0;
        return (
          <button
            key={i}
            className={active ? "act" : ""}
            onClick={() => setPage(item.id)}
            aria-label={t(item.labelKey)}
            style={{ position: "relative" }}
          >
            <Icon name={item.icon} size={20} strokeWidth={active ? 2 : 1.75} />
            <span style={{ fontSize: 9, marginTop: 2 }}>{t(item.labelKey)}</span>
            {showLeadDot && (
              <span
                aria-label={`${leadCount} new ${leadCount === 1 ? "lead" : "leads"}`}
                style={{
                  position: "absolute",
                  top: 2,
                  right: 6,
                  minWidth: 14,
                  height: 14,
                  padding: "0 4px",
                  borderRadius: 7,
                  background: "#ff3d6e",
                  color: "#fff",
                  fontSize: 9,
                  fontFamily: "Oswald",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  boxShadow: "0 0 0 2px var(--color-dark-bg), 0 0 8px rgba(255,61,110,0.6)",
                }}
              >
                {leadCount > 9 ? "9+" : leadCount}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
