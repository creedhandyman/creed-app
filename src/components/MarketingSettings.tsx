"use client";
/**
 * Ops → Business settings → Customer messages: the switches for email
 * campaigns and customer referrals. Both OFF by default. Columns live on the
 * organizations row (supabase/migrations/20261112170000_campaigns_and_referrals.sql).
 */
import { useState } from "react";
import { Icon } from "./Icon";
import type { Organization } from "@/lib/types";

type SaveOrg = (u: Record<string, unknown>) => Promise<void>;

export function CampaignsCard({ org, saveOrg }: { org: Organization; saveOrg: SaveOrg }) {
  const on = org.campaigns_enabled === true;
  const noAddress = !String(org.address || "").trim();
  return (
    <div className="cd mb">
      <h4 style={{ fontSize: 16, marginBottom: 8, display: "inline-flex", alignItems: "center", gap: 6 }}>
        <Icon name="mail" size={16} color="var(--color-primary)" />
        Email campaigns
      </h4>
      <div className="dim" style={{ fontSize: 14, marginBottom: 10 }}>
        Send one email to a group of your customers, like a seasonal check-up reminder or a note to people you haven&apos;t
        worked for in a year. Every email carries your business address and an unsubscribe link, and anyone who
        unsubscribes is never emailed again. When it&apos;s on, Campaigns shows up in Operations.
      </div>
      <label className="row" style={{ gap: 8, cursor: "pointer" }}>
        <input
          type="checkbox"
          checked={on}
          onChange={async (e) => { await saveOrg({ campaigns_enabled: e.target.checked }); }}
          style={{ width: 16, height: 16, cursor: "pointer" }}
        />
        <span style={{ fontSize: 15, fontWeight: 500 }}>{on ? "On" : "Off"} — email campaigns</span>
      </label>
      {on && noAddress && (
        <div style={{ fontSize: 13.5, marginTop: 8, color: "var(--color-warning, #f5b400)" }}>
          Add your business mailing address in Business info before you send. The law requires it on every marketing email.
        </div>
      )}
    </div>
  );
}

export function ReferralsCard({ org, saveOrg }: { org: Organization; saveOrg: SaveOrg }) {
  const on = org.referrals_enabled === true;
  const reward = Math.max(0, Number(org.referral_reward_cents ?? 2500) || 0);
  const [draft, setDraft] = useState(String(reward / 100));
  const noSite = !org.site_slug || org.site_published === false;
  return (
    <div className="cd mb">
      <h4 style={{ fontSize: 16, marginBottom: 8, display: "inline-flex", alignItems: "center", gap: 6 }}>
        <Icon name="share" size={16} color="var(--color-primary)" />
        Customer referrals
      </h4>
      <div className="dim" style={{ fontSize: 14, marginBottom: 10 }}>
        Each customer gets their own link to your quote request form, in their portal and on their customer page.
        When a new customer comes in through it and pays for their first job, the person who sent it earns a credit
        you can put on their next quote.
      </div>
      <label className="row" style={{ gap: 8, cursor: "pointer" }}>
        <input
          type="checkbox"
          checked={on}
          onChange={async (e) => { await saveOrg({ referrals_enabled: e.target.checked }); }}
          style={{ width: 16, height: 16, cursor: "pointer" }}
        />
        <span style={{ fontSize: 15, fontWeight: 500 }}>{on ? "On" : "Off"} — customer referrals</span>
      </label>
      <div style={{ marginTop: 10 }}>
        <label className="sl">Thank-you credit</label>
        <div className="row" style={{ gap: 6, marginTop: 4 }}>
          <span>$</span>
          <input
            type="number"
            min="0"
            max="1000"
            step="1"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={async () => {
              const v = Math.round(Math.max(0, Math.min(1000, parseFloat(draft) || 0)) * 100);
              setDraft(String(v / 100));
              if (v !== reward) await saveOrg({ referral_reward_cents: v });
            }}
            style={{ width: 90 }}
          />
          <span className="dim" style={{ fontSize: 13 }}>off the referrer&apos;s next job</span>
        </div>
      </div>
      {on && noSite && (
        <div style={{ fontSize: 13.5, marginTop: 8, color: "var(--color-warning, #f5b400)" }}>
          Referral links point at your public quote request form, so publish your site in Branding first.
        </div>
      )}
    </div>
  );
}
