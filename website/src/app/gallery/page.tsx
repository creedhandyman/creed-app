import type { Metadata } from "next";
import { GALLERY, SITE } from "@/lib/site";
import { PageHero, BeforeAfter, CtaBand } from "@/components/blocks";

export const metadata: Metadata = {
  title: "Before & after gallery",
  description: `Real repair and turnover work around ${SITE.city} — photo-documented before and after, the way every Creed job is run.`,
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
              <BeforeAfter key={g.title} {...g} />
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
      <CtaBand num="02" title="Want yours in this gallery?" />
    </main>
  );
}
