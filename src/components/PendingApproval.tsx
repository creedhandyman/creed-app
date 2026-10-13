"use client";
import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import Grizz from "./Grizz";
import { t } from "@/lib/i18n";

/**
 * Shown to someone who asked to join a business (invite link → Join a team)
 * until an owner/manager approves them in Ops → Team. The database gives a
 * pending member nothing of the business (RLS via auth_org_id()), so there's
 * nothing to show yet. Re-checks every 15s and on "Check again"; the root
 * page swaps to the app the moment their status flips to active. If the
 * owner declines, the profile is deleted and initAuth routes them back to
 * onboarding. Translated (pa.*) — joiners are often Spanish-phone crew.
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
      useStore.getState().showToast(t("pa.stillWaiting"), "info");
    }
  };

  const biz = org?.name || t("pa.theBusiness");
  // "Thanks, {name}! We let {biz} know…" — split on {biz} so it can be bold.
  const [thanksPre, thanksPost = ""] = t("pa.thanks").replace("{name}", user.name.split(" ")[0]).split("{biz}");

  return (
    <div style={{ minHeight: "100dvh", background: "radial-gradient(900px 520px at 50% -6%,#13284c 0%,#0a0a0f 60%)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, color: "#f1f2f6" }}>
      <div style={{ width: "100%", maxWidth: 400, textAlign: "center" }}>
        <Grizz pose="wave" bob style={{ margin: "0 auto", display: "block" }} />
        <h2 style={{ fontFamily: "Oswald, sans-serif", fontSize: 24, textTransform: "uppercase", margin: "14px 0 8px", letterSpacing: ".04em" }}>
          {t("pa.title")}
        </h2>
        <p style={{ fontSize: 15.5, color: "#b5b5c0", lineHeight: 1.55, marginBottom: 6 }}>
          {thanksPre}<b style={{ color: "#f1f2f6" }}>{biz}</b>{thanksPost}
        </p>
        <p style={{ fontSize: 14, color: "#8b8b99", lineHeight: 1.55, marginBottom: 22 }}>
          {t("pa.body")}
        </p>
        <button className="bb" onClick={checkNow} disabled={checking} style={{ width: "100%", padding: 13, fontSize: 15, marginBottom: 10 }}>
          {checking ? t("pa.checking") : t("pa.checkAgain")}
        </button>
        <button className="bo" onClick={() => { logout(); }} style={{ width: "100%", padding: 11, fontSize: 14 }}>
          {t("pa.signOut")}
        </button>
        <p style={{ fontSize: 12.5, color: "#666", marginTop: 16 }}>
          {t("pa.wrongBiz")}
        </p>
      </div>
    </div>
  );
}
