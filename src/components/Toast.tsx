"use client";
import { useStore } from "@/lib/store";
import { Icon } from "./Icon";

const COLORS = {
  success: { bg: "rgba(0,204,102,0.14)",  border: "rgba(0,204,102,0.85)",  glow: "rgba(0,204,102,0.5)",  glow2: "rgba(0,204,102,0.45)",  icon: "checkCircle", ink: "#00cc66" },
  error:   { bg: "rgba(192,0,0,0.14)",    border: "rgba(192,0,0,0.85)",    glow: "rgba(255,91,91,0.5)",  glow2: "rgba(255,91,91,0.45)",  icon: "errorCircle", ink: "#ff5b5b" },
  info:    { bg: "rgba(46,117,182,0.14)", border: "rgba(46,117,182,0.85)", glow: "rgba(46,139,255,0.5)", glow2: "rgba(46,139,255,0.45)", icon: "info",        ink: "#5aa6ff" },
  warning: { bg: "rgba(255,136,0,0.14)",  border: "rgba(255,136,0,0.85)",  glow: "rgba(255,136,0,0.5)",  glow2: "rgba(255,136,0,0.45)",  icon: "warn",        ink: "#ff9a2e" },
} as const;

export default function Toast() {
  const { message, type, visible } = useStore((s) => s.toast);
  const hideToast = useStore((s) => s.hideToast);

  if (!visible) return null;

  const c = COLORS[type] || COLORS.info;

  return (
    <div
      onClick={hideToast}
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        top: "max(16px, env(safe-area-inset-top))",
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 9999,
        background: c.bg,
        backdropFilter: "blur(16px) saturate(160%)",
        WebkitBackdropFilter: "blur(16px) saturate(160%)",
        border: `1.5px solid ${c.border}`,
        borderRadius: 14,
        padding: "12px 18px 12px 16px",
        minWidth: 260,
        maxWidth: 420,
        display: "flex",
        alignItems: "center",
        gap: 12,
        cursor: "pointer",
        boxShadow: `0 0 24px -2px ${c.glow}, inset 0 0 22px -8px ${c.glow2}, 0 12px 36px rgba(0,0,0,0.55)`,
        animation: "toastIn 0.36s cubic-bezier(0.22,1,0.36,1)",
      }}
    >
      <Icon name={c.icon} size={20} color={c.ink} strokeWidth={2} />
      <span style={{ fontSize: 15.5, color: "#e8e8ee", fontFamily: "Source Sans 3, sans-serif", lineHeight: 1.4, letterSpacing: 0.1 }}>
        {message}
      </span>
      <style>{`
        @keyframes toastIn {
          from { opacity:0; transform:translateX(-50%) translateY(-18px) scale(0.92); }
          60%  { opacity:1; transform:translateX(-50%) translateY(0) scale(1.03); }
          to   { opacity:1; transform:translateX(-50%) translateY(0) scale(1); }
        }
      `}</style>
    </div>
  );
}
