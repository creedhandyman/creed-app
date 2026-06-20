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

// Mockup 5-tab bar: Quote · Jobs · Home · Time · More. The overflow tabs
// (Schedule, Quests, Operations, Customers, Mileage, Settings) relocate
// into the More hub — nothing is lost. This array is in side-nav order;
// bottom-nav reverses it (see `items` below), yielding Quote · Jobs ·
// Home · Time · More left-to-right.
const NAV_ITEMS: NavItem[] = [
  { id: "more", icon: "menu", labelKey: "nav.more" },
  { id: "time", icon: "time", labelKey: "nav.time" },
  { id: "dash", icon: "home", labelKey: "nav.home" },
  { id: "jobs", icon: "jobs", labelKey: "nav.jobs" },
  { id: "qf", icon: "quote", labelKey: "nav.quote" },
];

interface Props {
  page: string;
  setPage: (p: string) => void;
  isAdmin?: boolean;
}

export default function VerticalNav({ page, setPage, isAdmin }: Props) {
  const navBottom = useStore((s) => s.navBottom);
  // Pending leads light up a dot on the Jobs nav button so Bernard
  // notices them without having to open Jobs first.
  const leadCount = useStore((s) =>
    s.jobs.filter((j) => j.status === "lead" && !j.archived).length
  );
  const items = navBottom ? [...NAV_ITEMS].reverse() : NAV_ITEMS;
  return (
    <div className="vnav">
      {items.map((item, i) => {
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
