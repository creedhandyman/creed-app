/**
 * Server-only secrets for the Google Calendar connection: Google tokens are
 * stored AES-256-GCM encrypted, and the OAuth `state` is HMAC-signed. The key
 * comes from GOOGLE_TOKEN_KEY (any long random string), else is derived from
 * PORTAL_SESSION_SECRET, so it never lives in the database or in client code.
 */
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";

function key(): Buffer {
  const raw = process.env.GOOGLE_TOKEN_KEY || (process.env.PORTAL_SESSION_SECRET ? `gcal:${process.env.PORTAL_SESSION_SECRET}` : "");
  if (!raw) throw new Error("GOOGLE_TOKEN_KEY (or PORTAL_SESSION_SECRET) is not set");
  return createHash("sha256").update(raw).digest();
}

const b64u = (b: Buffer) => b.toString("base64url");

export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `v1.${b64u(iv)}.${b64u(c.getAuthTag())}.${b64u(ct)}`;
}

export function decrypt(enc: string | null | undefined): string | null {
  if (!enc) return null;
  const [v, iv, tag, ct] = enc.split(".");
  if (v !== "v1" || !iv || !tag || !ct) return null;
  try {
    const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
    d.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([d.update(Buffer.from(ct, "base64url")), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

const sign = (s: string) => createHmac("sha256", key()).update(`gcal-state:${s}`).digest("base64url");

/** OAuth state: who started the connect, for which business, until when, plus a browser nonce. */
export function makeState(orgId: string, userId: string, nonce: string, now = Date.now()): string {
  const body = b64u(Buffer.from(JSON.stringify({ o: orgId, u: userId, n: nonce, e: now + 15 * 60000 })));
  return `${body}.${sign(body)}`;
}

export function readState(state: string | null, now = Date.now()): { orgId: string; userId: string; nonce: string } | null {
  if (!state) return null;
  const [body, sig] = state.split(".");
  if (!body || !sig || !safeEqual(sig, sign(body))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { o?: string; u?: string; n?: string; e?: number };
    if (!p.o || !p.u || !p.n || !p.e || p.e < now) return null;
    return { orgId: p.o, userId: p.u, nonce: p.n };
  } catch {
    return null;
  }
}

export const newNonce = () => b64u(randomBytes(18));
