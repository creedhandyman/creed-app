/**
 * Meta (Facebook/Instagram) Pixel — ad measurement for creedhm.com's MARKETING
 * funnel only. Loaded on the public marketing pages (MarketingShell) and fired
 * once at the two conversion points: account created (store.signup →
 * CompleteRegistration) and business created (Onboarding → StartTrial).
 * Never loaded inside the signed-in app, the customer portal, /status quotes or
 * the public business-card pages, so no customer or job data reaches Meta.
 * Disclosed in /privacy ("Advertising measurement").
 *
 * The pixel id is public by design (it ships in the page); override with
 * NEXT_PUBLIC_META_PIXEL_ID, or set it to "off" to disable.
 */
export const META_PIXEL_ID = (process.env.NEXT_PUBLIC_META_PIXEL_ID || "2540661056695471").trim();

type Fbq = ((...args: unknown[]) => void) & {
  callMethod?: (...args: unknown[]) => void;
  queue?: unknown[];
  push?: unknown;
  loaded?: boolean;
  version?: string;
};
declare global {
  interface Window {
    fbq?: Fbq;
    _fbq?: Fbq;
  }
}

let inited = false;

/** Inject Meta's loader once (same as their snippet) and init the pixel. */
function ensurePixel(): boolean {
  if (typeof window === "undefined") return false;
  if (!META_PIXEL_ID || META_PIXEL_ID === "off") return false;
  try {
    if (!window.fbq) {
      const n = function (...args: unknown[]) {
        if (n.callMethod) n.callMethod(...args);
        else n.queue!.push(args);
      } as Fbq;
      n.push = n;
      n.loaded = true;
      n.version = "2.0";
      n.queue = [];
      window.fbq = n;
      if (!window._fbq) window._fbq = n;
      const s = document.createElement("script");
      s.async = true;
      s.src = "https://connect.facebook.net/en_US/fbevents.js";
      document.head.appendChild(s);
    }
    if (!inited) {
      window.fbq("init", META_PIXEL_ID);
      inited = true;
    }
    return true;
  } catch {
    return false;
  }
}

/** A marketing page view. */
export function pixelPageView(): void {
  if (ensurePixel()) window.fbq!("track", "PageView");
}

/** A standard conversion event (e.g. CompleteRegistration, StartTrial). Never throws. */
export function pixelEvent(name: string, params?: Record<string, string | number>): void {
  try {
    if (ensurePixel()) window.fbq!("track", name, params ?? {});
  } catch {
    /* ad measurement must never break signup */
  }
}
