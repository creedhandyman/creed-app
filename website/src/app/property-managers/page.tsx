import type { Metadata } from "next";
import Link from "next/link";
import { SITE } from "@/lib/site";
import { PageHero, CtaBand } from "@/components/blocks";

export const metadata: Metadata = {
  title: "For property managers — make-ready & punch lists",
  description: `Turnovers scheduled around vacancy dates, one invoice per property, photo-documented completion, same ${SITE.rate}/hr rate. Wichita and Sedgwick County.`,
};

const POINTS = [
  { h: "Scheduled around vacancy dates", p: "Tell us the move-out and the show date. The unit is ready in between." },
  { h: "One invoice per property", p: "Clean paperwork your bookkeeping can file without a phone call." },
  { h: "Photo-documented completion", p: "Every turnover closes with a photo report of the finished work — proof for the owner file." },
  { h: "Same rate as everyone", p: `${SITE.rate}/hr, materials at cost. No PM premium, no volume games.` },
  { h: "Punch lists as written", p: "Send the list from your walkthrough — AppFolio work orders included — and it comes back checked off." },
  { h: "Insured, with COI on request", p: "General liability on every job. Certificate of insurance sent same day you ask." },
];

export default function PropertyManagersPage() {
  return (
    <main>
      <PageHero
        kicker="Property managers"
        title="Turnovers without the babysitting."
        lead="Make-ready work between tenants, start to finish: patch and paint, fixtures, rekeys, and the punch list from your walkthrough — one crew, one invoice, unit ready to show."
      >
        <div className="btn-row" style={{ marginTop: 30 }}>
          <a href={SITE.phoneHref} className="btn btn-red">Call {SITE.phone}</a>
          <a href={`mailto:${SITE.email}`} className="btn btn-outline">Email the shop</a>
        </div>
      </PageHero>

      <section className="band">
        <div className="container section">
          <div className="svc-grid">
            {POINTS.map((pt) => (
              <div className="svc" key={pt.h}>
                <div className="svc-num"><span className="rule" /></div>
                <h3 className="h3" style={{ fontSize: 19 }}>{pt.h}</h3>
                <p>{pt.p}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="band band-alt">
        <div className="container promo" style={{ padding: "44px 24px" }}>
          <div>
            <h2>Standing work welcome</h2>
            <p>
              A handful of Wichita property managers keep us on their turnover
              rotation. If you manage units anywhere in {SITE.county}, the
              first punch list is the audition — send one over.
            </p>
          </div>
          <Link href="/contact" className="btn btn-outline" style={{ whiteSpace: "nowrap" }}>
            Send a punch list
          </Link>
        </div>
      </section>

      <CtaBand num="02" title="Got a unit turning this month?" copy="Send the punch list or the vacancy dates. You get a number and a slot before you hang up." />
    </main>
  );
}
