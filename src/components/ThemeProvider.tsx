"use client";
import { useEffect } from "react";
import { useStore } from "@/lib/store";
import { DEFAULT_BRAND, isHex, normHex, brandInk, brandGrad, lighten, rgbTriplet } from "@/lib/brand";

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
    // The gradient's second stop: the business's own 2nd color when they
    // turned the gradient on (Business settings → Brand color), else the
    // lighter shade of their color (the look before gradients existed).
    root.setProperty("--color-primary-2", b2 || lighten(b, 30));
    root.setProperty("--brand-ink", brandInk(b));
    root.setProperty("--brand-grad", brandGrad(b, b2));
    // Glass surfaces (.dhead) are tinted with rgba(var(--accent-glow), a).
    // An org that never picked a color keeps the original bright-blue glass.
    const custom = isHex(brandColor) && normHex(brandColor) !== normHex(DEFAULT_BRAND);
    const glow = custom ? rgbTriplet(b) : "46, 139, 255";
    root.setProperty("--accent-glow", glow);
    root.setProperty("--accent-glow-2", b2 ? rgbTriplet(b2) : glow);
  }, [brandColor, brandColor2]);

  return <>{children}</>;
}
