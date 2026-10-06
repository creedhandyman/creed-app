import type { Metadata } from "next";
import Link from "next/link";
import { SITE, SERVICES, HERO, GALLERY, PRICE_POINTS, CREED, WORK_ORDER, SPECIAL, REVIEWS, FAQ } from "@/lib/site";

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
            <Kicker>Wichita handyman · License #{SITE.license}</Kicker>
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
              Painting, flooring, repairs, and rental turnovers across
              Wichita — licensed, insured, and straightforward. Free
              estimates, and you get the price before any work starts.
            </p>
            <div className="btn-row" style={{ marginTop: 30 }}>
              <a href={WORK_ORDER.url} target="_blank" rel="noopener" className="btn btn-red">Get a free estimate</a>
              <a href={SITE.smsHref} className="btn btn-outline">Text a photo</a>
            </div>
            <a href="#reviews" className="hero-rating">
              <span className="stars" aria-hidden="true">★★★★★</span>
              <b>{REVIEWS.rating}</b> on {REVIEWS.source} · Read what customers say
            </a>
            <div className="hero-ticks">
              <span className="tick"><i />Licensed &amp; insured</span>
              <span className="tick"><i />Free estimates</span>
              <span className="tick"><i />Cleanup included</span>
            </div>
          </div>
          <div className="hero-photo">
            <div className="imgwrap">
              <Img
                src={HERO.after}
                alt="Bernard Reed, owner of Creed Handyman, standing by his work truck in Wichita"
                style={{ width: "100%", aspectRatio: "4 / 5", objectFit: "cover", display: "block", filter: "saturate(.9) contrast(1.04)" }}
              />
              <div className="edge" />
              <div className="price">
                <b>FREE</b>
                <span>estimates</span>
              </div>
            </div>
            <div className="cap">{HERO.caption}</div>
          </div>
        </div>
      </section>

      {/* ---------- Trust opener ---------- */}
      <section className="band">
        <div className="trust-grid">
          <div className="trust trust-blue">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="8" r="7" /><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88" />
            </svg>
            <span className="t-label">Official</span>
            <p>Quality home repairs — licensed &amp; insured for your protection.</p>
          </div>
          <Link href="/guarantee" className="trust trust-black">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" />
            </svg>
            <span className="t-label">Warranty</span>
            <p>Peace of mind with our satisfaction guarantee. Read the terms →</p>
          </Link>
          <div className="trust trust-red">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><polyline points="9 11.5 11 13.5 15 9.5" />
            </svg>
            <span className="t-label">Safe</span>
            <p>Experienced professionals with clean background checks.</p>
          </div>
          <div className="trust trust-white">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="13 17 18 12 13 7" /><polyline points="6 17 11 12 6 7" />
            </svg>
            <span className="t-label">Smooth</span>
            <p>Making home repairs seamless.</p>
          </div>
        </div>
      </section>

      {/* ---------- Reviews ---------- */}
      <section className="band band-alt" id="reviews">
        <div className="container section">
          <SecLabel>What customers say</SecLabel>
          <h2 className="h2" style={{ marginBottom: 10 }}>
            <span style={{ color: "#f5b301" }} aria-hidden="true">★★★★★ </span>
            {REVIEWS.rating} from every customer review
          </h2>
          <p className="sub" style={{ marginBottom: 28 }}>Verified reviews from {REVIEWS.source}. Real Wichita customers.</p>
          <div className="review-grid">
            {REVIEWS.items.map((r) => (
              <figure className="review" key={r.name}>
                <div className="stars" aria-label="5 out of 5 stars">★★★★★</div>
                <blockquote>“{r.text}”</blockquote>
                <figcaption><b>{r.name}</b> · {r.job}</figcaption>
              </figure>
            ))}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "12px 32px", marginTop: 24 }}>
            <a href={SITE.social.homeadvisor} target="_blank" rel="noopener" className="golink">Read our reviews on HomeAdvisor →</a>
            <a href={SITE.googleProfile} target="_blank" rel="noopener" className="golink">See us on Google →</a>
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
          <p className="sub">Handyman services across Wichita and Sedgwick County. If it is not on the list, ask.</p>
          <div className="svc-grid svc-grid-4">
            {SERVICES.map((s, i) => (
              <Link href={`/services/${s.slug}`} className="svc" key={s.slug}>
                <div className="svc-num">
                  <span className="n">{String(i + 1).padStart(2, "0")}</span>
                  <span className="rule" />
                </div>
                <h3 className="h3">{s.name}</h3>
                <p>{s.blurb}</p>
                <ul className="svc-tasks" aria-hidden="true">
                  {s.tasks.slice(0, 4).map((t) => <li key={t}>{t}</li>)}
                </ul>
                <span className="svc-more">See everything we do →</span>
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
        <div className="container section">
          <SecLabel>03 — Pricing</SecLabel>
          <h2 className="h2" style={{ marginBottom: 16 }}>One rate for everything.</h2>
          <p className="lead" style={{ fontSize: 17.5, marginBottom: 32, maxWidth: "60ch" }}>
            You get an estimate before work starts, and the price on the
            invoice is the price we agreed on.
          </p>
          <div className="price-grid price-plumb">
            <div className="price-cards">
              <div className="rate-slab">
                <div className="num">
                  <b>{SITE.rate}</b>
                  <span>/ hour</span>
                </div>
                <div className="min">{SITE.minimum}</div>
              </div>
              <div className="special">
                <span className="k">Special</span>
                <div className="num"><b>{SPECIAL.price}</b><span>{SPECIAL.title}</span></div>
                <p>{SPECIAL.note}</p>
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

      {/* ---------- FAQ ---------- */}
      <section className="band band-alt" id="faq">
        <div className="container section">
          <SecLabel>Questions</SecLabel>
          <h2 className="h2" style={{ marginBottom: 28 }}>Before you call</h2>
          <div className="faq">
            {FAQ.map((f) => (
              <details key={f.q}>
                <summary>{f.q}</summary>
                <p>{f.a}</p>
              </details>
            ))}
          </div>
        </div>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "FAQPage",
              mainEntity: FAQ.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
            }),
          }}
        />
      </section>

      {/* ---------- Closing CTA ---------- */}
      <CtaBand />
    </main>
  );
}
