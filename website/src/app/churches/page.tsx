import type { Metadata } from "next";
import { SITE } from "@/lib/site";
import { PageHero, CtaBand } from "@/components/blocks";

export const metadata: Metadata = {
  title: "Serving our churches — free labor",
  description: `Free handyman labor for local churches in ${SITE.areaLine} that reach out. Materials at cost, first come first served.`,
};

export default function ChurchesPage() {
  return (
    <main>
      <PageHero
        kicker="Community"
        title="Serving our churches."
        lead="Free labor for local churches that reach out. Materials at cost, first come first served. It is the simplest way we know to put the shop's faith to work."
      />

      <section className="band">
        <div className="container section two-col">
          <div>
            <h2 className="h2" style={{ fontSize: 30 }}>How it works</h2>
            <ul className="checklist" style={{ gridTemplateColumns: "1fr", marginTop: 20 }}>
              <li><i />Any church in {SITE.county} can reach out — call or use the quote form.</li>
              <li><i />The labor is free. You pay only for materials, at our cost, receipts included.</li>
              <li><i />Same work we do anywhere: plumbing, electrical, drywall, doors, mounting, repairs.</li>
              <li><i />First come, first served — church work is scheduled between paying jobs.</li>
              <li><i />Big projects get an honest read: if it needs a specialty contractor, we say so.</li>
            </ul>
          </div>
          <div className="card">
            <h3 className="h3" style={{ fontSize: 18 }}>Why</h3>
            <p style={{ fontSize: 16, lineHeight: 1.6, color: "var(--muted)", margin: 0 }}>
              Creed is a faith-led shop. Churches hold Wichita&rsquo;s
              neighborhoods together, and most run on volunteer hands and thin
              budgets — a leaking faucet or a door that won&rsquo;t latch sits
              broken for months. That is a problem we can actually fix, so we
              do. No strings, no pitch from the pulpit.
            </p>
          </div>
        </div>
      </section>

      <CtaBand
        num="02"
        label="Reach out"
        title="Something broken at your church?"
        copy="Call or send the details through the form — tell us it's for a church, and we'll get you on the list."
      />
    </main>
  );
}
