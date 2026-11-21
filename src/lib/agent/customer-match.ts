/**
 * The ONE customer matcher for agent calls. Customer phones are saved in
 * every format ("(316) 555-0101", "316.555.0101", "+13165550101"), emails in
 * any case — so both sides are normalized before comparing, and the same
 * tenant sent in by AppFolio, Angi and an email doesn't become three
 * customers. Pure: candidates in, best match out.
 */

/** Last 10 digits of a US phone ("" when fewer than 10 digits). */
export function phoneKey(raw: string | null | undefined): string {
  const d = String(raw || "").replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : "";
}

/** Lower-case, trimmed email ("" when it isn't one). Gmail dots / +tags are
 *  NOT folded: different addresses can be different people. */
export function emailKey(raw: string | null | undefined): string {
  const e = String(raw || "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : "";
}

/** Name folded for comparing: lower-case letters/digits, single spaces. */
export function nameKey(raw: string | null | undefined): string {
  return String(raw || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export interface CustomerLike {
  id: string;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
}

export interface MatchQuery {
  phone?: string | null;
  email?: string | null;
  name?: string | null;
}

export type MatchedBy = "phone" | "email" | "name";

export interface CustomerMatch<C extends CustomerLike> {
  customer: C;
  by: MatchedBy;
}

/**
 * Every candidate that matches, best first: phone, then email, then exact
 * folded name (name only when no phone/email was given, or nothing else
 * matched — a shared name alone is weak, so it ranks last).
 */
export function matchCustomers<C extends CustomerLike>(candidates: C[], q: MatchQuery): CustomerMatch<C>[] {
  const p = phoneKey(q.phone);
  const e = emailKey(q.email);
  const n = nameKey(q.name);
  const out: CustomerMatch<C>[] = [];
  const seen = new Set<string>();
  const add = (c: C, by: MatchedBy) => { if (!seen.has(c.id)) { seen.add(c.id); out.push({ customer: c, by }); } };
  if (p) for (const c of candidates) if (phoneKey(c.phone) === p) add(c, "phone");
  if (e) for (const c of candidates) if (emailKey(c.email) === e) add(c, "email");
  if (n && n.length >= 3 && !out.length) for (const c of candidates) if (nameKey(c.name) === n) add(c, "name");
  return out;
}

/** The single best match, or null. Only a phone or email match counts as
 *  "the same customer" for creating work orders — a name alone never does. */
export function sameCustomer<C extends CustomerLike>(candidates: C[], q: MatchQuery): C | null {
  const m = matchCustomers(candidates, q).find((x) => x.by !== "name");
  return m ? m.customer : null;
}
