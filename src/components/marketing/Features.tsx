"use client";
import Link from "next/link";
import { Icon, type IconName } from "@/components/Icon";
import MarketingShell from "./MarketingShell";

interface Row {
  rev?: boolean;
  ic: IconName; icBg: string; icC: string;
  h: string; p: string;
  bullets: { c: string; t: string }[];
}

const ROWS: Row[] = [
  {
    ic: "sparkle", icBg: "rgba(245,180,0,.16)", icC: "#ffd76b",
    h: "AI quoting that learns your prices",
    p: "Snap a few photos or upload an inspection report and Creed writes the full itemized quote — split by trade, with labor, materials, and hours. Every edit and completed job teaches the AI, so your pricing gets sharper over time.",
    bullets: [{ c: "#f5b400", t: "Photo / PDF → quote" }, { c: "#f5b400", t: "Self-learning pricing" }, { c: "#f5b400", t: "PDF export" }],
  },
  {
    rev: true,
    ic: "photo", icBg: "rgba(157,78,221,.16)", icC: "#d8b6ff",
    h: "Show the “after” before you start",
    p: "Generate a photorealistic render of the finished space — built from the exact work in your quote — and drop it straight into the proposal. Customers buy what they can picture.",
    bullets: [{ c: "#9d4edd", t: "Auto-built from line items" }, { c: "#9d4edd", t: "Before / after in the PDF" }],
  },
  {
    ic: "mic", icBg: "rgba(46,117,182,.16)", icC: "#7fb6ff",
    h: "Inspections, hands-free",
    p: "Walk the property and talk. Creed transcribes, ticks the checklist live, and tags your photos room by room — then turns the whole walk into a quote.",
    bullets: [{ c: "#2E75B6", t: "Voice Walk AI" }, { c: "#2E75B6", t: "Live checklist" }, { c: "#2E75B6", t: "Auto photo tagging" }],
  },
  {
    rev: true,
    ic: "schedule", icBg: "rgba(255,204,0,.16)", icC: "#ffe07a",
    h: "Schedule & dispatch the crew",
    p: "Day, week, and month views. Assign by worker, see who's where, move jobs in seconds — and the time they clock on site flows straight into payroll.",
    bullets: [{ c: "#ffcc00", t: "Day / week / month" }, { c: "#00cc66", t: "Time clock → payroll" }, { c: "#2E75B6", t: "Work orders" }],
  },
  {
    ic: "money", icBg: "rgba(0,204,102,.16)", icC: "#3ee08f",
    h: "Get paid faster",
    p: "Customers approve and e-sign the quote, pay a deposit, and follow a live status tracker — all through Stripe, straight to your account. No chasing paper invoices.",
    bullets: [{ c: "#00cc66", t: "E-sign + deposits" }, { c: "#00cc66", t: "Stripe Connect" }, { c: "#00cc66", t: "Live status pages" }],
  },
  {
    rev: true,
    ic: "trophy", icBg: "rgba(157,78,221,.16)", icC: "#d8b6ff",
    h: "Grow & motivate",
    p: "A digital business card, automatic review requests, and a branded customer portal turn every job into the next one. Quests reward your crew for five-star work with real bonuses.",
    bullets: [{ c: "#2E75B6", t: "Digital card" }, { c: "#f5b400", t: "Auto reviews" }, { c: "#9d4edd", t: "Quests & bonuses" }, { c: "#ff8800", t: "Customer portal" }],
  },
];

const dot = (c: string) => <span className="fd-dot" style={{ background: c }} />;

/** In-app phone mockup for each feature row — rendered in pure CSS so the
 *  marketing page shows the real product, not abstract art. Index-aligned
 *  with ROWS. */
