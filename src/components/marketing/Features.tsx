"use client";
import Link from "next/link";
import { Icon, type IconName } from "@/components/Icon";
import MarketingShell from "./MarketingShell";

interface Row {
  rev?: boolean;
  ic: IconName; icBg: string; icC: string;
  h: string; p: string;
  bullets: { c: string; t: string }[];
  blob: string; blobPos: React.CSSProperties;
  big: IconName; bigC: string; bigSize: number;
}

const ROWS: Row[] = [
  {
    ic: "sparkle", icBg: "rgba(245,180,0,.16)", icC: "#ffd76b",
    h: "AI quoting that learns your prices",
    p: "Snap a few photos or upload an inspection report and Creed writes the full itemized quote — split by trade, with labor, materials, and hours. Every edit and completed job teaches the AI, so your pricing gets sharper over time.",
    bullets: [{ c: "#f5b400", t: "Photo / PDF → quote" }, { c: "#f5b400", t: "Self-learning pricing" }, { c: "#f5b400", t: "PDF export" }],
    blob: "#f5b400", blobPos: { left: -40, top: -40 }, big: "sparkle", bigC: "#ffd76b", bigSize: 70,
  },
  {
    rev: true,
    ic: "photo", icBg: "rgba(157,78,221,.16)", icC: "#d8b6ff",
    h: "Show the “after” before you start",
    p: "Generate a photorealistic render of the finished space — built from the exact work in your quote — and drop it straight into the proposal. Customers buy what they can picture.",
    bullets: [{ c: "#9d4edd", t: "Auto-built from line items" }, { c: "#9d4edd", t: "Before / after in the PDF" }],
    blob: "#9d4edd", blobPos: { right: -40, bottom: -40 }, big: "sparkle", bigC: "#d8b6ff", bigSize: 70,
  },
  {
    ic: "mic", icBg: "rgba(46,117,182,.16)", icC: "#7fb6ff",
    h: "Inspections, hands-free",
    p: "Walk the property and talk. Creed transcribes, ticks the checklist live, and tags your photos room by room — then turns the whole walk into a quote.",
    bullets: [{ c: "#2E75B6", t: "Voice Walk AI" }, { c: "#2E75B6", t: "Live checklist" }, { c: "#2E75B6", t: "Auto photo tagging" }],
    blob: "#2E75B6", blobPos: { left: -40, bottom: -40 }, big: "mic", bigC: "#7fb6ff", bigSize: 64,
  },
  {
    rev: true,
    ic: "schedule", icBg: "rgba(255,204,0,.16)", icC: "#ffe07a",
    h: "Schedule & dispatch the crew",
    p: "Day, week, and month views. Assign by worker, see who's where, move jobs in seconds — and the time they clock on site flows straight into payroll.",
    bullets: [{ c: "#ffcc00", t: "Day / week / month" }, { c: "#00cc66", t: "Time clock → payroll" }, { c: "#2E75B6", t: "Work orders" }],
    blob: "#ffcc00", blobPos: { right: -40, top: -40 }, big: "schedule", bigC: "#ffe07a", bigSize: 64,
  },
  {
    ic: "money", icBg: "rgba(0,204,102,.16)", icC: "#3ee08f",
    h: "Get paid faster",
    p: "Customers approve and e-sign the quote, pay a deposit, and follow a live status tracker — all through Stripe, straight to your account. No chasing paper invoices.",
    bullets: [{ c: "#00cc66", t: "E-sign + deposits" }, { c: "#00cc66", t: "Stripe Connect" }, { c: "#00cc66", t: "Live status pages" }],
    blob: "#00cc66", blobPos: { left: -40, top: -40 }, big: "money", bigC: "#3ee08f", bigSize: 64,
  },
  {
    rev: true,
    ic: "trophy", icBg: "rgba(255,61,110,.16)", icC: "#ff8aa8",
    h: "Grow & motivate",
    p: "A digital business card, automatic review requests, and a branded customer portal turn every job into the next one. Quests reward your crew for five-star work with real bonuses.",
    bullets: [{ c: "#2E75B6", t: "Digital card" }, { c: "#f5b400", t: "Auto reviews" }, { c: "#9d4edd", t: "Quests & bonuses" }, { c: "#ff8800", t: "Customer portal" }],
    blob: "#ff3d6e", blobPos: { right: -40, bottom: -40 }, big: "trophy", bigC: "#ff8aa8", bigSize: 64,
  },
];

export default function Features() {
  return (
    <MarketingShell>
      <div className="phead"><div className="wrap">
        <div className="kick">Features</div>
        <div className="h1">One app, the <span className="g">whole job</span></div>
        <div className="lead">Everything a handyman business needs to quote, schedule, work, get paid, and grow — with AI doing the heavy lifting.</div>
      </div></div>

      <div className="wrap">
        {ROWS.map((r) => (
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
            <div className="fart">
              <div className="blob" style={{ background: r.blob, ...r.blobPos }} />
              <div className="big"><Icon name={r.big} size={r.bigSize} color={r.bigC} /></div>
            </div>
          </div>
        ))}

        <div style={{ textAlign: "center", padding: "56px 0" }}>
          <Link className="btn btn-glow btn-lg" href="/pricing"><Icon name="rocket" size={18} /> See plans &amp; pricing</Link>
        </div>
      </div>
    </MarketingShell>
  );
}
