"use client";
import { useEffect, useState } from "react";
import { Icon } from "./Icon";

// Android Chrome fires `beforeinstallprompt` once the PWA is installable; we
// capture it and show our own banner — far better install rate than the hidden
// browser menu. Hidden once installed (standalone display) or dismissed.
// (iOS Safari doesn't fire this event; that's fine — we're Android-first.)
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISS_KEY = "creed_install_dismissed";

export default function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const standalone =
      window.matchMedia?.("(display-mode: standalone)").matches ||
      (navigator as unknown as { standalone?: boolean }).standalone === true;
    if (standalone || localStorage.getItem(DISMISS_KEY) === "1") return;

    const onPrompt = (e: Event) => {
      e.preventDefault(); // suppress Chrome's mini-infobar; show our own
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setDeferred(null);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (!deferred) return null;

  const install = async () => {
    const e = deferred;
    setDeferred(null);
    try {
      await e.prompt();
      await e.userChoice;
    } catch {
      /* user dismissed / unavailable */
    }
  };
  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, "1");
    setDeferred(null);
  };

  return (
    <div
      style={{
        position: "fixed", left: 12, right: 12, bottom: 16, zIndex: 1200,
        maxWidth: 440, margin: "0 auto", display: "flex", alignItems: "center", gap: 11,
        padding: "11px 13px", borderRadius: 14,
        background: "var(--color-card-dark)", border: "1px solid var(--color-primary)",
        boxShadow: "0 14px 44px rgba(0,0,0,.55)",
      }}
    >
      <img src="/icons/icon-192.png" alt="" style={{ width: 40, height: 40, borderRadius: 10, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 14.5 }}>Install Creed</div>
        <div className="dim" style={{ fontSize: 12.5, lineHeight: 1.35 }}>Home-screen app — full screen, faster, gets push alerts.</div>
      </div>
      <button onClick={dismiss} aria-label="Dismiss" style={{ background: "none", border: "none", color: "var(--color-dim)", cursor: "pointer", padding: 4, flexShrink: 0, display: "inline-flex" }}>
        <Icon name="close" size={16} />
      </button>
      <button className="bb" onClick={install} style={{ flexShrink: 0, padding: "8px 14px" }}>Install</button>
    </div>
  );
}
