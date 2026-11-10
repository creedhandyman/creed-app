import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuthedProfile } from "@/lib/api-auth";
import { residentContact } from "@/lib/resident";
import { normalizePhone } from "@/lib/sms";
import {
  canSeeThread,
  crewJobIds,
  isAdminRole,
  LIST_ROWS,
  summarizeThreads,
  THREAD_ROWS,
  type TextRow,
  type ThreadSummary,
} from "@/lib/sms-threads";

/**
 * Server side of the Texts screen (/api/sms/threads, /thread, /reply, /lead):
 * load one business's logged texts, work out which conversations the caller
 * may see, and put names and addresses on them. sms_messages is service-role
 * only, so every read here is scoped to the caller's org_id by hand.
 */

const COLS =
  "id, direction, contact_phone, job_id, customer_id, match_status, recipient_role, kind, body, status, error, media, read_at, created_at";

export interface Viewer {
  orgId: string;
  userId: string;
  role: string | null;
  admin: boolean;
  /** Jobs a crew member is on (owners/managers: unused). */
  myJobs: Set<string>;
}

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

/** The caller as the Texts screen sees them. Crew get their job list. */
export async function viewerOf(supabase: SupabaseClient, prof: AuthedProfile & { orgId: string }): Promise<Viewer> {
  const admin = isAdminRole(prof.role);
  const v: Viewer = { orgId: prof.orgId, userId: prof.userId, role: prof.role, admin, myJobs: new Set() };
  if (admin) return v;
  try {
    const { data: me } = await supabase.from("profiles").select("name").eq("id", prof.userId).maybeSingle();
    const name = ((me as { name?: string | null } | null)?.name || "").trim();
    if (!name) return v;
    const [{ data: sched }, { data: jobs }] = await Promise.all([
      supabase
        .from("schedule")
        .select("job_id, note")
        .eq("org_id", prof.orgId)
        .not("job_id", "is", null)
        .gte("sched_date", daysAgo(30))
        .limit(2000),
      supabase
        .from("jobs")
        .select("id, requested_tech")
        .eq("org_id", prof.orgId)
        .ilike("requested_tech", name.replace(/[\\%_]/g, (c) => `\\${c}`))
        .limit(500),
    ]);
    v.myJobs = crewJobIds(
      name,
      (sched || []) as { job_id: string | null; note: string | null }[],
      (jobs || []) as { id: string; requested_tech: string | null }[],
    );
  } catch {
    /* no jobs = no conversations */
  }
  return v;
}

/** The business's newest texts, optionally one conversation's. Throws on a database error. */
export async function loadRows(supabase: SupabaseClient, orgId: string, phone?: string): Promise<TextRow[]> {
  let q = supabase.from("sms_messages").select(COLS).eq("org_id", orgId);
  if (phone) q = q.eq("contact_phone", phone);
  const { data, error } = await q.order("created_at", { ascending: false }).limit(phone ? THREAD_ROWS : LIST_ROWS);
  if (error) throw new Error(error.message);
  return ((data || []) as TextRow[]).map((r) => ({ ...r, direction: r.direction === "in" ? "in" : "out" }));
}

/** The caller's conversations, newest first (crew: only their jobs'). */
export async function visibleThreads(supabase: SupabaseClient, v: Viewer): Promise<ThreadSummary[]> {
  const rows = await loadRows(supabase, v.orgId);
  return summarizeThreads(rows).filter((t) => canSeeThread(v.role, t.jobIds, v.myJobs));
}

export interface ThreadInfo {
  /** Customer or resident name, "" when unknown. */
  name: string;
  /** Job address, "" when no job. */
  address: string;
  jobStatus: string;
  optedOut: boolean;
}

/** Names, addresses and STOP state for a set of conversations. Best-effort. */
export async function describe(
  supabase: SupabaseClient,
  orgId: string,
  threads: Pick<ThreadSummary, "phone" | "jobId" | "customerId" | "role">[],
): Promise<Record<string, ThreadInfo>> {
  const out: Record<string, ThreadInfo> = {};
  for (const t of threads) out[t.phone] = { name: "", address: "", jobStatus: "", optedOut: false };
  if (!threads.length) return out;

  const jobIds = [...new Set(threads.map((t) => t.jobId).filter((x): x is string => !!x))];
  const custIds = [...new Set(threads.map((t) => t.customerId).filter((x): x is string => !!x))];
  const phones = threads.map((t) => normalizePhone(t.phone)).filter(Boolean);

  const [jobsRes, custRes, optRes] = await Promise.all([
    jobIds.length
      ? supabase.from("jobs").select("id, property, client, status, rooms, customer_id").eq("org_id", orgId).in("id", jobIds)
      : Promise.resolve({ data: [] }),
    custIds.length
      ? supabase.from("customers").select("id, name").eq("org_id", orgId).in("id", custIds)
      : Promise.resolve({ data: [] }),
    phones.length ? supabase.from("sms_opt_outs").select("phone").in("phone", phones) : Promise.resolve({ data: [] }),
  ]).catch(() => [{ data: [] }, { data: [] }, { data: [] }] as { data: unknown[] }[]);

  const jobs = new Map(
    ((jobsRes.data || []) as { id: string; property: string | null; client: string | null; status: string | null; rooms: unknown; customer_id: string | null }[])
      .map((j) => [j.id, j]),
  );
  const custs = new Map(((custRes.data || []) as { id: string; name: string | null }[]).map((c) => [c.id, c.name || ""]));
  const opted = new Set(((optRes.data || []) as { phone: string }[]).map((o) => o.phone));

  for (const t of threads) {
    const job = t.jobId ? jobs.get(t.jobId) : undefined;
    let name = "";
    if (t.role === "resident" && job) name = residentContact(job.rooms).name || "";
    if (!name && t.customerId) name = custs.get(t.customerId) || "";
    if (!name && job && t.role !== "resident") name = job.client || "";
    out[t.phone] = {
      name,
      address: job?.property || "",
      jobStatus: job?.status || "",
      optedOut: opted.has(normalizePhone(t.phone)),
    };
  }
  return out;
}

export type OpenedThread =
  | { ok: false; status: number; error: string }
  | { ok: true; viewer: Viewer; phone: string; rows: TextRow[] };

/**
 * One conversation the caller may open: their business, that phone, and
 * (crew) one of their jobs. Every route that reads, marks or answers a
 * conversation comes through here.
 */
export async function openThread(supabase: SupabaseClient, prof: AuthedProfile | null, phoneRaw: unknown): Promise<OpenedThread> {
  if (!prof) return { ok: false, status: 401, error: "Unauthorized" };
  if (!prof.orgId) return { ok: false, status: 403, error: "No business on your account" };
  const phone = normalizePhone(typeof phoneRaw === "string" ? phoneRaw : "");
  if (!phone) return { ok: false, status: 400, error: "Missing phone" };
  const viewer = await viewerOf(supabase, { ...prof, orgId: prof.orgId });
  let rows: TextRow[];
  try {
    rows = await loadRows(supabase, viewer.orgId, phone);
  } catch {
    return { ok: false, status: 409, error: "Texts aren't set up yet (run the text replies migration)." };
  }
  const jobIds = [...new Set(rows.map((r) => r.job_id).filter((x): x is string => !!x))];
  if (!rows.length || !canSeeThread(viewer.role, jobIds, viewer.myJobs)) {
    return { ok: false, status: 404, error: "Conversation not found" };
  }
  return { ok: true, viewer, phone, rows };
}
