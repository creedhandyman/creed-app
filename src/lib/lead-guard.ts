/**
 * Server side of the lead-form spam checks (rules: lib/lead-spam.ts):
 * Cloudflare Turnstile (only when TURNSTILE_SECRET_KEY is set), the AI check
 * for borderline submissions, and the durable per-email / held-submission
 * counts the rate limit adds to lib/rate-limit.ts.
 */
import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { callClaude } from "./anthropic-server";
import { aiPrompt, readAiVerdict, type Submission } from "./lead-spam";

/** One-way tag of an email address (what's stored and counted, never the address). */
export function emailTag(email: string): string {
  const e = (email || "").trim().toLowerCase();
  if (!e) return "";
  const salt = process.env.RATE_LIMIT_SALT || process.env.PORTAL_SESSION_SECRET || "creed";
  return createHash("sha256").update(`${salt}|mail|${e}`).digest("hex").slice(0, 16);
}

/** Turnstile is ON only when the secret key is set (the site key goes to the forms). */
export const turnstileOn = () => !!process.env.TURNSTILE_SECRET_KEY;

export async function verifyTurnstile(token: unknown, ip: string, fetcher: typeof fetch = fetch): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return true;
  if (typeof token !== "string" || !token || token.length > 4096) return false;
  try {
    const body = new URLSearchParams({ secret, response: token });
    if (ip) body.set("remoteip", ip);
    const r = await fetcher("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body });
    const j = (await r.json()) as { success?: boolean };
    return j.success === true;
  } catch {
    // Cloudflare unreachable: don't lose a real customer over it.
    return true;
  }
}

/**
 * Borderline submission → the AI decides. null = no answer (no key, error,
 * timeout, unreadable): the caller lets it through as a lead.
 */
export async function aiSolicitationCheck(orgId: string, s: Submission): Promise<{ verdict: "job" | "solicitation"; reason: string } | null> {
  try {
    const { status, data } = await callClaude({
      model: "claude-sonnet-5-5",
      max_tokens: 80,
      messages: [{ role: "user", content: aiPrompt(s) }],
    }, { orgId, callType: "lead_spam" }, { deadlineMs: 20_000 });
    if (status !== 200) return null;
    const blocks = Array.isArray(data.content) ? (data.content as { type?: string; text?: string }[]) : [];
    return readAiVerdict(blocks.filter((b) => b.type === "text").map((b) => b.text || "").join(""));
  } catch {
    return null;
  }
}

/**
 * Durable counts for one business: leads already saved from this email, and
 * submissions held for review from this address / email (so a vendor whose
 * pitches are being held still hits the limit). A failed read counts 0.
 */
export async function guardCounts(
  supabase: SupabaseClient,
  o: { orgId: string; fromTag: string; mailTag: string; now?: number },
): Promise<{ mailHour: number; mailDay: number; heldFromHour: number; heldFromDay: number }> {
  const now = o.now ?? Date.now();
  const hourAgo = new Date(now - 3_600_000).toISOString();
  const dayAgo = new Date(now - 86_400_000).toISOString();
  const jobs = async (since: string) => {
    if (!o.mailTag) return 0;
    const { count, error } = await supabase.from("jobs").select("id", { count: "exact", head: true })
      .eq("org_id", o.orgId).gte("created_at", since).like("rooms", `%"leadMail":"${o.mailTag}"%`);
    return error ? 0 : count || 0;
  };
  const held = async (col: "from_tag" | "email_tag", tag: string, since: string) => {
    if (!tag) return 0;
    const { count, error } = await supabase.from("lead_review").select("id", { count: "exact", head: true })
      .eq("org_id", o.orgId).eq(col, tag).gte("created_at", since);
    return error ? 0 : count || 0;
  };
  try {
    const [jh, jd, mh, md, fh, fd] = await Promise.all([
      jobs(hourAgo), jobs(dayAgo),
      held("email_tag", o.mailTag, hourAgo), held("email_tag", o.mailTag, dayAgo),
      held("from_tag", o.fromTag, hourAgo), held("from_tag", o.fromTag, dayAgo),
    ]);
    return { mailHour: jh + mh, mailDay: jd + md, heldFromHour: fh, heldFromDay: fd };
  } catch {
    return { mailHour: 0, mailDay: 0, heldFromHour: 0, heldFromDay: 0 };
  }
}
