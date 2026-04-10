import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/ThemeProvider";

export const metadata: Metadata = {
  title: "Creed Handyman LLC",
  description: "Handyman business management app",
  icons: { icon: "/CREED_LOGO.png", apple: "/CREED_LOGO.png" },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Creed Handyman",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#0a0a0f",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
