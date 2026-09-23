import { SITE, WORK_ORDER } from "@/lib/site";
import Img from "@/components/Img";

/** Kicker (red bar + blue label) used at the top of page heroes. */
export function Kicker({ children }: { children: React.ReactNode }) {
  return (
    <div className="kicker">
      <span className="bar" />
      <span className="txt">{children}</span>
    </div>
  );
}

/** Numbered section label with trailing rule — "01 — Services". */
export function SecLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="seclabel">
      <span className="txt">{children}</span>
      <span className="rule" />
    </div>
  );
}

/** Standard page hero: kicker + H1 + lead paragraph. */
export function PageHero({
  kicker,
  title,
  lead,
  children,
}: {
  kicker: string;
  title: React.ReactNode;
  lead?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <section className="band">
      <div className="container" style={{ padding: "56px 24px 48px" }}>
        <Kicker>{kicker}</Kicker>
        <h1 className="h1">{title}</h1>
        {lead ? <p className="lead" style={{ maxWidth: "52ch" }}>{lead}</p> : null}
        {children}
      </div>
    </section>
  );
}

/** One before/after gallery card. */
export function BeforeAfter({
  title,
  note,
  before,
  after,
}: {
  title: string;
  note: string;
  before: string;
  after: string;
}) {
  return (
    <div className="ba">
      <div className="ba-imgs">
        <div className="ba-cell">
          <Img
            src={before}
            alt={`${title} — before`}
            style={{ width: "100%", aspectRatio: "1 / 1", objectFit: "cover", display: "block" }}
            className="ph"
          />
          <span className="ba-tag">BEFORE</span>
        </div>
        <div className="ba-cell">
          <Img
            src={after}
            alt={`${title} — after`}
            style={{ width: "100%", aspectRatio: "1 / 1", objectFit: "cover", display: "block" }}
            className="ph"
          />
          <span className="ba-tag after">AFTER</span>
        </div>
      </div>
      <div className="ba-meta">
        <h3>{title}</h3>
        <p>{note}</p>
      </div>
    </div>
  );
}

/** Red closing CTA band shared by every page. */
export function CtaBand({
  label = "Get started",
  num = "04",
  title = "Tell us what needs fixing.",
  copy = "Send photos and a few details. You get a quote before anyone picks up a tool.",
}: {
  label?: string;
  num?: string;
  title?: string;
  copy?: string;
}) {
  return (
    <section className="band band-red" id="quote">
      {/* Decorative — the band's copy carries the message. */}
      <div className="cta-mascot" aria-hidden="true">
        <img src="/assets/mascot.jpg" alt="" />
      </div>
      <div className="container cta-close">
        <div className="kicker">
          <span className="bar" />
          <span className="txt">{num} — {label}</span>
        </div>
        <h2>{title}</h2>
        <p>{copy}</p>
        <div className="btn-row">
          {/* The Creed HM card takes photos + details straight onto the
              board — better than the plain form for the same job. */}
          <a href={WORK_ORDER.url} target="_blank" rel="noopener" className="btn btn-dark">Request a quote</a>
          <a href={SITE.phoneHref} className="btn btn-white">Call {SITE.phone}</a>
        </div>
      </div>
    </section>
  );
}

/** The 4-up credentials strip. */
export function CredStrip() {
  const CREDS = [
    { h: "NATE", p: "HVAC certified technician" },
    { h: "EPA 608", p: "Refrigerant handling certified" },
    { h: "Insured", p: "General liability on every job" },
    { h: "17,000+ hours", p: "Hands-on work experience" },
  ];
  return (
    <section className="cred-strip">
      <div className="container" style={{ paddingLeft: 24, paddingRight: 24 }}>
        <div className="cred-grid">
          {CREDS.map((c) => (
            <div className="cred" key={c.h}>
              <b>{c.h}</b>
              <p>{c.p}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
