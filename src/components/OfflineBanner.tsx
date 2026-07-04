"use client";
import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";

// Compact relative-time for the "last synced" label. No dep — the codebase
// has no time-ago helper and this is the only place that needs one.
function ago(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 45) return "just now";
  const m = Math.floor(s / 60);
  if (m < 1) return "under a minute ago";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

/**
 * Slim amber strip shown only while the app is serving the last cached
 * snapshot (no network). Honest by design — tells the user the data isn't
 * live and how stale it is, so nobody mistakes an offline read for the
 * current truth. Auto-clears the moment a real load succeeds.
 */
export default function OfflineBanner() {
  const offline = useStore((s) => s.usingOfflineData);
  const lastSyncedAt = useStore((s) => s.lastSyncedAt);
  const pending = useStore((s) => s.pendingWrites);
  const [, tick] = useState(0);

  // Keep the relative label fresh while the network stays down. loadAll
  // re-setting the same `usingOfflineData: true` won't re-render (Zustand
  // bails on unchanged selected values), so drive it from a local timer.
  useEffect(() => {
    if (!offline) return;
    const iv = setInterval(() => tick((n) => n + 1), 30000);
    return () => clearInterval(iv);
  }, [offline]);

  if (!offline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "sticky",
        top: 0,
        zIndex: 50,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        padding: "6px 12px",
        background: "#3a2a08",
        borderBottom: "1px solid #5a3f0a",
        color: "#f5c451",
        fontSize: 12.5,
        fontWeight: 600,
        letterSpacing: 0.2,
        textAlign: "center",
      }}
    >
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: "50%",
          background: "#f5c451",
          flexShrink: 0,
        }}
      />
      <span>
        Offline — showing saved data
        {lastSyncedAt ? ` · last synced ${ago(lastSyncedAt)}` : ""}
        {pending > 0
          ? ` · ${pending} change${pending > 1 ? "s" : ""} will sync when you reconnect`
          : ""}
      </span>
    </div>
  );
}
