import type { Metadata } from "next";
import { SITE, PRICE_POINTS } from "@/lib/site";
import { PageHero, CtaBand } from "@/components/blocks";

export const metadata: Metadata = {
  title: `Pricing — ${SITE.rate}/hr, one rate for everything`,
  description: `${SITE.rate} an hour with a two-hour minimum. No trip charges inside Wichita, materials at cost, cleanup included. The quote is the invoice.`,
  alternates: { canonical: "/pricing" },
};

export default function PricingPage() {
  return (
    <main>
      <PageHero
        kicker="Pricing"
        title="One rate for everything."
        lead="You get an estimate before work starts, and the price on the invoice is the price we agreed on. That is the whole pricing page — the rest is detail."
      />

      <section className="band">
        <div className="container section price-grid">
          <div>
            <div className="rate-slab">
              <div className="num">
                <b>{SITE.rate}</b>
                <span>/ hour</span>
              </div>
              <div className="min">{SITE.minimum}</div>
            </div>
            <p style={{ marginTop: 20, fontSize: 15.5, lineHeight: 1.55, color: "var(--dim)" }}>
              The two-hour minimum covers the truck, the tools, and getting to
              you — most call-out lists fill two hours easily, so bundle the
              small stuff into one visit and get more done for the same money.
            </p>
          </div>
          <div className="pointlist">
            {PRICE_POINTS.map((pt) => (
              <div className="point" key={pt.h}>
                <i />
                <div>
                  <b>{pt.h}</b>
                  <p>{pt.p}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="band band-alt">
        <div className="container section">
          <h2 className="h2" style={{ fontSize: 32 }}>How a job goes</h2>
          <div className="steps" style={{ marginTop: 28 }}>
            <div className="step">
              <span className="n">STEP 01</span>
              <b>Send it</b>
              <p>Call, or send photos and a few details through the quote form. Photos get you a number fastest.</p>
            </div>
            <div className="step">
              <span className="n">STEP 02</span>
              <b>Get the number</b>
              <p>You get the estimate before work starts. If something changes mid-job, you hear about it before it costs anything.</p>
            </div>
            <div className="step">
              <span className="n">STEP 03</span>
              <b>Done and clean</b>
              <p>Work done, mess gone, old material hauled off. Pay by card or check — every invoice carries an online payment link.</p>
            </div>
          </div>
          <p style={{ marginTop: 28, fontSize: 16, color: "var(--dim)", maxWidth: "70ch" }}>
            What we don&rsquo;t do: jobs that legally need a specialty contractor
            — full repipes, panel upgrades, roofing tear-offs. If your job is
            one of those, we tell you up front and point you to the right trade
            instead of billing hours at it.
          </p>
        </div>
      </section>

      <CtaBand num="02" />
    </main>
  );
}
