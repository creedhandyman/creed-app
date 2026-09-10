"use client";
/**
 * App-brand trademark/copyright footer — rendered at the bottom of the
 * dashboard and the app loading screens. This is the CREED HM product
 * mark (not the org's own logo/branding, which stays per-tenant).
 */
export default function BrandFooter({ style }: { style?: React.CSSProperties }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 4,
        padding: "16px 0 8px",
        opacity: 0.8,
        ...style,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <img
          src="/CREED_LOGO.png"
          alt="Creed HM logo"
          style={{ width: 18, height: 18, borderRadius: 5, objectFit: "cover" }}
          onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
        />
        <span style={{ fontFamily: "Oswald, sans-serif", fontWeight: 600, fontSize: 12, letterSpacing: ".14em", color: "#8a8a99" }}>
          CREED HM™
        </span>
      </div>
      <div style={{ fontSize: 10.5, color: "#5a5a66", letterSpacing: ".02em" }}>
        © {new Date().getFullYear()} Creed Handyman LLC · All rights reserved
      </div>
    </div>
  );
}
