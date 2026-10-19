import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Digital Asset Links for the Google Play (TWA) Android app. Android
 * verifies this file to let the app own creedhm.com links and run
 * fullscreen (no browser URL bar).
 *
 * Fingerprints come from the env var TWA_SHA256_FINGERPRINTS — a
 * comma-separated list of colon-formatted SHA-256 certificate
 * fingerprints from Play Console → Test and release → Setup →
 * App signing (the "App signing key certificate", plus optionally the
 * upload key certificate). Env-driven so adding/rotating a key is a
 * Vercel env change + redeploy, not a code change. 404s until set —
 * the TWA still works then, just with a visible URL bar.
 */
const PACKAGE_NAME = "com.creedhm.app";

export async function GET() {
  const fingerprints = (process.env.TWA_SHA256_FINGERPRINTS || "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  if (!fingerprints.length) {
    return NextResponse.json({ error: "Not configured" }, { status: 404 });
  }
  return NextResponse.json(
    [
      {
        relation: ["delegate_permission/common.handle_all_urls"],
        target: {
          namespace: "android_app",
          package_name: PACKAGE_NAME,
          sha256_cert_fingerprints: fingerprints,
        },
      },
    ],
    { headers: { "Cache-Control": "public, max-age=3600" } },
  );
}
