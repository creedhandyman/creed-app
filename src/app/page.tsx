"use client";
import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import Login from "@/components/Login";
import AppShell from "@/components/AppShell";

export default function Home() {
  const [mounted, setMounted] = useState(false);
  const user = useStore((s) => s.user);
  const loading = useStore((s) => s.loading);
  const startAutoRefresh = useStore((s) => s.startAutoRefresh);
  const stopAutoRefresh = useStore((s) => s.stopAutoRefresh);

  useEffect(() => setMounted(true), []);

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

  return <AppShell />;
}
