import { createHmac, timingSafeEqual } from "crypto";

/**
 * Twilio webhook signature check (X-Twilio-Signature). Twilio signs the full
 * URL it called plus every POST field, sorted by name and concatenated as
 * name+value, with HMAC-SHA1 keyed by the account's auth token, base64.
 * Server-only. Tested in twilio-signature.test.ts.
 *
 * `url` must be the exact public URL configured in Twilio. Callers build it
 * from siteOrigin() (never the request Host header).
 */
export function twilioSignature(authToken: string, url: string, params: Record<string, string>): string {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, k) => acc + k + params[k], url);
  return createHmac("sha1", authToken).update(Buffer.from(data, "utf-8")).digest("base64");
}

export function validTwilioSignature(
  authToken: string | undefined,
  signature: string | null,
  url: string,
  params: Record<string, string>,
): boolean {
  if (!authToken || !signature) return false;
  const want = Buffer.from(twilioSignature(authToken, url, params));
  const got = Buffer.from(signature);
  return want.length === got.length && timingSafeEqual(want, got);
}

/** Form-encoded body -> plain object (last value wins on repeats). */
export function formParams(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(raw)) out[k] = v;
  return out;
}
