import type { Metadata } from "next";
import Link from "next/link";
import { SITE } from "@/lib/site";
import { PageHero, CredStrip, CtaBand } from "@/components/blocks";

export const metadata: Metadata = {
  title: "About — the name is the promise",
  description: `Creed Handyman is a certified, insured, one-crew shop serving ${SITE.areaLine}. NATE HVAC certified, EPA 608, 10,000+ hours on the tools.`,
};

export default function AboutPage() {
  return (
    <main>
      <PageHero
        kicker="About"
        title="The name is the promise."
        lead="A creed is something you live by. Ours is short: do the repair right, charge what we said, and leave the place cleaner than we found it."
      />

      <CredStrip />

      <section className="band">
        <div className="container section two-col">
          <div>
            <h2 className="h2" style={{ fontSize: 30 }}>Who shows up</h2>
            <p style={{ fontSize: 17, lineHeight: 1.6, color: "var(--muted)", margin: "0 0 18px" }}>
              Creed Handyman is Bernard&rsquo;s shop — a working tradesman, not a
              dispatcher. Nine years and ten thousand-plus hours on the tools,
              NATE-certified in HVAC with EPA 608 refrigerant certification,
              and general liability insurance on every job.
            </p>
            <p style={{ fontSize: 17, lineHeight: 1.6, color: "var(--muted)", margin: "0 0 18px" }}>
              The rate is {SITE.rate} an hour, the quote comes before the work,
              and materials are billed at cost with receipts on request. That
              is not a promotion — it is just how the shop runs.
            </p>
            <p style={{ fontSize: 17, lineHeight: 1.6, color: "var(--muted)", margin: 0 }}>
              We are a faith-led shop, and it shows up in the work: local
              churches that reach out get our labor free, materials at cost.{" "}
              <Link href="/churches">Read how that works →</Link>
            </p>
          </div>
          <div>
            <div className="card" style={{ marginBottom: 24 }}>
              <h3 className="h3" style={{ fontSize: 18 }}>Where we work</h3>
              <p style={{ fontSize: 15.5, lineHeight: 1.6, color: "var(--muted)", margin: 0 }}>
                {SITE.areaLine}: {SITE.cities.join(", ")}. Mobile service — we
                come to you, no storefront.
              </p>
            </div>
            <div className="card">
              <h3 className="h3" style={{ fontSize: 18 }}>Hours</h3>
              <p style={{ fontSize: 15.5, lineHeight: 1.8, color: "var(--muted)", margin: 0 }}>
                {SITE.hours.map((r) => (
                  <span key={r.d} style={{ display: "block" }}>{r.d} — {r.h}</span>
                ))}
              </p>
            </div>
          </div>
        </div>
      </section>

      <CtaBand num="02" />
    </main>
  );
}
