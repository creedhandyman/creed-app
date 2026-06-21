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

// The 4 fixed tabs. Anything else (the More hub + every overflow page) is
// represented by the morphing More slot.
const BASE_TAB_IDS = ["qf", "jobs", "dash", "time"];

// Overflow pages the More slot can morph into when one is active. Keyed by
// AppShell page id → the icon + label to show in the slot.
const OVERFLOW_TABS: Record<string, { icon: IconName; labelKey: string }> = {
  sched: { icon: "schedule", labelKey: "nav.sched" },
  quests: { icon: "quest", labelKey: "nav.quest" },
  ops: { icon: "ops", labelKey: "nav.ops" },
  mileage: { icon: "mileage", labelKey: "nav.mileage" },
  financials: { icon: "money", labelKey: "nav.financials" },
  payroll: { icon: "pay", labelKey: "nav.pay" },
  workvision: { icon: "worker", labelKey: "nav.work" },
  troubleshoot: { icon: "troubleshoot", labelKey: "nav.help" },
};

// Per-tab signature color, shown only when that tab is the active one.
// Base tabs get distinct hues; overflow tabs colour the morphed More slot
// (they're never shown side-by-side, so reused hues are fine).
const TAB_COLOR: Record<string, string> = {
  qf: "#f5b400",          // Quote — yellow/gold
  jobs: "#ef4444",        // Jobs — red
  dash: "#2e8bff",        // Home — blue
  time: "#13c06a",        // Time — green
  more: "#14b8a6",        // More hub — teal
  sched: "#ff8a3d",       // Schedule — orange
  quests: "#9d4edd",      // Quests — purple
  ops: "#06b6d4",         // Ops — cyan
  mileage: "#14b8a6",     // Mileage — teal
  financials: "#10b981",  // Money — emerald
  payroll: "#22c55e",     // Payroll — green
  workvision: "#13c06a",  // Work mode — green
  troubleshoot: "#94a3b8",// Help — slate
};

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
  // We're on an overflow page (or the hub itself) whenever the current page
  // isn't one of the 4 base tabs — that's when the More slot lights up.
  const onOverflow = !BASE_TAB_IDS.includes(page);

  return (
    <div className="vnav">
      {items.map((item, i) => {
        if (item.adminOnly && !isAdmin) return null;

        // The More slot morphs into whatever overflow tab is active so the
        // bar reflects where you are, and still taps through to the hub so
        // you can switch tabs.
        const isMore = item.id === "more";
        const morph = isMore && page !== "more" ? OVERFLOW_TABS[page] : null;
        const iconName: IconName = morph ? morph.icon : item.icon;
        const label = morph ? t(morph.labelKey) : t(item.labelKey);
        const active = isMore ? onOverflow : page === item.id;
        const color = isMore ? (TAB_COLOR[page] || TAB_COLOR.more) : (TAB_COLOR[item.id] || TAB_COLOR.dash);
        const showLeadDot = item.id === "jobs" && leadCount > 0;

        return (
          <button
            key={i}
            onClick={() => setPage(isMore ? "more" : item.id)}
            aria-label={label}
            // Active = icon + label tinted in the tab's signature color (no
            // filled box); inactive uses the default muted class color.
            style={{ position: "relative", color: active ? color : undefined }}
          >
            <Icon name={iconName} size={20} strokeWidth={active ? 2 : 1.75} />
            <span style={{ fontSize: 9, marginTop: 2, fontWeight: active ? 600 : undefined }}>{label}</span>
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
