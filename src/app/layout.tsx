import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./marketing.css";
import { ThemeProvider } from "@/components/ThemeProvider";
import { SEO_ORIGIN } from "@/lib/seo";

// Relative metadata URLs (canonicals, OG) resolve against the one indexed
// origin — www — not the env-driven app origin (see lib/seo.ts).
const SITE_URL = SEO_ORIGIN;

// Runs before first paint: flags a cached signed-in user so the home page's
// server-rendered landing stays hidden for them (HomeGate.tsx + globals.css
// .home-landing / .home-boot). Read-only; a bad value just means no flag.
const SESSION_FLAG_SCRIPT =
  'try{var u=JSON.parse(localStorage.getItem("c_user")||"null");if(u&&u.id)document.documentElement.setAttribute("data-session","1")}catch(e){}';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "Creed Handy Manager — run your whole handyman business from your pocket",
  description:
    "Quote with AI, schedule the crew, and get paid — all in one app. AI quoting, Voice Walk inspections, Stripe payments, payroll, and crew quests for handyman businesses.",
  icons: { icon: "/CREED_LOGO.png", apple: "/CREED_LOGO.png" },
  openGraph: {
    title: "Creed Handy Manager",
    description: "Run your whole handyman business from your pocket — AI quoting, crew scheduling, and payments in one app.",
    type: "website",
    url: SITE_URL,
    images: ["/CREED_LOGO.png"],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Creed",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  // viewport-fit=cover is the linchpin for the whole safe-area system:
  // without it iOS resolves every env(safe-area-inset-*) to 0, which
  // silently no-ops the bottom-nav height, the .mc bottom margin, and
  // the .sb sticky offset in globals.css. With it, all of that activates.
  viewportFit: "cover",
  themeColor: "#0a0a0f",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: SESSION_FLAG_SCRIPT }} />
        <link rel="manifest" href="/manifest.json" />
      </head>
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
