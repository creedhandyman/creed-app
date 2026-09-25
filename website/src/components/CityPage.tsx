import Link from "next/link";
import { SITE, WORK_ORDER, CITY_PAGES } from "@/lib/site";
import { Kicker, CtaBand } from "@/components/blocks";

type City = (typeof CITY_PAGES)[number];

/** Shared template for the per-city service-area pages. */
export default function CityPage({ data }: { data: City }) {
  return (
    <main>
      <section className="band">
        <div className="container" style={{ padding: "56px 24px 48px" }}>
          <Kicker>Service area · {SITE.county}</Kicker>
          <h1 className="h1">Handyman in {data.city}, Kansas</h1>
          <p className="lead" style={{ maxWidth: "52ch" }}>{data.intro}</p>
          <div className="btn-row" style={{ marginTop: 30 }}>
            <a href={WORK_ORDER.url} target="_blank" rel="noopener" className="btn btn-red">Request a quote</a>
            <a href={SITE.phoneHref} className="btn btn-outline">Call {SITE.phone}</a>
          </div>
        </div>
      </section>

      <section className="band">
        <div className="container section two-col">
          <div>
            <h2 className="h2" style={{ fontSize: 30 }}>Work we do in {data.city}</h2>
            {data.body.map((p) => (
              <p key={p.slice(0, 24)} style={{ fontSize: 17, lineHeight: 1.6, color: "var(--muted)", margin: "18px 0 0" }}>
                {p}
              </p>
            ))}
            <ul className="checklist" style={{ gridTemplateColumns: "1fr", marginTop: 24 }}>
              {data.jobs.map((j) => (
                <li key={j}><i />{j}</li>
              ))}
            </ul>
            <p style={{ marginTop: 22, fontSize: 15.5, color: "var(--dim)" }}>
              Full list on the <Link href="/services">services page</Link> — and
              if your job is not on any list, ask anyway.
            </p>
          </div>
          <div>
            <div className="rate-slab" style={{ marginBottom: 24 }}>
              <div className="num">
                <b>{SITE.rate}</b>
                <span>/ hour</span>
              </div>
              <div className="min">{SITE.minimum} · quoted before work starts</div>
            </div>
            <div className="card">
              <h3 className="h3" style={{ fontSize: 18 }}>Hours</h3>
              <p style={{ fontSize: 15.5, lineHeight: 1.8, color: "var(--muted)", margin: 0 }}>
                {SITE.hours.map((r) => (
                  <span key={r.d} style={{ display: "block" }}>{r.d} — {r.h}</span>
                ))}
              </p>
              <p style={{ fontSize: 15, color: "var(--dim)", margin: "14px 0 0" }}>
                Based in Wichita · serving {SITE.areaLine}.
              </p>
            </div>
          </div>
        </div>
      </section>

      <CtaBand num="02" title={`Got a ${data.city} job for us?`} />
    </main>
  );
}
