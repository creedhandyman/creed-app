// Server side of email campaigns (service-role Supabase client).
// - loadRecipients: the exact list a campaign goes to, built from the same
//   pickRecipients rule the Campaigns screen counts with.
// - queueCampaign: writes one 'queued' campaign_sends row per recipient and
//   schedules the campaign. Nothing is emailed here.
// - dispatchDueCampaigns: the cron's job (/api/campaigns/dispatch). Claims
//   queued rows, re-checks each customer is still subscribed, sends one at a
//   time under Resend's rate limit, and marks each row sent / failed.
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  campaignProblems,
  pickRecipients,
  renderCampaignEmail,
  type AudienceCustomer,
  type AudienceJob,
  type AudienceMembership,
  type CampaignAudience,
  type Recipient,
} from "./campaigns";
import { sendEmail } from "./email";
import { referralLink } from "./referrals";
import { siteOrigin } from "./site-url";
import { signUnsubscribeToken } from "./unsubscribe-token";

/** Page through a table so a big customer list isn't cut at 1,000 rows. */
async function all<T>(
  q: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = [];
  const size = 1000;
  for (let from = 0; ; from += size) {
    const { data, error } = await q(from, from + size - 1);
    if (error) throw new Error(error.message);
    out.push(...(data || []));
    if (!data || data.length < size) break;
  }
  return out;
}

export async function loadRecipients(
  supabase: SupabaseClient,
  orgId: string,
  audience: CampaignAudience,
): Promise<Recipient[]> {
  const customers = await all<AudienceCustomer>((a, b) =>
    supabase.from("customers").select("id, type, name, email, email_unsubscribed_at").eq("org_id", orgId).order("created_at").range(a, b),
  );
  const jobs = audience === "lapsed"
    ? await all<AudienceJob>((a, b) =>
        supabase.from("jobs").select("customer_id, status, job_date, created_at, archived").eq("org_id", orgId).range(a, b),
      )
    : [];
  const memberships = audience === "members"
    ? await all<AudienceMembership>((a, b) =>
        supabase.from("customer_memberships").select("customer_id, status").eq("org_id", orgId).range(a, b),
      )
    : [];
  return pickRecipients({ audience, customers, jobs, memberships });
}

export interface OrgForCampaign {
  id: string;
  name: string | null;
  email: string | null;
  address: string | null;
  campaigns_enabled?: boolean | null;
  referrals_enabled?: boolean | null;
  site_slug?: string | null;
  site_published?: boolean | null;
}

export const ORG_CAMPAIGN_COLS = "id, name, email, address, campaigns_enabled, referrals_enabled, site_slug, site_published";

export function resendConfigured(): boolean {
  return !!process.env.RESEND_API_KEY;
}

/** "Business Name <address>" — the business's own name on the From line,
 *  sent from the app's verified domain. */
