/**
 * Text-message consent (A2P 10DLC / CTIA): business texts need a recorded,
 * customer-given opt-in. It lives on the job's rooms blob as `smsConsent`,
 * written when the customer checks the optional text box on the website quote
 * form (/api/leads) or on the quote approval page (/api/jobs/approve). The
 * blob survives QuoteForge saves (saveJob spreads prevData), so a website
 * opt-in carries through to the quoted job.
 *
 * It covers the person who gave it — the customer — never a resident/tenant
 * on a property-management job. Kept free of imports so server routes and the
 * public /status page can share it.
 */

export interface SmsConsentRecord {
  granted: boolean;
  /** ISO time of the opt-in (or decline). */
  at: string;
  /** Where it was given, e.g. "website quote form", "quote approval page". */
  source: string;
  /** The exact disclosure wording the customer saw. */
  text?: string;
  /** Requester IP — internal; stripped from customer-facing payloads. */
  ip?: string;
}

type Obj = Record<string, unknown>;

const parse = (rooms: unknown): Obj | null => {
  try {
    const b = typeof rooms === "string" ? JSON.parse(rooms) : rooms;
    return b && typeof b === "object" && !Array.isArray(b) ? (b as Obj) : null;
  } catch {
    return null;
  }
};

/** The consent record on a job's rooms blob (string or object), if any. */
export function smsConsentOf(rooms: unknown): SmsConsentRecord | null {
  const c = parse(rooms)?.smsConsent as Partial<SmsConsentRecord> | undefined;
  return c && typeof c === "object" && typeof c.granted === "boolean" ? (c as SmsConsentRecord) : null;
}

/** True only when the customer opted in to texts for this job. */
export function smsConsentGranted(rooms: unknown): boolean {
  return smsConsentOf(rooms)?.granted === true;
}

/**
 * Merge a new consent answer into a blob object (mutates and returns it).
 * A "yes" always records. A "no" (the box left unchecked) is recorded only
 * when there's no earlier answer — leaving an optional box unchecked isn't a
 * revocation; that's what replying STOP is for.
 */
export function applySmsConsent(blob: Obj, next: SmsConsentRecord): Obj {
  const prev = blob.smsConsent as Partial<SmsConsentRecord> | undefined;
  if (next.granted || !prev || typeof prev.granted !== "boolean") {
    blob.smsConsent = {
      granted: next.granted,
      at: next.at,
      source: next.source,
      ...(next.text ? { text: next.text.slice(0, 1000) } : {}),
      ...(next.ip ? { ip: next.ip } : {}),
    };
  }
  return blob;
}