function renderDevice(i: number) {
  let inner: React.ReactNode = null;
  if (i === 0) {
    inner = (
      <>
        <div className="fd-tbar"><div className="fd-tt">Quote</div><div className="fd-mini">128 Maple Ave</div></div>
        <div className="fd-gold"><div><div className="k">Total</div><div className="n">$8,450</div></div></div>
        <div className="fd-seg"><b className="on">Quote</b><b>Guide</b><b>Issues</b><b>Photos</b></div>
        <div className="fd-card">
          <div className="fd-li"><div className="l">{dot("#9d4edd")}Replace flooring — LVP</div><b>$1,240</b></div>
          <div className="fd-li"><div className="l">{dot("#ff8800")}Repaint walls &amp; ceilings</div><b>$1,980</b></div>
          <div className="fd-li"><div className="l">{dot("#2E75B6")}New vanity + mirror</div><b>$760</b></div>
          <div className="fd-li"><div className="l">{dot("#00cc66")}Install window blinds</div><b>$420</b></div>
        </div>
        <div className="fd-abar"><span className="fd-abtn">PDF</span><span className="fd-abtn render">Render</span><span className="fd-abtn send">Send</span><span className="fd-abtn">Save</span></div>
      </>
    );
  } else if (i === 1) {
    inner = (
      <>
        <div className="fd-tbar"><div className="fd-tt"><span className="fd-tdot" style={{ background: "rgba(157,78,221,.18)", color: "#d8b6ff" }}>✨</span>AI Finish</div></div>
        <div className="fd-ba">
          <div className="p"><div className="fd-img fd-before">🏚</div><div className="fd-tag">Before</div></div>
          <div className="p"><div className="fd-img fd-after">✨</div><div className="fd-tag" style={{ color: "#d8b6ff" }}>After · AI</div></div>
        </div>
        <div className="fd-prompt"><span className="pc">Built from 6 line items</span> Light-gray LVP flooring, off-white walls, new vanity, window blinds, fresh trim…</div>
        <div className="fd-gen">✨ Generate · ~$0.04</div>
      </>
    );
  } else if (i === 2) {
    inner = (
      <div className="fd-cam">
        <div className="st"><div className="fd-rec"><span className="fd-rd" /> 02:14</div><div style={{ fontSize: 10, color: "#fff", opacity: .8 }}>Kitchen · 3/8</div></div>
        <div className="fd-checks">
          <span className="fd-ck on">Flooring ✓</span><span className="fd-ck on">Cabinets ✓</span><span className="fd-ck on">Sink ✓</span>
          <span className="fd-ck">Outlets</span><span className="fd-ck">Lighting</span><span className="fd-ck">Walls</span>
        </div>
        <div className="sb"><div className="fd-shutter" /></div>
      </div>
    );
  } else if (i === 3) {
    inner = (
      <>
        <div className="fd-tbar"><div className="fd-tt">Schedule</div><div className="fd-mini">Jun 21–27</div></div>
        <div className="fd-sseg"><b>Day</b><b className="on">Week</b><b>Month</b><b>Dispatch</b></div>
        <div className="fd-avs"><div className="fd-av on">All</div><div className="fd-av">JM</div><div className="fd-av">DR</div><div className="fd-av">ZB</div><div className="fd-av">AE</div></div>
        <div className="fd-day"><div className="fd-dh"><b>Mon <span style={{ fontWeight: 400 }}>Jun 22</span></b><span>2 jobs · 17.2h</span></div>
          <div className="fd-sjob" style={{ marginBottom: 5 }}><span className="fd-gd" />Maple Ave · 9:00a<span className="fd-crew">JM · DR</span></div>
          <div className="fd-sjob"><span className="fd-gd" />Linden Ct · 10:00a<span className="fd-crew">ZB · AE</span></div>
        </div>
        <div className="fd-day"><div className="fd-dh"><b>Tue <span style={{ fontWeight: 400 }}>Jun 23</span></b><span>1 job · 7.8h</span></div>
          <div className="fd-sjob"><span className="fd-gd" />Oak Park · 9:00a<span className="fd-crew">JM</span></div>
        </div>
      </>
    );
  } else if (i === 4) {
    inner = (
      <>
        <div style={{ textAlign: "center", marginBottom: 9 }}>
          <div style={{ width: 32, height: 32, borderRadius: 9, margin: "0 auto 5px", background: "linear-gradient(135deg,#2E75B6,#16365a)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Oswald, sans-serif", fontWeight: 700, color: "#fff", fontSize: 16 }}>C</div>
          <div style={{ fontFamily: "Oswald, sans-serif", fontWeight: 700, fontSize: 12, letterSpacing: ".4px", textTransform: "uppercase", color: "#7fb6ff" }}>Creed Handyman</div>
        </div>
        <div className="fd-shero"><div style={{ fontSize: 23 }}>🔨</div><div className="fd-stt">In Progress</div><div className="fd-sd">Your crew is on site today</div></div>
        <div className="fd-card" style={{ padding: "10px 11px" }}>
          <div className="fd-step"><div className="fd-sdot" style={{ background: "#00cc66" }}>✓</div><div style={{ fontSize: 10, color: "#00cc66" }}>Quote accepted</div></div>
          <div className="fd-ln" style={{ background: "#00cc66" }} />
          <div className="fd-step"><div className="fd-sdot" style={{ background: "#2E75B6", boxShadow: "0 0 8px rgba(46,117,182,.7)" }}>🔨</div><div style={{ fontSize: 10, color: "#7fb6ff", fontFamily: "Oswald, sans-serif", fontWeight: 700 }}>In progress</div></div>
          <div className="fd-bar" style={{ marginTop: 8 }}><i style={{ width: "62%", background: "#2E75B6" }} /></div>
          <div style={{ fontSize: 9.5, color: "#9a9aa8", marginTop: 4 }}>62% · 5 of 8 tasks done</div>
        </div>
        <div className="fd-pay">💳 Pay Deposit · $1,500</div>
      </>
    );
  } else {
    inner = (
      <>
        <div className="fd-tbar"><div className="fd-tt">Quest Hub</div><div className="fd-tdot" style={{ background: "rgba(157,78,221,.18)", color: "#d8b6ff" }}>🏆</div></div>
        <div className="fd-qhero"><div className="fd-qd">Jan – Jun 2026 · 8d 3h left</div><div className="fd-qm">$400 <small>of $1,950 max</small></div>
          <div className="fd-qbar">
            {[0, 1, 2, 3].map((k) => <i key={k} style={{ background: "linear-gradient(90deg,#9d4edd,#f5b400)" }} />)}
            {[4, 5, 6, 7].map((k) => <i key={k} style={{ background: "rgba(255,255,255,.12)" }} />)}
          </div>
          <div style={{ fontSize: 9, color: "#cdb6f0", marginTop: 6, fontFamily: "Oswald, sans-serif", letterSpacing: ".06em" }}>4 / 12 QUESTS COMPLETE</div>
        </div>
        <div className="fd-qtier">T1 · Foundation</div>
        <div className="fd-qmis" style={{ borderLeft: "3px solid #2E75B6" }}><div><div style={{ fontFamily: "Oswald, sans-serif", fontWeight: 600, fontSize: 12 }}>Five Star Tech</div><div style={{ fontSize: 9, color: "#9a9aa8" }}>1 of 10 ★</div></div><span className="coin">$100</span></div>
        <div className="fd-qmis" style={{ borderLeft: "3px solid #f5b400" }}><div><div style={{ fontFamily: "Oswald, sans-serif", fontWeight: 600, fontSize: 12 }}>Super Handy</div><div style={{ fontSize: 9, color: "#3ee08f" }}>Done · pending</div></div><span className="coin">$50</span></div>
      </>
    );
  }
  return (
    <div className="shot">
      <div className="fd"><div className="fd-scr"><div className="fd-notch" />{inner}</div></div>
    </div>
  );
}

export default function Features() {
  return (
    <MarketingShell>
      <div className="phead"><div className="wrap">
        <div className="kick">Features</div>
        <div className="h1">One app, the <span className="g">whole job</span></div>
        <div className="lead">Everything a handyman business needs to quote, schedule, work, get paid, and grow — with AI doing the heavy lifting.</div>
      </div></div>

      <div className="wrap">
        {ROWS.map((r, idx) => (
          <div className={`frow${r.rev ? " rev" : ""}`} key={r.h}>
            <div className="ftext">
              <div className="ficon" style={{ background: r.icBg, color: r.icC }}><Icon name={r.ic} size={28} color={r.icC} /></div>
              <h3>{r.h}</h3>
              <p>{r.p}</p>
              <div className="fbul">
                {r.bullets.map((b) => (
                  <span key={b.t}><span className="d" style={{ background: b.c }} />{b.t}</span>
                ))}
              </div>
            </div>
            {renderDevice(idx)}
          </div>
        ))}

        <div style={{ textAlign: "center", padding: "56px 0" }}>
          <Link className="btn btn-glow btn-lg" href="/pricing"><Icon name="rocket" size={18} /> See plans &amp; pricing</Link>
        </div>
      </div>
    </MarketingShell>
  );
}
