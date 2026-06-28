"use client";
import { useState, useEffect } from "react";
import { useStore } from "@/lib/store";
import { db } from "@/lib/supabase";
import type { Organization, Profile } from "@/lib/types";
import { Icon } from "./Icon";
import Grizz from "./Grizz";
import { TRADE_IDS, tradeConfig, tradePatch } from "@/lib/trades";

/**
 * Guided onboarding led by Grizz, the handyman-bear mascot. Eight steps walk a
 * new owner from setup through the whole job flow (quote → schedule → work →
 * paid) so they understand the app before landing in it.
 *
 * This is a wrapper + explainer around the EXISTING data path — createBusiness /
 * joinBusiness do the same org/profile inserts as before. The one change in
 * timing: we stash the created rows locally and only flip the store
 * (setOrg/setUser, which unmounts onboarding into the app) at the final step,
 * so the tour can keep showing after the business is created.
 *
 * Steps: 0 welcome · 1 setup (the real form) · 2 trade picker · 3 quote ·
 * 4 schedule · 5 work mode · 6 get paid · 7 done. Steps 3–6 are purely
 * educational; the trade picker (2) only shows when CREATING a business —
 * joiners skip it and inherit the org's existing trade.
 */

const TOTAL = 8;

export default function Onboarding() {
  const user = useStore((s) => s.user)!;
  const setUser = useStore((s) => s.setUser);
  const setOrg = useStore((s) => s.setOrg);

  // ── Setup form (Step 1) — same inputs the bare form collected, trimmed to
  // the essentials the mockup shows. Name required; phone/city optional.
  const [mode, setMode] = useState<"create" | "join">("create");
  const [bizName, setBizName] = useState("");
  const [phone, setPhone] = useState("");
  const [city, setCity] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  // Primary trade chosen on step 2 (create flow only). Defaults to handyman
  // so the multi-trade behavior is unchanged if the user skips the pick.
  const [selectedTrade, setSelectedTrade] = useState("handyman");

  // ── Tour state. createdBiz holds the freshly inserted rows so the tour keeps
  // rendering; finish() applies them to the store to enter the app.
  const [stepIdx, setStepIdx] = useState(0);
  const [createdBiz, setCreatedBiz] = useState<{ org: Organization; profile: Profile } | null>(null);
  const created = createdBiz !== null;

  // ── Quote-total count-up for the quote demo (stepIdx 3, "Step 1 of 4").
  const [quoteVal, setQuoteVal] = useState(0);
  useEffect(() => {
    if (stepIdx !== 3) { setQuoteVal(0); return; }
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) { setQuoteVal(8450); return; }
    let raf = 0;
    const to = 8450, dur = 1300, t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / dur);
      const e = 1 - Math.pow(1 - p, 3);
      setQuoteVal(Math.round(to * e));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [stepIdx]);

  // ── Data path (UNCHANGED inserts). On success, stash + advance into the tour
  // instead of flipping the store immediately.
  const createBusiness = async () => {
    if (!bizName.trim()) { setErr("Enter your business name"); return; }
    setSaving(true);
    setErr("");
    try {
      const orgResult = await db.post<Organization>("organizations", {
        name: bizName.trim(),
        phone,
        email: user.email,
        license_num: "",
        address: city,
        default_rate: 55,
        primary_trade: "handyman",
        trial_start: new Date().toISOString(),
        subscription_status: "trial",
      });
      if (!orgResult?.length) { setErr("Failed to create business"); setSaving(false); return; }
      const org = orgResult[0];

      const profileResult = await db.post<Profile>("profiles", {
        id: user.id,
        email: user.email,
        name: user.name,
        role: "owner",
        rate: 55,
        start_date: new Date().toISOString().split("T")[0],
        emp_num: "001",
        org_id: org.id,
      });
      if (!profileResult?.length) { setErr("Failed to create profile"); setSaving(false); return; }

      setCreatedBiz({ org, profile: profileResult[0] });
      setSaving(false);
      setStepIdx(2);
    } catch (e) {
      setErr("Something went wrong");
      console.error(e);
      setSaving(false);
    }
  };

  const joinBusiness = async () => {
    if (!inviteCode.trim()) { setErr("Enter an invite code"); return; }
    setSaving(true);
    setErr("");
    try {
      const orgs = await db.get<Organization>("organizations", { id: inviteCode.trim() });
      if (!orgs.length) { setErr("Business not found — check the invite code"); setSaving(false); return; }
      const org = orgs[0];

      const profileResult = await db.post<Profile>("profiles", {
        id: user.id,
        email: user.email,
        name: user.name,
        role: "tech",
        rate: org.default_rate || 35,
        start_date: new Date().toISOString().split("T")[0],
        emp_num: String(Math.floor(Math.random() * 900) + 100),
        org_id: org.id,
      });
      if (!profileResult?.length) { setErr("Failed to join — you may already be a member"); setSaving(false); return; }

      setCreatedBiz({ org, profile: profileResult[0] });
      setSaving(false);
      setStepIdx(3); // skip the trade picker — joiners inherit the org's trade
    } catch (e) {
      setErr("Something went wrong");
      console.error(e);
      setSaving(false);
    }
  };

  // Persist the chosen trade to the created org (create flow, step 2).
  // Best-effort: db.patch toasts its own errors. Also updates the stashed
  // org so finish()/the back button reflect the pick. tradePatch seeds
  // default_rate + (for clean-match trades) trade_rates without clobbering.
  const saveTrade = async () => {
    if (!createdBiz || mode !== "create") return;
    const patch = tradePatch(selectedTrade, createdBiz.org.trade_rates);
    await db.patch("organizations", createdBiz.org.id, patch);
    setCreatedBiz((prev) => (prev ? { ...prev, org: { ...prev.org, ...patch } } : prev));
  };

  // Apply the created rows to the store → the no-org gate now sees an org and
  // renders the app. Never enter the app without having created/joined. For a
  // create flow we merge the trade patch in so the app boots with the right
  // rate/trade even if the DB write hasn't round-tripped yet.
  const finish = () => {
    if (!createdBiz) { setStepIdx(1); return; }
    const org = mode === "create"
      ? { ...createdBiz.org, ...tradePatch(selectedTrade, createdBiz.org.trade_rates) }
      : createdBiz.org;
    setOrg(org);
    setUser(createdBiz.profile);
  };

  // Once created, can't walk back into setup (avoids a double-insert). Joiners
  // also can't reach the trade picker (step 2) they skipped past.
  const minStep = created ? (mode === "join" ? 3 : 2) : 0;
  const back = () => setStepIdx((i) => Math.max(minStep, i - 1));
  const skip = () => {
    if (created && mode === "create" && stepIdx === 2) void saveTrade();
    return created ? finish() : setStepIdx(1);
  };
  const onPrimary = () => {
    if (saving) return;
    if (stepIdx === 0) return setStepIdx(1);
    if (stepIdx === 1) return mode === "create" ? createBusiness() : joinBusiness();
    if (stepIdx === 2) { void saveTrade(); return setStepIdx(3); }
    if (stepIdx === 7) return finish();
    setStepIdx((i) => Math.min(TOTAL - 1, i + 1));
  };

  const primaryLabel =
    stepIdx === 0 ? "Get started"
    : stepIdx === 1 ? (saving ? (mode === "create" ? "Creating…" : "Joining…") : mode === "create" ? "Create my business" : "Join team")
    : stepIdx === 2 ? "Continue"
    : stepIdx === 7 ? "Start my first quote"
    : "Next";

  const showSkip = stepIdx !== 1 && stepIdx !== 7;
  const trade = tradeConfig(selectedTrade); // live preview on the step-2 picker

  return (
    <div style={{ minHeight: "100dvh", background: "radial-gradient(900px 520px at 50% -6%,#13284c 0%,#0a0a0f 60%)", display: "flex", justifyContent: "center", color: "#f1f2f6" }}>
      <style>{OB_CSS}</style>
      <div style={{ width: "100%", maxWidth: 430, display: "flex", flexDirection: "column" }}>

        {/* Skip */}
        <div style={{ display: "flex", justifyContent: "flex-end", minHeight: 18, padding: "13px 22px 0" }}>
          {showSkip && (
            <span onClick={skip} style={{ fontSize: 12, color: "#666", cursor: "pointer" }}>Skip tour</span>
          )}
        </div>

        {/* Progress */}
        <div style={{ display: "flex", gap: 5, padding: "8px 22px 6px" }}>
          {Array.from({ length: TOTAL }).map((_, i) => (
            <span key={i} className={"ob-pi" + (i <= stepIdx ? " on" : "")} />
          ))}
        </div>

        {/* Body — only the active step is mounted, keyed so animations replay. */}
        <div style={{ flex: 1, display: "flex", overflowY: "auto" }}>
          <div key={stepIdx} className="ob-step" style={{ flex: 1, display: "flex", flexDirection: "column", width: "100%", padding: "6px 24px 0" }}>

            {/* 0 — WELCOME */}
            {stepIdx === 0 && (
              <>
                <Grizz pose="wave" bob style={{ margin: "2px auto 0", display: "block" }} />
                <div className="ob-speech">
                  <div className="ob-who">Grizz · your job-site buddy</div>
                  <p>{"Hey there! I'm "}<b>Grizz</b>{". Give me about a minute and I'll get Creed set up and show you how a whole job runs — from "}<b>photo to paid</b>{"."}</p>
                </div>
                <h2 className="ob-h2" style={{ marginTop: "auto", paddingBottom: 10 }}>Welcome to <span className="ob-g">Creed</span></h2>
              </>
            )}

            {/* 1 — SETUP (the real form) */}
            {stepIdx === 1 && (
              <>
                <Grizz pose="point" size={118} style={{ margin: "2px auto 0", display: "block" }} />
                <div className="ob-speech">
                  <div className="ob-who">Grizz</div>
                  <p>{mode === "create"
                    ? "First — what's your business called? That's the only thing I really need. The rest you can add later."
                    : "Joining a crew? Paste the invite code your boss gave you — it's in their Team settings."}</p>
                </div>

                <div className="ob-toggle">
                  <button className={mode === "create" ? "on" : ""} onClick={() => { setMode("create"); setErr(""); }}>Create business</button>
                  <button className={mode === "join" ? "on" : ""} onClick={() => { setMode("join"); setErr(""); }}>Join a team</button>
                </div>

                {mode === "create" ? (
                  <>
                    <div className="ob-field">
                      <label>Business name *</label>
                      <input value={bizName} onChange={(e) => setBizName(e.target.value)} placeholder="e.g. Creed Handyman LLC" />
                    </div>
                    <div className="ob-field">
                      <label>Phone <span className="ob-opt">· optional</span></label>
                      <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(555) 123-4567" inputMode="tel" />
                    </div>
                    <div className="ob-field">
                      <label>City <span className="ob-opt">· optional</span></label>
                      <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Wichita, KS" />
                    </div>
                  </>
                ) : (
                  <div className="ob-field">
                    <label>Invite code</label>
                    <input value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} placeholder="Paste invite code here" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
                  </div>
                )}

                {err && <div style={{ color: "#ff8888", fontSize: 13, marginTop: 10, textAlign: "center" }}>{err}</div>}
              </>
            )}

            {/* 2 — TRADE PICKER (create flow only; joiners skip to step 3) */}
            {stepIdx === 2 && (
              <>
                <Grizz pose="point" size={92} style={{ margin: "2px auto 0", display: "block" }} />
                <div className="ob-speech">
                  <div className="ob-who">Grizz</div>
                  <p>{trade.grizzLine}</p>
                </div>

                <h2 className="ob-h2" style={{ fontSize: 19, textAlign: "left", marginTop: 14 }}>What&apos;s your trade?</h2>
                <div style={{ fontSize: 12.5, color: "#9a9aa8", marginTop: 2, marginBottom: 10 }}>
                  Tunes your rate, materials, checklist, and units. You can change it anytime in Settings.
                </div>

                <div className="ob-trades">
                  {TRADE_IDS.map((id) => {
                    const tc = tradeConfig(id);
                    return (
                      <button
                        key={id}
                        type="button"
                        className={"ob-tile" + (selectedTrade === id ? " on" : "")}
                        onClick={() => setSelectedTrade(id)}
                      >
                        <span className="ic"><Icon name={tc.icon} size={18} color="#7fb6ff" /></span>
                        <span className="nm">{tc.name}</span>
                      </button>
                    );
                  })}
                </div>

                <div className="ob-tpreview">
                  <div className="ob-who" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <Icon name="sparkle" size={13} color="#7fb6ff" /> I&apos;ll set up for you
                  </div>
                  <div className="ob-chips">
                    <span className="ob-chip">Default rate <b>${trade.defaultRate}/hr</b></span>
                    <span className="ob-chip">Units <b>{trade.units}</b></span>
                    <span className="ob-chip">{trade.name} checklist <b>✓</b></span>
                  </div>
                  <div className="ob-starter">
                    {trade.starterItems.map((it) => (
                      <div className="it" key={it}><span className="d" />{it}</div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* 3 — QUOTE */}
            {stepIdx === 3 && (
              <>
                <div className="ob-speech" style={{ marginTop: 4 }}>
                  <div className="ob-who">Step 1 of 4 · Grizz</div>
                  <p>{"A lead comes in. "}<b>Snap a few photos</b>{" or talk through the place — I'll write the "}<b>itemized quote</b>{" for you in seconds."}</p>
                </div>
                <div className="ob-demo">
                  <div className="ob-stepnum"><span className="b"><Icon name="sparkle" size={13} color="#7fb6ff" /></span> AI Quote</div>
                  <div className="ob-qtotal">${quoteVal.toLocaleString()}</div>
                  <div className="ob-qli"><span><span className="ob-dot" style={{ background: "#9d4edd" }} />Flooring — LVP</span><b>$1,240</b></div>
                  <div className="ob-qli"><span><span className="ob-dot" style={{ background: "#ff8800" }} />Repaint walls</span><b>$1,980</b></div>
                  <div className="ob-qli"><span><span className="ob-dot" style={{ background: "#00cc66" }} />New vanity + blinds</span><b>$1,180</b></div>
                </div>
              </>
            )}

            {/* 4 — SCHEDULE */}
            {stepIdx === 4 && (
              <>
                <div className="ob-speech" style={{ marginTop: 4 }}>
                  <div className="ob-who">Step 2 of 4 · Grizz</div>
                  <p>{"Customer says yes? "}<b>Drop it on the calendar</b>{" and assign your crew. Everyone sees where to be."}</p>
                </div>
                <div className="ob-demo">
                  <div className="ob-stepnum"><span className="b"><Icon name="schedule" size={13} color="#7fb6ff" /></span> Schedule</div>
                  <div className="ob-cal">
                    <div className="d">M</div>
                    <div className="d pick">T<span style={{ fontSize: 8 }}>9a</span></div>
                    <div className="d">W</div><div className="d">T</div><div className="d">F</div>
                  </div>
                  <div className="ob-crew">
                    <span>Crew:</span><span className="ob-av">JM</span><span className="ob-av">DR</span> assigned · 5.0h
                  </div>
                </div>
              </>
            )}

            {/* 5 — WORK MODE */}
            {stepIdx === 5 && (
              <>
                <div className="ob-speech" style={{ marginTop: 4 }}>
                  <div className="ob-who">Step 3 of 4 · Grizz</div>
                  <p>{"On site, open "}<b>Work Mode</b>{". Your checklist, photos, and time clock in one screen — tick off tasks, snap before/afters, and your hours roll "}<b>straight to payroll</b>{"."}</p>
                </div>
                <div className="ob-demo">
                  <div className="ob-stepnum"><span className="b"><Icon name="list" size={13} color="#7fb6ff" /></span> Work Mode · WorkVision</div>
                  {["Kitchen — replace flooring", "Bath — new vanity", "Living — paint walls"].map((task) => (
                    <div className="ob-wo" key={task}>
                      <span className="ob-tick"><Icon name="check" size={12} color="#fff" /></span>
                      <span>{task}</span>
                    </div>
                  ))}
                  <div className="ob-clock">
                    <span><Icon name="time" size={12} color="#7dffb8" style={{ verticalAlign: -2, marginRight: 4 }} />Clocked in · 4h 12m</span>
                    <span>→ payroll</span>
                  </div>
                </div>
              </>
            )}

            {/* 6 — GET PAID */}
            {stepIdx === 6 && (
              <>
                <div className="ob-speech" style={{ marginTop: 4 }}>
                  <div className="ob-who">Step 4 of 4 · Grizz</div>
                  <p>{"They "}<b>sign, pay a deposit</b>{", and follow a live status page. When it's done, you get paid through Stripe — money in your account."}</p>
                </div>
                <div className="ob-demo">
                  <div className="ob-stepnum"><span className="b"><Icon name="money" size={13} color="#7fb6ff" /></span> Get Paid</div>
                  <div className="ob-tl">
                    <div className="stp a"><span className="dot">✓</span> Signed &amp; deposit paid</div>
                    <div className="ln" style={{ marginLeft: 7 }} />
                    <div className="stp b"><span className="dot">✓</span> Job complete</div>
                    <div className="ln" style={{ marginLeft: 7 }} />
                    <div className="stp c"><span className="dot">$</span> Paid out</div>
                  </div>
                  <div className="ob-paid">Paid · $8,450</div>
                </div>
              </>
            )}

            {/* 7 — DONE */}
            {stepIdx === 7 && (
              <>
                <Grizz pose="cheer" bob style={{ margin: "2px auto 0", display: "block" }} />
                {[
                  { bx: "-70px", by: "90px", c: "#ffd76b" },
                  { bx: "60px", by: "80px", c: "#9d4edd" },
                  { bx: "-40px", by: "120px", c: "#3ee08f" },
                  { bx: "80px", by: "120px", c: "#7fb6ff" },
                  { bx: "0px", by: "70px", c: "#ff8aa8" },
                ].map((b, i) => (
                  <span key={i} className="ob-burst" style={{ ["--bx"]: b.bx, ["--by"]: b.by, background: b.c } as React.CSSProperties} />
                ))}
                <div className="ob-speech">
                  <div className="ob-who">Grizz</div>
                  <p>{"That's the whole loop — "}<b>quote, schedule, work, paid</b>{". You're all set. Let's go quote your first job!"}</p>
                </div>
                <h2 className="ob-h2" style={{ marginTop: "auto", paddingBottom: 10 }}>{"You're "}<span className="ob-g">ready</span> 🎉</h2>
              </>
            )}

          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: "14px 22px calc(22px + env(safe-area-inset-bottom,0px))", display: "flex", gap: 10 }}>
          {stepIdx > minStep && (
            <button className="ob-btn ob-back" onClick={back} aria-label="Back">
              <Icon name="back" size={18} color="#9a9aa8" />
            </button>
          )}
          <button className="ob-btn ob-next" onClick={onPrimary} disabled={saving}>
            {primaryLabel}
            <Icon name={stepIdx === 7 ? "party" : "next"} size={16} color="#7dffb8" />
          </button>
        </div>
      </div>
    </div>
  );
}

