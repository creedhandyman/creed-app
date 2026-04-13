"use client";
import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import Login from "@/components/Login";
import Onboarding from "@/components/Onboarding";
import AppShell from "@/components/AppShell";
import BillingGate from "@/components/BillingGate";
import Toast from "@/components/Toast";
import ConfirmModal from "@/components/ConfirmModal";

export default function Home() {
  const [mounted, setMounted] = useState(false);
  const user = useStore((s) => s.user);
  const loading = useStore((s) => s.loading);
  const startAutoRefresh = useStore((s) => s.startAutoRefresh);
  const stopAutoRefresh = useStore((s) => s.stopAutoRefresh);
  const initAuth = useStore((s) => s.initAuth);

  useEffect(() => setMounted(true), []);

  // Validate Supabase Auth session on mount
  useEffect(() => {
    initAuth();
  }, [initAuth]);

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
        showToast("Stripe connected successfully!", "success");
      } else if (stripeStatus === "pending") {
        showToast("Stripe setup started — finish onboarding in your Stripe dashboard", "info");
      } else if (stripeStatus === "error") {
        const reason = params.get("reason") || "unknown";
        showToast(`Stripe connection failed (${reason}). Check Vercel env vars.`, "error");
      }
    }
  }, []);

  useEffect(() => {
    if (user) {
      startAutoRefresh();
      return () => stopAutoRefresh();
    }
  }, [user, startAutoRefresh, stopAutoRefresh]);

  // Don't render until client-side to avoid hydration mismatch
  if (!mounted) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0a0a0f",
        }}
      >
        <h2 style={{ color: "#2E75B6", fontFamily: "Oswald" }}>Loading Creed...</h2>
      </div>
    );
  }

  if (!user) return <Login />;

  // User exists but no org — needs onboarding
  if (!user.org_id) return <Onboarding />;

  if (loading) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0a0a0f",
        }}
      >
        <h2 style={{ color: "#2E75B6", fontFamily: "Oswald" }}>Loading Creed...</h2>
      </div>
    );
  }

  return <><Toast /><ConfirmModal /><BillingGate><AppShell /></BillingGate></>;
}
