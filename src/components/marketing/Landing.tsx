"use client";
import Link from "next/link";
import { Icon } from "@/components/Icon";
import MarketingShell from "./MarketingShell";

const FEATURES = [
  { ic: "sparkle", bg: "rgba(245,180,0,.16)", c: "#ffd76b", h: "AI Quoting", p: "Snap photos or upload an inspection — the AI writes the itemized, trade-by-trade quote and learns your pricing over time." },
  { ic: "photo", bg: "rgba(157,78,221,.16)", c: "#d8b6ff", h: "AI “After” Render", p: "Show customers a photorealistic preview of the finished job — built from your quote — and close more work." },
  { ic: "schedule", bg: "rgba(255,204,0,.16)", c: "#ffe07a", h: "Schedule & Dispatch", p: "Day, week, month views. Assign the crew, track time on site, and feed hours straight to payroll." },
  { ic: "money", bg: "rgba(0,204,102,.16)", c: "#3ee08f", h: "Get Paid Faster", p: "Customers e-sign quotes, pay deposits, and follow a live status tracker — powered by Stripe." },
  { ic: "clients", bg: "rgba(46,117,182,.16)", c: "#7fb6ff", h: "Crew & Payroll", p: "Time clock, work orders, auto-payroll, mileage, and HR — the back office on autopilot." },
  { ic: "trophy", bg: "rgba(255,61,110,.16)", c: "#ff8aa8", h: "Grow & Motivate", p: "Digital business card, automatic reviews, a customer portal, and gamified Quests that keep your crew hungry." },
];

const STATS = [
  { v: "$273B", l: "U.S. handyman industry" },
  { v: "Minutes", l: "to a full quote, not hours" },
  { v: "5-in-1", l: "apps replaced" },
  { v: "$0", l: "to get started" },
];

const REPLACES = [
  { l: "Quoting", c: "#ffd76b" },
  { l: "Scheduling", c: "#3ee08f" },
  { l: "Invoicing", c: "#7fb6ff" },
  { l: "CRM", c: "#d8b6ff" },
  { l: "Payroll", c: "#ff8aa8" },
];

export default function Landing() {
  return (
    <MarketingShell>
      {/* Hero */}
      <header className="hero">
        <div className="wrap herogrid">
          <div>
            <div className="pill"><Icon name="sparkle" size={14} /> AI-powered quoting · built by a handyman</div>
            <h1 className="hero-h">Run your whole<br /><span className="g">handyman business</span><br />from your pocket.</h1>
            <div className="hsub">Quote with AI, schedule the crew, and get paid — all in one app. No spreadsheets, no paperwork, no second tool.</div>
            <div className="hbtns">
              <Link className="btn btn-glow btn-lg" href="/signin?mode=signup"><Icon name="rocket" size={18} /> Get Started Free</Link>
              <Link className="btn btn-ghost btn-lg" href="/features"><Icon name="start" size={18} /> See it in action</Link>
            </div>
            <div className="hnote"><Icon name="check" size={14} /> No credit card to start · set up in minutes</div>
          </div>
          <div className="heromock">
            <div className="device"><div className="scr">
              <div className="notch" />
              <div className="tbar"><div className="tt">Creed</div><div className="tdot"><Icon name="bell" size={13} /></div></div>
              <div className="hpay"><div className="l">Your next check</div><div className="n">$1,284</div></div>
              <div className="gc g-gold"><div className="gi" style={{ background: "rgba(245,180,0,.2)", color: "#ffd76b" }}><Icon name="quote" size={18} /></div><div><b>Quick Quote</b><small>Snap &amp; price a job</small></div></div>
              <div className="gc g-green"><div className="gi" style={{ background: "rgba(0,204,102,.2)", color: "#3ee08f" }}><Icon name="time" size={18} /></div><div><b>Clock In</b><small>Start your shift</small></div></div>
              <div className="jrow"><div><div className="p">3979 Roseberry</div><div className="s">Crew on site · 62%</div></div><span className="pchip">Active</span></div>
            </div></div>
          </div>
        </div>
      </header>

      {/* Stat strip */}
      <div className="wrap">
        <div className="stats">
          {STATS.map((s) => (
            <div className="stat" key={s.l}><div className="v">{s.v}</div><div className="l">{s.l}</div></div>
          ))}
        </div>
      </div>

      {/* Feature grid */}
      <section className="feat"><div className="wrap">
        <div className="kick">Everything in one app</div>
        <div className="h2">From the first photo<br />to <span className="g">final payment</span></div>
        <div className="grid3">
          {FEATURES.map((f) => (
            <div className="fcard" key={f.h}>
              <div className="ic" style={{ background: f.bg, color: f.c }}><Icon name={f.ic} size={25} color={f.c} /></div>
              <h3>{f.h}</h3>
              <p>{f.p}</p>
            </div>
          ))}
        </div>
      </div></section>

      {/* Replaces band */}
      <section className="replaces"><div className="wrap">
        <div className="kick">Stop paying for five tools</div>
        <div className="h2">Replaces the apps<br />you&apos;re <span className="g">juggling now</span></div>
        <div className="repchips">
          {REPLACES.map((r) => <span className="repchip" key={r.l} style={{ color: r.c }}>{r.l}</span>)}
        </div>
      </div></section>

      {/* CTA band */}
      <section className="ctaband"><div className="wrap">
        <h2>Everything your crew needs.<br /><span className="g">Nothing you don&apos;t.</span></h2>
        <div className="lead" style={{ marginTop: 18 }}>Built by a handyman, for handymen. Start free today.</div>
        <div className="hbtns" style={{ justifyContent: "center", marginTop: 30 }}>
          <Link className="btn btn-glow btn-lg" href="/signin?mode=signup"><Icon name="rocket" size={18} /> Get Started Free</Link>
          <Link className="btn btn-ghost btn-lg" href="/signin?mode=signup"><Icon name="download" size={18} /> Get the App</Link>
        </div>
      </div></section>
    </MarketingShell>
  );
}
