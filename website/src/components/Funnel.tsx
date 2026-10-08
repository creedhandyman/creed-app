import Link from "next/link";
import { SITE, WORK_ORDER, CITY_PAGES } from "@/lib/site";
import { SecLabel } from "@/components/blocks";
import EmailLink from "@/components/EmailLink";

/* Homepage "funnel" sections — each one condenses a full page (About,
   How it works, Guarantee, Service area, Contact) into the homepage so a
   desktop visitor walks trust → proof → price → guarantee → book without
   leaving. `pc-only` hides a section on phones (How it works + Guarantee
   show everywhere; the rest stay desktop-only to keep the phone page short). */

export function MeetOwner() {
  const PLEDGE = [
    "You get the price before any work starts",
    "I show up when I say I will",
    "Cleanup and haul-away are part of the job",
    "Photos of the finished work, every job",
    "One-year workmanship guarantee",
  ];
  return (
    <section className="band pc-only" id="about">
      <div className="container section two-col">
        <div>
          <SecLabel>Meet the owner</SecLabel>
          <h2 className="h2" style={{ fontSize: 34 }}>The person who quotes it is the person who fixes it.</h2>
          <p className="fn-p">
            Creed Handyman is Bernard Reed&rsquo;s shop: a working tradesman, not a
            dispatcher. Seventeen thousand-plus hours on the tools, NATE-certified
            in HVAC with EPA 608, licensed (#{SITE.license}) and insured by{" "}
            {SITE.insurer} on every job.
          </p>
          <p className="fn-p">
            We are a faith-led shop, and it shows up in the work: honest numbers,
            materials at cost, and free labor for local churches that reach out.
          </p>
          <Link href="/about" className="golink" style={{ display: "inline-block", marginTop: 8 }}>More about us →</Link>
        </div>
        <div className="card fn-pledge">
          <h3 className="h3" style={{ fontSize: 18 }}>My promise on every job</h3>
          <ul className="checklist" style={{ gridTemplateColumns: "1fr", marginTop: 16 }}>
            {PLEDGE.map((p) => <li key={p}><i />{p}</li>)}
          </ul>
          <p className="fn-sign">— Bernard Reed, owner</p>
        </div>
      </div>
    </section>
  );
}

export function HowItWorks() {
  const STEPS = [
    { h: "Send it over", p: "Text a photo, call, or send the work order. Two minutes, tops." },
    { h: "Free estimate", p: "You get the number before anyone picks up a tool. No surprise invoices." },
    { h: "We do the work", p: "On the day we set, start to finish. Cleanup and haul-away included." },
    { h: "Done & guaranteed", p: "Photos of the finished job, backed by our one-year workmanship guarantee." },
  ];
  return (
    <section className="band band-alt" id="process">
      <div className="container section">
        <SecLabel>How it works</SecLabel>
        <h2 className="h2" style={{ marginBottom: 32 }}>From photo to finished in four steps</h2>
        <ol className="fn-steps">
          {STEPS.map((s, i) => (
            <li key={s.h}>
              <span className="fn-n">{i + 1}</span>
              <b>{s.h}</b>
              <p>{s.p}</p>
            </li>
          ))}
        </ol>
        <div className="btn-row" style={{ marginTop: 32 }}>
          <a href={WORK_ORDER.url} target="_blank" rel="noopener" className="btn btn-red">Start with step 1</a>
          <a href={SITE.smsHref} className="btn btn-outline">Text a photo</a>
        </div>
      </div>
    </section>
  );
}

export function GuaranteeBand() {
  return (
    <section className="band" id="guarantee">
      <div className="container section">
        <div className="fn-guarantee">
          <div className="fn-seal" aria-hidden="true">
            <b>1</b><span>year</span>
          </div>
          <div>
            <SecLabel>Guarantee</SecLabel>
            <h2 className="h2" style={{ marginBottom: 12 }}>100% satisfaction, guaranteed.</h2>
            <p className="fn-p" style={{ maxWidth: "62ch" }}>
              If something we built or fixed fails because of our workmanship, call
              within the year and we come back and make it right — no charge for the
              labor. One year from the contract date, effective once the job is paid
              in full. A trusted company since 2022.
            </p>
            <Link href="/guarantee" className="golink">Read the full terms →</Link>
          </div>
        </div>
      </div>
    </section>
  );
}

export function ServiceArea() {
  const pageFor = (c: string) => CITY_PAGES.find((p) => p.city === c)?.slug;
  return (
    <section className="band pc-only" id="area">
      <div className="container section" style={{ paddingTop: 48, paddingBottom: 48 }}>
        <SecLabel>Service area</SecLabel>
        <h2 className="h2" style={{ fontSize: 30, marginBottom: 18 }}>Wichita and all of {SITE.county}</h2>
        <div className="fn-cities">
          {SITE.cities.map((c) => {
            const slug = pageFor(c);
            return slug ? (
              <Link key={c} href={`/${slug}`} className="fn-city fn-city-link">{c} <span aria-hidden="true">→</span></Link>
            ) : (
              <span key={c} className="fn-city">{c}</span>
            );
          })}
        </div>
        <p style={{ fontSize: 15.5, color: "var(--dim)", margin: "16px 0 0" }}>
          Mobile service — we come to you. No trip charge inside Wichita.
        </p>
      </div>
    </section>
  );
}

export function ContactStrip() {
  return (
    <section className="band band-alt pc-only" id="book">
      <div className="container section">
        <SecLabel>Get your free estimate</SecLabel>
        <h2 className="h2" style={{ marginBottom: 28 }}>Ready when you are</h2>
        <div className="fn-contact">
          <div className="card" style={{ borderColor: "var(--red)" }}>
            <h3 className="h3" style={{ fontSize: 18 }}>Free estimate</h3>
            <p>Photos, details, and the address in one go. It lands on our board the moment you hit send.</p>
            <a href={WORK_ORDER.url} target="_blank" rel="noopener" className="btn btn-red" style={{ fontSize: 14.5, padding: "12px 20px" }}>Get a free estimate</a>
          </div>
          <div className="card">
            <h3 className="h3" style={{ fontSize: 18 }}>Call or text</h3>
            <p><a href={SITE.phoneHref} className="ftr-phone" style={{ fontSize: 24 }}>{SITE.phone}</a></p>
            <p>Texted photos get the fastest quotes. Email: <EmailLink /></p>
          </div>
          <div className="card">
            <h3 className="h3" style={{ fontSize: 18 }}>Hours</h3>
            <p style={{ lineHeight: 1.8 }}>
              {SITE.hours.map((r) => (
                <span key={r.d} style={{ display: "block" }}>{r.d} — {r.h}</span>
              ))}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
