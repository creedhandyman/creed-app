"use client";
/**
 * Compact business-card preview that replaces the old "Quick tip"
 * marketing widget on the dashboard. Tapping the card opens a modal
 * with the full ShareCardPanel — QR, copy, SMS, native share, vCard
 * preview link — so Bernard can show the card at a job site without
 * digging through Operations → Settings every time.
 */
import { useState } from "react";
import { useStore } from "@/lib/store";
import ShareCardPanel from "./ShareCardPanel";

export default function DashboardCardPreview() {
  const org = useStore((s) => s.org);
  const darkMode = useStore((s) => s.darkMode);
  const [open, setOpen] = useState(false);

  if (!org) return null;
  const slug = org.site_slug || "";

  return (
    <>
      <div
        onClick={() => setOpen(true)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setOpen(true); }}
        className="cd"
        style={{
          borderLeft: "3px solid var(--color-primary)",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: 12,
        }}
      >
        {/* Logo / monogram */}
        <div
          style={{
            width: 48, height: 48, borderRadius: 10, flexShrink: 0,
            background: darkMode ? "#0a0a0f" : "#f0f2f5",
            border: `1px solid ${darkMode ? "#1e1e2e" : "#e0e0e5"}`,
            display: "flex", alignItems: "center", justifyContent: "center",
            overflow: "hidden",
          }}
        >
          {org.logo_url ? (
            <img
              src={org.logo_url}
              alt=""
              style={{ width: "100%", height: "100%", objectFit: "contain" }}
              onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
            />
          ) : (
            <span style={{ fontFamily: "Oswald, sans-serif", color: "var(--color-primary)", fontSize: 18 }}>
              {(org.name || "?").slice(0, 2).toUpperCase()}
            </span>
          )}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
            <h4 style={{ fontSize: 13, margin: 0 }}>📇 My business card</h4>
            <span style={{ fontSize: 10, fontFamily: "Oswald, sans-serif", color: "var(--color-primary)", textTransform: "uppercase", letterSpacing: ".06em" }}>
              {slug ? "Tap to share" : "Set slug"}
            </span>
          </div>
          <div className="dim" style={{ fontSize: 12, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {org.name}
            {org.phone ? ` · ${org.phone}` : ""}
          </div>
          {slug ? (
            <div style={{ fontSize: 11, color: "#888", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "monospace" }}>
              /card/{slug}
            </div>
          ) : (
            <div style={{ fontSize: 11, color: "var(--color-warning)", marginTop: 2 }}>
              Pick a URL slug under Marketing → Website to unlock the card.
            </div>
          )}
        </div>
      </div>

      {open && (
        <div
          onClick={() => setOpen(false)}
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed", inset: 0, zIndex: 999,
            background: "rgba(0,0,0,.75)",
            display: "flex", alignItems: "flex-start", justifyContent: "center",
            padding: 16, overflowY: "auto",
            // Push below safe-area top so the close button isn't behind a notch.
            paddingTop: "max(24px, env(safe-area-inset-top))",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%", maxWidth: 460,
              background: darkMode ? "var(--color-card-dark)" : "var(--color-card-light)",
              border: `1px solid ${darkMode ? "var(--color-border-dark)" : "var(--color-border-light)"}`,
              borderRadius: 14,
              padding: 16,
              maxHeight: "calc(100vh - 32px)",
              overflowY: "auto",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <h3 style={{ fontFamily: "Oswald, sans-serif", fontSize: 16, color: "var(--color-primary)", margin: 0, textTransform: "uppercase", letterSpacing: ".05em" }}>
                Share my card
              </h3>
              <button
                onClick={() => setOpen(false)}
                aria-label="Close"
                style={{
                  background: "transparent", border: "none",
                  color: darkMode ? "#888" : "#555",
                  fontSize: 22, lineHeight: 1, cursor: "pointer",
                  padding: 4,
                }}
              >
                ×
              </button>
            </div>
            <ShareCardPanel noTitle />
          </div>
        </div>
      )}
    </>
  );
}
