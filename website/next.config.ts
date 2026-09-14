import type { NextConfig } from "next";

// Static export — the whole site is plain HTML/CSS/JS. The only dynamic
// behavior (the quote form) POSTs to the Creed app's public /api/leads
// endpoint cross-origin, so no server is needed here. Deployable on
// Vercel (auto-detected) or any static host.
const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
};

export default nextConfig;
