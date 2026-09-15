import type { Metadata } from "next";
import { Oswald, Source_Sans_3 } from "next/font/google";
import { SITE, CREED } from "@/lib/site";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import "./globals.css";

const oswald = Oswald({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-head",
});
const sourceSans = Source_Sans_3({
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  variable: "--font-body",
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE.domain),
  title: {
    default: `${SITE.name} — Wichita, KS handyman | ${SITE.rate}/hr, quoted first`,
    template: `%s — ${SITE.name} | Wichita, KS`,
  },
  description: `Certified, insured handyman serving ${SITE.areaLine}. ${SITE.rate} an hour with a two-hour minimum, quoted before the work starts. Call ${SITE.phone}.`,
  openGraph: {
    type: "website",
    siteName: SITE.name,
    title: `${SITE.name} — ${CREED.sentence}`,
    description: `Wichita handyman. ${SITE.rate}/hr, two-hour minimum, quoted before work starts.`,
    images: ["/assets/hero.jpg"],
  },
};

// Service-area business: no street address on purpose (mobile service).
const jsonLd = {
  "@context": "https://schema.org",
  "@type": "HomeAndConstructionBusiness",
  name: SITE.name,
  legalName: SITE.legalName,
  url: SITE.domain,
  telephone: "+13164007414",
  email: SITE.email,
  image: `${SITE.domain}/assets/hero.jpg`,
  logo: `${SITE.domain}/assets/logo.png`,
  priceRange: `${SITE.rate}/hr`,
  address: {
    "@type": "PostalAddress",
    addressLocality: SITE.city,
    addressRegion: SITE.region,
    addressCountry: "US",
  },
  areaServed: SITE.cities.map((c) => ({ "@type": "City", name: `${c}, KS` })),
  openingHoursSpecification: [
    {
      "@type": "OpeningHoursSpecification",
      dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
      opens: "08:00",
      closes: "18:00",
    },
    { "@type": "OpeningHoursSpecification", dayOfWeek: "Saturday", opens: "08:00", closes: "14:00" },
  ],
  sameAs: [SITE.social.facebook, SITE.social.instagram],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${oswald.variable} ${sourceSans.variable}`}>
      <body>
        <SiteHeader />
        {children}
        <SiteFooter />
        <a href={SITE.phoneHref} className="callbar">Call {SITE.phone}</a>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </body>
    </html>
  );
}
