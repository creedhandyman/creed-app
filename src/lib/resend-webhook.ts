import crypto from "crypto";

// Resend signs its webhooks the Svix way: headers svix-id, svix-timestamp and
// svix-signature ("v1,<base64> v1,<base64>…"), signed with HMAC-SHA256 over
// "<id>.<timestamp>.<raw body>" using the base64 part of the whsec_ secret.
// Tested in src/__tests__/campaigns.test.ts.

const TOLERANCE_S = 5 * 60;

export function verifySvix(input: {
  secret: string | undefined;
  id: string | null;
  timestamp: string | null;
  signature: string | null;
  body: string;
  nowS?: number;
}): boolean {
  const { secret, id, timestamp, signature, body } = input;
  if (!secret || !id || !timestamp || !signature) return false;
  const ts = Number(timestamp);
  const now = input.nowS ?? Math.floor(Date.now() / 1000);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > TOLERANCE_S) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  if (!key.length) return false;
  const expected = crypto.createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest();
  return signature.split(" ").some((part) => {
    const [ver, sig] = part.split(",");
    if (ver !== "v1" || !sig) return false;
    const got = Buffer.from(sig, "base64");
    return got.length === expected.length && crypto.timingSafeEqual(got, expected);
  });
}

/** Resend event → the campaign_sends column it stamps. */
export const EVENT_COLUMN: Record<string, string> = {
  "email.delivered": "delivered_at",
  "email.opened": "opened_at",
  "email.clicked": "clicked_at",
  "email.bounced": "bounced_at",
  "email.complained": "complained_at",
};
