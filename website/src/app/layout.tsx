import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import { Oswald, Source_Sans_3 } from "next/font/google";
import { SITE, CREED, WORK_ORDER } from "@/lib/site";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import Motion from "@/components/Motion";
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
    default: `${SITE.name} — Wichita, KS handyman | Free estimates`,
    template: `%s — ${SITE.name} | Wichita, KS`,
  },
  description: `Licensed, insured Wichita handyman: painting, flooring, repairs, and rental turnovers. Free estimates, 5-star reviews, $80 house-call special. Call ${SITE.phone}.`,
  openGraph: {
    type: "website",
    siteName: SITE.name,
    title: `${SITE.name} — ${CREED.sentence}`,
    description: `Wichita handyman. ${SITE.rate}/hr, two-hour minimum, quoted before work starts.`,
    images: ["/assets/bernard-truck.jpg"],
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
  image: `${SITE.domain}/assets/bernard-truck.jpg`,
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
      opens: "09:00",
      closes: "19:00",
    },
    { "@type": "OpeningHoursSpecification", dayOfWeek: "Saturday", opens: "09:00", closes: "12:00" },
  ],
  sameAs: [SITE.social.facebook, SITE.social.instagram, SITE.social.homeadvisor, SITE.googleProfile],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${oswald.variable} ${sourceSans.variable}`}>
      <body>
        <SiteHeader />
        {children}
        <SiteFooter />
        <nav className="callbar" aria-label="Contact">
          <a href={SITE.phoneHref}>Call</a>
          <a href={SITE.smsHref}>Text</a>
          <a href={WORK_ORDER.url} target="_blank" rel="noopener" className="cb-quote">Free estimate</a>
        </nav>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        <Motion />
        <Analytics />
      </body>
    </html>
  );
}
