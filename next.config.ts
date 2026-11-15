import type { NextConfig } from "next";

// Response headers for every page and API route. No CSP yet (the app uses
// inline styles and blob: print pages; a CSP needs its own pass).
const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
        ],
      },
      // The pages where a customer signs or pays must not be framed by another site.
      ...["/status", "/portal/:path*", "/payment/:path*"].map((source) => ({
        source,
        headers: [{ key: "X-Frame-Options", value: "DENY" }],
      })),
    ];
  },
};

export default nextConfig;
