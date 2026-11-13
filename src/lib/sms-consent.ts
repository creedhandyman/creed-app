import { tryReadBlob } from "./job-blob";
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

const parse = (rooms: unknown): Obj | null => tryReadBlob(rooms);

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

/**
 * Every business text says how to stop them — carriers look for it (CTIA),
 * and Twilio acts on a STOP reply either way. Appends "Reply STOP to opt
 * out." on its own line unless the message already carries STOP wording
 * (e.g. an owner's custom review template that includes it). A plain
 * "stop by Tuesday" doesn't count as opt-out wording.
 */
export function withOptOut(body: string): string {
  const text = (body || "").trimEnd();
  if (!text) return text;
  if (/\b(?:reply|text|send)\s+["'“]?stop\b|\bstop\s+to\s+(?:opt|unsub|end|cancel|quit)/i.test(text)) return text;
  return `${text}\nReply STOP to opt out.`;
}

/* ------------------------------------------------------------------------
 * Per-CUSTOMER consent (customers.sms_consent, 2026-11-12).
 *
 * The job-blob record above stays (it's the proof captured on the job where
 * the customer checked the box). The customer row now carries the CURRENT
 * answer for that person, plus a short history, so:
 *   - an opt-in on one job covers that customer's other jobs;
 *   - the owner can record an opt-in the customer gave in person / on a call,
 *     or turn automatic texts off, from the customer page;
 *   - a STOP reply is written onto the customer (and START restores it).
 * `autoTextConsent` is the ONE rule every automatic Twilio send asks.
 * Hand-sent texts (the phone's own Messages app) never ask it.
 * --------------------------------------------------------------------- */

/** How an owner-recorded consent was given. */
export type ConsentMethod = "in_person" | "phone_call" | "in_writing" | "text_message";
export const CONSENT_METHODS: ConsentMethod[] = ["in_person", "phone_call", "in_writing", "text_message"];

export interface SmsConsentEntry extends SmsConsentRecord {
  /** Who recorded it (a team member's name) — owner-recorded answers only. */
  by?: string;
  method?: ConsentMethod;
  /** The job it came from, when it came from a job page. */
  jobId?: string;
  /** The number it covers (digits, last 10). A different number on the
   *  customer later means this answer no longer applies. */
  phone?: string;
}

export interface CustomerSmsConsent extends SmsConsentEntry {
  /** Earlier answers, newest first. */
  history?: SmsConsentEntry[];
}

export const CONSENT_HISTORY_MAX = 20;

const last10 = (p: unknown): string => {
  const d = typeof p === "string" ? p.replace(/\D/g, "") : "";
  return d.length >= 10 ? d.slice(-10) : "";
};

const when = (at: unknown): number => {
  const t = typeof at === "string" ? Date.parse(at) : NaN;
  return Number.isFinite(t) ? t : 0;
};

function cleanEntry(e: Partial<SmsConsentEntry> | null | undefined): SmsConsentEntry | null {
  if (!e || typeof e !== "object" || typeof e.granted !== "boolean") return null;
  const s = (v: unknown, n: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : undefined);
  const out: SmsConsentEntry = {
    granted: e.granted,
    at: s(e.at, 40) || "",
    source: s(e.source, 120) || "",
  };
  const text = s(e.text, 1000); if (text) out.text = text;
  const ip = s(e.ip, 64); if (ip) out.ip = ip;
  const by = s(e.by, 120); if (by) out.by = by;
  if (e.method && CONSENT_METHODS.includes(e.method)) out.method = e.method;
  const jobId = s(e.jobId, 64); if (jobId) out.jobId = jobId;
  const phone = last10(e.phone); if (phone) out.phone = phone;
  return out;
}

/** The customer's consent record (object or JSON string), if any. */
export function customerSmsConsentOf(raw: unknown): CustomerSmsConsent | null {
  let v: unknown = raw;
  if (typeof v === "string") {
    try { v = JSON.parse(v); } catch { return null; }
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const head = cleanEntry(v as Partial<SmsConsentEntry>);
  if (!head) return null;
  const hist = (v as { history?: unknown }).history;
  const history = Array.isArray(hist)
    ? hist.map((h) => cleanEntry(h as Partial<SmsConsentEntry>)).filter((h): h is SmsConsentEntry => !!h).slice(0, CONSENT_HISTORY_MAX)
    : [];
  return history.length ? { ...head, history } : head;
}

/**
 * The customer's next consent value, or null when nothing should be written.
 *   mode "form" — the customer's own optional box (website form, approval
 *     page, booking page): a yes always records; an unchecked box records a
 *     "no" only when nothing is on file (leaving it unchecked isn't a
 *     revocation — replying STOP is).
 *   mode "set" — an explicit answer (owner recorded it, STOP, START): always
 *     records.
 * The answer it replaces moves into `history` (newest first, capped).
 */
export function nextCustomerSmsConsent(
  prev: unknown,
  entry: SmsConsentEntry,
  mode: "form" | "set",
): CustomerSmsConsent | null {
  const head = cleanEntry(entry);
  if (!head) return null;
  const p = customerSmsConsentOf(prev);
  if (mode === "form" && !head.granted && p) return null;
  const history = p
    ? [cleanEntry(p) as SmsConsentEntry, ...(p.history || [])].slice(0, CONSENT_HISTORY_MAX)
    : [];
  return history.length ? { ...head, history } : head;
}

export interface AutoTextConsent {
  ok: boolean;
  /** Where the deciding answer lives: the customer row or a job's blob. */
  via: "customer" | "job" | null;
  record: SmsConsentEntry | null;
  /** Why not, in plain words (only when !ok). */
  reason?: string;
}

/**
 * May Creed send this customer an AUTOMATIC text? The newest answer wins:
 *   - the customer row's answer (yes or no), unless it was for a different
 *     phone number than the one on the customer now;
 *   - a "yes" on any of the given jobs' blobs (an unchecked box on a job is
 *     not a "no").
 * Nothing on file = no.
 */
export function autoTextConsent(
  customer: { sms_consent?: unknown; phone?: string | null } | null | undefined,
  ...jobRooms: unknown[]
): AutoTextConsent {
  let c: SmsConsentEntry | null = customerSmsConsentOf(customer?.sms_consent);
  if (c?.phone && last10(customer?.phone) && c.phone !== last10(customer?.phone)) c = null;
  let j: SmsConsentRecord | null = null;
  for (const r of jobRooms) {
    const x = smsConsentOf(r);
    if (x?.granted && (!j || when(x.at) > when(j.at))) j = x;
  }
  if (j && (!c || when(j.at) > when(c.at))) return { ok: true, via: "job", record: cleanEntry(j) };
  if (c) {
    return c.granted
      ? { ok: true, via: "customer", record: c }
      : { ok: false, via: "customer", record: c, reason: "Automatic texts are turned off for this customer." };
  }
  return { ok: false, via: null, record: null, reason: "This customer hasn't agreed to automatic texts." };
}

/* Resident (tenant) on a property-manager job: their own answer, recorded on
 * the job blob as `residentSmsConsent` (Jobs → resident section). The
 * customer's consent never covers the resident. Tied to the resident number
 * it was given for. */

export function residentSmsConsentOf(rooms: unknown): SmsConsentEntry | null {
  return cleanEntry(parse(rooms)?.residentSmsConsent as Partial<SmsConsentEntry> | undefined);
}

/** True only when the resident agreed to texts for THIS number. */
export function residentTextConsent(rooms: unknown, residentPhone: string | null | undefined): boolean {
  const r = residentSmsConsentOf(rooms);
  if (!r?.granted) return false;
  return !r.phone || r.phone === last10(residentPhone);
}
