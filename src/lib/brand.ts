// Per-org brand color helpers — pure functions, no React, so both client
// components and the print-template lib can import them. WCAG luminance picks a
// readable ink color; shade/lighten derive the gradient + soft accent.

export const DEFAULT_BRAND = "#2E75B6";

export function isHex(h: string | null | undefined): h is string {
  return typeof h === "string" && /^#[0-9a-fA-F]{6}$/.test(h.trim());
}

export function normHex(h: string): string {
  let v = h.trim();
  if (!v.startsWith("#")) v = "#" + v;
  return v.toUpperCase();
}

function toRgb(h: string): [number, number, number] {
  const v = h.replace("#", "");
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}

function toHex(rgb: [number, number, number]): string {
  return (
    "#" +
    rgb.map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, "0")).join("").toUpperCase()
  );
}

/** WCAG relative luminance (0–1). */
export function luminance(h: string): number {
  const f = (v: number) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const [r, g, b] = toRgb(h);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** Readable text color (#1a1a2a vs #fff) for text sitting ON the brand fill. */
export function brandInk(h: string): string {
  return luminance(h) > 0.55 ? "#1a1a2a" : "#ffffff";
}

/** Shift every channel by `amt` (clamped 0–255). Positive = lighter. */
export function shade(h: string, amt: number): string {
  const [r, g, b] = toRgb(h);
  return toHex([r + amt, g + amt, b + amt]);
}
export const lighten = (h: string, amt: number): string => shade(h, Math.abs(amt));

/** Two-tone gradient; second stop falls back to a lighter shade of the first. */
export function brandGrad(c1: string, c2?: string | null): string {
  return `linear-gradient(135deg, ${c1}, ${isHex(c2) ? c2 : shade(c1, 40)})`;
}

/** hex → rgba() string with alpha. */
export function rgba(h: string, a: number): string {
  const [r, g, b] = toRgb(h);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** True when a color is so light or dark it's hard to read as an accent —
 *  drives the soft "this may be hard to read" warning in the picker. */
export function isExtremeLuminance(h: string): boolean {
  const l = luminance(h);
  return l > 0.82 || l < 0.035;
}
