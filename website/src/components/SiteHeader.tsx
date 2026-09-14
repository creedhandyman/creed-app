import Link from "next/link";
import { SITE } from "@/lib/site";

const NAV = [
  { href: "/services", label: "Services" },
  { href: "/gallery", label: "Gallery" },
  { href: "/pricing", label: "Pricing" },
  { href: "/property-managers", label: "Property managers" },
];

// Extra stops for the mobile scroll-nav (desktop reaches these via footer/CTAs).
const NAV_MOBILE_EXTRA = [
  { href: "/about", label: "About" },
  { href: "/churches", label: "Churches" },
  { href: "/contact", label: "Contact" },
];

export default function SiteHeader() {
  return (
    <header className="hdr">
      <div className="hdr-in">
        <Link href="/" className="hdr-logo">
          <img src={SITE.logo} alt="" />
          <span className="hdr-word">
            Creed<span> Handyman</span>
          </span>
        </Link>
        <div className="hdr-right">
          <nav className="nav" aria-label="Main">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href}>{n.label}</Link>
            ))}
          </nav>
          <a href={SITE.phoneHref} className="hdr-call">{SITE.phone}</a>
        </div>
      </div>
      <nav className="subnav" aria-label="Pages">
        {[...NAV, ...NAV_MOBILE_EXTRA].map((n) => (
          <Link key={n.href} href={n.href}>{n.label}</Link>
        ))}
      </nav>
    </header>
  );
}
