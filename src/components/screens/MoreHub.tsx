"use client";
import { useState } from "react";
import { useStore } from "@/lib/store";
import { Icon, type IconName } from "@/components/Icon";
import UserGuideModal from "@/components/UserGuideModal";
import Grizz from "@/components/Grizz";

interface Props {
  setPage: (p: string) => void;
  openSettings: () => void;
  // Opens Operations, optionally deep-linked to a sub-tab (e.g. the
  // Customers tile jumps straight to Operations -> customers).
  openOps: (tab?: string) => void;
}

/**
 * The "More" hub — the overflow destination for the 5-tab nav. Holds the
 * tabs that came off the bar (Schedule, Quests, Operations) plus Customers,
 * Mileage, Settings, and Help. Reached via the menu (three-lines) tab.
 */
export default function MoreHub({ setPage, openSettings, openOps }: Props) {
  const user = useStore((s) => s.user);
  const org = useStore((s) => s.org);
  const darkMode = useStore((s) => s.darkMode);
  const [showGuide, setShowGuide] = useState(false);

  const name = user?.name || "—";
  const initials =
    name.split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase() || "?";
  const roleLabel = user?.role ? user.role.charAt(0).toUpperCase() + user.role.slice(1) : "";

  // Role gate: techs/apprentices don't manage the business, so the admin
  // tiles never render for them — Customers (CRM) is hidden outright, and
  // the Operations tile becomes "Time Off" (Operations already roots
  // non-admins at HR; this makes the tile honest about where it goes).
  const isAdmin = user?.role === "owner" || user?.role === "manager";

  const tiles: {
    id: string; icon: IconName; name: string; sub: string; color: string; tint: string; onClick: () => void;
  }[] = [
    { id: "sched", icon: "schedule", name: "Schedule", sub: "Calendar · assignments", color: "#ff8a3d", tint: "rgba(255,138,61,.16)", onClick: () => setPage("sched") },
    { id: "quests", icon: "trophy", name: "Quests", sub: "Crew incentives", color: "var(--color-violet)", tint: "rgba(157,78,221,.16)", onClick: () => setPage("quests") },
    isAdmin
      ? { id: "ops", icon: "ops", name: "Operations", sub: "Payroll · Financials · Team", color: "#3aa0ff", tint: "rgba(58,160,255,.14)", onClick: () => openOps() }
      : { id: "ops", icon: "schedule", name: "Time Off", sub: "Requests · balances", color: "#3aa0ff", tint: "rgba(58,160,255,.14)", onClick: () => openOps() },
    ...(isAdmin
      ? [{ id: "clients", icon: "clients" as IconName, name: "Customers", sub: "CRM & history", color: "#3ee08f", tint: "rgba(0,204,102,.14)", onClick: () => openOps("customers") }]
      : []),
    { id: "mileage", icon: "mileage", name: "Mileage", sub: "Trip logging", color: "#14b8a6", tint: "rgba(20,184,166,.16)", onClick: () => setPage("mileage") },
    { id: "map", icon: "map", name: "Crew Map", sub: "Stamps · today's stops", color: "#3ee08f", tint: "rgba(0,204,102,.14)", onClick: () => setPage("map") },
    { id: "settings", icon: "settings", name: "Settings", sub: isAdmin ? "Account · branding" : "Account · notifications", color: "#aab", tint: "rgba(138,138,153,.18)", onClick: openSettings },
    { id: "grizz", icon: "info", name: "Ask Grizz", sub: "Tips & how Creed works", color: "#f5b400", tint: "rgba(245,180,0,.14)", onClick: () => setShowGuide(true) },
  ];

  return (
    <div className="fi">
      <h2 style={{ fontSize: 24, color: "var(--color-primary)", marginBottom: 12, display: "inline-flex", alignItems: "center", gap: 8 }}>
        <Icon name="menu" size={22} color="var(--color-primary)" /> More
      </h2>

      {/* Profile -> Settings (Account) */}
      <div className="cd mb" onClick={openSettings} style={{ display: "flex", alignItems: "center", gap: 11, cursor: "pointer", padding: 13 }}>
        <div style={{ width: 42, height: 42, borderRadius: "50%", background: "var(--color-card-dark-3)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Oswald", fontWeight: 600, color: darkMode ? "#cdd6e6" : "#5a6175", flexShrink: 0 }}>{initials}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: "Oswald", fontWeight: 600, fontSize: 17 }}>{name}</div>
          <div style={{ fontSize: 13, color: "var(--color-success)" }}>{roleLabel}{org?.name ? ` · ${org.name}` : ""}</div>
        </div>
        <Icon name="next" size={18} color="var(--color-dim)" />
      </div>

      {/* Relocated tabs + Customers / Mileage / Settings */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 11, marginBottom: 11 }}>
        {tiles.map((tile, i) => {
          // An odd tile count leaves the last tile alone with an empty cell
          // beside it (the tech view has no Customers tile → 7 tiles). Span the
          // odd last one across both columns so the grid fills evenly.
          const spanFull = tiles.length % 2 === 1 && i === tiles.length - 1;
          return (
            <div key={tile.id} className="cd" onClick={tile.onClick} style={{ cursor: "pointer", padding: 14, ...(spanFull ? { gridColumn: "1 / -1" } : {}) }}>
              <div style={{ width: 40, height: 40, borderRadius: 12, background: tile.tint, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 10, overflow: "hidden" }}>
                {tile.id === "grizz"
                  ? <Grizz pose="point" size={30} />
                  : <Icon name={tile.icon} size={20} color={tile.color} />}
              </div>
              <div style={{ fontFamily: "Oswald", fontWeight: 600, fontSize: 16, letterSpacing: ".3px" }}>{tile.name}</div>
              <div style={{ fontSize: 12, color: "var(--color-dim)", marginTop: 2 }}>{tile.sub}</div>
            </div>
          );
        })}
      </div>

      {showGuide && <UserGuideModal onClose={() => setShowGuide(false)} />}
    </div>
  );
}
