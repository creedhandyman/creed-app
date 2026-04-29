"use client";
/**
 * Share-card panel — rendered inside the dashboard's "My business
 * card" tap-to-expand modal. Contains:
 *   - Action row: native share / SMS / email / copy / preview
 *   - Live URL the user can copy
 *   - Inline QR
 *   - Optional admin-only "Customize" form that edits the public
 *     /card/<slug> page's tagline + services list (org.site_content)
 *
 * The QR encodes the org's card URL with `?tech=<user.id>` so any
 * lead that comes in through this share gets attributed back to the
 * tech who shared it (powers Network Scout / referral credit).
 */
import { useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { useStore } from "@/lib/store";
import { db } from "@/lib/supabase";
import { Icon } from "./Icon";

interface Props {
  /** When set, the SMS / email shortcuts target this customer first. */
  customer?: {
    name: string;
    phone?: string;
    email?: string;
    primary_contact?: string;
  };
  /** Hide the title (used when embedded inside another titled card). */
  noTitle?: boolean;
}

const PRIMARY = "var(--color-primary)";

function buildBase(): string {
  if (typeof window === "undefined") return "";
  return window.location.origin;
}

export default function ShareCardPanel({ customer, noTitle }: Props) {
  const org = useStore((s) => s.org);
  const user = useStore((s) => s.user);
  const showToast = useStore((s) => s.showToast);
  const darkMode = useStore((s) => s.darkMode);
  const [smsBusy, setSmsBusy] = useState(false);

  const slug = org?.site_slug || "";
  // Tag the share URL with the current tech's id so any lead that
  // comes in through their copy of the QR/link gets attributed back
  // to them. Lands on jobs.referrer_tech_id via /api/leads.
  const cardUrl = useMemo(() => {
    if (!slug) return "";
    const base = `${buildBase()}/card/${slug}`;
    return user?.id ? `${base}?tech=${user.id}` : base;
  }, [slug, user?.id]);

  if (!org) return null;

  if (!slug) {
    return (
      <div className="cd mb">
        {!noTitle && <h4 style={{ fontSize: 13, marginBottom: 6 }}>📇 Share my card</h4>}
        <p className="dim" style={{ fontSize: 12, margin: 0 }}>
          Set a custom URL slug under Marketing → Website first, then this card unlocks at <code style={{ fontSize: 11 }}>creedhm.com/card/&lt;slug&gt;</code>.
        </p>
      </div>
    );
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(cardUrl);
      showToast("Card link copied", "success");
    } catch {
      showToast("Couldn't copy — long-press to select the link below", "warning");
    }
  };

  const shareUniversal = async () => {
    // Native share sheet on mobile / Edge / Safari. Falls back to copy
    // when the API isn't available (most desktop Chrome). We pass the
    // URL only — title/text on iOS Share sheet sometimes drops the URL
    // when both are set, depending on which target the user picks.
    if (typeof navigator !== "undefined" && "share" in navigator) {
      try {
        await (navigator as Navigator & { share: (d: ShareData) => Promise<void> }).share({
          title: org.name,
          text: `${org.name} — quick contact card`,
          url: cardUrl,
        });
        return;
      } catch {
        // User cancelled, or browser failed; fall through to copy.
      }
    }
    copy();
  };

  // SMS path — when there's a target customer, fire the existing /api/sms
  // endpoint (Twilio). Otherwise fall back to a tel-style prompt asking
  // for a number. Worst case, open the device's SMS composer.
  const sms = async (msgPrefix?: string) => {
    const message = `${msgPrefix ?? `${org.name} contact card:`} ${cardUrl}`;
    const phone = customer?.phone;
    if (phone) {
      setSmsBusy(true);
      try {
        const res = await fetch("/api/sms", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ to: phone, body: message }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          // Twilio fail-open — open the native SMS composer so the
          // contractor can still send the message manually.
          window.location.href = `sms:${phone}?body=${encodeURIComponent(message)}`;
          showToast(data?.error || "Twilio send failed — opening SMS app", "warning");
          return;
        }
        showToast(`Texted ${customer.name}`, "success");
      } catch (e) {
        window.location.href = `sms:${phone}?body=${encodeURIComponent(message)}`;
        showToast(e instanceof Error ? e.message : "Falling back to SMS app", "warning");
      } finally {
        setSmsBusy(false);
      }
      return;
    }
    // No customer — just open the device's SMS app with the link.
    window.location.href = `sms:?body=${encodeURIComponent(message)}`;
  };

  const email = () => {
    if (!customer?.email) {
      showToast("No email on file for this customer", "warning");
      return;
    }
    const subject = encodeURIComponent(`${org.name} — contact card`);
    const body = encodeURIComponent(
      `Hi ${customer.primary_contact || customer.name},\n\n` +
      `Here's our contact card — save it for next time:\n\n${cardUrl}\n\n` +
      `— ${org.name}`,
    );
    window.location.href = `mailto:${customer.email}?subject=${subject}&body=${body}`;
  };

  const customSms = `Hi ${customer?.primary_contact || customer?.name?.split(" ")[0] || ""}! ${org.name} contact card:`.trim();

  return (
    <div className="cd mb">
      {!noTitle && (
        <h4 style={{ fontSize: 13, marginBottom: 6 }}>📇 Share my card</h4>
      )}
      <p className="dim" style={{ fontSize: 12, margin: "0 0 10px" }}>
        Public digital business card with tap-to-call, vCard download, and a
        QR for in-person handoffs. Lives at <code style={{ fontSize: 11 }}>{`/card/${slug}`}</code>.
      </p>

      {/* Action row */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
        <button
          className="bb"
          onClick={shareUniversal}
          style={{ fontSize: 12, padding: "5px 10px" }}
          title="Open native share sheet (mobile) or copy"
        >
          📤 Share
        </button>
        <button
          className="bo"
          onClick={() => sms(customer ? customSms : undefined)}
          disabled={smsBusy}
          style={{ fontSize: 12, padding: "5px 10px" }}
          title={customer?.phone ? `Text ${customer.phone}` : "Open SMS composer"}
        >
          📱 SMS{customer?.phone ? ` (${customer.phone})` : ""}
        </button>
        {customer?.email && (
          <button
            className="bo"
            onClick={email}
            style={{ fontSize: 12, padding: "5px 10px" }}
          >
            ✉ Email
          </button>
        )}
        <button
          className="bo"
          onClick={copy}
          style={{ fontSize: 12, padding: "5px 10px" }}
        >
          📋 Copy
        </button>
        <a
          href={`/card/${slug}`}
          target="_blank"
          rel="noopener noreferrer"
          style={{ fontSize: 12, padding: "5px 10px", textDecoration: "none", color: PRIMARY, border: "1px solid var(--color-border-dark)", borderRadius: 6, display: "inline-flex", alignItems: "center", gap: 4 }}
        >
          ↗ Preview
        </a>
      </div>

      {/* URL */}
      <div
        style={{
          padding: "6px 10px", borderRadius: 6,
          background: darkMode ? "#0f0f18" : "#f7f7fa",
          border: `1px solid ${darkMode ? "#1e1e2e" : "#eee"}`,
          fontSize: 11, wordBreak: "break-all",
          fontFamily: "monospace", marginBottom: 12,
        }}
      >
        {cardUrl}
      </div>

      {/* QR */}
      <div style={{ display: "flex", justifyContent: "center" }}>
        <div
          style={{
            display: "inline-block",
            background: "#fff",
            padding: 12,
            borderRadius: 10,
            border: `1px solid ${darkMode ? "#1e1e2e" : "#ddd"}`,
          }}
        >
          <QRCodeSVG value={cardUrl} size={180} level="M" includeMargin={false} />
        </div>
      </div>
      <p className="dim" style={{ fontSize: 11, textAlign: "center", margin: "8px 0 0" }}>
        Show this QR on your phone — anyone can scan it to get the card.
      </p>

      {/* Card customization — admin only. Edits the tagline and the
          services bullet list shown on the public /card/<slug> page. */}
      {(user?.role === "owner" || user?.role === "manager") && (
        <CardCustomizer />
      )}
    </div>
  );
}

