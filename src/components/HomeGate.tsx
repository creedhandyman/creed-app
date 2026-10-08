"use client";
import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import Landing from "@/components/marketing/Landing";
import Onboarding from "@/components/Onboarding";
import PendingApproval from "@/components/PendingApproval";
import AppShell from "@/components/AppShell";
import BillingGate from "@/components/BillingGate";
import Toast from "@/components/Toast";
import ConfirmModal from "@/components/ConfirmModal";
import InstallPrompt from "@/components/InstallPrompt";
import BrandFooter from "@/components/BrandFooter";

/** Full-screen app loading state, shared by the pre-mount and data-loading
 *  gates — centered wordmark + the CREED HM™/© brand footer at the bottom.
 *  The wordmark is a styled div, not a heading: this screen ships (hidden) in
 *  the home page's server HTML, and crawlers shouldn't read it as a title. */
function LoadingScreen() {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: "#0a0a0f",
        position: "relative",
      }}
    >
      <div
        role="status"
        style={{
          color: "#2E75B6",
          fontFamily: "Oswald",
          fontSize: 24,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          lineHeight: 1.15,
        }}
      >
        Loading Creed...
      </div>
      <BrandFooter style={{ position: "absolute", bottom: 14, left: 0, right: 0 }} />
    </div>
  );
}

/**
 * The "/" route: the marketing landing for visitors, the app for signed-in
 * users. Rendered by app/page.tsx (a server page, so it can carry metadata).
 *
 * Before mount (server HTML + first client render) it emits BOTH the landing
 * and a hidden boot screen, so search engines and first-time visitors get the
 * real landing copy without waiting on JavaScript — it used to server-render
 * only "Loading Creed...". A head script in app/layout.tsx sets
 * `html[data-session]` when a user is cached in localStorage; globals.css then
 * hides the landing and shows the boot screen, so signed-in users never see a
 * flash of marketing before the app takes over.
 */
export default function HomeGate() {
  const [mounted, setMounted] = useState(false);
  const user = useStore((s) => s.user);
  const loading = useStore((s) => s.loading);
  const startAutoRefresh = useStore((s) => s.startAutoRefresh);
  const stopAutoRefresh = useStore((s) => s.stopAutoRefresh);
  const initAuth = useStore((s) => s.initAuth);

  useEffect(() => setMounted(true), []);

  // No signed-in user after all (signed out, or a stale cached user that
  // initAuth cleared): drop the session flag so the landing becomes visible.
  useEffect(() => {
    if (mounted && !user) document.documentElement.removeAttribute("data-session");
  }, [mounted, user]);

  // Validate Supabase Auth session on mount
  useEffect(() => {
    initAuth();
  }, [initAuth]);

  // Register the service worker on load — needed for installability (the
  // install prompt), push, and offline caching. No-op where unsupported.
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);

  // Handle Stripe redirect — refresh org data when returning from Stripe
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const stripeStatus = params.get("stripe");
    if (stripeStatus) {
      // Clean URL
      window.history.replaceState({}, "", "/");
      // Refresh org data
      const { loadAll, showToast } = useStore.getState();
      loadAll();
      if (stripeStatus === "success") {
        showToast("Stripe connected — you can accept payments now", "success");
      } else if (stripeStatus === "pending") {
        showToast(
          "Stripe onboarding complete — Stripe is verifying your account. Payments usually enable within a few minutes.",
          "info",
        );
      } else if (stripeStatus === "error") {
        // eslint-disable-next-line no-console
        console.error("[stripe connect] failed:", params.get("reason") || "unknown");
        showToast("Stripe didn't finish connecting. Open Ops → Billing and tap Connect again — your progress there is saved.", "error");
      }
    }
  }, []);

  useEffect(() => {
    if (user) {
      startAutoRefresh();
      return () => stopAutoRefresh();
    }
    // Key on user.id, NOT the user object reference. The previous
    // `[user, ...]` dep fired this effect twice per visit: once from the
    // localStorage-rehydrated cached user, then again when initAuth
    // re-set the same user with a fresh object reference. Each re-fire
    // ran startAutoRefresh → loadAll, which pulled all 14 tables a
    // second time. ~30 redundant Supabase queries per visit. Keying on
    // user?.id collapses that to a single fire.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, startAutoRefresh, stopAutoRefresh]);

  // Before mount the user is unknown to React (it lives in localStorage), so
  // render both and let the html[data-session] flag pick which one shows.
  // Both branches return a fragment whose first child is the same
  // .home-landing div, so React keeps the landing's DOM across mount instead
  // of re-creating it.
  if (!mounted) {
    return (
      <>
        <div className="home-landing"><Landing /></div>
        <div className="home-boot"><LoadingScreen /></div>
      </>
    );
  }

  // Logged-out visitors get the marketing landing; signed-in users never
  // see it (they fall through to onboarding / the app below).
  if (!user) return <><div className="home-landing"><Landing /></div></>;

  // User exists but no org — needs onboarding
  if (!user.org_id) return <Onboarding />;

  // Asked to join a business; waiting for the owner to approve.
  if (user.status === "pending") return <><Toast /><PendingApproval /></>;

  if (loading) {
    return <LoadingScreen />;
  }

  return <><Toast /><ConfirmModal /><InstallPrompt /><BillingGate><AppShell /></BillingGate></>;
}
