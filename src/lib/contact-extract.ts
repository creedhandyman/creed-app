/**
 * Contact info typed into a quote's description → the job's customer and
 * resident fields. Bernard writes things like
 *   "Tenant: Mary Jones 316-555-0142. Dog in back yard."
 *   "Customer Joe Nde, joe@example.com, (316) 555-0199 — repaint 2 bedrooms"
 * into Quick Quote (or the AppFolio intake puts "Tenant: Mary." into the
 * lead description). This pulls the names, phones and emails out so the
 * quote screen can offer them in one tap, and review requests later have
 * someone to go to.
 *
 * Pure and import-free (no AI, no network): runs instantly on the phone and
 * is tested on its own. Nothing here writes anything — QuoteForge's
 * ContactFound card shows the result and the owner confirms.
 *
 * Rules:
 *  - A LABEL decides who a contact is: Tenant / Resident / Occupant / Renter
 *    → resident; Customer / Client / Homeowner / Owner / Contact / Name →
 *    customer. The label's segment runs to the next label or line break.
 *  - Phones and emails with no label go in `loose`; the caller decides
 *    (resident on a property-manager job, else the customer) — see
 *    planContactFill.
 *  - Phones listed in `exclude` (the business's own numbers) are ignored, so
 *    "call me at 316-252-6335" never becomes the customer's number.
 */

export interface FoundContact {
  name: string;
  phone: string;
  email: string;
}

export interface ExtractedContacts {
  customer: FoundContact;
  resident: FoundContact;
  /** Unlabeled contact details (a name only when one sits right before the phone/email). */
  loose: FoundContact;
}

const EMPTY = (): FoundContact => ({ name: "", phone: "", email: "" });

const RESIDENT_WORDS = ["tenant", "tenants", "resident", "residents", "occupant", "occupants", "renter", "renters"];
const CUSTOMER_WORDS = ["customer", "client", "homeowner", "home owner", "owner", "contact", "name"];

// "Tenant:", "Tenant name:", "Resident -", "Customer = Joe". A separator is
// required, so "the owner said" never starts a segment.
const LABEL_RE = new RegExp(
  `(?:^|[\\s(,;.])((?:${[...RESIDENT_WORDS, ...CUSTOMER_WORDS].map((w) => w.replace(" ", "\\s+")).join("|")}))(?:\\s+(?:name|info|contact|phone|cell|#))?\\s*(?::|-|–|—|=)\\s*`,
  "gi",
);

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
// US numbers: 316-555-0142, (316) 555-0142, 316.555.0142, 3165550142, +1 316 555 0142.
const PHONE_RE = /(?<![\d-])(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?![\d-])/g;

/** Last 10 digits — how two spellings of the same number compare. */
export function phoneKey(p: string | null | undefined): string {
  const d = (p || "").replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : "";
}

/** "3165550142" → "(316) 555-0142"; anything else is returned trimmed. */
export function formatPhone(p: string): string {
  const k = phoneKey(p);
  return k ? `(${k.slice(0, 3)}) ${k.slice(3, 6)}-${k.slice(6)}` : p.trim();
}

// Words that can open a capitalized run but are never part of a person's name.
const NOT_NAME = new Set([
  "call", "text", "phone", "cell", "mobile", "email", "e-mail", "at", "or", "and", "the", "please", "pet", "pets",
  "dog", "cat", "work", "order", "wo", "maintenance", "limit", "unit", "apt", "suite", "ks", "kansas", "wichita",
  "tenant", "resident", "customer", "client", "owner", "homeowner", "contact", "name", "number", "tel", "ph",
  "is", "has", "will", "must", "home", "after", "before", "only", "mr", "mrs", "ms",
]);

/** A person's name at the START of a label segment: up to 4 words, stopping at
 *  punctuation, a digit, an @, or a word that isn't name-like. */
