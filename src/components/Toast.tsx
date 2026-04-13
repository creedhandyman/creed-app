"use client";
import { useStore } from "@/lib/store";

const COLORS = {
  success: { bg: "#00cc6622", border: "#00cc66", icon: "\u2705" },
  error: { bg: "#C0000022", border: "#C00000", icon: "\u274C" },
  info: { bg: "#2E75B622", border: "#2E75B6", icon: "\u2139\uFE0F" },
  warning: { bg: "#ff880022", border: "#ff8800", icon: "\u26A0\uFE0F" },
};

export default function Toast() {
  const { message, type, visible } = useStore((s) => s.toast);
  const hideToast = useStore((s) => s.hideToast);

  if (!visible) return null;

  const c = COLORS[type] || COLORS.info;

  return (
    <div
      onClick={hideToast}
      style={{
        position: "fixed",
        top: 16,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 9999,
        background: "#12121a",
        border: `1px solid ${c.border}`,
        borderLeft: `4px solid ${c.border}`,
        borderRadius: 10,
        padding: "12px 20px",
        minWidth: 260,
        maxWidth: 420,
        display: "flex",
        alignItems: "center",
        gap: 10,
        cursor: "pointer",
        boxShadow: `0 8px 24px rgba(0,0,0,0.5), 0 0 0 1px ${c.border}33`,
        animation: "toastIn 0.3s ease",
      }}
    >
      <span style={{ fontSize: 18, flexShrink: 0 }}>{c.icon}</span>
      <span style={{ fontSize: 13, color: "#e2e2e8", fontFamily: "Source Sans 3, sans-serif", lineHeight: 1.4 }}>
        {message}
      </span>
      <style>{`@keyframes toastIn { from { opacity: 0; transform: translateX(-50%) translateY(-12px); } to { opacity: 1; transform: translateX(-50%) translateY(0); } }`}</style>
    </div>
  );
}
