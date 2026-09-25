import type { Metadata } from "next";
import Link from "next/link";
import { SERVICES, SITE } from "@/lib/site";
import { Kicker, CtaBand } from "@/components/blocks";

export const metadata: Metadata = {
  title: "Handyman services",
  description: `Plumbing, electrical, drywall and paint, doors and locks, mounting, and make-ready turnovers across ${SITE.areaLine}. ${SITE.rate}/hr, quoted first.`,
  alternates: { canonical: "/services" },
};

export default function ServicesPage() {
  return (
    <main>
      <section className="band">
        <div className="container two-col svc-hero" style={{ padding: "56px 24px 48px", alignItems: "center", gap: 40 }}>
          <div>
            <Kicker>Services</Kicker>
            <h1 className="h1">What we fix</h1>
            <p className="lead" style={{ maxWidth: "52ch" }}>
              Six things we do most, listed plainly. If your job is not on a
              list, ask anyway — odd jobs are the job.
            </p>
          </div>
          <div className="svc-art svc-art-desktop">
            <img src="/assets/neon-sign.webp" alt="Creed Handyman LLC — established 2022 — call 316-400-7414" />
          </div>
        </div>
      </section>
      <section className="band">
        <div className="container section">
          <div className="svc-art svc-art-mobile" style={{ marginBottom: 24 }}>
            <img src="/assets/neon-sign.webp" alt="Creed Handyman LLC — established 2022 — call 316-400-7414" />
          </div>
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
