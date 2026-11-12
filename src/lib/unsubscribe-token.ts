import crypto from "crypto";

// Server-only signed token for a customer's email unsubscribe link
// (/u/[token] and the one-click List-Unsubscribe POST to /api/unsubscribe).
// Format: "<customerId>.<hmac>". Signed with PORTAL_SESSION_SECRET under its
// own "unsub:" purpose, so it can't be swapped for a portal or approval token.

function secret(): string {
  const s = process.env.PORTAL_SESSION_SECRET;
  if (!s) throw new Error("PORTAL_SESSION_SECRET is not set — cannot sign unsubscribe links.");
  return s;
}

const sign = (customerId: string) =>
  crypto.createHmac("sha256", secret()).update(`unsub:${customerId}`).digest("base64url");

export function signUnsubscribeToken(customerId: string): string {
  return `${customerId}.${sign(customerId)}`;
}

/** The customer id the token was made for, or null if it isn't ours. */
export function verifyUnsubscribeToken(token: string | null | undefined): string | null {
  if (!token || typeof token !== "string") return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const id = token.slice(0, dot);
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const a = Buffer.from(token.slice(dot + 1));
  const b = Buffer.from(sign(id));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return id;
}
