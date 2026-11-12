// Email campaigns: the pure rules (who gets one, what it says, the footer the
// law requires). Used by the Campaigns screen (live recipient count) and by the
// server (/api/campaigns/send picks the list, /api/campaigns/dispatch renders
// each email), so the count the owner sees is the list that gets sent.
// Tested in src/__tests__/campaigns.test.ts.

export type CampaignAudience = "all" | "individual" | "business" | "property_manager" | "lapsed" | "members";
export type CampaignStatus = "draft" | "scheduled" | "sending" | "sent" | "cancelled";

export interface Campaign {
  id: string;
  org_id: string;
  name: string;
  subject: string;
  body: string;
  audience: CampaignAudience;
  status: CampaignStatus;
  scheduled_for?: string | null;
  started_at?: string | null;
  sent_at?: string | null;
  recipient_count?: number | null;
  last_error?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface CampaignSend {
  id: string;
  campaign_id: string;
  customer_id: string;
  email: string;
  status: "queued" | "sending" | "sent" | "failed" | "skipped";
  error?: string | null;
  sent_at?: string | null;
  delivered_at?: string | null;
  opened_at?: string | null;
  clicked_at?: string | null;
  bounced_at?: string | null;
  complained_at?: string | null;
}

export const AUDIENCES: CampaignAudience[] = ["all", "individual", "business", "property_manager", "lapsed", "members"];

export const AUDIENCE_LABEL: Record<CampaignAudience, string> = {
  all: "Everyone with an email",
  individual: "Homeowners",
  business: "Businesses",
  property_manager: "Property managers",
  lapsed: "No job in the last year",
  members: "Members",
};

export function isAudience(v: unknown): v is CampaignAudience {
  return typeof v === "string" && (AUDIENCES as string[]).includes(v);
}

/** Loose but safe: one @, something before it, a dot after it, no spaces. */
export function isEmail(v: unknown): v is string {
  return typeof v === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

export interface AudienceCustomer {
  id: string;
  type?: string | null;
  name?: string | null;
  email?: string | null;
  email_unsubscribed_at?: string | null;
}
export interface AudienceJob {
  customer_id?: string | null;
  status?: string | null;
  job_date?: string | null;
  created_at?: string | null;
  archived?: boolean | null;
}
export interface AudienceMembership {
  customer_id?: string | null;
  status?: string | null;
}

export interface Recipient {
  customer_id: string;
  email: string;
  name: string;
}

const DONE = new Set(["complete", "invoiced", "paid"]);
const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

function jobTime(j: AudienceJob): number {
  const t = Date.parse(String(j.job_date || j.created_at || ""));
  return Number.isFinite(t) ? t : 0;
}

/**
 * Who a campaign goes to. Every audience skips customers with no valid email
 * and customers who unsubscribed, and sends each address once (the first
 * customer with it wins). "lapsed" = finished work with us before, but no job
 * of any kind in the last 365 days. "members" = an active or past-due plan.
 */
export function pickRecipients(input: {
  audience: CampaignAudience;
  customers: AudienceCustomer[];
  jobs?: AudienceJob[];
  memberships?: AudienceMembership[];
  now?: number;
}): Recipient[] {
  const now = input.now ?? Date.now();
  const jobsByCustomer = new Map<string, AudienceJob[]>();
  for (const j of input.jobs || []) {
    if (!j.customer_id || j.archived) continue;
    const list = jobsByCustomer.get(j.customer_id) || [];
    list.push(j);
    jobsByCustomer.set(j.customer_id, list);
  }
  const members = new Set(
    (input.memberships || [])
      .filter((m) => m.customer_id && (m.status === "active" || m.status === "past_due"))
      .map((m) => m.customer_id as string),
  );

  const inAudience = (c: AudienceCustomer): boolean => {
    switch (input.audience) {
      case "all":
        return true;
      case "individual":
      case "business":
      case "property_manager":
        return (c.type || "individual") === input.audience;
      case "members":
        return members.has(c.id);
      case "lapsed": {
        const list = jobsByCustomer.get(c.id) || [];
        if (!list.some((j) => DONE.has(String(j.status)))) return false;
        const latest = Math.max(...list.map(jobTime));
        return latest > 0 && now - latest > YEAR_MS;
      }
    }
  };

  const seen = new Set<string>();
  const out: Recipient[] = [];
  for (const c of input.customers) {
    if (c.email_unsubscribed_at) continue;
    if (!isEmail(c.email)) continue;
    if (!inAudience(c)) continue;
    const email = String(c.email).trim();
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ customer_id: c.id, email, name: (c.name || "").trim() });
  }
  return out;
}

export function firstName(full: string | null | undefined): string {
  const f = String(full || "").trim().split(/\s+/)[0];
  return f || "there";
}

/** Merge fields an owner can type: {first_name}, {business_name},
 *  {referral_link} (empty when referrals are off or the customer has no link). */
