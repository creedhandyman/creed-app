"use client";
import Link from "next/link";
import { Icon } from "@/components/Icon";
import MarketingShell from "./MarketingShell";
import { HOME_FAQ } from "./home-content";

// Copy is written for what handyman business owners search ("handyman
// software", "handyman estimate app", "handyman invoicing app"…). Every
// claim here describes shipped behaviour — keep it that way.
const FEATURES = [
  { ic: "sparkle", bg: "rgba(245,180,0,.16)", c: "#ffd76b", h: "AI Estimates & Quotes", p: "Snap photos, talk through the job with Voice Walk, or upload an inspection — the AI writes the itemized, trade-by-trade quote and learns your pricing over time." },
  { ic: "photo", bg: "rgba(157,78,221,.16)", c: "#d8b6ff", h: "AI “After” Render", p: "Show customers a photorealistic preview of the finished job — built from your quote — and close more work." },
  { ic: "schedule", bg: "rgba(255,204,0,.16)", c: "#ffe07a", h: "Scheduling & Dispatch", p: "Day, week, month views. Assign the crew, track time on site, and feed hours straight to payroll." },
  { ic: "money", bg: "rgba(0,204,102,.16)", c: "#3ee08f", h: "Invoicing & Payments", p: "Customers e-sign quotes, pay deposits and balances by card, and follow a live job tracker — powered by Stripe." },
  { ic: "clients", bg: "rgba(46,117,182,.16)", c: "#7fb6ff", h: "Time Clock & Payroll", p: "A crew time clock that works without signal, work orders, auto-payroll, mileage, and HR — the back office on autopilot." },
  { ic: "trophy", bg: "rgba(255,61,110,.16)", c: "#ff8aa8", h: "Grow & Motivate", p: "Digital business card, automatic reviews, a customer portal, and gamified Quests that keep your crew hungry." },
];

const STEPS = [
  { h: "Walk the job", p: "Snap photos room by room, or talk it through with Voice Walk while the app listens and takes notes." },
  { h: "AI writes the quote", p: "An itemized estimate by trade with hours, materials and your rates — plus optional Good / Better / Best options. Tweak it in minutes." },
  { h: "Send it, sign it, get paid", p: "Text the customer a link. They sign and pay a deposit by card; you schedule the crew, and the invoice follows the work." },
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
            <div className="pill"><Icon name="sparkle" size={14} /> Handyman business software · built by a working handyman</div>
            <h1 className="hero-h">The <span className="g">handyman app</span><br />that quotes, schedules<br />and gets you paid.</h1>
            <p className="hsub">AI writes the quote from your photos, the crew clocks in from their phones, and customers sign and pay online. One app for your whole handyman business — no spreadsheets, no second tool.</p>
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
        <h2 className="h2">From the first photo<br />to <span className="g">final payment</span></h2>
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

      {/* How it works */}
      <section className="feat"><div className="wrap">
        <div className="kick">How it works</div>
        <h2 className="h2">From walk-through<br />to <span className="g">signed quote</span></h2>
        <div className="grid3">
          {STEPS.map((s, i) => (
            <div className="fcard" key={s.h}>
              <div className="stepn">{i + 1}</div>
              <h3>{s.h}</h3>
              <p>{s.p}</p>
            </div>
          ))}
        </div>
      </div></section>

      {/* Replaces band */}
      <section className="replaces"><div className="wrap">
        <div className="kick">Stop paying for five tools</div>
        <h2 className="h2">Replaces the apps<br />you&apos;re <span className="g">juggling now</span></h2>
        <div className="repchips">
          {REPLACES.map((r) => <span className="repchip" key={r.l} style={{ color: r.c }}>{r.l}</span>)}
        </div>
      </div></section>

      {/* Built in the field */}
      <section className="feat"><div className="wrap">
        <div className="kick">Built in the field</div>
        <h2 className="h2">Built by a handyman company.<br /><span className="g">Used every day.</span></h2>
        <p className="lead">Creed Handy Manager is built and used daily by Creed Handyman LLC in Wichita, KS. The crew&apos;s quotes, schedules, time cards and payroll all run through it — so every feature started as a real job that needed it.</p>
        <div className="hbtns" style={{ justifyContent: "center", marginTop: 26 }}>
          <a className="btn btn-ghost" href="https://www.creedhandyman.com" target="_blank" rel="noopener">See Creed Handyman <Icon name="next" size={16} /></a>
        </div>
      </div></section>

      {/* FAQ — the same HOME_FAQ feeds the FAQPage structured data in app/page.tsx */}
      <section className="feat" id="faq"><div className="wrap">
        <div className="kick">Questions</div>
        <h2 className="h2">Handyman software,<br /><span className="g">answered</span></h2>
        <div className="faq">
          {HOME_FAQ.map((f) => (
            <div className="q" key={f.q}>
              <h3>{f.q}</h3>
              <p>
                {f.a}
                {f.more && <> <Link className="faqmore" href={f.more.href}>{f.more.label} →</Link></>}
              </p>
            </div>
          ))}
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
