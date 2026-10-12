import type { Metadata } from "next";
import { SITE } from "@/lib/site";
import { PageHero, CtaBand } from "@/components/blocks";

export const metadata: Metadata = {
  title: "Serving our churches & nonprofits — free labor",
  description: `Free handyman labor for local churches and nonprofits in ${SITE.areaLine} that reach out. Depending on the job, we may cover the materials too. First come, first served.`,
  alternates: { canonical: "/churches" },
};

const HELP = [
  "Leaking faucets, running toilets, and clogged drains",
  "Doors, locks, and latches that won't close right",
  "Light fixtures, outlets, and ceiling fans",
  "Drywall patches and paint in classrooms and halls",
  "Mounting TVs, projectors, shelves, and whiteboards",
  "Grab bars, handrails, and safety fixes",
  "Flooring repairs and worn trim",
  "Getting the building ready for an event",
];

const STEPS = [
  { h: "Reach out", p: "Call, text, or send the form — tell us it's for a church or nonprofit." },
  { h: "Honest read", p: "We look at photos or come by, then tell you what it takes and how materials will be handled." },
  { h: "On the schedule", p: "First come, first served — church and nonprofit work fits in between paying jobs." },
  { h: "Done right", p: "Same work and the same cleanup as any paying customer. No strings attached." },
];

export default function ChurchesPage() {
  return (
    <main>
      <PageHero
        kicker="Community"
        title="Serving our churches."
        lead="Free labor for local churches and nonprofits that reach out. Depending on the job, we may cover the materials too. It is the simplest way we know to put the shop's faith to work."
      />

      <section className="band">
        <div className="container section two-col">
          <div>
            <h2 className="h2" style={{ fontSize: 30 }}>How it works</h2>
            <ul className="checklist" style={{ gridTemplateColumns: "1fr", marginTop: 20 }}>
              <li><i />Any church, ministry, or local nonprofit we serve can reach out: {SITE.areaLine}.</li>
              <li><i />The labor is free.</li>
              <li><i />Materials depend on the job. On some projects we cover them; on others the organization pays for them. Either way, we settle it before any work starts.</li>
              <li><i />First come, first served. This work is scheduled between paying jobs.</li>
              <li><i />Big projects get an honest read: if it needs a specialty contractor, we say so.</li>
            </ul>
          </div>
          <div className="card">
            <h3 className="h3" style={{ fontSize: 18 }}>Why</h3>
            <p style={{ fontSize: 16, lineHeight: 1.6, color: "var(--muted)", margin: 0 }}>
              Creed is a faith-led shop. Churches and nonprofits hold
              Wichita&rsquo;s neighborhoods together, and most run on volunteer
              hands and thin budgets, so a leaking faucet or a door that
              won&rsquo;t latch sits broken for months. That is a problem we can
              actually fix, so we do. No strings, no pitch from the pulpit.
            </p>
          </div>
        </div>
      </section>

      <section className="band band-alt">
        <div className="container section">
          <h2 className="h2" style={{ fontSize: 30, marginBottom: 8 }}>What we can help with</h2>
          <p className="sub" style={{ marginBottom: 24 }}>The same work we do for any customer. If it is not on the list, ask.</p>
          <ul className="checklist">
            {HELP.map((h) => <li key={h}><i />{h}</li>)}
          </ul>
        </div>
      </section>

      <section className="band">
        <div className="container section">
          <h2 className="h2" style={{ fontSize: 30, marginBottom: 28 }}>From first call to fixed</h2>
          <ol className="fn-steps">
            {STEPS.map((s, i) => (
              <li key={s.h}>
                <span className="fn-n">{i + 1}</span>
                <b>{s.h}</b>
                <p>{s.p}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <CtaBand
        num="02"
        label="Reach out"
        title="Something broken at your church?"
        copy="Call or send the details through the form — tell us it's for a church or nonprofit, and we'll get you on the list."
      />
    </main>
  );
}
