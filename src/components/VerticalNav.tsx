"use client";
import type { CSSProperties } from "react";
import { useStore } from "@/lib/store";
import { t } from "@/lib/i18n";
import { useNavLayout } from "@/lib/nav-layout";
import { Icon, type IconName } from "./Icon";

interface NavItem {
  id: string;
  icon: IconName;
  labelKey: string;
  adminOnly?: boolean;
}

// 5-tab bar: Quote · Jobs · Home · Schedule · More. The overflow tabs
// (Time, Quests, Operations, Customers, Mileage, Settings) relocate into
// the More hub — nothing is lost. This array is in side-nav order;
// bottom-nav reverses it (see `items` below), yielding Quote · Jobs ·
// Home · Schedule · More left-to-right.
const NAV_ITEMS: NavItem[] = [
  { id: "more", icon: "menu", labelKey: "nav.more" },
  { id: "sched", icon: "schedule", labelKey: "nav.sched" },
  { id: "dash", icon: "home", labelKey: "nav.home" },
  { id: "jobs", icon: "jobs", labelKey: "nav.jobs" },
  { id: "qf", icon: "quote", labelKey: "nav.quote" },
];

// The 4 fixed tabs. Anything else (the More hub + every overflow page) is
// represented by the morphing More slot.
const BASE_TAB_IDS = ["qf", "jobs", "dash", "sched"];

// Overflow pages the More slot can morph into when one is active. Keyed by
// AppShell page id → the icon + label to show in the slot.
const OVERFLOW_TABS: Record<string, { icon: IconName; labelKey: string }> = {
  time: { icon: "time", labelKey: "nav.time" },
  quests: { icon: "quest", labelKey: "nav.quest" },
  ops: { icon: "ops", labelKey: "nav.ops" },
  mileage: { icon: "mileage", labelKey: "nav.mileage" },
  map: { icon: "map", labelKey: "nav.map" },
  financials: { icon: "money", labelKey: "nav.financials" },
  payroll: { icon: "pay", labelKey: "nav.pay" },
  workvision: { icon: "worker", labelKey: "nav.work" },
  troubleshoot: { icon: "troubleshoot", labelKey: "nav.fixit" },
  flip: { icon: "trending", labelKey: "nav.flip" },
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
  map: "#3ee08f",         // Crew Map — mint (matches its More-hub tile)
  financials: "#10b981",  // Money — emerald
  payroll: "#22c55e",     // Payroll — green
  workvision: "#13c06a",  // Work mode — green
  troubleshoot: "#94a3b8",// Fix-it — slate
  flip: "#ffcc00",        // Flip Mode — gold
  customers: "#3ee08f",   // Customers (side menu) — mint, like its More-hub tile
};

interface Props {
  page: string;
  setPage: (p: string) => void;
  isAdmin?: boolean;
  /** The Operations area the current ops page was opened on (side menu
   *  lights Customers / Payroll / Financials instead of Operations). */
  opsTab?: string | null;
  openOps: (tab?: string) => void;
  openSettings: () => void;
}

export default function VerticalNav(props: Props) {
  const { layout, right } = useNavLayout();
  if (layout === "side") return <SideNav {...props} right={right} />;
  return <TabBar {...props} bottom={layout === "bottom"} />;
}

// Pending leads light up the Jobs button so Bernard notices them without
// having to open Jobs first.
const useLeadCount = () => useStore((s) => s.jobs.filter((j) => j.status === "lead" && !j.archived).length);
// Unread bell notifications light Home (the bell lives on the dashboard), so
// a tech on Time / Work mode still sees there's something.
const useUnreadCount = () => useStore((s) => s.notifications.filter((n) => !n.read_at).length);