export function mergeFields(
  text: string,
  vars: { firstName: string; businessName: string; referralLink?: string },
): string {
  return String(text || "")
    .replace(/\{first_name\}/g, vars.firstName)
    .replace(/\{business_name\}/g, vars.businessName)
    .replace(/\{referral_link\}/g, vars.referralLink || "");
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Plain text → simple HTML: paragraphs on blank lines, line breaks inside,
 *  and bare https links made clickable. Everything else is escaped. */
export function textToHtml(text: string): string {
  return String(text || "")
    .trim()
    .split(/\n{2,}/)
    .map((para) => {
      const safe = escapeHtml(para).replace(
        /(https:\/\/[^\s<]+[^\s<.,;:!?)])/g,
        (u) => `<a href="${u}">${u}</a>`,
      );
      return `<p style="margin:0 0 14px">${safe.replace(/\n/g, "<br>")}</p>`;
    })
    .join("");
}

/** What a campaign can't go out without. The business's mailing address is
 *  required in every marketing email (CAN-SPAM); the subject and body are
 *  the email itself. Returns the problems, empty = ready. */
export function campaignProblems(c: { subject?: string; body?: string }, org: { address?: string | null }): string[] {
  const out: string[] = [];
  if (!String(c.subject || "").trim()) out.push("Add a subject line.");
  if (!String(c.body || "").trim()) out.push("Write the email.");
  if (!String(org.address || "").trim()) out.push("Add your business mailing address in Business settings → Business info. Every marketing email has to show it.");
  return out;
}

/** The footer every campaign email carries: who sent it, their mailing
 *  address, why they got it and the one-click way out. */
export function campaignFooter(input: { businessName: string; address: string; unsubscribeUrl: string }): { text: string; html: string } {
  const why = `You're getting this because you're a customer of ${input.businessName}.`;
  const text = [
    "--",
    input.businessName,
    input.address,
    why,
    `Unsubscribe: ${input.unsubscribeUrl}`,
  ].join("\n");
  const html =
    `<hr style="border:none;border-top:1px solid #ddd;margin:24px 0 12px">` +
    `<p style="font-size:12px;color:#777;margin:0;line-height:1.5">` +
    `${escapeHtml(input.businessName)}<br>${escapeHtml(input.address)}<br>${escapeHtml(why)}<br>` +
    `<a href="${escapeHtml(input.unsubscribeUrl)}" style="color:#777">Unsubscribe</a></p>`;
  return { text, html };
}

/** One full email for one customer. */
export function renderCampaignEmail(input: {
  subject: string;
  body: string;
  customerName: string;
  businessName: string;
  address: string;
  unsubscribeUrl: string;
  referralLink?: string;
}): { subject: string; text: string; html: string } {
  const vars = { firstName: firstName(input.customerName), businessName: input.businessName, referralLink: input.referralLink };
  const subject = mergeFields(input.subject, vars).replace(/\s+/g, " ").trim();
  const body = mergeFields(input.body, vars).trim();
  const footer = campaignFooter({ businessName: input.businessName, address: input.address, unsubscribeUrl: input.unsubscribeUrl });
  return {
    subject,
    text: `${body}\n\n${footer.text}`,
    html:
      `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#222;max-width:560px">` +
      `${textToHtml(body)}${footer.html}</div>`,
  };
}

/** Starter emails on the Campaigns screen. Plain words the owner edits. */
export const STARTER_TEMPLATES: { key: string; name: string; audience: CampaignAudience; subject: string; body: string }[] = [
  {
    key: "seasonal",
    name: "Seasonal maintenance",
    audience: "all",
    subject: "Time for a seasonal check-up, {first_name}",
    body:
      "Hi {first_name},\n\nThe season is changing, and it's a good time to get ahead of small repairs before they turn into big ones: gutters, caulking, weatherstripping, smoke detectors and anything that's been bugging you.\n\nReply to this email or give us a call to get on the schedule.\n\nThanks,\n{business_name}",
  },
  {
    key: "lapsed",
    name: "It's been a year",
    audience: "lapsed",
    subject: "It's been a while, {first_name}",
    body:
      "Hi {first_name},\n\nIt's been about a year since we worked on your place. If anything new has come up, from a leaky faucet to a bigger project, we'd be glad to take a look.\n\nJust reply to this email and we'll set up a time.\n\nThanks,\n{business_name}",
  },
  {
    key: "membership",
    name: "Membership offer",
    audience: "individual",
    subject: "Never think about home maintenance again",
    body:
      "Hi {first_name},\n\nOur maintenance plan covers regular check-ups so small problems get caught early, and members get priority scheduling.\n\nReply to this email if you'd like the details.\n\nThanks,\n{business_name}",
  },
  {
    key: "referral",
    name: "Ask for a referral",
    audience: "all",
    subject: "Know someone who needs a hand?",
    body:
      "Hi {first_name},\n\nThanks again for trusting us with your home. If a friend or neighbor needs work done, send them your link and we'll take good care of them:\n\n{referral_link}\n\nWhen they book their first job, you'll get a thank-you credit on your next one.\n\nThanks,\n{business_name}",
  },
];