export function campaignFrom(businessName: string): string {
  const addr = process.env.RESEND_CAMPAIGN_FROM || process.env.RESEND_FROM_EMAIL || "reviews@creedhandyman.com";
  const name = businessName.replace(/["<>\r\n]/g, "").trim();
  return name ? `${name} <${addr}>` : addr;
}

export function unsubscribeUrl(customerId: string): string {
  return `${siteOrigin()}/u/${encodeURIComponent(signUnsubscribeToken(customerId))}`;
}

/** Why this business can't send campaigns right now (empty = it can). */
export function sendBlockers(org: OrgForCampaign, c: { subject?: string; body?: string }): string[] {
  const out: string[] = [];
  if (!org.campaigns_enabled) out.push("Turn on email campaigns in Business settings → Customer messages first.");
  if (!resendConfigured()) out.push("Email sending isn't set up on the server yet (RESEND_API_KEY).");
  return out.concat(campaignProblems(c, org));
}

/** Build the list and queue it. The campaign moves draft → scheduled. */
export async function queueCampaign(
  supabase: SupabaseClient,
  input: { orgId: string; campaignId: string; audience: CampaignAudience; scheduledFor: string },
): Promise<{ count: number }> {
  const recipients = await loadRecipients(supabase, input.orgId, input.audience);
  for (let i = 0; i < recipients.length; i += 500) {
    const chunk = recipients.slice(i, i + 500).map((r) => ({
      org_id: input.orgId,
      campaign_id: input.campaignId,
      customer_id: r.customer_id,
      email: r.email,
      status: "queued",
    }));
    const { error } = await supabase
      .from("campaign_sends")
      .upsert(chunk, { onConflict: "campaign_id,customer_id", ignoreDuplicates: true });
    if (error) throw new Error(error.message);
  }
  const { error } = await supabase
    .from("campaigns")
    .update({
      status: "scheduled",
      scheduled_for: input.scheduledFor,
      recipient_count: recipients.length,
      last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.campaignId)
    .eq("org_id", input.orgId)
    .eq("status", "draft");
  if (error) throw new Error(error.message);
  return { count: recipients.length };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface DispatchSummary {
  campaigns: number;
  sent: number;
  failed: number;
  skipped: number;
  paused: string[];
}

interface CampaignRow {
  id: string;
  org_id: string;
  subject: string;
  body: string;
  status: string;
  started_at: string | null;
}

interface SendRow {
  id: string;
  customer_id: string;
  email: string;
}

/**
 * Send what's due. Stops early when the time budget runs out; whatever is
 * left stays 'queued' for the next run. Rows stuck in 'sending' (a run that
 * died mid-send) are left alone and shown to the owner as not sent, never
 * retried automatically, so nobody gets the same email twice.
 */
export async function dispatchDueCampaigns(
  supabase: SupabaseClient,
  opts: { budgetMs: number; gapMs?: number; now?: Date } = { budgetMs: 240_000 },
): Promise<DispatchSummary> {
  const started = Date.now();
  const gap = opts.gapMs ?? 550; // Resend allows ~2 requests a second.
  const nowIso = (opts.now || new Date()).toISOString();
  const out: DispatchSummary = { campaigns: 0, sent: 0, failed: 0, skipped: 0, paused: [] };

  const { data: due, error } = await supabase
    .from("campaigns")
    .select("id, org_id, subject, body, status, started_at")
    .in("status", ["scheduled", "sending"])
    .lte("scheduled_for", nowIso)
    .order("scheduled_for", { ascending: true })
    .limit(20);
  if (error) throw new Error(error.message);

  for (const c of (due || []) as CampaignRow[]) {
    if (Date.now() - started > opts.budgetMs) break;
    out.campaigns++;

    const { data: orgRow } = await supabase.from("organizations").select(ORG_CAMPAIGN_COLS).eq("id", c.org_id).maybeSingle();
    const org = orgRow as OrgForCampaign | null;
    const blockers = org ? sendBlockers(org, c) : ["Business not found."];
    if (blockers.length) {
      // Owner turned campaigns off (or the address went missing) mid-send:
      // pause, keep the queue, say why on the campaign.
      await supabase.from("campaigns").update({ last_error: blockers[0], updated_at: new Date().toISOString() }).eq("id", c.id);
      out.paused.push(c.id);
      continue;
    }
    if (c.status === "scheduled") {
      await supabase
        .from("campaigns")
        .update({ status: "sending", started_at: c.started_at || new Date().toISOString(), last_error: null, updated_at: new Date().toISOString() })
        .eq("id", c.id)
        .eq("status", "scheduled");
    }

    const businessName = (org!.name || "").trim() || "Your contractor";
    const from = campaignFrom(businessName);
    const replyTo = org!.email && org!.email.includes("@") ? org!.email : undefined;
    const origin = siteOrigin();

    for (;;) {
      if (Date.now() - started > opts.budgetMs) break;
      const { data: batch } = await supabase
        .from("campaign_sends")
        .select("id, customer_id, email")
        .eq("campaign_id", c.id)
        .eq("status", "queued")
        .limit(25);
      const rows = (batch || []) as SendRow[];
      if (!rows.length) {
        const { data: left } = await supabase
          .from("campaign_sends").select("id").eq("campaign_id", c.id).in("status", ["queued", "sending"]).limit(1);
        if (!left || !left.length) {
          await supabase
            .from("campaigns")
            .update({ status: "sent", sent_at: new Date().toISOString(), updated_at: new Date().toISOString() })
            .eq("id", c.id)
            .in("status", ["scheduled", "sending"]);
        }
        break;
      }

      const ids = rows.map((r) => r.customer_id);
      const { data: custs } = await supabase
        .from("customers")
        .select("id, name, email_unsubscribed_at, referral_code")
        .in("id", ids);
      const byId = new Map(
        ((custs || []) as { id: string; name: string | null; email_unsubscribed_at: string | null; referral_code: string | null }[])
          .map((x) => [x.id, x]),
      );

      for (const row of rows) {
        if (Date.now() - started > opts.budgetMs) break;
        // Claim it, so two overlapping runs can't both send it.
        const { data: claimed } = await supabase
          .from("campaign_sends").update({ status: "sending" }).eq("id", row.id).eq("status", "queued").select("id");
        if (!claimed || !(claimed as unknown[]).length) continue;

        const cust = byId.get(row.customer_id);
        if (!cust || cust.email_unsubscribed_at) {
          await supabase.from("campaign_sends")
            .update({ status: "skipped", error: cust ? "Unsubscribed" : "Customer deleted" }).eq("id", row.id);
          out.skipped++;
          continue;
        }
        const unsub = unsubscribeUrl(row.customer_id);
        const link = org!.referrals_enabled ? referralLink(origin, org!, cust.referral_code) : null;
        const mail = renderCampaignEmail({
          subject: c.subject,
          body: c.body,
          customerName: cust.name || "",
          businessName,
          address: org!.address || "",
          unsubscribeUrl: unsub,
          referralLink: link || undefined,
        });
        const unsubPost = `${origin}/api/unsubscribe?t=${encodeURIComponent(signUnsubscribeToken(row.customer_id))}`;
        const r = await sendEmail(row.email, mail.subject, mail.text, mail.html, {
          from,
          replyTo,
          headers: {
            "List-Unsubscribe": `<${unsubPost}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          },
        });
        if (r.ok) {
          await supabase.from("campaign_sends")
            .update({ status: "sent", sent_at: new Date().toISOString(), resend_id: r.id ?? null, error: null }).eq("id", row.id);
          out.sent++;
        } else {
          await supabase.from("campaign_sends").update({ status: "failed", error: r.error.slice(0, 500) }).eq("id", row.id);
          out.failed++;
        }
        if (gap > 0) await sleep(gap);
      }
    }
  }
  return out;
}
