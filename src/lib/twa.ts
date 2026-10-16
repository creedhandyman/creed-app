/**
 * Play Store (TWA) detection. The Android app on Google Play is a Trusted
 * Web Activity wrapping this site; Google Play's payments policy forbids
 * steering users to non-Play payment for digital subscriptions INSIDE a
 * Play-distributed app, so every subscription purchase CTA is hidden there
 * (BillingGate, BillingSettings, /onboarding) and replaced with a neutral
 * "manage your plan on the web" note. The web app is unaffected.
 *
 * Detection: the TWA launches with start_url "/?src=twa" (set in the
 * Android wrapper's twa-manifest) and its first navigation carries an
 * android-app:// referrer. Either signal persists a localStorage flag,
 * because later in-app navigations lose both.
 */

const KEY = "c_twa";

/** Call once on app boot (root page mount). */
export function markTwaFromUrl(): void {
  if (typeof window === "undefined") return;
  try {
    const fromParam = new URLSearchParams(window.location.search).get("src") === "twa";
    const fromReferrer = document.referrer.startsWith("android-app://");
    if (fromParam || fromReferrer) localStorage.setItem(KEY, "1");
  } catch {
    /* storage unavailable — treat as web */
  }
}

/** True when running inside the Google Play (TWA) build. */
export function isTwa(): boolean {
  try {
    return typeof window !== "undefined" && localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

/** The note shown wherever a purchase CTA was hidden for Play compliance. */
export const TWA_BILLING_NOTE =
  "Plans and billing are managed on the web — sign in at www.creedhm.com in a browser to subscribe or change your plan.";