function leadingName(seg: string): string {
  const cut = seg.split(/[.,;:()|/\n\r]|\s[-–—]\s|\d|@/)[0] || "";
  const out: string[] = [];
  for (const w of cut.trim().split(/\s+/)) {
    if (!w) continue;
    const bare = w.replace(/['’]s$/i, "").replace(/[^A-Za-z'’-]/g, "");
    if (!bare || NOT_NAME.has(bare.toLowerCase())) break;
    // "&" style couples are written as "and" — stop there; keep it simple.
    if (!/^[A-Za-z]/.test(bare)) break;
    out.push(bare);
    if (out.length >= 4) break;
  }
  // A lone lowercase word after a label ("Tenant: unknown") isn't a name.
  if (out.length === 1 && out[0] === out[0].toLowerCase()) return "";
  return out.map((w) => (w === w.toLowerCase() ? w[0].toUpperCase() + w.slice(1) : w)).join(" ");
}

/** A capitalized name sitting right before a phone/email ("Mary Jones 316-…",
 *  "call Joe at …"). Empty when the words before it aren't name-like. */
function nameBefore(text: string, at: number): string {
  const before = text.slice(Math.max(0, at - 40), at);
  const m = before.match(/([A-Z][a-zA-Z'’-]+(?:\s+[A-Z][a-zA-Z'’-]+){0,2})\s*(?:at|@|:|-|–|,|is)?\s*\(?$/);
  if (!m) return "";
  const words = m[1].split(/\s+/).filter((w) => !NOT_NAME.has(w.toLowerCase()));
  return words.join(" ");
}

function firstOf(re: RegExp, s: string, skip: (v: string) => boolean): { value: string; index: number } | null {
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (!skip(m[0])) return { value: m[0], index: m.index };
  }
  return null;
}

/** Pull customer / resident / unlabeled contact details out of free text. */
export function extractContacts(text: string, opts: { exclude?: (string | null | undefined)[] } = {}): ExtractedContacts {
  const out: ExtractedContacts = { customer: EMPTY(), resident: EMPTY(), loose: EMPTY() };
  const src = (text || "").replace(/\\n/g, "\n");
  if (!src.trim()) return out;
  const excluded = new Set((opts.exclude || []).map(phoneKey).filter(Boolean));
  const skipPhone = (p: string) => !phoneKey(p) || excluded.has(phoneKey(p));
  const never = () => false;

  // Label positions → segments.
  const labels: { who: "customer" | "resident"; start: number; bodyStart: number }[] = [];
  LABEL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = LABEL_RE.exec(src))) {
    const word = m[1].toLowerCase().replace(/\s+/g, " ");
    const who = RESIDENT_WORDS.includes(word) ? "resident" : "customer";
    labels.push({ who, start: m.index + m[0].indexOf(m[1]), bodyStart: m.index + m[0].length });
  }

  const covered: [number, number][] = [];
  for (let i = 0; i < labels.length; i++) {
    const l = labels[i];
    const nextLabel = labels[i + 1]?.start ?? src.length;
    const nl = src.indexOf("\n", l.bodyStart);
    const end = Math.min(nextLabel, nl === -1 ? src.length : nl);
    const seg = src.slice(l.bodyStart, end);
    covered.push([l.start, end]);
    const slot = out[l.who];
    if (!slot.name) slot.name = leadingName(seg);
    if (!slot.phone) slot.phone = formatPhone(firstOf(PHONE_RE, seg, skipPhone)?.value || "");
    if (!slot.email) slot.email = (firstOf(EMAIL_RE, seg, never)?.value || "").toLowerCase();
  }

  // Unlabeled details: the first phone / email outside every label segment.
  const outside = (idx: number) => !covered.some(([a, b]) => idx >= a && idx < b);
  PHONE_RE.lastIndex = 0;
  while ((m = PHONE_RE.exec(src))) {
    if (!outside(m.index) || skipPhone(m[0])) continue;
    out.loose.phone = formatPhone(m[0]);
    out.loose.name = nameBefore(src, m.index);
    break;
  }
  EMAIL_RE.lastIndex = 0;
  while ((m = EMAIL_RE.exec(src))) {
    if (!outside(m.index)) continue;
    out.loose.email = m[0].toLowerCase();
    if (!out.loose.name) out.loose.name = nameBefore(src, m.index);
    break;
  }
  return out;
}

