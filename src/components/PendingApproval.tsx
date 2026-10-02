"use client";
import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import Grizz from "./Grizz";

/**
 * Shown to someone who asked to join a business (invite link → Join a team)
 * until an owner/manager approves them in Ops → Team. The database gives a
 * pending member nothing of the business (RLS via auth_org_id()), so there's
 * nothing to show yet. Re-checks every 15s and on "Check again"; the root
 * page swaps to the app the moment their status flips to active. If the
 * owner declines, the profile is deleted and initAuth routes them back to
 * onboarding.
 */
export default function PendingApproval() {
  const user = useStore((s) => s.user)!;
  const org = useStore((s) => s.org);
  const initAuth = useStore((s) => s.initAuth);
  const logout = useStore((s) => s.logout);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    const id = setInterval(() => { void initAuth(); }, 15000);
    return () => clearInterval(id);
  }, [initAuth]);

  const checkNow = async () => {
    setChecking(true);
    await initAuth();
    setChecking(false);
    if (useStore.getState().user?.status === "pending") {
      useStore.getState().showToast("Still waiting — your boss hasn't approved you yet.", "info");
    }
  };

  const biz = org?.name || "the business";

  return (
    <div style={{ minHeight: "100dvh", background: "radial-gradient(900px 520px at 50% -6%,#13284c 0%,#0a0a0f 60%)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, color: "#f1f2f6" }}>
      <div style={{ width: "100%", maxWidth: 400, textAlign: "center" }}>
        <Grizz pose="wave" bob style={{ margin: "0 auto", display: "block" }} />
        <h2 style={{ fontFamily: "Oswald, sans-serif", fontSize: 24, textTransform: "uppercase", margin: "14px 0 8px", letterSpacing: ".04em" }}>
          Waiting for approval
        </h2>
        <p style={{ fontSize: 15.5, color: "#b5b5c0", lineHeight: 1.55, marginBottom: 6 }}>
          Thanks, {user.name.split(" ")[0]}! We let <b style={{ color: "#f1f2f6" }}>{biz}</b> know you want to join.
        </p>
        <p style={{ fontSize: 14, color: "#8b8b99", lineHeight: 1.55, marginBottom: 22 }}>
          As soon as the owner approves you, the app opens right here — you can leave this screen open or come back later.
        </p>
        <button className="bb" onClick={checkNow} disabled={checking} style={{ width: "100%", padding: 13, fontSize: 15, marginBottom: 10 }}>
          {checking ? "Checking…" : "Check again"}
        </button>
        <button className="bo" onClick={() => { logout(); }} style={{ width: "100%", padding: 11, fontSize: 14 }}>
          Sign out
        </button>
        <p style={{ fontSize: 12.5, color: "#666", marginTop: 16 }}>
          Joined the wrong business? Sign out and ask your boss for a new invite link.
        </p>
      </div>
    </div>
  );
}
