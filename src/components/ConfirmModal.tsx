"use client";
import { useStore } from "@/lib/store";

export default function ConfirmModal() {
  const { title, message, visible } = useStore((s) => s.confirmState);
  const resolveConfirm = useStore((s) => s.resolveConfirm);

  if (!visible) return null;

  const isDanger = /delete|remove|cancel|discard/i.test(title + message);
  const accent = isDanger ? "#C00000" : "#2E75B6";

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9998,
        background: "rgba(5, 5, 12, 0.72)",
        backdropFilter: "blur(8px) saturate(120%)",
        WebkitBackdropFilter: "blur(8px) saturate(120%)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        animation: "fadeIn 0.22s cubic-bezier(0.22, 1, 0.36, 1)",
      }}
      onClick={() => resolveConfirm(false)}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "linear-gradient(180deg, #14141e 0%, #12121a 100%)",
          border: `1px solid ${accent}22`,
          borderTop: `3px solid ${accent}`,
          borderRadius: 16,
          padding: "26px 28px 22px",
          width: "100%",
          maxWidth: 380,
          boxShadow: `0 24px 64px rgba(0, 0, 0, 0.6), 0 0 32px ${accent}22`,
          animation: "modalIn 0.28s cubic-bezier(0.34, 1.56, 0.64, 1)",
        }}
      >
        <h3
          style={{
            fontFamily: "Oswald, sans-serif",
            fontSize: 18,
            textTransform: "uppercase",
            color: accent,
            marginBottom: 12,
            letterSpacing: ".05em",
            fontWeight: 600,
          }}
        >
          {title}
        </h3>
        <p
          style={{
            fontSize: 14,
            color: "#b5b5c0",
            lineHeight: 1.55,
            marginBottom: 22,
            fontFamily: "Source Sans 3, sans-serif",
          }}
        >
          {message}
        </p>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button
            onClick={() => resolveConfirm(false)}
            style={{
              padding: "9px 20px",
              borderRadius: 10,
              fontSize: 13,
              fontFamily: "Oswald, sans-serif",
              textTransform: "uppercase",
              letterSpacing: ".06em",
              background: "transparent",
              border: "1px solid #2a2a3a",
              color: "#aaa",
              cursor: "pointer",
              transition: "all 200ms cubic-bezier(0.22, 1, 0.36, 1)",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = "#3a3a4a";
              e.currentTarget.style.color = "#ddd";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = "#2a2a3a";
              e.currentTarget.style.color = "#aaa";
            }}
          >
            Cancel
          </button>
          <button
            onClick={() => resolveConfirm(true)}
            style={{
              padding: "9px 22px",
              borderRadius: 10,
              fontSize: 13,
              fontFamily: "Oswald, sans-serif",
              textTransform: "uppercase",
              letterSpacing: ".06em",
              background: `linear-gradient(135deg, ${accent} 0%, ${
                isDanger ? "#d41010" : "#3580c4"
              } 100%)`,
              color: "#fff",
              border: "none",
              cursor: "pointer",
              boxShadow: `0 4px 16px ${accent}55`,
              transition: "all 120ms cubic-bezier(0.34, 1.56, 0.64, 1)",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = "translateY(-1px)";
              e.currentTarget.style.filter = "brightness(1.08)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = "translateY(0)";
              e.currentTarget.style.filter = "brightness(1)";
            }}
          >
            {isDanger ? "Delete" : "Confirm"}
          </button>
        </div>
      </div>
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes modalIn {
          from { opacity: 0; transform: scale(0.94) translateY(-12px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>
    </div>
  );
}
