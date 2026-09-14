import type { Metadata } from "next";
import Link from "next/link";
import { SERVICES, SITE } from "@/lib/site";
import { PageHero, CtaBand } from "@/components/blocks";

export const metadata: Metadata = {
  title: "Handyman services",
  description: `Plumbing, electrical, drywall and paint, doors and locks, mounting, and make-ready turnovers across ${SITE.areaLine}. ${SITE.rate}/hr, quoted first.`,
};

export default function ServicesPage() {
  return (
    <main>
      <PageHero
        kicker="Services"
        title="What we fix"
        lead="Six things we do most, listed plainly. If your job is not on a list, ask anyway — odd jobs are the job."
      />
      <section className="band">
        <div className="container section">
          <div className="svc-grid">
            {SERVICES.map((s, i) => (
              <Link href={`/services/${s.slug}`} className="svc" key={s.slug}>
                <div className="svc-num">
                  <span className="n">{String(i + 1).padStart(2, "0")}</span>
                  <span className="rule" />
                </div>
                <h3 className="h3">{s.name}</h3>
                <p>{s.blurb}</p>
                <p style={{ marginTop: 14, fontFamily: "var(--font-head)", fontSize: 13, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--blue-lt)" }}>
                  Details →
                </p>
              </Link>
            ))}
          </div>
          <p style={{ marginTop: 28, fontSize: 16.5, color: "var(--dim)" }}>
            Bigger than a handyman job? If it needs a specialty contractor, we
            say so before any money changes hands — and point you to the right
            trade.
          </p>
        </div>
      </section>
      <CtaBand num="02" />
    </main>
  );
}
