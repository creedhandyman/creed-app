"use client";

import { useState } from "react";
import Link from "next/link";
import { SITE } from "@/lib/site";

const NAV = [
  { href: "/services", label: "Services" },
  { href: "/gallery", label: "Gallery" },
  { href: "/pricing", label: "Pricing" },
  { href: "/property-managers", label: "Property managers" },
];

// Extra stops shown in the desktop hamburger menu and the mobile scroll-nav.
const NAV_EXTRA = [
  { href: "/about", label: "About" },
  { href: "/churches", label: "Churches" },
  { href: "/contact", label: "Contact" },
];

// The full-site menu behind the desktop hamburger.
const MENU = [{ href: "/", label: "Home" }, ...NAV, ...NAV_EXTRA];

export default function SiteHeader() {
  const [open, setOpen] = useState(false);

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
          <div className="hdr-menu">
            <button
              type="button"
              className="hdr-burger"
              aria-label="All pages"
              aria-expanded={open}
              onClick={() => setOpen(!open)}
            >
              <span /><span /><span />
            </button>
            {open && (
              <>
                <div className="hdr-menu-backdrop" onClick={() => setOpen(false)} />
                <nav className="hdr-menu-panel" aria-label="All pages">
                  {MENU.map((n) => (
                    <Link key={n.href} href={n.href} onClick={() => setOpen(false)}>
                      {n.label}
                    </Link>
                  ))}
                </nav>
              </>
            )}
          </div>
        </div>
      </div>
      <nav className="subnav" aria-label="Pages">
        {[...NAV, ...NAV_EXTRA].map((n) => (
          <Link key={n.href} href={n.href}>{n.label}</Link>
        ))}
      </nav>
    </header>
  );
}
