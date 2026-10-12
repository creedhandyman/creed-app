import type { Metadata } from "next";
import { SITE, WORK_ORDER, GALLERY } from "@/lib/site";
import { PageHero, CtaBand, BeforeAfter } from "@/components/blocks";
import EmailLink from "@/components/EmailLink";

export const metadata: Metadata = {
  title: "For property managers — make-ready & punch lists",
  description: `Make-ready turnovers, move-out inspections, and occupied-unit repairs. Scheduled around vacancy dates, one invoice per property, photo-documented completion, same ${SITE.rate}/hr rate. Wichita, Sedgwick County, Andover, and Newton.`,
  alternates: { canonical: "/property-managers" },
};

const POINTS = [
  { h: "Scheduled around vacancy dates", p: "Tell us the move-out and the show date. The unit is ready in between." },
  { h: "One invoice per property", p: "Clean paperwork your bookkeeping can file without a phone call." },
  { h: "Photo-documented completion", p: "Every turnover closes with a photo report of the finished work — proof for the owner file." },
  { h: "Same rate as everyone", p: `${SITE.rate}/hr, materials at cost. No PM premium, no volume games.` },
  { h: "Punch lists as written", p: "Send the list from your walkthrough — AppFolio work orders included — and it comes back checked off." },
  { h: "Insured, with COI on request", p: "General liability on every job. Certificate of insurance sent same day you ask." },
];

// What a full turnover can cover — pick what the unit needs.
const TURNOVER = [
  "Move-out inspection with photos",
  "Trash-out and haul-away",
  "Patch, texture, and paint",
  "Carpet tear-out and vinyl plank installs",
  "Fixtures, blinds, and smoke/CO detectors",
  "Rekeys and lock changes",
  "Caulk and grout refresh",
  "Small plumbing and electrical repairs",
  "Appliance hookups",
  "Final photo report for the owner file",
];

const STEPS = [
  { h: "Send the work order", p: "AppFolio work order, email, or our online form, with the vacancy dates if it's a turnover." },
  { h: "Quote & timeline", p: "Every job comes back with a price and a firm timeline sized to the scope, before work starts." },
  { h: "Work gets done", p: "Vacant units on your schedule; occupied units around your tenant's availability." },
  { h: "Photos & one invoice", p: "A photo report when it's done and one clean invoice per property." },
];

export default function PropertyManagersPage() {
  const proof = GALLERY.filter((g) => g.services?.includes("make-ready")).slice(0, 2);
  return (
    <main>
      <PageHero
        kicker="Property managers"
        title="Turnovers without the babysitting."
        lead="Make-ready work between tenants, start to finish, plus repair work orders while tenants are still in: patch and paint, flooring, fixtures, rekeys, and the punch list from your walkthrough. One crew, one invoice, unit ready to show."
      >
        <div className="btn-row" style={{ marginTop: 30 }}>
          <a href={WORK_ORDER.url} target="_blank" rel="noopener" className="btn btn-red">{WORK_ORDER.label}</a>
          <a href={SITE.phoneHref} className="btn btn-outline">Call {SITE.phone}</a>
          <EmailLink className="btn btn-outline" label="Email the shop" />
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
        <div className="container section two-col">
          <div>
            <h2 className="h2" style={{ fontSize: 30 }}>What a turnover covers</h2>
            <p className="sub" style={{ marginBottom: 20 }}>Pick what the unit needs, or send your walkthrough list and we work it as written.</p>
            <ul className="checklist" style={{ gridTemplateColumns: "1fr" }}>
              {TURNOVER.map((t) => <li key={t}><i />{t}</li>)}
            </ul>
          </div>
          <div>
            <div className="card" style={{ borderColor: "var(--blue)", marginBottom: 24 }}>
              <h3 className="h3" style={{ fontSize: 18 }}>Occupied-unit repairs</h3>
              <p style={{ fontSize: 16, lineHeight: 1.6, color: "var(--muted)", margin: 0 }}>
                Tenant still living there? Send the work order. We schedule
                around your tenant&rsquo;s availability, fix it, clean up, and close
                it out with photos so you know exactly what was done.
              </p>
            </div>
            <div className="card">
              <h3 className="h3" style={{ fontSize: 18 }}>Timelines, quoted per job</h3>
              <p style={{ fontSize: 16, lineHeight: 1.6, color: "var(--muted)", margin: 0 }}>
                A paint-and-blinds refresh and a full gut-and-floor turnover
                are different jobs. Every turnover gets a firm timeline with
                its quote, so you can set the show date with confidence.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="band">
        <div className="container section">
          <h2 className="h2" style={{ fontSize: 30, marginBottom: 28 }}>How it works</h2>
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

      {proof.length > 0 && (
        <section className="band band-alt">
          <div className="container section">
            <h2 className="h2" style={{ fontSize: 30, marginBottom: 8 }}>Turnovers, before &amp; after</h2>
            <p className="sub" style={{ marginBottom: 28 }}>Real rental make-readies. Drag the handle to compare.</p>
            <div className="gal-grid">
              {proof.map((g) => (
                <BeforeAfter key={g.title} title={g.title} note={g.note} before={g.before} after={g.after} />
              ))}
            </div>
          </div>
        </section>
      )}

      <section className="band">
        <div className="container promo" style={{ padding: "44px 24px" }}>
          <div>
            <h2>Standing work welcome</h2>
            <p>
              A handful of Wichita property managers keep us on their turnover
              rotation. If you manage units anywhere in {SITE.county}, Andover, or Newton, the
              first punch list is the audition — send one over.
            </p>
          </div>
          <a href={WORK_ORDER.url} target="_blank" rel="noopener" className="btn btn-outline" style={{ whiteSpace: "nowrap" }}>
            {WORK_ORDER.label}
          </a>
        </div>
      </section>

      <CtaBand num="02" title="Got a unit turning this month?" copy="Send the punch list or the vacancy dates. You get a number and a slot before you hang up." />
    </main>
  );
}
