import type { Metadata } from "next";
import { SITE, WORK_ORDER } from "@/lib/site";
import { PageHero } from "@/components/blocks";
import QuoteForm from "@/components/QuoteForm";

export const metadata: Metadata = {
  title: "Request a quote",
  description: `Tell us what needs fixing — you get a quote before anyone picks up a tool. Or call ${SITE.phone}. Serving ${SITE.areaLine}.`,
};

export default function ContactPage() {
  return (
    <main>
      <PageHero
        kicker="Get started"
        title="Tell us what needs fixing."
        lead="A few details now, a number before any work starts. Prefer talking? The phone gets answered by the person holding the tools."
      />

      <section className="band">
        <div className="container section two-col">
          <div>
            <h2 className="h2" style={{ fontSize: 28, marginBottom: 24 }}>Request a quote</h2>
            <QuoteForm />
          </div>
          <div>
            <div className="card" style={{ marginBottom: 24, borderColor: "var(--blue)" }}>
              <h3 className="h3" style={{ fontSize: 18 }}>Have a work order ready?</h3>
              <p style={{ fontSize: 15.5, lineHeight: 1.6, color: "var(--muted)", margin: "0 0 16px" }}>
                Send it straight through our Creed HM card — photos, details,
                and the address in one go. It lands on our board the moment
                you hit send.
              </p>
              <a href={WORK_ORDER.url} target="_blank" rel="noopener" className="btn btn-red" style={{ fontSize: 14.5, padding: "12px 20px" }}>
                {WORK_ORDER.label}
              </a>
            </div>
            <div className="card" style={{ marginBottom: 24 }}>
              <h3 className="h3" style={{ fontSize: 18 }}>Faster by phone</h3>
              <p style={{ margin: "0 0 10px" }}>
                <a href={SITE.phoneHref} className="ftr-phone" style={{ fontSize: 26 }}>{SITE.phone}</a>
              </p>
              <p style={{ fontSize: 15.5, lineHeight: 1.6, color: "var(--muted)", margin: 0 }}>
                Call or text — texted photos get the fastest quotes. Email works
                too: <a href={`mailto:${SITE.email}`}>{SITE.email}</a>
              </p>
            </div>
            <div className="card" style={{ marginBottom: 24 }}>
              <h3 className="h3" style={{ fontSize: 18 }}>Hours</h3>
              <p style={{ fontSize: 15.5, lineHeight: 1.8, color: "var(--muted)", margin: 0 }}>
                {SITE.hours.map((r) => (
                  <span key={r.d} style={{ display: "block" }}>{r.d} — {r.h}</span>
                ))}
              </p>
            </div>
            <div className="card">
              <h3 className="h3" style={{ fontSize: 18 }}>Service area</h3>
              <p style={{ fontSize: 15.5, lineHeight: 1.6, color: "var(--muted)", margin: "0 0 14px" }}>
                {SITE.areaLine}. No trip charges inside Wichita.
              </p>
              <iframe
                title={`Map of ${SITE.county}, Kansas`}
                src="https://www.google.com/maps?q=Sedgwick+County,+KS&output=embed"
                style={{ width: "100%", height: 220, border: "2px solid var(--line)", display: "block", filter: "grayscale(.3)" }}
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
              />
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
