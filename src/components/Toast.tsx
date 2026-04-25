"use client";
import { useStore } from "@/lib/store";

const COLORS = {
  success: { border: "#00cc66", icon: "✅" },
  error:   { border: "#C00000", icon: "❌" },
  info:    { border: "#2E75B6", icon: "ℹ️" },
  warning: { border: "#ff8800", icon: "⚠️" },
} as const;

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
        top: "max(16px, env(safe-area-inset-top))",
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 9999,
        background: "rgba(18, 18, 26, 0.92)",
        backdropFilter: "blur(14px) saturate(140%)",
        WebkitBackdropFilter: "blur(14px) saturate(140%)",
        border: `1px solid ${c.border}55`,
        borderLeft: `3px solid ${c.border}`,
        borderRadius: 12,
        padding: "12px 18px 12px 16px",
        minWidth: 260,
        maxWidth: 420,
        display: "flex",
        alignItems: "center",
        gap: 12,
        cursor: "pointer",
        boxShadow: `0 12px 36px rgba(0, 0, 0, 0.55), 0 0 0 1px ${c.border}22, 0 0 24px ${c.border}33`,
        animation: "toastIn 0.32s cubic-bezier(0.22, 1, 0.36, 1)",
      }}
    >
      <span style={{ fontSize: 18, flexShrink: 0, lineHeight: 1 }}>{c.icon}</span>
      <span
        style={{
          fontSize: 13.5,
          color: "#e8e8ee",
          fontFamily: "Source Sans 3, sans-serif",
          lineHeight: 1.4,
          letterSpacing: 0.1,
        }}
      >
        {message}
      </span>
      <style>{`
        @keyframes toastIn {
          from { opacity: 0; transform: translateX(-50%) translateY(-14px) scale(0.96); }
          to   { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); }
        }
      `}</style>
    </div>
  );
}
