"use client";
import { useEffect } from "react";
import { useStore } from "@/lib/store";
import { DEFAULT_BRAND, isHex, brandInk, brandGrad, lighten } from "@/lib/brand";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const darkMode = useStore((s) => s.darkMode);
  const navLeft = useStore((s) => s.navLeft);
  const navBottom = useStore((s) => s.navBottom);
  const brandColor = useStore((s) => s.org?.brand_color);
  const brandColor2 = useStore((s) => s.org?.brand_color_2);

  useEffect(() => {
    const classes = [darkMode ? "dark" : "light"];
    if (navBottom) classes.push("nav-bottom");
    else if (navLeft) classes.push("nav-left");
    document.documentElement.className = classes.join(" ");
  }, [darkMode, navLeft, navBottom]);

  // Per-org brand accent. Inline styles on <html> outrank the globals.css
  // :root / .light rules, so the brand color holds across the dark/light
  // toggle. Most default accents already use var(--color-primary), so buttons,
  // active nav, links, chips, and .statusstrip fallbacks retint for free. The
  // guardrail (ROYGBIV statuses + success/danger) uses its own tokens and isn't
  // touched here. Existing orgs (no brand_color) fall back to the default blue.
  useEffect(() => {
    const root = document.documentElement.style;
    const b = isHex(brandColor) ? brandColor : DEFAULT_BRAND;
    const b2 = isHex(brandColor2) ? brandColor2 : null;
    root.setProperty("--color-primary", b);
    root.setProperty("--color-primary-soft", lighten(b, 30));
    root.setProperty("--brand-ink", brandInk(b));
    root.setProperty("--brand-grad", brandGrad(b, b2));
  }, [brandColor, brandColor2]);

  return <>{children}</>;
}
