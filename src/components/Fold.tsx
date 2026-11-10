"use client";
import { useState, type ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

/**
 * A section that starts collapsed to one tappable header row (icon · title ·
 * count · chevron) and opens on tap. Used to keep busy screens calm: the
 * Dispatch tab opens showing only "Plan the week", with the rest folded.
 *
 * The body is only rendered while open, so heavy content (a map) costs
 * nothing until it's asked for.
 */
export default function Fold({
  title,
  icon,
  count,
  defaultOpen = false,
  children,
}: {
  title: string;
  icon?: IconName;
  /** Shown after the title, e.g. how many rows are inside. */
  count?: number | string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ marginBottom: 8 }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 8, textAlign: "left", cursor: "pointer",
          padding: "11px 12px", borderRadius: 12, color: "inherit",
          background: "var(--color-card-dark-2)", border: "1px solid var(--color-border-dark-2)",
          fontSize: 12.5, letterSpacing: ".1em", textTransform: "uppercase", fontWeight: 600,
        }}
      >
        {icon && <Icon name={icon} size={14} color="var(--color-dim)" />}
        <span style={{ flex: 1, minWidth: 0 }}>
          {title}
          {count !== undefined && count !== "" && <span className="dim" style={{ fontWeight: 500 }}> ({count})</span>}
        </span>
        <Icon name={open ? "collapse" : "expand"} size={16} color="var(--color-dim)" />
      </button>
      {open && <div style={{ marginTop: 8 }}>{children}</div>}
    </div>
  );
}
