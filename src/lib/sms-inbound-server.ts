import type { SupabaseClient } from "@supabase/supabase-js";
import { residentContact } from "@/lib/resident";
import { parseSchedCrew } from "@/lib/day-plan";
import { notifyManagers } from "@/lib/notify-server";
import {
  imageExt,
  last10,
  pickMatch,
  prettyPhone,
  RESIDENT_DAYS,
  THREAD_DAYS,
  type InboundMatch,
  type MatchInput,
} from "@/lib/sms-inbound";

/**
 * Server side of incoming customer texts: load match candidates, save the
 * text, copy its photos into the job, and alert the right people. Every step
 * is best-effort and never throws, so a database hiccup can't stop Twilio
 * getting its reply. The rules themselves live in lib/sms-inbound (tested).
 */

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

/** Who a text from `from` (E.164) belongs to. */
export async function matchInbound(supabase: SupabaseClient, from: string): Promise<InboundMatch> {
  const digits = last10(from);
  const input: MatchInput = { thread: null, customers: [], customerJobs: [], residentJobs: [], textingOrgs: [] };

  // 1. Our newest text to this number. Incoming rows have to_phone = our
  //    number, so this only ever finds texts we sent.
  try {
    const { data } = await supabase
      .from("sms_messages")
      .select("org_id, job_id")
      .eq("to_phone", from)
      .gte("created_at", daysAgo(THREAD_DAYS))
      .order("created_at", { ascending: false })
      .limit(1);
    const t = data?.[0] as { org_id?: string | null; job_id?: string | null } | undefined;
    if (t?.org_id) {
      let customerId: string | null = null;
      if (t.job_id) {
        const { data: job } = await supabase.from("jobs").select("customer_id").eq("id", t.job_id).maybeSingle();
        customerId = (job as { customer_id?: string | null } | null)?.customer_id || null;
      }
      input.thread = { orgId: t.org_id, jobId: t.job_id || null, customerId };
    }
  } catch {
    /* fall through to the other rules */
  }

  // 2. Customers with that number (needs the migration's lookup function).
  if (digits) {
    try {
      const { data } = await supabase.rpc("sms_customers_by_phone", { p_last10: digits });
      input.customers = ((data || []) as { id: string; org_id: string; name: string | null }[])
        .filter((c) => c.id && c.org_id)
        .map((c) => ({ id: c.id, orgId: c.org_id, name: c.name || "" }));
    } catch {
      /* migration not run yet */
    }
    if (input.customers.length) {
      try {
        const { data } = await supabase
          .from("jobs")
          .select("id, customer_id, org_id, status, created_at")
          .in("customer_id", input.customers.map((c) => c.id))
          .order("created_at", { ascending: false })
          .limit(100);
        input.customerJobs = ((data || []) as Record<string, string>[]).map((j) => ({
          id: j.id,
          customerId: j.customer_id,
          orgId: j.org_id,
          status: j.status || "",
          createdAt: j.created_at || "",
        }));
      } catch {
        /* no jobs */
      }
    }

    // 3. Residents live inside the job blob, typed any which way, so read
    //    recent jobs that mention a resident/tenant and compare in code.
    try {
      const { data } = await supabase
        .from("jobs")
        .select("id, org_id, rooms, created_at")
        .gte("created_at", daysAgo(RESIDENT_DAYS))
        .or("rooms.ilike.*residentPhone*,rooms.ilike.*tenantPhone*")
        .limit(1000);
      for (const j of (data || []) as { id: string; org_id: string; rooms: unknown; created_at: string }[]) {
        const r = residentContact(j.rooms);
        if (r.phone && last10(r.phone) === digits) {
          input.residentJobs.push({ id: j.id, orgId: j.org_id, name: r.name, createdAt: j.created_at || "" });
        }
      }
    } catch {
      /* skip residents */
    }
  }

  // Businesses with texting on: decides who gets texts from unknown numbers.
  try {
    const { data } = await supabase.from("organizations").select("id").eq("auto_sms_enroute", true).limit(2);
    input.textingOrgs = ((data || []) as { id: string }[]).map((o) => o.id);
  } catch {
    /* none */
  }

  return pickMatch(input);
}

export interface SavedInbound {
  /** false = the save didn't happen (migration not run, or a database error). */
  saved: boolean;
  /** true = Twilio already delivered this exact text: do nothing more. */
  duplicate: boolean;
  id: string | null;
  /** The saved row's created_at: the burst check only looks at texts before it. */
  createdAt: string | null;
}

/** Save an incoming text on the sms_messages log. */
export async function saveInbound(
  supabase: SupabaseClient,
  t: { sid: string; from: string; to: string; body: string; kind: string; match: InboundMatch },
): Promise<SavedInbound> {
  try {
    const { data, error } = await supabase
      .from("sms_messages")
      .insert({
        direction: "in",
        org_id: t.match.orgId,
        job_id: t.match.jobId,
        customer_id: t.match.customerId,
        match_status: t.match.status,
        from_phone: t.from,
        to_phone: t.to || "unknown",
        contact_phone: t.from,
        kind: t.kind,
        body: t.body.slice(0, 1600),
        twilio_sid: t.sid || null,
        status: "received",
      })
      .select("id, created_at")
      .maybeSingle();
    if (error) return { saved: false, duplicate: error.code === "23505", id: null, createdAt: null };
    const row = data as { id?: string; created_at?: string } | null;
    return { saved: true, duplicate: false, id: row?.id || null, createdAt: row?.created_at || null };
  } catch {
    return { saved: false, duplicate: false, id: null, createdAt: null };
  }
}

/**
 * Copy a text's photos out of Twilio (its links need our account login and
 * don't last) into Supabase storage, record them on the message and add them
 * to the matched job's photos. Returns the stored urls.
 */
