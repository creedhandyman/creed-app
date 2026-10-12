import type { Metadata } from "next";
import { GALLERY, SITE } from "@/lib/site";
import { PageHero, BeforeAfter, CtaBand } from "@/components/blocks";
import RecentWork from "@/components/RecentWork";

export const metadata: Metadata = {
  title: "Before & after gallery",
  description: `Real repair and turnover work around ${SITE.city} — photo-documented before and after, the way every Creed job is run.`,
  alternates: { canonical: "/gallery" },
};

export default function GalleryPage() {
  return (
    <main>
      <PageHero
        kicker="Gallery"
        title={<>Before &amp; after</>}
        lead="Real jobs around Wichita. Every job we run gets photo documentation — this page grows as work wraps up."
      />
      <section className="band">
        <div className="container section">
          <div className="gal-grid">
            {GALLERY.map((g) => (
              <BeforeAfter key={g.title} title={g.title} note={g.note} before={g.before} after={g.after} />
            ))}
          </div>
          <p style={{ marginTop: 32, fontSize: 16, color: "var(--dim)" }}>
            More recent work lands on{" "}
            <a href={SITE.social.facebook} target="_blank" rel="noopener">Facebook</a>
            {" "}and{" "}
            <a href={SITE.social.instagram} target="_blank" rel="noopener">Instagram</a>
            {" "}first — the gallery here gets the keepers.
          </p>
        </div>
      </section>
      <section className="band band-alt rw-band" aria-label="Recent work">
        <div className="container" style={{ paddingTop: 40, paddingBottom: 18 }}>
          <h2 className="h2" style={{ fontSize: 30, margin: 0 }}>More recent work</h2>
        </div>
        <RecentWork />
      </section>
      <CtaBand num="02" title="Want yours in this gallery?" />
    </main>
  );
}
