"use client";
import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import Grizz from "./Grizz";
import { tipsEnabled, tipSeen, markTipSeen, setTipsEnabled } from "@/lib/grizz";
import { t } from "@/lib/i18n";

interface Props {
  show: boolean;
}

export default function VoiceWalkTip({ show }: Props) {
  const user = useStore((s) => s.user);
  const uid = user?.id;
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (show && tipsEnabled(uid) && !tipSeen("voice_walk", uid)) {
      setVisible(true);
    }
  }, [show, uid]);

  if (!visible) return null;

  const gotIt = () => {
    markTipSeen("voice_walk", uid);
    setVisible(false);
  };

  const turnOff = () => {
    setTipsEnabled(false, uid);
    setVisible(false);
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(0,0,0,.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 12,
      }}
      onClick={() => gotIt()}
    >
      <div
        className="cd"
        style={{
          position: "relative",
          maxWidth: 380,
          pointerEvents: "auto",
          border: "1.5px solid rgba(245,180,0,.6)",
          borderRadius: 16,
          padding: "16px 14px",
          boxShadow: "0 20px 50px -8px rgba(0,0,0,.8)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <Grizz pose="wave" size={88} style={{ position: "absolute", right: -44, top: -12 }} />
        <div style={{ fontFamily: "Oswald", fontWeight: 700, fontSize: 11, letterSpacing: ".1em", textTransform: "uppercase", color: "#ffd76b", marginBottom: 6 }}>{t("vw.tipTitle")}</div>
        <div style={{ fontSize: 14.5, lineHeight: 1.5, marginBottom: 12 }}>
          <strong>{t("vw.tipHead")}</strong>
          <br />
          <br />
          {t("vw.tipThen")} <strong>{t("vw.tipBold")}</strong> {t("vw.tipBody")}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <span onClick={turnOff} style={{ fontSize: 11.5, color: "var(--color-dim)", cursor: "pointer", userSelect: "none" }}>{t("tip.dontShow")}</span>
          <button
            onClick={gotIt}
            style={{
              fontFamily: "Oswald",
              fontWeight: 600,
              fontSize: 12,
              letterSpacing: ".3px",
              textTransform: "uppercase",
              color: "#1a1305",
              background: "#ffd76b",
              border: "none",
              borderRadius: 9,
              padding: "8px 18px",
              cursor: "pointer",
            }}
          >
            {t("tip.gotIt")}
          </button>
        </div>
      </div>
    </div>
  );
}
