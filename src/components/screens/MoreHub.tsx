"use client";
import { useState } from "react";
import { useStore } from "@/lib/store";
import { Icon, type IconName } from "@/components/Icon";
import UserGuideModal from "@/components/UserGuideModal";

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
  const [showGuide, setShowGuide] = useState(false);

  const name = user?.name || "—";
  const initials =
    name.split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase() || "?";
  const roleLabel = user?.role ? user.role.charAt(0).toUpperCase() + user.role.slice(1) : "";

  const tiles: {
    id: string; icon: IconName; name: string; sub: string; color: string; tint: string; onClick: () => void;
  }[] = [
    { id: "sched", icon: "schedule", name: "Schedule", sub: "Calendar · assignments", color: "#7fb6ff", tint: "rgba(46,139,255,.14)", onClick: () => setPage("sched") },
    { id: "quests", icon: "trophy", name: "Quests", sub: "Crew incentives", color: "var(--color-violet)", tint: "rgba(157,78,221,.16)", onClick: () => setPage("quests") },
    { id: "ops", icon: "ops", name: "Operations", sub: "Payroll · Financials · Team", color: "#3aa0ff", tint: "rgba(58,160,255,.14)", onClick: () => openOps() },
    { id: "clients", icon: "clients", name: "Customers", sub: "CRM & history", color: "#3ee08f", tint: "rgba(0,204,102,.14)", onClick: () => openOps("customers") },
    { id: "mileage", icon: "mileage", name: "Mileage", sub: "Trip logging", color: "var(--color-warning)", tint: "rgba(255,136,0,.16)", onClick: () => setPage("mileage") },
    { id: "settings", icon: "settings", name: "Settings", sub: "Account · branding", color: "#aab", tint: "rgba(138,138,153,.18)", onClick: openSettings },
  ];

  return (
    <div className="fi">
      <h2 style={{ fontSize: 24, color: "var(--color-primary)", marginBottom: 12, display: "inline-flex", alignItems: "center", gap: 8 }}>
        <Icon name="menu" size={22} color="var(--color-primary)" /> More
      </h2>

      {/* Profile -> Settings (Account) */}
      <div className="cd mb" onClick={openSettings} style={{ display: "flex", alignItems: "center", gap: 11, cursor: "pointer", padding: 13 }}>
        <div style={{ width: 42, height: 42, borderRadius: "50%", background: "var(--color-card-dark-3)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Oswald", fontWeight: 600, color: "#cdd6e6", flexShrink: 0 }}>{initials}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: "Oswald", fontWeight: 600, fontSize: 17 }}>{name}</div>
          <div style={{ fontSize: 13, color: "var(--color-success)" }}>{roleLabel}{org?.name ? ` · ${org.name}` : ""}</div>
        </div>
        <Icon name="next" size={18} color="var(--color-dim)" />
      </div>

      {/* Relocated tabs + Customers / Mileage / Settings */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 11, marginBottom: 11 }}>
        {tiles.map((tile) => (
          <div key={tile.id} className="cd" onClick={tile.onClick} style={{ cursor: "pointer", padding: 14 }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: tile.tint, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 10 }}>
              <Icon name={tile.icon} size={20} color={tile.color} />
            </div>
            <div style={{ fontFamily: "Oswald", fontWeight: 600, fontSize: 16, letterSpacing: ".3px" }}>{tile.name}</div>
            <div style={{ fontSize: 12, color: "var(--color-dim)", marginTop: 2 }}>{tile.sub}</div>
          </div>
        ))}
      </div>

      {/* Help & user guide */}
      <div className="cd" onClick={() => setShowGuide(true)} style={{ display: "flex", alignItems: "center", gap: 12, cursor: "pointer", padding: 13 }}>
        <div style={{ width: 38, height: 38, borderRadius: 11, background: "rgba(138,138,153,.16)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <Icon name="help" size={19} color="#aab" />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15.5, fontWeight: 600 }}>Help &amp; user guide</div>
          <div style={{ fontSize: 13.5, color: "var(--color-dim)" }}>How Creed works</div>
        </div>
        <Icon name="next" size={17} color="var(--color-dim)" />
      </div>

      {showGuide && <UserGuideModal onClose={() => setShowGuide(false)} />}
    </div>
  );
}
