import { NextRequest, NextResponse } from "next/server";

/**
 * IP-based rate limiting for the abuse-prone / cost-bearing API routes.
 *
 * Backed by Upstash Redis over its REST API — no SDK, just a fetch, the same
 * way the rest of this app talks to Twilio/Stripe. It is FAIL-OPEN by design:
 * if Upstash isn't configured (env vars unset) or is unreachable, requests are
 * allowed. This limiter protects the bill (Anthropic / OpenAI / Twilio / image
 * gen), so it must never take the app down.
 *
 * To activate: create an Upstash Redis DB and set in the environment
 *   UPSTASH_REDIS_REST_URL
 *   UPSTASH_REDIS_REST_TOKEN
 * Until then this is a no-op.
 */

export const config = {
  matcher: [
    "/api/ai/:path*",
    "/api/render",
    "/api/transcribe",
    "/api/sms",
    "/api/leads",
    "/api/waitlist",
    "/api/checkout",
    "/api/verify-payment",
    "/api/notify",
    "/api/promo/:path*",
    "/api/status-link",
    "/api/stripe/:path*",
    "/api/portal/request-link",
    "/api/portal/send-link",
  ],
};

// Requests per minute, per IP. Tighten the directly-cost-bearing ones.
const LIMITS: Record<string, number> = {
  "/api/ai": 5,
  "/api/ai/receipt": 10,
  "/api/render": 3,
  "/api/transcribe": 5,
  "/api/sms": 3,
  "/api/leads": 5,
  "/api/waitlist": 5,
  "/api/checkout": 10,
  "/api/verify-payment": 15,
  "/api/notify": 10,
  "/api/promo/apply": 5,
  "/api/status-link": 20,
  "/api/portal/request-link": 2,
  "/api/portal/send-link": 5,
};
const DEFAULT_LIMIT = 12; // e.g. /api/stripe/* (connect, portal, …)
const WINDOW_SEC = 60;

// Stripe must reach its webhook unthrottled — dropping events would be worse
// than any abuse. (Cron routes aren't in the matcher at all.)
const SKIP = new Set(["/api/stripe/webhook"]);

function clientIp(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for");
  // Vercel prepends the real client IP as the first entry, so the first hop is
  // the trustworthy one (a client-spoofed XFF can't displace it).
  let ip = xff ? xff.split(",")[0].trim() : (req.headers.get("x-real-ip") || "").trim();
  if (!ip) return "unknown";
  // Normalize IPv6 to its /64 prefix so one user can't rotate the low 64 bits.
  if (ip.includes(":")) ip = ip.split(":").slice(0, 4).join(":") + "::/64";
  return ip;
}

function limitFor(path: string): number {
  if (LIMITS[path] != null) return LIMITS[path];
  if (path.startsWith("/api/ai")) return LIMITS["/api/ai"];
  if (path.startsWith("/api/promo")) return LIMITS["/api/promo/apply"];
  return DEFAULT_LIMIT;
}

export async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;
  if (SKIP.has(path)) return NextResponse.next();

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return NextResponse.next(); // not configured → fail open

  const ip = clientIp(req);
  const limit = limitFor(path);
  const bucket = Math.floor(Date.now() / 1000 / WINDOW_SEC);
  const key = `rl:${path}:${ip}:${bucket}`;

  try {
    // One round trip: INCR the per-(path,ip,minute) counter and (re)set its TTL.
    const res = await fetch(`${url}/pipeline`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify([
        ["INCR", key],
        ["EXPIRE", key, String(WINDOW_SEC + 5)],
      ]),
    });
    if (!res.ok) return NextResponse.next(); // fail open
    const out = (await res.json()) as Array<{ result?: number; error?: string }>;
    const count = out?.[0]?.result ?? 0;
    if (count > limit) {
      return NextResponse.json(
        { error: "Too many requests — please slow down and try again shortly." },
        { status: 429, headers: { "Retry-After": String(WINDOW_SEC) } },
      );
    }
  } catch {
    return NextResponse.next(); // network error / timeout → fail open
  }
  return NextResponse.next();
}