interface SiteContent {
  headline?: string;
  subheadline?: string;
  services?: string[];
  whyUs?: string[];
  cta?: string;
  about?: string;
}

function CardCustomizer() {
  const org = useStore((s) => s.org);
  const setOrg = useStore((s) => s.setOrg);
  const showToast = useStore((s) => s.showToast);

  const initial: SiteContent = useMemo(() => {
    try { return org?.site_content ? JSON.parse(org.site_content) : {}; } catch { return {}; }
  }, [org?.site_content]);

  const initialServices = (initial.services || []).join("\n");
  const [open, setOpen] = useState(false);
  const [headline, setHeadline] = useState(initial.headline || "");
  const [services, setServices] = useState(initialServices);
  const [saving, setSaving] = useState(false);

  if (!org) return null;

  const dirty = headline.trim() !== (initial.headline || "").trim()
    || services.trim() !== initialServices.trim();

  const save = async () => {
    setSaving(true);
    // Preserve any other site_content fields (subheadline, whyUs,
    // cta, about) that the legacy /s/<slug> site might still use.
    // We only own headline and services from this form.
    const merged: SiteContent = {
      ...initial,
      headline: headline.trim() || undefined,
      services: services
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
    };
    await db.patch("organizations", org.id, { site_content: JSON.stringify(merged) });
    // Refetch the org so the card preview rerenders with new copy.
    const orgs = await db.get("organizations", { id: org.id });
    if (orgs.length) setOrg(orgs[0] as never);
    setSaving(false);
    showToast("Card updated", "success");
  };

  return (
    <div
      style={{
        marginTop: 12,
        borderTop: "1px solid var(--color-border-dark)",
        paddingTop: 10,
      }}
    >
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          background: "transparent",
          border: "none",
          padding: "4px 0",
          color: "var(--color-primary)",
          fontFamily: "Oswald, sans-serif",
          fontSize: 12,
          letterSpacing: ".06em",
          textTransform: "uppercase",
          cursor: "pointer",
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <Icon name="edit" size={13} color="var(--color-primary)" />
        {open ? "Close" : "Customize card"}
      </button>

      {open && (
        <div style={{ marginTop: 8 }}>
          <label className="sl" style={{ fontSize: 11 }}>
            Tagline (one sentence — appears under your business name)
          </label>
          <input
            value={headline}
            onChange={(e) => setHeadline(e.target.value)}
            placeholder='e.g. "Property maintenance done right, on time"'
            maxLength={120}
            style={{ marginTop: 4, marginBottom: 10, fontSize: 13 }}
          />

          <label className="sl" style={{ fontSize: 11 }}>
            Services (one per line — shown as bullets)
          </label>
          <textarea
            value={services}
            onChange={(e) => setServices(e.target.value)}
            placeholder={"Repairs & maintenance\nRemodels & renovations\nInspections & estimates"}
            style={{ marginTop: 4, height: 100, fontSize: 13, fontFamily: "inherit" }}
          />
          <p className="dim" style={{ fontSize: 11, marginTop: 4, marginBottom: 8 }}>
            Leave services blank to fall back to your licensed-trades list.
          </p>

          <div style={{ display: "flex", gap: 6 }}>
            <button
              className="bb"
              disabled={!dirty || saving}
              onClick={save}
              style={{ fontSize: 12, padding: "6px 14px", opacity: !dirty || saving ? 0.5 : 1 }}
            >
              {saving ? "Saving…" : "Save"}
            </button>
            {dirty && (
              <button
                className="bo"
                onClick={() => {
                  setHeadline(initial.headline || "");
                  setServices(initialServices);
                }}
                style={{ fontSize: 12, padding: "6px 12px" }}
              >
                Reset
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
