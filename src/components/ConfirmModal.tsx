"use client";
import { useStore } from "@/lib/store";

export default function ConfirmModal() {
  const { title, message, visible } = useStore((s) => s.confirmState);
  const resolveConfirm = useStore((s) => s.resolveConfirm);

  if (!visible) return null;

  const isDanger = /delete|remove|cancel/i.test(title + message);

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 9998,
        background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        animation: "fadeIn 0.2s ease",
      }}
      onClick={() => resolveConfirm(false)}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#12121a", border: "1px solid #1e1e2e",
          borderRadius: 14, padding: "24px 28px", width: "90%", maxWidth: 380,
          animation: "modalIn 0.25s ease",
        }}
      >
        <h3 style={{
          fontFamily: "Oswald, sans-serif", fontSize: 18, textTransform: "uppercase",
          color: isDanger ? "#C00000" : "#2E75B6", marginBottom: 10, letterSpacing: ".04em",
        }}>
          {title}
        </h3>
        <p style={{ fontSize: 14, color: "#aaa", lineHeight: 1.5, marginBottom: 20 }}>
          {message}
        </p>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button
            onClick={() => resolveConfirm(false)}
            style={{
              padding: "8px 20px", borderRadius: 8, fontSize: 13,
              fontFamily: "Oswald, sans-serif", textTransform: "uppercase",
              background: "transparent", border: "1px solid #1e1e2e",
              color: "#888", cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            onClick={() => resolveConfirm(true)}
            style={{
              padding: "8px 20px", borderRadius: 8, fontSize: 13,
              fontFamily: "Oswald, sans-serif", textTransform: "uppercase",
              background: isDanger ? "#C00000" : "#2E75B6",
              color: "#fff", border: "none", cursor: "pointer",
            }}
          >
            {isDanger ? "Delete" : "Confirm"}
          </button>
        </div>
      </div>
      <style>{`
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes modalIn { from { opacity: 0; transform: scale(0.95) translateY(-8px); } to { opacity: 1; transform: scale(1) translateY(0); } }
      `}</style>
    </div>
  );
}
