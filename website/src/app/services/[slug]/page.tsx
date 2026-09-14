import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SERVICES, SITE } from "@/lib/site";
import { Kicker, CtaBand } from "@/components/blocks";

export function generateStaticParams() {
  return SERVICES.map((s) => ({ slug: s.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const svc = SERVICES.find((s) => s.slug === slug);
  if (!svc) return {};
  return {
    title: `${svc.name} — Wichita handyman service`,
    description: `${svc.blurb} ${SITE.rate}/hr with a two-hour minimum across ${SITE.areaLine}, quoted before the work starts.`,
  };
}

export default async function ServicePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const svc = SERVICES.find((s) => s.slug === slug);
  if (!svc) notFound();

  const others = SERVICES.filter((s) => s.slug !== svc.slug);

  return (
    <main>
      <section className="band">
        <div className="container" style={{ padding: "56px 24px 48px" }}>
          <Kicker>{SITE.city}, Kansas · Service</Kicker>
          <h1 className="h1">{svc.name}</h1>
          <p className="lead" style={{ maxWidth: "52ch" }}>{svc.intro}</p>
          <div className="btn-row" style={{ marginTop: 30 }}>
            <Link href="/contact" className="btn btn-red">Request a quote</Link>
            <a href={SITE.phoneHref} className="btn btn-outline">Call {SITE.phone}</a>
          </div>
        </div>
      </section>

      <section className="band">
        <div className="container section two-col">
          <div>
            <h2 className="h2" style={{ fontSize: 30 }}>Common jobs</h2>
            <ul className="checklist" style={{ gridTemplateColumns: "1fr", marginTop: 20 }}>
              {svc.tasks.map((t) => (
                <li key={t}><i />{t}</li>
              ))}
            </ul>
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
              <h3 className="h3" style={{ fontSize: 18 }}>How it works</h3>
              <p style={{ fontSize: 15.5, lineHeight: 1.55, color: "var(--muted)", margin: 0 }}>
                Send photos and a description, or have us out to look. You get
                the number first, the work second, and a clean room after —
                cleanup and haul-away are part of the job, not an extra.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="band band-alt">
        <div className="container" style={{ padding: "36px 24px" }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "10px 22px", alignItems: "baseline" }}>
            <span style={{ fontFamily: "var(--font-head)", fontSize: 12.5, letterSpacing: ".22em", textTransform: "uppercase", color: "var(--dim)" }}>
              Also on the truck:
            </span>
            {others.map((s) => (
              <Link key={s.slug} href={`/services/${s.slug}`} className="golink" style={{ fontSize: 13.5 }}>
                {s.name}
              </Link>
            ))}
          </div>
        </div>
      </section>

      <CtaBand num="02" />
    </main>
  );
}
