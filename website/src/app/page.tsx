import type { Metadata } from "next";
import Link from "next/link";
import { SITE, SERVICES, HERO, GALLERY, PRICE_POINTS, CREED, WORK_ORDER } from "@/lib/site";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};
import { Kicker, SecLabel, BeforeAfter, CtaBand, CredStrip } from "@/components/blocks";
import Img from "@/components/Img";

export default function HomePage() {
  return (
    <main>
      {/* ---------- Hero ---------- */}
      <section className="band">
        <div className="container hero-grid">
          <div>
            <Kicker>{SITE.city}, Kansas</Kicker>
            <h1 className="h1 h1-creed">
              {CREED.lines.map((l, i) => (
                <span className="line" key={i}>
                  <span className="cap">{l.letter}</span>
                  {l.rest}
                </span>
              ))}
              <span className="tail">{CREED.tail}</span>
            </h1>
            <p className="lead" style={{ maxWidth: "46ch" }}>
              Repairs done right — certified, insured, and straightforward.
              {" "}{SITE.rate} an hour with a two-hour minimum, quoted before
              the work starts.
            </p>
            <div className="btn-row" style={{ marginTop: 30 }}>
              <a href={WORK_ORDER.url} target="_blank" rel="noopener" className="btn btn-red">Request a quote</a>
            </div>
            <div className="hero-ticks">
              <span className="tick"><i />Licensed &amp; insured</span>
              <span className="tick"><i />Upfront pricing</span>
              <span className="tick"><i />Cleanup included</span>
            </div>
          </div>
          <div className="hero-photo">
            <div className="imgwrap">
              <Img
                src={HERO.after}
                alt="New Pergo plank flooring after a carpet tear-out on a Wichita job"
                style={{ width: "100%", aspectRatio: "4 / 5", objectFit: "cover", display: "block", filter: "saturate(.9) contrast(1.04)" }}
              />
              <div className="edge" />
              <div className="price">
                <b>{SITE.rate}</b>
                <span>/ hr</span>
              </div>
            </div>
            <div className="cap">{HERO.caption}</div>
          </div>
        </div>
      </section>

      {/* ---------- Credentials strip ---------- */}
      <CredStrip />

      {/* ---------- Services ---------- */}
      <section className="band" id="services">
        <div className="container section">
          <SecLabel>01 — Services</SecLabel>
          <h2 className="h2">What we fix</h2>
          <p className="sub">Six things we do most. If it is not on the list, ask.</p>
          <div className="svc-grid">
            {SERVICES.map((s, i) => (
              <Link href={`/services/${s.slug}`} className="svc" key={s.slug}>
                <div className="svc-num">
                  <span className="n">{String(i + 1).padStart(2, "0")}</span>
                  <span className="rule" />
                </div>
                <h3 className="h3">{s.name}</h3>
                <p>{s.blurb}</p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- Gallery ---------- */}
      <section className="band band-alt" id="gallery">
        <div className="container section">
          <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "baseline", justifyContent: "space-between", marginBottom: 36 }}>
            <div>
              <SecLabel>02 — Gallery</SecLabel>
              <h2 className="h2" style={{ marginBottom: 10 }}>Before &amp; after</h2>
              <p style={{ fontSize: 18, color: "var(--muted)", margin: 0 }}>Real jobs around Wichita.</p>
            </div>
            <Link href="/gallery" className="golink">See full gallery →</Link>
          </div>
          <div className="gal-grid">
            {GALLERY.slice(0, 2).map((g) => (
              <BeforeAfter key={g.title} {...g} />
            ))}
          </div>
        </div>
      </section>

      {/* ---------- Pricing ---------- */}
      <section className="band" id="pricing">
        <div className="container section price-grid">
          <div>
            <SecLabel>03 — Pricing</SecLabel>
            <h2 className="h2" style={{ marginBottom: 16 }}>One rate for everything.</h2>
            <p className="lead" style={{ fontSize: 17.5, marginBottom: 28 }}>
              You get an estimate before work starts, and the price on the
              invoice is the price we agreed on.
            </p>
            <div className="rate-slab">
              <div className="num">
                <b>{SITE.rate}</b>
                <span>/ hour</span>
              </div>
              <div className="min">{SITE.minimum}</div>
            </div>
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

      {/* ---------- Property managers band ---------- */}
      <section className="band band-alt" id="property-managers">
        <div className="container promo" style={{ padding: "48px 24px" }}>
          <div>
            <h2>Managing units in Wichita?</h2>
            <p>
              Make-ready turnovers and punch lists on the same rate, scheduled
              around your vacancy dates, one invoice per property.
            </p>
          </div>
          <Link href="/property-managers" className="btn btn-outline" style={{ whiteSpace: "nowrap" }}>
            For property managers
          </Link>
        </div>
      </section>

      {/* ---------- Community band ---------- */}
      <section className="band">
        <div className="container promo">
          <div>
            <div className="k" style={{ fontFamily: "var(--font-head)", fontSize: 12.5, letterSpacing: ".22em", textTransform: "uppercase", color: "var(--blue-lt)", marginBottom: 12 }}>
              Community
            </div>
            <h2>Serving our churches</h2>
            <p>Free labor for local churches that reach out. Materials at cost, first come first served.</p>
          </div>
          <Link href="/churches" className="golink">Reach out →</Link>
        </div>
      </section>

      {/* ---------- Closing CTA ---------- */}
      <CtaBand />
    </main>
  );
}
