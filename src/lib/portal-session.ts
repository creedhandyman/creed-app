import crypto from "crypto";

// Server-only helpers for the customer portal's signed-cookie session.
//
// We don't use Supabase Auth for portal customers — they're not real users in
// auth.users, just rows in the `clients` table. So the session is an
// HMAC-signed payload carrying the customer's id + org_id + expiry, stored in
// an HttpOnly cookie. Stateless: no DB lookup needed to verify a request.
//
// Single-use magic-link redemption is enforced via the portal_tokens table
// (used_at), but once redeemed the cookie itself is the source of truth.

const SECRET = process.env.PORTAL_SESSION_SECRET || "creed-portal-fallback-secret-change-me";
const COOKIE_NAME = "creed_portal";
// 30-day session — long enough that customers don't need a fresh magic link
// every visit, short enough that a stolen cookie eventually expires.
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface PortalSession {
  customer_id: string;
  org_id: string;
  expires_at: number;
}

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromB64url(s: string): Buffer {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

export function signSession(session: PortalSession): string {
  const payload = b64url(Buffer.from(JSON.stringify(session)));
  const sig = b64url(crypto.createHmac("sha256", SECRET).update(payload).digest());
  return `${payload}.${sig}`;
}

export function verifySession(cookie: string | undefined | null): PortalSession | null {
  if (!cookie) return null;
  const parts = cookie.split(".");
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  const expected = b64url(crypto.createHmac("sha256", SECRET).update(payload).digest());
  // Length-checked timing-safe compare so a wrong-length sig doesn't throw.
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const data = JSON.parse(fromB64url(payload).toString("utf8")) as PortalSession;
    if (!data.customer_id || !data.org_id || !data.expires_at) return null;
    if (Date.now() > data.expires_at) return null;
    return data;
  } catch {
    return null;
  }
}

export function buildSessionCookie(customerId: string, orgId: string): {
  name: string;
  value: string;
  options: { httpOnly: true; secure: true; sameSite: "lax"; path: "/"; maxAge: number };
} {
  const session: PortalSession = {
    customer_id: customerId,
    org_id: orgId,
    expires_at: Date.now() + SESSION_TTL_MS,
  };
  return {
    name: COOKIE_NAME,
    value: signSession(session),
    options: {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: Math.floor(SESSION_TTL_MS / 1000),
    },
  };
}

export const PORTAL_COOKIE_NAME = COOKIE_NAME;

// Generate a URL-safe one-time token for the magic link. 32 bytes ≈ 256 bits
// of entropy — way more than enough to make brute-forcing pointless.
export function generatePortalToken(): string {
  return b64url(crypto.randomBytes(32));
}
