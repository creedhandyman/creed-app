"use client";
import { useEffect, useState, type ReactNode } from "react";
import { useBackLayer } from "@/lib/back-layer";
import { t } from "@/lib/i18n";
import { Icon } from "./Icon";

/**
 * A short, categorized list of settings: each row is a category (icon · title ·
 * one line saying what's inside); tapping one opens just that category's
 * settings with a back button to the list. Replaces the long scroll of every
 * setting at once, on both the personal Settings screen and Ops → Settings.
 * Phone back closes an open category (back to the list) before it leaves the
 * screen.
 */
export interface SettingsCategory {
  id: string;
  icon: string;
  title: string;
  /** What's inside, in a few words. */
  sub?: string;
  /** Small status shown at the right of the row (e.g. "On"). */
  badge?: string;
  /** The settings themselves — only mounted while the category is open. */
  content: ReactNode;
}

export default function SettingsCategories({
  categories, footer,
}: {
  categories: SettingsCategory[];
  /** Shown under the list only (sign out, support…). */
  footer?: ReactNode;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const open = categories.find((c) => c.id === openId) || null;
  const close = () => setOpenId(null);
  useBackLayer(!!open, close);

  // Opening / closing a category starts at the top — the list is short, the
  // category might not be.
  useEffect(() => {
    try { window.scrollTo({ top: 0 }); } catch { /* */ }
  }, [openId]);

  if (open) {
    return (
      <div>
        <button
          type="button"
          onClick={close}
          style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left", background: "none", border: "none", color: "inherit", cursor: "pointer", padding: "0 0 12px" }}
        >
          <span style={{ width: 30, height: 30, borderRadius: 9, border: "1px solid var(--color-border-dark-2, rgba(128,128,128,.3))", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Icon name="back" size={16} />
          </span>
          <span style={{ fontFamily: "Oswald", fontWeight: 700, fontSize: 19, letterSpacing: ".4px", textTransform: "uppercase" }}>{open.title}</span>
          <span className="dim" style={{ marginLeft: "auto", fontSize: 12.5 }}>{t("settings.allSettings")}</span>
        </button>
        {open.content}
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {categories.map((c) => (
          <button
            key={c.id}
            type="button"
            className="cd"
            onClick={() => setOpenId(c.id)}
            style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", textAlign: "left", cursor: "pointer", color: "inherit", padding: "12px 13px", margin: 0 }}
          >
            <span aria-hidden style={{ width: 38, height: 38, borderRadius: 11, background: "var(--color-primary-soft, rgba(46,117,182,.15))", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <Icon name={c.icon} size={19} color="var(--color-primary)" />
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", fontFamily: "Oswald", fontSize: 16, fontWeight: 600, letterSpacing: ".3px" }}>{c.title}</span>
              {c.sub && <span className="dim" style={{ display: "block", fontSize: 12.5, marginTop: 1 }}>{c.sub}</span>}
            </span>
            {c.badge && <span className="dim" style={{ fontSize: 12.5, flexShrink: 0 }}>{c.badge}</span>}
            <Icon name="next" size={16} color="var(--color-dim)" />
          </button>
        ))}
      </div>
      {footer}
    </div>
  );
}
