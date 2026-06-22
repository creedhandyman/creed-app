import crypto from "crypto";

// Server-only HMAC token that binds a customer's quote-approval link to one
// specific job. It is NEVER stored on the job row, so reading the (publicly
// viewable) job does not reveal it — only someone actually sent the link can
// approve. Verified by /api/jobs/approve; minted by /api/status-link.

function secret(): string {
  const s = process.env.PORTAL_SESSION_SECRET;
  if (!s) {
    throw new Error("PORTAL_SESSION_SECRET is not set — cannot sign job approval tokens.");
  }
  return s;
}

export function signJobToken(jobId: string): string {
  return crypto.createHmac("sha256", secret()).update(`approve:${jobId}`).digest("base64url");
}

export function verifyJobToken(jobId: string, token: string | null | undefined): boolean {
  if (!token) return false;
  const expected = signJobToken(jobId);
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
