"use client";
import { useEffect, useState, type ReactNode } from "react";
import { useStore } from "@/lib/store";
import Grizz from "./Grizz";
import { tipsEnabled, tipSeen, markTipSeen, setTipsEnabled } from "@/lib/grizz";

/**
 * One-time Grizz coachmark — he peeks from the bottom-left corner with a single
 * tip pointing at the screen's primary action. Shows ONCE per tip id (persisted
 * in localStorage), and never when the global "Show Grizz tips" switch is off.
 *
 * Mounted per-page in AppShell (not inside the big screen components), so it
 * only fires on screen ENTRY — never mid-task — and the screens stay untouched.
 * "Got it" acknowledges this tip; "Don't show tips" flips the global switch.
 */
export default function Coachmark({ id, text }: { id: string; text: ReactNode }) {
  const user = useStore((s) => s.user);
  const uid = user?.id;
  const [show, setShow] = useState(false);

  // Client-only check (localStorage) — also avoids a hydration flash.
  useEffect(() => {
    setShow(tipsEnabled(uid) && !tipSeen(id, uid));
  }, [id, uid]);

  if (!show) return null;

  const gotIt = () => { markTipSeen(id, uid); setShow(false); };
  const turnOff = () => { setTipsEnabled(false, uid); setShow(false); };

  return (
    <div
      className="grizz-coach"
      style={{
        position: "fixed",
        left: 12,
        right: 12,
        bottom: "calc(96px + env(safe-area-inset-bottom,0px))",
        zIndex: 60,
        maxWidth: 430,
        margin: "0 auto",
        pointerEvents: "none",
      }}
    >
      <style>{`
        .grizz-coach{animation:grizzCoachIn .35s ease-out both}
        @keyframes grizzCoachIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
        @media (prefers-reduced-motion:reduce){.grizz-coach{animation:none}}
      `}</style>
      <div
        className="cd"
        style={{
          position: "relative",
          marginLeft: 66,
          pointerEvents: "auto",
          border: "1px solid rgba(245,180,0,.5)",
          borderRadius: 14,
          padding: "12px 13px",
          boxShadow: "0 12px 34px -12px rgba(0,0,0,.7)",
        }}
      >
        <Grizz pose="point" size={76} style={{ position: "absolute", left: -64, bottom: -8 }} />
        <div style={{ fontFamily: "Oswald", fontWeight: 600, fontSize: 10, letterSpacing: ".1em", textTransform: "uppercase", color: "#ffd76b", marginBottom: 3 }}>Grizz</div>
        <div style={{ fontSize: 13.5, lineHeight: 1.45 }}>{text}</div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10 }}>
          <span onClick={turnOff} style={{ fontSize: 11.5, color: "var(--color-dim)", cursor: "pointer" }}>Don&apos;t show tips</span>
          <button onClick={gotIt} style={{ fontFamily: "Oswald", fontWeight: 600, fontSize: 12, letterSpacing: ".3px", textTransform: "uppercase", color: "#1a1305", background: "#ffd76b", border: "none", borderRadius: 9, padding: "7px 16px", cursor: "pointer" }}>Got it</button>
        </div>
      </div>
    </div>
  );
}
