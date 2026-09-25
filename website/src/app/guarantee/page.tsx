import type { Metadata } from "next";
import Link from "next/link";
import { SITE } from "@/lib/site";
import { PageHero, CtaBand } from "@/components/blocks";

export const metadata: Metadata = {
  title: "Warranty & satisfaction guarantee",
  description: `${SITE.name}'s workmanship guarantee in plain terms: defects in workmanship repaired free for one year from the contract date. A trusted company since 2022.`,
  alternates: { canonical: "/guarantee" },
};

const TERMS = [
  "This guarantee is valid for one year from the date of the contract.",
  "Unless otherwise stated in the contract, Creed Handyman LLC will repair, free of charge, defects in workmanship for work performed under the contract.",
  "The guarantee becomes effective when payment has been made in full.",
  "Notify Creed Handyman LLC within 365 days of first knowledge of any defect, so we have the first opportunity to promptly repair items found to be defective within a reasonable period of time.",
  "The guarantee covers labor only. Materials are covered by their manufacturers' warranties, where offered.",
];

export default function GuaranteePage() {
  return (
    <main>
      <PageHero
        kicker="Warranty & Guarantee"
        title="100% satisfaction, guaranteed."
        lead="Our workmanship guarantee, in plain terms — the same promise on every job, no fine-print games."
      />

      <section className="band">
        <div className="container section two-col">
          <div>
            <h2 className="h2" style={{ fontSize: 28 }}>The guarantee</h2>
            <ul className="checklist" style={{ gridTemplateColumns: "1fr", marginTop: 20 }}>
              {TERMS.map((t) => (
                <li key={t.slice(0, 24)}><i />{t}</li>
              ))}
            </ul>
            <p style={{ marginTop: 24, fontSize: 15, lineHeight: 1.6, color: "var(--dim)" }}>
              What is not included: there are no other guarantees, expressed or
              implied, and there is no liability for consequential damages of
              any nature or kind.
            </p>
          </div>
          <div>
            <div className="card" style={{ marginBottom: 24, borderColor: "var(--blue)" }}>
              <h3 className="h3" style={{ fontSize: 18 }}>What this means for you</h3>
              <p style={{ fontSize: 16, lineHeight: 1.6, color: "var(--muted)", margin: 0 }}>
                If something we built or fixed fails because of our
                workmanship, call within the year and we come back and make it
                right — no charge for the labor. That is the whole deal.
              </p>
            </div>
            <div className="card">
              <h3 className="h3" style={{ fontSize: 18 }}>A trusted company since 2022</h3>
              <p style={{ fontSize: 15.5, lineHeight: 1.6, color: "var(--muted)", margin: 0 }}>
                Licensed &amp; insured, {SITE.rate}/hr quoted before the work
                starts, serving {SITE.areaLine}. Questions about the guarantee?{" "}
                <a href={SITE.phoneHref}>{SITE.phone}</a> or{" "}
                <Link href="/contact">send us a note</Link>.
              </p>
            </div>
          </div>
        </div>
      </section>

      <CtaBand num="02" />
    </main>
  );
}
