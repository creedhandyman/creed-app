"use client";
import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { Icon } from "./Icon";
import Grizz from "./Grizz";
import { gsDismissed, dismissGs, tipsEnabled } from "@/lib/grizz";

/**
 * Dashboard "Getting Started" card (owner/admin only). Four activation tasks
 * whose completion is DERIVED FROM REAL DATA — so it self-checks as the owner
 * actually does the work (no per-task booleans stored). Each row deep-links to
 * the relevant screen.
 *
 * It disappears for good once (a) the × is tapped, or (b) all four are done —
 * in which case it shows a one-time "You're rolling!" celebration with confetti,
 * then never renders again (persisted via gs_dismissed). Hidden entirely when
 * the global "Show Grizz tips" switch is off.
 */

const CONFETTI = [
  { cx: "-66px", cy: "76px", c: "#ffd76b" }, { cx: "58px", cy: "62px", c: "#9d4edd" },
  { cx: "-34px", cy: "94px", c: "#3ee08f" }, { cx: "72px", cy: "98px", c: "#7fb6ff" },
  { cx: "12px", cy: "56px", c: "#ff8aa8" }, { cx: "-82px", cy: "112px", c: "#3ee08f" },
  { cx: "44px", cy: "122px", c: "#ffd76b" }, { cx: "-14px", cy: "72px", c: "#7fb6ff" },
];

export default function GettingStarted({
  setPage,
  openOps,
}: {
  setPage: (p: string) => void;
  openOps: (tab?: string) => void;
}) {
  const user = useStore((s) => s.user)!;
  const org = useStore((s) => s.org);
  const jobs = useStore((s) => s.jobs);
  const profiles = useStore((s) => s.profiles);
  const uid = user.id;

  // Hidden until the client-side flag check runs (avoids a flash on load).
  const [dismissed, setDismissed] = useState(true);
  useEffect(() => { setDismissed(gsDismissed(uid) || !tipsEnabled(uid)); }, [uid]);

  const tasks = [
    { key: "logo", label: "Add your business logo", done: !!org?.logo_url, go: () => openOps("settings") },
    { key: "quote", label: "Create your first quote", done: jobs.length >= 1, go: () => setPage("qf") },
    { key: "stripe", label: "Connect Stripe to get paid", done: org?.stripe_connected === true, go: () => openOps("billing") },
    { key: "crew", label: "Invite your crew", done: profiles.length >= 2, go: () => openOps("team") },
  ];
  const doneCount = tasks.filter((t) => t.done).length;
  const allDone = doneCount === tasks.length;

  // First time all four are done: persist dismissal so it never returns, show
  // the celebration, then auto-collapse it after a beat (with a manual × too)
  // so it doesn't sit on the dashboard forever for an already-set-up account.
  useEffect(() => {
    if (!allDone || !tipsEnabled(uid) || gsDismissed(uid)) return;
    dismissGs(uid);
    const id = setTimeout(() => setDismissed(true), 4000);
    return () => clearTimeout(id);
  }, [allDone, uid]);

  if (dismissed) return null;

  const cardStyle: React.CSSProperties = {
    border: "1px solid rgba(46,117,182,.45)",
    background: "linear-gradient(135deg,rgba(46,117,182,.14),rgba(46,117,182,.03))",
    borderRadius: 16,
    padding: 13,
    marginBottom: 14,
    boxShadow: "0 0 22px -8px rgba(46,117,182,.5)",
  };

  return (
    <div style={cardStyle}>
      <style>{`
        .gs-conf{position:absolute;top:0;left:50%;width:7px;height:10px;border-radius:1px;opacity:0;animation:gsConf 1.1s forwards}
        @keyframes gsConf{0%{opacity:1;transform:translate(0,0) rotate(0)}100%{opacity:0;transform:translate(var(--cx),var(--cy)) rotate(260deg)}}
        @media (prefers-reduced-motion:reduce){.gs-conf{display:none}}
      `}</style>

      {allDone ? (
        <div style={{ position: "relative", textAlign: "center", padding: "8px 4px" }}>
          <button onClick={() => { dismissGs(uid); setDismissed(true); }} aria-label="Hide" style={{ position: "absolute", top: -2, right: -2, background: "none", border: "none", color: "var(--color-dim)", cursor: "pointer", fontSize: 18, lineHeight: 1, padding: 4, zIndex: 1 }}>×</button>
          {CONFETTI.map((c, i) => (
            <span key={i} className="gs-conf" style={{ ["--cx"]: c.cx, ["--cy"]: c.cy, background: c.c, left: `${44 + i}%` } as React.CSSProperties} />
          ))}
          <Grizz pose="cheer" size={52} style={{ margin: "0 auto", display: "block" }} />
          <div style={{ fontFamily: "Oswald", fontWeight: 600, fontSize: 15, textTransform: "uppercase", marginTop: 6 }}>You&apos;re rolling! 🎉</div>
          <div style={{ fontSize: 12, color: "var(--color-dim)", marginTop: 4 }}>Nice work. I&apos;ll be in <b>Ask Grizz</b> if you need me.</div>
        </div>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 9 }}>
            <Grizz pose="point" size={40} style={{ marginTop: -6, flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: "Oswald", fontWeight: 600, fontSize: 14, letterSpacing: ".3px", textTransform: "uppercase" }}>Get set up with Grizz</div>
              <div style={{ fontSize: 11, color: "var(--color-primary)" }}>{doneCount} of {tasks.length} done</div>
            </div>
            <button onClick={() => { dismissGs(uid); setDismissed(true); }} aria-label="Hide" style={{ background: "none", border: "none", color: "var(--color-dim)", cursor: "pointer", fontSize: 18, lineHeight: 1, padding: 2 }}>×</button>
          </div>

          <div style={{ height: 6, borderRadius: 3, background: "var(--color-border-dark)", overflow: "hidden", marginBottom: 11 }}>
            <div style={{ height: "100%", width: `${(doneCount / tasks.length) * 100}%`, background: "linear-gradient(90deg,#2E75B6,#7fb6ff)", borderRadius: 3, transition: "width .5s cubic-bezier(.2,.8,.2,1)" }} />
          </div>

          {tasks.map((task) => (
            <div
              key={task.key}
              onClick={task.done ? undefined : task.go}
              style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 6px", borderRadius: 9, cursor: task.done ? "default" : "pointer" }}
            >
              <span style={{ width: 21, height: 21, borderRadius: 6, border: `1.6px solid ${task.done ? "var(--color-success)" : "var(--color-border-dark-2)"}`, background: task.done ? "var(--color-success)" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                {task.done && <Icon name="check" size={12} color="#fff" />}
              </span>
              <span style={{ fontSize: 13.5, flex: 1, color: task.done ? "var(--color-dim)" : "inherit", textDecoration: task.done ? "line-through" : "none" }}>{task.label}</span>
              {!task.done && <Icon name="next" size={15} color="var(--color-dim)" />}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