const OB_CSS = `
.ob-pi{flex:1;height:4px;border-radius:2px;background:#22222e;transition:.4s}
.ob-pi.on{background:linear-gradient(90deg,#2E75B6,#7fb6ff);box-shadow:0 0 8px -1px rgba(46,139,255,.7)}
.ob-step{position:relative;animation:obSlide .45s cubic-bezier(.2,.8,.2,1) both}
@keyframes obSlide{from{opacity:0;transform:translateX(26px)}to{opacity:1;transform:none}}
.ob-speech{background:#12121a;border:1px solid #2a2a3a;border-radius:16px;padding:14px 16px;margin:12px 0 0;position:relative}
.ob-speech::before{content:"";position:absolute;top:-9px;left:50%;transform:translateX(-50%);border-left:9px solid transparent;border-right:9px solid transparent;border-bottom:9px solid #12121a}
.ob-who{font-family:Oswald,sans-serif;font-weight:600;font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#7fb6ff;margin-bottom:4px}
.ob-speech p{font-size:15px;line-height:1.5;color:#e6e8ee}
.ob-speech b{color:#fff}
.ob-h2{font-family:Oswald,sans-serif;font-weight:700;font-size:26px;letter-spacing:.4px;text-transform:uppercase;text-align:center;line-height:1.1}
.ob-g{background:linear-gradient(90deg,#7fb6ff,#3ee08f);-webkit-background-clip:text;background-clip:text;color:transparent}
.ob-field{margin-top:11px}
.ob-field label{font-size:11px;font-weight:600;color:#9a9aa8;text-transform:uppercase;letter-spacing:.06em;display:block;margin-bottom:6px}
.ob-field input{width:100%;background:#0d0d15;border:1px solid #2a2a3a;border-radius:11px;padding:13px 14px;color:#f1f2f6;font-size:15px;font-family:inherit}
.ob-field input:focus{outline:none;border-color:#2E75B6;box-shadow:0 0 0 3px rgba(46,117,182,.2)}
.ob-opt{font-size:11px;color:#666;font-weight:400}
.ob-toggle{display:flex;margin-top:12px;border-radius:10px;overflow:hidden;border:1px solid #2a2a3a}
.ob-toggle button{flex:1;padding:9px;font-family:Oswald,sans-serif;font-weight:600;font-size:13px;text-transform:uppercase;letter-spacing:.04em;background:#0d0d15;color:#9a9aa8;border:none;cursor:pointer}
.ob-toggle button.on{background:#2E75B6;color:#fff}
.ob-trades{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:4px}
.ob-tile{display:flex;flex-direction:column;align-items:center;gap:6px;background:#12121a;border:1px solid #2a2a3a;border-radius:13px;padding:11px 6px;cursor:pointer;transition:.15s}
.ob-tile:hover{border-color:#3a3a4a}
.ob-tile.on{border-color:#2E75B6;background:rgba(46,117,182,.14);box-shadow:0 0 16px -5px rgba(46,117,182,.8)}
.ob-tile .ic{width:34px;height:34px;border-radius:9px;display:flex;align-items:center;justify-content:center;background:#1c1c28}
.ob-tile.on .ic{background:rgba(46,117,182,.22)}
.ob-tile .nm{font-family:Oswald,sans-serif;font-weight:600;font-size:11px;letter-spacing:.2px;text-transform:uppercase;color:#e6e8ee;text-align:center;line-height:1.1}
.ob-tpreview{background:linear-gradient(135deg,rgba(46,117,182,.1),rgba(46,117,182,.02));border:1px solid rgba(46,117,182,.35);border-radius:14px;padding:13px;margin-top:13px}
.ob-chips{display:flex;flex-wrap:wrap;gap:6px;margin:9px 0 10px}
.ob-chip{font-size:11px;font-weight:600;padding:5px 10px;border-radius:9px;background:#12121a;border:1px solid #2a2a3a;color:#cfd2da}
.ob-chip b{color:#7fb6ff}
.ob-starter .it{display:flex;align-items:center;gap:7px;font-size:11.5px;color:#cfd2da;padding:3px 0}
.ob-starter .d{width:6px;height:6px;border-radius:50%;background:#7fb6ff;flex-shrink:0}
.ob-demo{background:#12121a;border:1px solid #1e1e2e;border-radius:16px;padding:16px;margin-top:6px}
.ob-stepnum{display:inline-flex;align-items:center;gap:8px;font-family:Oswald,sans-serif;font-weight:600;font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:#7fb6ff;margin-bottom:10px}
.ob-stepnum .b{width:24px;height:24px;border-radius:7px;background:rgba(46,117,182,.18);display:flex;align-items:center;justify-content:center}
.ob-qtotal{font-family:Oswald,sans-serif;font-weight:700;font-size:26px;color:#ffd76b;text-align:center;margin-bottom:8px}
.ob-qli{display:flex;justify-content:space-between;align-items:center;font-size:12px;padding:7px 9px;border-radius:8px;background:#16161f;margin-bottom:5px;opacity:0;transform:translateY(8px);animation:obRise .5s forwards}
.ob-qli b{color:#fff}
.ob-qli:nth-child(2){animation-delay:.25s}.ob-qli:nth-child(3){animation-delay:.6s}.ob-qli:nth-child(4){animation-delay:.95s}
@keyframes obRise{to{opacity:1;transform:none}}
.ob-dot{width:6px;height:6px;border-radius:50%;display:inline-block;margin-right:6px}
.ob-cal{display:grid;grid-template-columns:repeat(5,1fr);gap:6px}
.ob-cal .d{aspect-ratio:1;border-radius:9px;background:#16161f;border:1px solid #1e1e2e;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:Oswald,sans-serif;font-size:13px;color:#9a9aa8;line-height:1.1}
.ob-cal .pick{border-color:#00cc66;color:#fff;background:rgba(0,204,102,.14);box-shadow:0 0 14px -4px rgba(0,204,102,.7);opacity:0;animation:obPop .5s .5s forwards}
@keyframes obPop{from{opacity:0;transform:scale(.7)}to{opacity:1;transform:none}}
.ob-crew{display:flex;align-items:center;gap:6px;margin-top:10px;font-size:12px;color:#9a9aa8}
.ob-av{width:24px;height:24px;border-radius:50%;background:#2E75B6;color:#fff;font-family:Oswald,sans-serif;font-size:10px;display:flex;align-items:center;justify-content:center;opacity:0;animation:obRise .4s forwards}
.ob-av:nth-child(2){animation-delay:1s}.ob-av:nth-child(3){animation-delay:1.2s}
.ob-wo{display:flex;align-items:center;gap:9px;font-size:13px;padding:8px 0;border-bottom:1px solid #1e1e2e}
.ob-wo:last-child{border:none}
.ob-tick{width:20px;height:20px;border-radius:6px;display:flex;align-items:center;justify-content:center;flex-shrink:0;background:#00cc66;border:1.5px solid #00cc66;opacity:0;transform:scale(.5);animation:obPop .35s forwards}
.ob-wo:nth-child(1) .ob-tick{animation-delay:.3s}.ob-wo:nth-child(2) .ob-tick{animation-delay:.8s}.ob-wo:nth-child(3) .ob-tick{animation-delay:1.3s}
.ob-clock{display:flex;justify-content:space-between;align-items:center;margin-top:10px;background:rgba(0,204,102,.1);border:1px solid rgba(0,204,102,.3);border-radius:10px;padding:8px 11px;font-size:12px;color:#7dffb8}
.ob-tl .stp{display:flex;align-items:center;gap:8px;font-size:12px;margin-bottom:1px}
.ob-tl .dot{width:16px;height:16px;border-radius:50%;background:#22222e;display:flex;align-items:center;justify-content:center;font-size:9px;color:#fff;transform:scale(.4);opacity:.3;animation:obDotIn .4s forwards}
.ob-tl .a .dot{background:#00cc66;animation-delay:.3s}
.ob-tl .b .dot{background:#00cc66;animation-delay:.9s}
.ob-tl .c .dot{background:#9d4edd;box-shadow:0 0 9px rgba(157,78,221,.7);animation-delay:1.5s}
@keyframes obDotIn{to{transform:none;opacity:1}}
.ob-tl .ln{width:2px;height:11px;background:#00cc66}
.ob-paid{text-align:center;margin-top:10px;font-family:Oswald,sans-serif;font-weight:700;font-size:20px;color:#3ee08f;opacity:0;animation:obPop .5s 1.8s forwards}
.ob-burst{position:absolute;top:120px;left:50%;width:8px;height:11px;border-radius:1px;opacity:0;animation:obBurst 1.1s .2s forwards}
@keyframes obBurst{0%{opacity:1;transform:translate(0,0) rotate(0)}100%{opacity:0;transform:translate(var(--bx),var(--by)) rotate(260deg)}}
.ob-btn{flex:1;display:inline-flex;align-items:center;justify-content:center;gap:8px;font-family:Oswald,sans-serif;font-weight:600;font-size:16px;letter-spacing:.4px;text-transform:uppercase;padding:15px;border-radius:14px;cursor:pointer;border:none}
.ob-next{background:rgba(0,204,102,.16);border:1.5px solid rgba(0,204,102,.85);color:#7dffb8;box-shadow:0 0 24px -4px rgba(0,204,102,.55),inset 0 0 20px -10px rgba(0,204,102,.5)}
.ob-next:disabled{opacity:.6;cursor:wait}
.ob-back{flex:0 0 54px;background:#1c1c28;border:1px solid #2a2a3a;color:#9a9aa8}
@media (prefers-reduced-motion:reduce){
  .ob-step,.ob-qli,.ob-cal .pick,.ob-av,.ob-tick,.ob-tl .dot,.ob-paid,.ob-burst{animation:none!important;opacity:1!important;transform:none!important}
}
`;
