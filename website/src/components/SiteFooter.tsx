import Link from "next/link";
import { SITE, CITY_PAGES } from "@/lib/site";

export default function SiteFooter() {
  return (
    <footer className="ftr">
      <div className="container">
        <div className="foot-grid">
          <div>
            <div className="ftr-brand">
              <img src={SITE.logo} alt="" />
              <span>{SITE.name}</span>
            </div>
            <p style={{ marginBottom: 12 }}>
              Mobile handyman service. We come to you — no storefront.
            </p>
            <a href={SITE.phoneHref} className="ftr-phone">{SITE.phone}</a>
            <p style={{ marginTop: 6 }}>
              <a href={`mailto:${SITE.email}`} style={{ color: "var(--muted)" }}>{SITE.email}</a>
            </p>
          </div>
          <div>
            <div className="ftr-label">Hours</div>
            <div className="txt">
              {SITE.hours.map((r) => (
                <div key={r.d}>{r.d} {r.h}</div>
              ))}
            </div>
          </div>
          <div>
            <div className="ftr-label">Service area — {SITE.county}</div>
            <p style={{ fontSize: 15 }}>
              {SITE.cities.map((c, i) => {
                const page = CITY_PAGES.find((cp) => cp.city === c);
                return (
                  <span key={c}>
                    {page ? <Link href={`/${page.slug}`} style={{ color: "var(--muted)", textDecoration: "underline" }}>{c}</Link> : c}
                    {i < SITE.cities.length - 1 ? ", " : "."}
                  </span>
                );
              })}
            </p>
          </div>
        </div>
        <div className="ftr-bottom">
          <span>© {new Date().getFullYear()} {SITE.name} · {SITE.city}, Kansas</span>
          <div className="ftr-links">
            <Link href="/services">Services</Link>
            <Link href="/pricing">Pricing</Link>
            <Link href="/about">About</Link>
            <Link href="/churches">Churches</Link>
            <Link href="/contact">Contact</Link>
            <a href={SITE.social.facebook} target="_blank" rel="noopener">Facebook</a>
            <a href={SITE.social.instagram} target="_blank" rel="noopener">Instagram</a>
          </div>
        </div>
      </div>
    </footer>
  );
}