export async function savePhotos(
  supabase: SupabaseClient,
  p: {
    sid: string;
    messageId: string | null;
    orgId: string | null;
    jobId: string | null;
    photos: { url: string; contentType: string }[];
  },
): Promise<string[]> {
  const account = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!p.photos.length || !account || !token) return [];
  const auth = `Basic ${Buffer.from(`${account}:${token}`).toString("base64")}`;
  const urls: string[] = [];

  for (let i = 0; i < p.photos.length; i++) {
    const ph = p.photos[i];
    try {
      const res = await fetch(ph.url, { headers: { Authorization: auth }, signal: AbortSignal.timeout(10_000) });
      if (!res.ok) continue;
      const bytes = Buffer.from(await res.arrayBuffer());
      if (!bytes.length || bytes.length > 8 * 1024 * 1024) continue;
      const path = `sms/${p.orgId || "unmatched"}/${p.sid || Date.now()}_${i}.${imageExt(ph.contentType)}`;
      const { error } = await supabase.storage
        .from("receipts")
        .upload(path, bytes, { contentType: ph.contentType, upsert: true });
      if (error) continue;
      const { data } = supabase.storage.from("receipts").getPublicUrl(path);
      if (data?.publicUrl) urls.push(data.publicUrl);
    } catch {
      /* skip this photo */
    }
  }
  if (!urls.length) return urls;

  if (p.messageId) {
    try {
      await supabase
        .from("sms_messages")
        .update({ media: urls.map((url) => ({ url, type: "image" })) })
        .eq("id", p.messageId);
    } catch {
      /* best-effort */
    }
  }
  if (p.jobId && p.orgId) await addPhotosToJob(supabase, p.orgId, p.jobId, urls);
  return urls;
}

/** Append photos to the job's photos (atomic, in the database: sms_add_job_photos). */
async function addPhotosToJob(supabase: SupabaseClient, orgId: string, jobId: string, urls: string[]) {
  try {
    await supabase.rpc("sms_add_job_photos", { p_job: jobId, p_org: orgId, p_urls: urls });
  } catch {
    /* best-effort: the photos are still on the message */
  }
}

/** Crew on a job: names on its schedule rows from the last 30 days on, plus the requested tech. */
async function crewForJob(supabase: SupabaseClient, orgId: string, jobId: string): Promise<string[]> {
  const names = new Set<string>();
  try {
    const { data: job } = await supabase
      .from("jobs").select("requested_tech").eq("id", jobId).eq("org_id", orgId).maybeSingle();
    const tech = (job as { requested_tech?: string | null } | null)?.requested_tech;
    if (tech) names.add(tech.trim());
    const { data: rows } = await supabase
      .from("schedule")
      .select("note")
      .eq("org_id", orgId)
      .eq("job_id", jobId)
      .gte("sched_date", daysAgo(30).slice(0, 10))
      .limit(50);
    for (const r of (rows || []) as { note?: string | null }[]) for (const n of parseSchedCrew(r.note)) names.add(n);
  } catch {
    /* owners/managers still get it */
  }
  return [...names].filter(Boolean);
}

/**
 * True when this person already texted in the 5 minutes BEFORE this text (one
 * alert per burst). Only earlier texts count, so the first text of a burst
 * always alerts even when the later ones are saved before its alert runs.
 */
async function recentlyAlerted(supabase: SupabaseClient, from: string, messageId: string | null, createdAt: string | null): Promise<boolean> {
  if (!messageId || !createdAt) return false;
  try {
    const since = new Date(new Date(createdAt).getTime() - 5 * 60_000).toISOString();
    const { data, error } = await supabase
      .from("sms_messages")
      .select("id")
      .eq("direction", "in")
      .eq("contact_phone", from)
      .neq("id", messageId)
      .eq("kind", "reply")
      .gte("created_at", since)
      .lt("created_at", createdAt)
      .limit(1);
    return !error && !!data?.length;
  } catch {
    return false;
  }
}

/** Bell + app push to owners, managers and the crew on the job. Never a text (owner's choice). */
export async function alertReply(
  supabase: SupabaseClient,
  t: { from: string; text: string; photoCount: number; match: InboundMatch; messageId: string | null; createdAt: string | null },
): Promise<void> {
  const { match } = t;
  if (!match.orgId) return; // held: no business gets it
  if (await recentlyAlerted(supabase, t.from, t.messageId, t.createdAt)) return;

  const who = match.name || prettyPhone(t.from);
  const photos = t.photoCount ? ` [${t.photoCount} photo${t.photoCount > 1 ? "s" : ""}]` : "";
  const title =
    match.status === "unknown" ? "Text from a new number"
    : match.status === "several" ? "Customer texted back (check which job)"
    : "Customer texted back";
  const crewNames = match.jobId ? await crewForJob(supabase, match.orgId, match.jobId) : [];

  await notifyManagers(supabase, {
    orgId: match.orgId,
    jobId: match.jobId,
    type: "text_reply",
    title,
    body: `${who}: ${(t.text || "(photo)").slice(0, 300)}${photos}`,
    crewNames,
    channels: { push: true, sms: false },
  });
}

/** A bell note (no push) that someone opted out of texts. */
export async function alertOptOut(supabase: SupabaseClient, from: string, match: InboundMatch): Promise<void> {
  if (!match.orgId) return;
  await notifyManagers(supabase, {
    orgId: match.orgId,
    jobId: match.jobId,
    type: "text_reply",
    title: "Customer stopped texts",
    body: `${match.name || prettyPhone(from)} replied STOP. They won't get texts from the business number until they text START.`,
    channels: { push: false, sms: false },
  });
}