function TabBar({ page, setPage, isAdmin, bottom }: Props & { bottom: boolean }) {
  const leadCount = useLeadCount();
  const unreadCount = useUnreadCount();
  const items = bottom ? [...NAV_ITEMS].reverse() : NAV_ITEMS;
  // We're on an overflow page (or the hub itself) whenever the current page
  // isn't one of the 4 base tabs — that's when the More slot lights up.
  // Work mode is part of the Time flow (clock in → work order), so the More
  // slot shows it as Time.
  const navPage = page === "workvision" ? "time" : page;
  const onOverflow = !BASE_TAB_IDS.includes(navPage);

  return (
    <div className="vnav">
      {items.map((item, i) => {
        if (item.adminOnly && !isAdmin) return null;

        // The More slot morphs into whatever overflow tab is active so the
        // bar reflects where you are, and still taps through to the hub so
        // you can switch tabs.
        const isMore = item.id === "more";
        const morph = isMore && navPage !== "more" ? OVERFLOW_TABS[navPage] : null;
        const iconName: IconName = morph ? morph.icon : item.icon;
        // Crew open Ops from the "Time Off" tile (it roots them at HR), so
        // the slot should say that, not "Ops".
        const label = morph ? t(navPage === "ops" && !isAdmin ? "nav.timeOff" : morph.labelKey) : t(item.labelKey);
        const active = isMore ? onOverflow : navPage === item.id;
        const color = isMore ? (TAB_COLOR[navPage] || TAB_COLOR.more) : (TAB_COLOR[item.id] || TAB_COLOR.dash);
        // Leads are an owner/manager queue — crew can't act on them.
        const showLeadDot = !!isAdmin && item.id === "jobs" && leadCount > 0;
        const showBellDot = item.id === "dash" && unreadCount > 0;

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
            <span style={{ fontSize: 11, marginTop: 2, fontWeight: active ? 600 : undefined }}>{label}</span>
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
                  fontSize: 11,
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
            {showBellDot && (
              <span
                aria-label={`${unreadCount} unread ${unreadCount === 1 ? "notification" : "notifications"}`}
                style={{ position: "absolute", top: 4, right: 10, width: 9, height: 9, borderRadius: "50%", background: "#ff3d6e", boxShadow: "0 0 0 2px var(--color-dark-bg)" }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

// ── Side menu (computers) ─────────────────────────────────────────────
// A wide screen has room for every main screen, so they're listed straight
// out instead of hiding behind More. More stays last for Ask Grizz +
// Business settings. Styles: `.snav` / `.sn-*` in globals.css.

// Operations areas that get their own side-menu row; on any other area
// (Recurring, HR, Team…) the Operations row is the lit one.
const SIDE_OPS_TABS = ["customers", "payroll", "financials"];

interface SideItem {
  key: string;
  icon: IconName;
  label: string;
  color: string;
  active: boolean;
  onClick: () => void;
  badge?: number;
}

function SideNav({ page, setPage, isAdmin, opsTab, openOps, openSettings, right }: Props & { right: boolean }) {
  const user = useStore((s) => s.user);
  const org = useStore((s) => s.org);
  const leadCount = useLeadCount();
  const unreadCount = useUnreadCount();
  const navPage = page === "workvision" ? "time" : page;
  const onOps = navPage === "ops";

  const pageItem = (id: string, icon: IconName, label: string, badge?: number): SideItem => ({
    key: id, icon, label, color: TAB_COLOR[id] || TAB_COLOR.dash, active: navPage === id, onClick: () => setPage(id), badge,
  });
  // Payroll / Financials also have stand-alone pages; light the row there too.
  const opsItem = (tab: string, icon: IconName, label: string): SideItem => ({
    key: `ops:${tab}`, icon, label, color: TAB_COLOR[tab] || TAB_COLOR.ops, active: (onOps && opsTab === tab) || navPage === tab, onClick: () => openOps(tab),
  });

  const groups: { key: string; label?: string; items: SideItem[] }[] = [
    { key: "main", items: [
      pageItem("dash", "home", t("nav.home"), unreadCount),
      pageItem("qf", "quote", t("nav.quote")),
      pageItem("jobs", "jobs", t("nav.jobs"), isAdmin ? leadCount : 0),
      pageItem("sched", "schedule", t("nav.sched")),
      pageItem("time", "time", t("nav.time")),
    ] },
    ...(isAdmin ? [{ key: "biz", label: t("nav.groupBusiness"), items: [
      opsItem("customers", "clients", t("more.customers")),
      opsItem("payroll", "pay", t("ops.payroll")),
      opsItem("financials", "money", t("ops.financials")),
      { key: "ops", icon: "ops" as IconName, label: t("more.operations"), color: TAB_COLOR.ops, active: onOps && !SIDE_OPS_TABS.includes(opsTab || ""), onClick: () => openOps() },
    ] }] : []),
    { key: "tools", label: t("nav.groupTools"), items: [
      pageItem("quests", "quest", t("more.quests")),
      // Crew's Operations is just HR (time off), so the row says that.
      ...(isAdmin ? [] : [{ key: "ops", icon: "leaf" as IconName, label: t("nav.timeOff"), color: TAB_COLOR.ops, active: onOps, onClick: () => openOps() }]),
      pageItem("mileage", "mileage", t("more.mileage")),
      ...(isAdmin ? [pageItem("map", "map", t("more.crewMap")), pageItem("flip", "trending", t("more.flip"))] : []),
      pageItem("troubleshoot", "troubleshoot", t("more.troubleshoot")),
      pageItem("more", "menu", t("nav.more")),
    ] },
  ];

  const name = user?.name || "—";
  const initials = name.split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase() || "?";
  const roleLabel = user?.role ? t(`team.role${user.role.charAt(0).toUpperCase()}${user.role.slice(1)}`) : "";

  return (
    <nav className={`snav${right ? " r" : ""}`} aria-label="Main">
      <button className="sn-brand" onClick={() => setPage("dash")} aria-label={t("nav.home")}>
        <img src="/creed-logo-badge.png" alt="" width={40} height={40} />
        <span className="sn-word"><b>CREED</b><small>HANDY MANAGER</small></span>
      </button>

      <div className="sn-list">
        {groups.map((g) => (
          <div key={g.key} className="sn-group">
            {g.label && <div className="sn-label">{g.label}</div>}
            {g.items.map((it) => (
              <button
                key={it.key}
                className={`sn-item${it.active ? " on" : ""}`}
                style={{ "--tab": it.color } as CSSProperties}
                onClick={it.onClick}
                aria-current={it.active ? "page" : undefined}
              >
                <Icon name={it.icon} size={18} strokeWidth={it.active ? 2.1 : 1.8} className="sn-ic" />
                <span className="sn-text">{it.label}</span>
                {!!it.badge && <span className="sn-badge">{it.badge > 99 ? "99+" : it.badge}</span>}
              </button>
            ))}
          </div>
        ))}
      </div>

      <button className="sn-user" onClick={openSettings} aria-label={t("more.mySettings")}>
        <span className="sn-av">{user?.photo_url ? <img src={user.photo_url} alt="" /> : initials}</span>
        <span className="sn-who"><b>{name}</b><small>{org?.name || roleLabel}</small></span>
        <Icon name="settings" size={16} />
      </button>
    </nav>
  );
}
