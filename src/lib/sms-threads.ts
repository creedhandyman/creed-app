/**
 * The Texts screen: the pure rules. How sms_messages rows become one
 * conversation per phone number, who on the crew may see which, and who a
 * reply goes to. No Supabase here, so it's all tested in sms-threads.test.ts;
 * lib/sms-threads-server.ts loads the rows and the /api/sms/* routes use both.
 *
 * A conversation = every logged text in one business with the same
 * contact_phone (the customer's number on both sides, migration
 * 20261110_text_replies.sql), newest first in the list.
 *
 * Who sees what (Bernard, 2026-11-10: "crew too"):
 *   owners + managers  every conversation in the business, unknown numbers too
 *   crew               conversations touching a job they're on: their name is
 *                      on one of its schedule rows (👷 list) or it's the job's
 *                      requested tech, same rule as the reply alert
 */
import type { RecipientRole } from "@/lib/sms-recipient";
import { parseSchedCrew } from "@/lib/day-plan";

export const MAX_REPLY = 1000;
/** How many logged texts the list reads (newest first) to build its rows. */
export const LIST_ROWS = 600;
/** How many texts one conversation shows. */
export const THREAD_ROWS = 200;

export interface TextRow {
  id: string;
  direction: "in" | "out";
  contact_phone: string | null;
  job_id: string | null;
  customer_id: string | null;
  match_status: string | null;
  recipient_role: string | null;
  kind: string | null;
  body: string | null;
  status: string | null;
  error: string | null;
  media: { url: string; type?: string }[] | null;
  read_at: string | null;
  created_at: string;
}

export interface ThreadSummary {
  phone: string;
  lastAt: string;
  lastDirection: "in" | "out";
  preview: string;
  /** Received texts nobody has opened yet. */
  unread: number;
  /** Newest job any text in the conversation is on. */
  jobId: string | null;
  /** Every job the conversation touches (crew visibility). */
  jobIds: string[];
  customerId: string | null;
  /** The newest received text's match (thread, customer, several, unknown…). */
  match: string | null;
  role: RecipientRole;
  count: number;
}

const byNewest = (a: { created_at: string }, b: { created_at: string }) =>
  a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0;

/** One line for a text in the list: its words, else what it carried. */
export function previewOf(r: Pick<TextRow, "body" | "media" | "status" | "kind">): string {
  const words = (r.body || "").replace(/\s+/g, " ").trim();
  if (words) return words.slice(0, 140);
  if (r.media?.length) return r.media.length > 1 ? `${r.media.length} photos` : "Photo";
  return "";
}

/** Who a reply on this conversation is for (the sms_messages recipient_role). */
export function replyRole(rows: Pick<TextRow, "direction" | "recipient_role" | "match_status" | "created_at">[]): RecipientRole {
  const sorted = [...rows].sort(byNewest);
  const sent = sorted.find((r) => r.direction === "out" && r.recipient_role);
  if (sent && ["customer", "resident", "property_manager"].includes(sent.recipient_role as string)) {
    return sent.recipient_role as RecipientRole;
  }
  const got = sorted.find((r) => r.direction === "in" && r.match_status);
  return got?.match_status === "resident" ? "resident" : "customer";
}

/** Rows (any order, one business) → one summary per phone, newest first. */
export function summarizeThreads(rows: TextRow[]): ThreadSummary[] {
  const groups = new Map<string, TextRow[]>();
  for (const r of rows) {
    if (!r.contact_phone) continue;
    const g = groups.get(r.contact_phone);
    if (g) g.push(r);
    else groups.set(r.contact_phone, [r]);
  }
  const out: ThreadSummary[] = [];
  for (const [phone, list] of groups) {
    const sorted = [...list].sort(byNewest);
    const last = sorted[0];
    const jobIds = [...new Set(sorted.map((r) => r.job_id).filter((x): x is string => !!x))];
    out.push({
      phone,
      lastAt: last.created_at,
      lastDirection: last.direction,
      preview: previewOf(last),
      unread: sorted.filter((r) => r.direction === "in" && !r.read_at).length,
      jobId: jobIds[0] || null,
      jobIds,
      customerId: sorted.find((r) => r.customer_id)?.customer_id || null,
      match: sorted.find((r) => r.direction === "in")?.match_status || null,
      role: replyRole(sorted),
      count: sorted.length,
    });
  }
  return out.sort((a, b) => (a.lastAt < b.lastAt ? 1 : a.lastAt > b.lastAt ? -1 : 0));
}

/**
 * Which conversation a text-reply bell row is about. The bell row knows only
 * its job and when it was made, and a property-manager job can have two
 * conversations (the manager and the resident). So: the number whose text on
 * that job came in last at or before the alert; else the newest text on the
 * job (clock skew); else null.
 */
export function bellThreadPhone(
  rows: Pick<TextRow, "direction" | "contact_phone" | "job_id" | "created_at">[],
  jobId: string,
  at: string | null | undefined,
): string | null {
  const onJob = rows
    .filter((r) => r.direction === "in" && r.job_id === jobId && r.contact_phone)
    .sort(byNewest);
  const atMs = at ? Date.parse(at) : NaN;
  if (!Number.isNaN(atMs)) {
    const hit = onJob.find((r) => Date.parse(r.created_at) <= atMs);
    if (hit) return hit.contact_phone;
  }
  return onJob[0]?.contact_phone || null;
}

export const isAdminRole = (role: string | null | undefined) => role === "owner" || role === "manager";

/**
 * The jobs a crew member is on: their name in a schedule row's 👷 list for
 * that job, or the job's requested tech. Names compare without case/spaces.
 */
export function crewJobIds(
  name: string,
  schedule: { job_id: string | null; note: string | null }[],
  jobs: { id: string; requested_tech: string | null }[],
): Set<string> {
  const me = name.trim().toLowerCase();
  const out = new Set<string>();
  if (!me) return out;
  for (const s of schedule) {
    if (s.job_id && parseSchedCrew(s.note).some((n) => n.toLowerCase() === me)) out.add(s.job_id);
  }
  for (const j of jobs) {
    if ((j.requested_tech || "").trim().toLowerCase() === me) out.add(j.id);
  }
  return out;
}

/** May this person open this conversation? Crew: only ones on their jobs. */
export function canSeeThread(role: string | null | undefined, jobIds: string[], myJobs: Set<string>): boolean {
  if (isAdminRole(role)) return true;
  return jobIds.some((id) => myJobs.has(id));
}

/** The words of a reply, or why it can't go. */
export function checkReply(body: unknown): { ok: true; text: string } | { ok: false; error: string } {
  const text = typeof body === "string" ? body.trim() : "";
  if (!text) return { ok: false, error: "Write a message first" };
  if (text.length > MAX_REPLY) return { ok: false, error: `That message is too long. Keep it under ${MAX_REPLY} characters.` };
  return { ok: true, text };
}
