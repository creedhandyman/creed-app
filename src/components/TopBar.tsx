"use client";
import type { ReactNode } from "react";
import { t } from "@/lib/i18n";
import { Icon, type IconName } from "./Icon";

/**
 * The ONE screen header: [back] [icon tile] TITLE ……… [right slot].
 * Every main screen uses it so titles sit in the same place, at the same size,
 * with the same back button. Styles live in globals.css (.topbar*).
 *  - `color` tints the icon tile — use the screen's nav colour (VerticalNav
 *    TAB_COLOR) so the header matches the tab you came from.
 *  - `onBack` adds the chevron on the left (screens reached from More / a
 *    deep link). Omit it on the bottom-nav tabs.
 *  - `right` holds the screen's own controls (Select, date nav, a status chip…).
 */
export default function TopBar({ title, icon, color = "var(--color-primary)", onBack, backLabel, right }: {
  title: ReactNode;
  icon?: IconName;
  color?: string;
  onBack?: () => void;
  backLabel?: string;
  right?: ReactNode;
}) {
  return (
    <div className="topbar">
      {onBack && (
        <button type="button" className="iconbtn" onClick={onBack} aria-label={backLabel || t("common.back")}>
          <Icon name="back" size={18} />
        </button>
      )}
      {icon && (
        <span className="topbar-ic" style={{ ["--c" as string]: color }}>
          <Icon name={icon} size={18} color={color} />
        </span>
      )}
      <h2 className="topbar-title">{title}</h2>
      {right && <div className="topbar-right">{right}</div>}
    </div>
  );
}
