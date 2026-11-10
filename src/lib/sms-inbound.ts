/**
 * Incoming customer texts (Twilio → /api/sms/inbound): the pure rules. Who a
 * text belongs to, which keyword it is, which photos came with it. No
 * Supabase or network here, so it's all tested in sms-inbound.test.ts; the
 * route loads the candidates and does the writes.
 *
 * Matching, first hit wins:
 *   1. thread    we texted that number in the last 60 days: same business + job
 *   2. customer  exactly one customer has that number: their newest open job
 *   3. resident  exactly one recent job lists it as the resident: that job
 *   several      more than one of 2/3 in ONE business: newest job, flagged
 *   unknown      nothing found: goes to the business only if exactly one
 *                business on Creed has texting turned on (today: Creed
 *                Handyman), so a Make a lead button can pick it up later
 *   held         nothing found with several businesses texting, or the
 *                number is on file at more than one business that never
 *                texted it: saved with no business, shown to no one
 * Every business shares one sending number, so a text is only ever routed to
 * a business that texted that number or has it on file.
 */

/** "linked": not picked here; set when an owner files the conversation by hand
 *  (Texts: Link to customer / Move to job), and then followed like "thread". */
export type MatchStatus = "thread" | "customer" | "resident" | "several" | "unknown" | "held" | "linked";

export interface InboundMatch {
  orgId: string | null;
  jobId: string | null;
  customerId: string | null;
  status: MatchStatus;
  /** Customer or resident name when the match names one person. */
  name: string;
}

export interface MatchInput {
  /** Our newest logged text to this number in the last 60 days, or their
   *  newest text that an owner filed by hand (match "linked"). */
  thread: { orgId: string; jobId: string | null; customerId: string | null } | null;
  /** Customers (any business) whose phone ends in the same 10 digits. */
  customers: { id: string; orgId: string; name: string }[];
  /** Jobs of those customers, any status. */
  customerJobs: { id: string; customerId: string; orgId: string; status: string; createdAt: string }[];
  /** Recent jobs whose resident/tenant phone matches. */
  residentJobs: { id: string; orgId: string; name: string; createdAt: string }[];
  /** Businesses with texting from the business number turned on. */
  textingOrgs: string[];
}

/** Statuses that count as "still going" when picking a customer's job. */
const OPEN = new Set(["lead", "quoted", "accepted", "scheduled", "active", "inspection"]);

export const THREAD_DAYS = 60;
export const RESIDENT_DAYS = 180;

/** Last 10 digits of a US number, whatever format it was typed in ("" if fewer). */
export function last10(phone: string | null | undefined): string {
  const d = (phone || "").replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : "";
}

/** "+13165550142" → "(316) 555-0142"; anything else comes back as given. */
export function prettyPhone(phone: string): string {
  const d = last10(phone);
  return d ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : phone;
}

const newest = <T extends { createdAt: string }>(xs: T[]): T | undefined =>
  [...xs].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))[0];

/** A customer's job to attach a text to: newest open one, else newest. */
function jobFor(jobs: MatchInput["customerJobs"]): MatchInput["customerJobs"][number] | undefined {
  return newest(jobs.filter((j) => OPEN.has(j.status))) || newest(jobs);
}

export function pickMatch(m: MatchInput): InboundMatch {
  if (m.thread) {
    const c = m.customers.find((x) => x.id === m.thread!.customerId);
    const r = m.residentJobs.find((x) => x.id === m.thread!.jobId);
    return {
      orgId: m.thread.orgId,
      jobId: m.thread.jobId,
      customerId: m.thread.customerId,
      status: "thread",
      name: r?.name || c?.name || "",
    };
  }

  const orgs = new Set([...m.customers.map((c) => c.orgId), ...m.residentJobs.map((r) => r.orgId)]);
  if (orgs.size === 0) {
    const only = m.textingOrgs.length === 1 ? m.textingOrgs[0] : null;
    return { orgId: only, jobId: null, customerId: null, status: only ? "unknown" : "held", name: "" };
  }
  if (orgs.size > 1) return { orgId: null, jobId: null, customerId: null, status: "held", name: "" };

  const orgId = [...orgs][0];
  const custs = m.customers.filter((c) => c.orgId === orgId);
  const residents = m.residentJobs.filter((r) => r.orgId === orgId);
  const custJobs = m.customerJobs.filter((j) => j.orgId === orgId && custs.some((c) => c.id === j.customerId));

  if (custs.length === 1 && residents.length === 0) {
    const job = jobFor(custJobs);
    return { orgId, jobId: job?.id || null, customerId: custs[0].id, status: "customer", name: custs[0].name || "" };
  }
  if (custs.length === 0 && residents.length === 1) {
    return { orgId, jobId: residents[0].id, customerId: null, status: "resident", name: residents[0].name || "" };
  }

  // Several people or jobs share the number: attach to the newest job, flag it.
  const pick = newest([
    ...custJobs.map((j) => ({ id: j.id, customerId: j.customerId as string | null, createdAt: j.createdAt })),
    ...residents.map((r) => ({ id: r.id, customerId: null as string | null, createdAt: r.createdAt })),
  ]);
  return {
    orgId,
    jobId: pick?.id || null,
    customerId: custs.length === 1 ? custs[0].id : pick?.customerId || null,
    status: "several",
    name: "",
  };
}

export type Keyword = "stop" | "start" | "help";

export const OPT_OUT_WORDS = ["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "REVOKE", "OPTOUT"];
export const OPT_IN_WORDS = ["START", "UNSTOP", "YES"];
export const HELP_WORDS = ["HELP", "INFO"];

const wordOf = (text: string) => (text || "").toUpperCase().replace(/[^A-Z]/g, "");

/**
 * A whole-message STOP/START/HELP keyword (Twilio's rule: the text is just the
 * word). "Yes" only counts as START from someone who opted out (`optedOut`):
 * from anyone else it's an ordinary reply ("Yes, Tuesday works"), and it used
 * to be swallowed as an opt-in with no alert.
 */
export function keywordOf(text: string, optedOut = false): Keyword | null {
  const word = wordOf(text);
  if (OPT_OUT_WORDS.includes(word)) return "stop";
  if (word === "YES") return optedOut ? "start" : null;
  if (OPT_IN_WORDS.includes(word)) return "start";
  if (HELP_WORDS.includes(word)) return "help";
  return null;
}

/** True when the whole text is "yes" (the one keyword that depends on opt-out state). */
export const isYes = (text: string) => wordOf(text) === "YES";

export const MAX_PHOTOS = 5;

/** The picture attachments on a Twilio webhook (MediaUrl0…, MediaContentType0…). */
export function photosFrom(params: Record<string, string>): { url: string; contentType: string }[] {
  const n = Math.min(Number(params.NumMedia) || 0, 10);
  const out: { url: string; contentType: string }[] = [];
  for (let i = 0; i < n && out.length < MAX_PHOTOS; i++) {
    const url = params[`MediaUrl${i}`] || "";
    const contentType = (params[`MediaContentType${i}`] || "").toLowerCase();
    if (/^https:\/\/api\.twilio\.com\//.test(url) && contentType.startsWith("image/")) out.push({ url, contentType });
  }
  return out;
}

/** File extension for an image content type. */
export function imageExt(contentType: string): string {
  const t = contentType.toLowerCase();
  if (t.includes("png")) return "png";
  if (t.includes("gif")) return "gif";
  if (t.includes("webp")) return "webp";
  if (t.includes("heic")) return "heic";
  return "jpg";
}
