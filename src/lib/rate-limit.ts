/**
 * Rate limits for the PUBLIC, unauthenticated endpoints (lead form, online
 * booking, portal sign-in links). Two layers, neither needs a new table:
 *
 *  1. `memoryLimit` — a sliding window held in this server instance's memory.
 *     Free and instant, but each serverless instance has its own copy, so it
 *     only stops a burst that lands on one instance.
 *  2. `publicFormLimit` — the durable one for forms that create a lead: it
 *     counts the leads those forms ALREADY saved. Each lead carries a
 *     `leadFrom` tag (a salted hash of the sender's address, never the raw
 *     IP) on its rooms blob, so "how many did this address send in the last
 *     hour / day" is a count over the jobs table, shared by every instance.
 *     A per-business cap backs it up against a flood from many addresses.
 *
 * Before this (2026-11-14) a script could POST /api/leads without limit: each
 * request made a customer, an address and a job, alerted every manager and
 * queued a paid AI draft.
 */
import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

type HeaderBag = { headers: { get(name: string): string | null } };

/**
 * The caller's address. On Vercel the platform SETS x-forwarded-for /
 * x-real-ip itself (a value the client sends is overwritten), so the first
 * hop can be trusted. Empty when nothing usable is there (local dev).
 */
export function clientIp(req: HeaderBag): string {
  const h = req.headers;
  const first = (v: string | null) => (v || "").split(",")[0].trim();
  return (first(h.get("x-vercel-forwarded-for")) || first(h.get("x-forwarded-for")) || first(h.get("x-real-ip"))).slice(0, 64);
}

/** A short, salted, one-way tag for an address — what gets stored and counted. */
export function addressTag(ip: string): string {
  if (!ip) return "";
  const salt = process.env.RATE_LIMIT_SALT || process.env.PORTAL_SESSION_SECRET || "creed";
  return createHash("sha256").update(`${salt}|${ip}`).digest("hex").slice(0, 16);
}

// ── Layer 1: in-memory sliding window ───────────────────────────────────────

const WINDOWS = new Map<string, number[]>();
const MAX_KEYS = 5000;

/**
 * true = allowed (and counted); false = over `max` hits within `windowMs`.
 * Per server instance — a first line of defence, not the whole answer.
 */
export function memoryLimit(key: string, max: number, windowMs: number, now = Date.now()): boolean {
  const cutoff = now - windowMs;
  const hits = (WINDOWS.get(key) || []).filter((t) => t > cutoff);
  if (hits.length >= max) {
    WINDOWS.set(key, hits);
    return false;
  }
  hits.push(now);
  WINDOWS.set(key, hits);
  if (WINDOWS.size > MAX_KEYS) {
    // Drop the oldest keys (Map keeps insertion order) so memory stays bounded.
    let drop = WINDOWS.size - MAX_KEYS;
    for (const k of WINDOWS.keys()) {
      if (drop-- <= 0) break;
      WINDOWS.delete(k);
    }
  }
  return true;
}

/** Test hook: forget every in-memory window. */
export function resetMemoryLimits(): void {
  WINDOWS.clear();
}

// ── Layer 2: durable count over the leads already saved ─────────────────────

export interface FormLimits {
  /** Leads one address may send a business per hour / per day. */
  perAddressHour: number;
  perAddressDay: number;
  /** Public-form leads one business accepts per hour, from everyone. */
  perOrgHour: number;
}

/** A person sends one or two requests; an office behind one address a few
 *  more. The business cap is far above any real hour for a service business. */
export const LEAD_LIMITS: FormLimits = { perAddressHour: 5, perAddressDay: 15, perOrgHour: 60 };

export type FormVerdict = { ok: true } | { ok: false; why: "address" | "org" };

/** The pure rule: counts in, verdict out. */
export function formVerdict(
  counts: { addressHour: number; addressDay: number; orgHour: number },
  limits: FormLimits = LEAD_LIMITS,
): FormVerdict {
  if (counts.addressHour >= limits.perAddressHour || counts.addressDay >= limits.perAddressDay) return { ok: false, why: "address" };
  if (counts.orgHour >= limits.perOrgHour) return { ok: false, why: "org" };
  return { ok: true };
}

/**
 * May this address send this business another public-form lead? Counts the
 * `leadFrom`-tagged jobs already saved (see the file header). A failed read
 * lets the lead through — losing a real customer's request is worse than
 * letting one extra through.
 */
export async function publicFormLimit(
  supabase: SupabaseClient,
  o: { orgId: string; tag: string; now?: number; limits?: FormLimits },
): Promise<FormVerdict> {
  const now = o.now ?? Date.now();
  const hourAgo = new Date(now - 3_600_000).toISOString();
  const dayAgo = new Date(now - 86_400_000).toISOString();
  const count = async (since: string, pattern: string): Promise<number> => {
    const { count: n, error } = await supabase
      .from("jobs").select("id", { count: "exact", head: true })
      .eq("org_id", o.orgId).gte("created_at", since).like("rooms", pattern);
    return error ? 0 : n || 0;
  };
  try {
    // The tag is hex, so it is safe inside the LIKE pattern.
    const mine = o.tag ? `%"leadFrom":"${o.tag}"%` : null;
    const [addressHour, addressDay, orgHour] = await Promise.all([
      mine ? count(hourAgo, mine) : Promise.resolve(0),
      mine ? count(dayAgo, mine) : Promise.resolve(0),
      count(hourAgo, `%"leadFrom":"%`),
    ]);
    return formVerdict({ addressHour, addressDay, orgHour }, o.limits);
  } catch {
    return { ok: true };
  }
}

/** What the customer reads when a form is refused. */
export const formLimitMessage = (why: "address" | "org" | "burst"): string =>
  why === "org"
    ? "We're getting a lot of requests right now. Please call us and we'll take care of you."
    : "You've already sent us a few requests. Please call us and we'll take care of you.";