const hasAny = (c: FoundContact) => !!(c.name || c.phone || c.email);

export interface LinkedCustomer {
  id: string;
  name: string;
  type?: string | null;
  phone?: string | null;
  email?: string | null;
}

export interface ContactPlan {
  /** Customer details to offer. `match` = an existing customer they belong to. */
  customer: (FoundContact & { mode: "new" | "match" | "fill"; matchId?: string; matchName?: string }) | null;
  /** Resident details to offer — only the fields the job doesn't already have. */
  resident: FoundContact | null;
}

const norm = (s: string | null | undefined) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * What to OFFER, given what was found and what's already on the quote.
 * Never overwrites: a field already filled is left alone, and a property
 * manager customer is never changed (on PM jobs unlabeled details belong to
 * the resident).
 */
export function planContactFill(input: {
  found: ExtractedContacts;
  /** The customer already picked on the quote, if any. */
  linked: LinkedCustomer | null;
  /** The free-text client name on the quote (or the AI's read of it). */
  clientName: string;
  /** Resident already on the job (lib/resident residentContact). */
  residentOnFile: FoundContact;
  /** Existing customers, to match a found phone/email/name to. */
  customers: LinkedCustomer[];
}): ContactPlan {
  const { found, linked, residentOnFile, customers } = input;
  const pm = (linked?.type || "").trim().toLowerCase() === "property_manager"
    || /\b(key\s*renter|property\s*management|properties|realty|management)\b/i.test(input.clientName || "");

  // Who gets the unlabeled details.
  const res: FoundContact = { ...found.resident };
  const cus: FoundContact = { ...found.customer };
  const target = pm ? res : cus;
  if (!target.phone) target.phone = found.loose.phone;
  if (!target.email) target.email = found.loose.email;
  // Carry the loose name too, even with a customer picked: it's what tells a
  // picked customer's own number from someone else's (nameOk below).
  if (!target.name) target.name = found.loose.name;

  // Resident: only the blanks.
  const resOffer: FoundContact = {
    name: residentOnFile.name ? "" : res.name,
    phone: residentOnFile.phone ? "" : res.phone,
    email: residentOnFile.email ? "" : res.email,
  };

  let cusOffer: ContactPlan["customer"] = null;
  if (pm && linked) {
    cusOffer = null; // never touch the property manager's record
  } else if (linked) {
    // Fill the picked customer's blank phone/email — when the found name
    // doesn't clearly belong to someone else.
    const nameOk = !cus.name || norm(linked.name).includes(norm(cus.name).slice(0, 4)) || norm(cus.name).includes(norm(linked.name).slice(0, 4));
    const fill: FoundContact = {
      name: "",
      phone: !linked.phone && nameOk ? cus.phone : "",
      email: !linked.email && nameOk ? cus.email : "",
    };
    if (fill.phone || fill.email) cusOffer = { ...fill, mode: "fill", matchId: linked.id, matchName: linked.name };
  } else if (!pm) {
    const name = cus.name || (input.clientName || "").trim();
    if (cus.phone || cus.email || cus.name) {
      const k = phoneKey(cus.phone);
      const match = (k && customers.find((c) => phoneKey(c.phone) === k))
        || (cus.email && customers.find((c) => (c.email || "").toLowerCase() === cus.email))
        || (name && customers.find((c) => norm(c.name) === norm(name)))
        || null;
      cusOffer = match
        ? {
          name: match.name,
          phone: match.phone ? "" : cus.phone,
          email: match.email ? "" : cus.email,
          mode: "match", matchId: match.id, matchName: match.name,
        }
        : { name, phone: cus.phone, email: cus.email, mode: "new" };
    }
  }

  return {
    customer: cusOffer && (cusOffer.mode === "match" || hasAny(cusOffer)) ? cusOffer : null,
    resident: hasAny(resOffer) ? resOffer : null,
  };
}
