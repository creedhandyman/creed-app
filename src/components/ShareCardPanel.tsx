"use client";
/**
 * Share-card panel — used in two places:
 *   1. Operations → Settings (under BrandingSettings) so the contractor
 *      can show the QR at job sites and copy/text the link.
 *   2. CustomerDetail in Operations → Customers, so the contractor can
 *      send a returning customer their card directly.
 *
 * The QR is rendered inline (qrcode.react SVG, same lib used on Jobs
 * pay-QR and Quests). Web Share API is used opportunistically — falls
 * back to a plain SMS compose link, mailto, and clipboard copy.
 */
import { useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { useStore } from "@/lib/store";

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
  const showToast = useStore((s) => s.showToast);
  const darkMode = useStore((s) => s.darkMode);
  const [smsBusy, setSmsBusy] = useState(false);

  const slug = org?.site_slug || "";
  const cardUrl = useMemo(() => slug ? `${buildBase()}/card/${slug}` : "", [slug]);

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
    </div>
  );
}
