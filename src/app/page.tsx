/**
 * "/" — the marketing landing for visitors, the app for signed-in users.
 *
 * A server page so it can carry the home page's own SEO metadata (canonical,
 * title, description) and structured data. All the client logic — auth, the
 * app shell, the logged-in/out switch — lives in components/HomeGate.tsx,
 * which server-renders the landing copy (see its header comment).
 */
import type { Metadata } from "next";
import HomeGate from "@/components/HomeGate";
import { HOME_FAQ } from "@/components/marketing/home-content";
import { SEO_ORIGIN } from "@/lib/seo";
import { TRIAL_DAYS } from "@/lib/trial";

const TITLE = "Handyman Software for Quotes, Scheduling & Payments — Creed Handy Manager";
const DESCRIPTION = `Handyman business software built by a working handyman: AI quotes from photos, scheduling, time clock, invoicing and payments in one app. ${TRIAL_DAYS}-day free trial.`;

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/" },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    type: "website",
    url: "/",
    siteName: "Creed Handy Manager",
    images: ["/CREED_LOGO.png"],
  },
};

// Plan prices mirror TIERS in src/app/pricing/page.tsx. No aggregateRating on
// purpose: star ratings may only be marked up from real, on-page reviews.
const ORG_ID = `${SEO_ORIGIN}/#org`;
const JSON_LD = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": ORG_ID,
      name: "Creed Handyman LLC",
      url: SEO_ORIGIN,
      logo: `${SEO_ORIGIN}/CREED_LOGO.png`,
      sameAs: ["https://www.creedhandyman.com"],
    },
    {
      "@type": "WebSite",
      "@id": `${SEO_ORIGIN}/#website`,
      url: SEO_ORIGIN,
      name: "Creed Handy Manager",
      publisher: { "@id": ORG_ID },
    },
    {
      "@type": "SoftwareApplication",
      name: "Creed Handy Manager",
      url: SEO_ORIGIN,
      description: DESCRIPTION,
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web, iOS, Android",
      publisher: { "@id": ORG_ID },
      offers: {
        "@type": "AggregateOffer",
        lowPrice: "24.99",
        highPrice: "149.99",
        priceCurrency: "USD",
        offerCount: 3,
      },
    },
    {
      "@type": "FAQPage",
      mainEntity: HOME_FAQ.map((f) => ({
        "@type": "Question",
        name: f.q,
        acceptedAnswer: { "@type": "Answer", text: f.a },
      })),
    },
  ],
};

export default function Page() {
  return (
    <>
      <script
        type="application/ld+json"
        // Static data, but escape "<" so no string can ever close the tag.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD).replace(/</g, "\\u003c") }}
      />
      <HomeGate />
    </>
  );
}
