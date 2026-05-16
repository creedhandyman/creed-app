"use client";
import { Component, useEffect, useState, type ReactNode } from "react";
import { useStore } from "@/lib/store";
import { db } from "@/lib/supabase";
import Payroll from "./Payroll";
import Financials from "./Financials";
import Customers from "./Customers";
import CustomerDetail from "./CustomerDetail";
import HR from "./HR";
import TeamStats from "../TeamStats";
import BillingSettings from "../BillingSettings";
import BrandingSettings from "../BrandingSettings";
import { Icon, type IconName } from "../Icon";
import { t } from "@/lib/i18n";

/**
 * Catches render-time crashes inside an Ops sub-tab so the whole tab
 * doesn't disappear behind Next's opaque "Application error" page.
 * Surfaces the real exception + stack inline so Bernard (or anyone) can
 * read the actual failure without devtools.
 */
class SubTabErrorBoundary extends Component<
  { label: string; children: ReactNode },
  { error: Error | null; info: string }
> {
  state: { error: Error | null; info: string } = { error: null, info: "" };
  static getDerivedStateFromError(error: Error) {
    return { error, info: "" };
  }
  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    // eslint-disable-next-line no-console
    console.error(`[Ops:${this.props.label}] render crash`, error, info);
    this.setState({ error, info: info?.componentStack || "" });
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="cd" style={{ borderLeft: "3px solid var(--color-accent-red)" }}>
        <h4 style={{ color: "var(--color-accent-red)", fontSize: 14, marginBottom: 8 }}>
          {this.props.label} tab crashed
        </h4>
        <p style={{ fontSize: 12, marginBottom: 8 }}>
          {String(this.state.error?.message || this.state.error)}
        </p>
        <details style={{ fontSize: 11, color: "#888" }}>
          <summary style={{ cursor: "pointer" }}>Stack</summary>
          <pre style={{ whiteSpace: "pre-wrap", marginTop: 6, fontSize: 10, fontFamily: "monospace" }}>
            {(this.state.error?.stack || "") + "\n" + this.state.info}
          </pre>
        </details>
        <button
          className="bo"
          onClick={() => this.setState({ error: null, info: "" })}
          style={{ fontSize: 12, padding: "4px 10px", marginTop: 8 }}
        >
          Retry
        </button>
      </div>
    );
  }
}

function OpsSettings() {
  const org = useStore((s) => s.org);
  const loadAll = useStore((s) => s.loadAll);
  const darkMode = useStore((s) => s.darkMode);

  if (!org) return null;

  const refreshOrg = async () => {
    await loadAll();
    const orgs = await db.get("organizations", { id: org.id });
    if (orgs.length) useStore.getState().setOrg(orgs[0] as never);
  };

  const tradeRates: Record<string, number> = (() => {
    try { return org.trade_rates ? JSON.parse(org.trade_rates) : {}; } catch { return {}; }
  })();

  let licensed: string[] = [];
  try { licensed = org.licensed_trades ? JSON.parse(org.licensed_trades) : []; } catch { /* */ }

  return (
    <div>
      {/* Branding & Business Info — logo, name, phone, address, license # */}
      <BrandingSettings />

      {/* Licensed Trades */}
      <div className="cd mb">
        <h4 style={{ fontSize: 14, marginBottom: 8 }}>🔑 {t("ops.licensedTrades")}</h4>
        <div className="dim" style={{ fontSize: 12, marginBottom: 8 }}>{t("ops.licensedHelp")}</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
          {["Electrical", "Plumbing", "HVAC", "Roofing", "Gas Fitting", "Fire Protection", "Structural", "Asbestos/Mold"].map((trade) => {
            const isLicensed = licensed.includes(trade);
            return (
              <label
                key={trade}
                onClick={async () => {
                  const updated = isLicensed ? licensed.filter((t) => t !== trade) : [...licensed, trade];
                  await db.patch("organizations", org.id, { licensed_trades: JSON.stringify(updated) });
                  refreshOrg();
                }}
                style={{
                  display: "flex", alignItems: "center", gap: 6, padding: "5px 8px",
                  borderRadius: 6, cursor: "pointer", fontSize: 12,
                  background: isLicensed ? "var(--color-success)15" : "transparent",
                  border: `1px solid ${isLicensed ? "var(--color-success)" : darkMode ? "#1e1e2e" : "#ddd"}`,
                }}
              >
                <span style={{ fontSize: 14, color: isLicensed ? "var(--color-success)" : "#555" }}>{isLicensed ? "☑" : "☐"}</span>
                {trade}
              </label>
            );
          })}
        </div>
      </div>

      {/* Quote Settings */}
      <div className="cd mb">
        <h4 style={{ fontSize: 14, marginBottom: 12, display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Icon name="trending" size={16} color="var(--color-primary)" />
          {t("ops.quoteSettings")}
        </h4>
        <div className="g2 mb">
          <div>
            <label className="sl">{t("ops.markup")}</label>
            <input type="number" key={`mk-${org.markup_pct}`} defaultValue={org.markup_pct || 0} min="0" step="1" placeholder="0" style={{ marginTop: 4 }}
              onBlur={async (e) => { await db.patch("organizations", org.id, { markup_pct: parseFloat(e.target.value) || 0 }); refreshOrg(); }} />
            <div className="dim" style={{ fontSize: 12, marginTop: 2 }}>{t("ops.markupHelp")}</div>
          </div>
          <div>
            <label className="sl">{t("ops.tax")}</label>
            <input type="number" key={`tx-${org.tax_pct}`} defaultValue={org.tax_pct || 0} min="0" step="0.1" placeholder="0" style={{ marginTop: 4 }}
              onBlur={async (e) => { await db.patch("organizations", org.id, { tax_pct: parseFloat(e.target.value) || 0 }); refreshOrg(); }} />
            <div className="dim" style={{ fontSize: 12, marginTop: 2 }}>{t("ops.taxHelp")}</div>
          </div>
        </div>
        <div className="g2">
          <div>
            <label className="sl">{t("ops.tripFee")}</label>
            <input type="number" key={`tf-${org.trip_fee}`} defaultValue={org.trip_fee || 0} min="0" step="5" placeholder="0" style={{ marginTop: 4 }}
              onBlur={async (e) => { await db.patch("organizations", org.id, { trip_fee: parseFloat(e.target.value) || 0 }); refreshOrg(); }} />
            <div className="dim" style={{ fontSize: 12, marginTop: 2 }}>{t("ops.tripFeeHelp")}</div>
          </div>
          <div>
            <label className="sl">{t("ops.minLaborHours")}</label>
            <input
              type="number"
              key={`mh-${org.min_labor_hours ?? 1}`}
              defaultValue={org.min_labor_hours ?? 1}
              min="0"
              step="0.25"
              placeholder="1"
              style={{ marginTop: 4 }}
              onBlur={async (e) => {
                const v = parseFloat(e.target.value);
                const next = Number.isFinite(v) && v >= 0 ? v : 0;
                await db.patch("organizations", org.id, { min_labor_hours: next });
                refreshOrg();
              }}
            />
            <div className="dim" style={{ fontSize: 12, marginTop: 2 }}>{t("ops.minLaborHoursHelp")}</div>
          </div>
        </div>
      </div>

      {/* Trade Rates */}
      <div className="cd mb">
        <h4 style={{ fontSize: 14, marginBottom: 8, display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Icon name="money" size={16} color="var(--color-primary)" />
          {t("ops.customRates")}
        </h4>
        <div className="dim" style={{ fontSize: 12, marginBottom: 8 }}>{t("ops.customRatesHelp")}</div>
        {["Plumbing", "Electrical", "Carpentry", "HVAC", "Painting", "Flooring", "General"].map((trade) => (
          <div key={trade} className="row" style={{ marginBottom: 4 }}>
            <span style={{ fontSize: 12, width: 80 }}>{trade}</span>
            <span>$</span>
            <input type="number" key={`${trade}-${tradeRates[trade] || ""}`} defaultValue={tradeRates[trade] || ""} placeholder="55" min="0" step="1" style={{ width: 70, fontSize: 12 }}
              onBlur={async (e) => {
                const val = parseFloat(e.target.value);
                const updated = { ...tradeRates };
                if (val && val > 0) updated[trade] = val; else delete updated[trade];
                await db.patch("organizations", org.id, { trade_rates: JSON.stringify(updated) }); refreshOrg();
              }} />
            <span style={{ fontSize: 11 }}>/hr</span>
            {tradeRates[trade] && <span style={{ fontSize: 12, color: "var(--color-success)" }}>✓</span>}
          </div>
        ))}
      </div>

      {/* Review Automation — auto-schedules a review-request SMS / email
          N hours after a Stripe-paid invoice. Wires the gamification quest
          flywheel without the owner having to remember. */}
      <ReviewAutomationCard org={org} refreshOrg={refreshOrg} />
    </div>
  );
}

/** Owner-facing controls for the Review Automation pipeline. The
 *  enable toggle / channel / delay / template / Google review URL all
 *  live on the organizations row; the cron at /api/reviews/dispatch
 *  reads them at send time. Defaults match what the migration sets. */
function ReviewAutomationCard({
  org,
  refreshOrg,
}: {
  org: NonNullable<ReturnType<typeof useStore.getState>["org"]>;
  refreshOrg: () => Promise<void>;
}) {
  const enabled = org.review_request_enabled !== false; // default TRUE
  const delayHours = typeof org.review_request_delay_hours === "number" ? org.review_request_delay_hours : 24;
  const channel = (org.review_request_channel as "sms" | "email" | "both") || "sms";
  const template = org.review_request_message ?? "";
  const reviewUrl = org.google_review_url ?? "";

  const defaultTemplate = "Hi {customer_name}, thanks for choosing {business_name} for your {job_property} project. If we earned it, we'd love a quick Google review: {review_link}";

  return (
    <div className="cd">
      <h4 style={{ fontSize: 14, marginBottom: 8, display: "inline-flex", alignItems: "center", gap: 6 }}>
        <Icon name="star" size={16} color="var(--color-primary)" />
        Review Automation
      </h4>
      <div className="dim" style={{ fontSize: 12, marginBottom: 12 }}>
        Auto-send a review request after a paid invoice. Closes the loop on the gamification quests and drives Google reviews without you having to remember.
      </div>

      {/* Enable toggle — primary affordance, pinned to the top so the
          owner can flip the whole automation on/off in one tap. */}
      <label className="row" style={{ gap: 8, marginBottom: 12, cursor: "pointer" }}>
        <input
          type="checkbox"
          checked={enabled}
          onChange={async (e) => {
            await db.patch("organizations", org.id, { review_request_enabled: e.target.checked });
            refreshOrg();
          }}
          style={{ width: 16, height: 16, cursor: "pointer" }}
        />
        <span style={{ fontSize: 13, fontWeight: 500 }}>
          {enabled ? "Enabled" : "Disabled"} — automatically request a review after payment
        </span>
      </label>

      {enabled && (
        <>
          <div className="g2 mb">
            <div>
              <label className="sl">Delay after payment (hours)</label>
              <input
                type="number"
                key={`rrd-${delayHours}`}
                defaultValue={delayHours}
                min="1"
                max="168"
                step="1"
                style={{ marginTop: 4 }}
                onBlur={async (e) => {
                  const v = parseInt(e.target.value, 10);
                  const next = Number.isFinite(v) && v >= 1 && v <= 168 ? v : 24;
                  await db.patch("organizations", org.id, { review_request_delay_hours: next });
                  refreshOrg();
                }}
              />
              <div className="dim" style={{ fontSize: 12, marginTop: 2 }}>
                How long to wait so you don&apos;t bombard the customer at payment.
              </div>
            </div>
            <div>
              <label className="sl">Channel</label>
              <select
                value={channel}
                onChange={async (e) => {
                  await db.patch("organizations", org.id, { review_request_channel: e.target.value });
                  refreshOrg();
                }}
                style={{ marginTop: 4 }}
              >
                <option value="sms">SMS only</option>
                <option value="email">Email only</option>
                <option value="both">Both</option>
              </select>
              <div className="dim" style={{ fontSize: 12, marginTop: 2 }}>
                Email needs RESEND_API_KEY on Vercel to actually send.
              </div>
            </div>
          </div>

          <div className="mb">
            <label className="sl">Google review URL</label>
            <input
              type="url"
              key={`gr-${reviewUrl}`}
              defaultValue={reviewUrl}
              placeholder="https://g.page/r/..."
              style={{ marginTop: 4 }}
              onBlur={async (e) => {
                await db.patch("organizations", org.id, { google_review_url: e.target.value.trim() || null });
                refreshOrg();
              }}
            />
            <div className="dim" style={{ fontSize: 12, marginTop: 2 }}>
              The link the message points the customer at. Leave blank to fall back to a generic &quot;reply with a star rating 1-5&quot; message.
            </div>
          </div>

          <div>
            <label className="sl">Message template</label>
            <textarea
              key={`tpl-${template.slice(0, 20)}`}
              defaultValue={template}
              placeholder={defaultTemplate}
              rows={4}
              style={{ marginTop: 4, width: "100%", fontSize: 12, fontFamily: "inherit" }}
              onBlur={async (e) => {
                const v = e.target.value.trim();
                await db.patch("organizations", org.id, { review_request_message: v || null });
                refreshOrg();
              }}
            />
            <div className="dim" style={{ fontSize: 12, marginTop: 2 }}>
              Variables: <code>{"{customer_name}"}</code>, <code>{"{business_name}"}</code>, <code>{"{job_property}"}</code>, <code>{"{review_link}"}</code>. Leave blank for the default.
            </div>
          </div>
        </>
      )}
    </div>
  );
}

type OpsTab = "payroll" | "financials" | "customers" | "hr" | "team" | "billing" | "settings";

export default function Operations({ setPage }: { setPage: (p: string) => void }) {
  const user = useStore((s) => s.user);
  const isAdmin = user?.role === "owner" || user?.role === "manager";
  const timeOffRequests = useStore((s) => s.timeOffRequests) ?? [];
  // Pending badge is only meaningful to admins — non-admins can't act on
  // it and shouldn't see a count of org-wide pending requests.
  const pendingTimeOffCount = isAdmin
    ? timeOffRequests.filter((r) => r && r.status === "pending").length
    : 0;

  // Non-admins land here only via the HR entry — default the sub-tab to
  // "hr" so they don't briefly see an empty "payroll" surface before any
  // filtering renders.
  const [tab, setTab] = useState<OpsTab>(isAdmin ? "payroll" : "hr");
  // CustomerDetail is rendered inline within the customers sub-tab. Its
  // state lives here so switching to a different sub-tab and back resets
  // to the list view (rather than the user landing on a stale detail).
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  useEffect(() => {
    if (tab !== "customers") setSelectedCustomerId(null);
  }, [tab]);

  // HR is the only sub-tab non-admins can see. The other Ops tabs are
  // admin-only — they were implicitly gated by the page-level admin
  // check, but now that the Ops route is open to everyone (so techs can
  // reach HR), the per-tab gate has to be explicit. HR carries the
  // pending-request badge for admins only.
  const allTabs: { id: OpsTab; label: string; icon: IconName; adminOnly?: boolean; badge?: number }[] = [
    { id: "payroll",    label: t("ops.payroll"),    icon: "money",    adminOnly: true },
    { id: "financials", label: t("ops.financials"), icon: "trending", adminOnly: true },
    { id: "customers",  label: "Customers",         icon: "clients",  adminOnly: true },
    { id: "hr",         label: "HR",                icon: "worker", badge: pendingTimeOffCount },
    { id: "team",       label: t("ops.team"),       icon: "worker",   adminOnly: true },
    { id: "billing",    label: t("ops.billing"),    icon: "receipt",  adminOnly: true },
    { id: "settings",   label: t("ops.settings"),   icon: "settings", adminOnly: true },
  ];
  const tabs = allTabs.filter((tb) => !tb.adminOnly || isAdmin);

  return (
    <div className="fi">
      <div style={{ display: "flex", gap: 3, marginBottom: 14, overflowX: "auto" }}>
        {tabs.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                padding: "6px 12px",
                borderRadius: 6,
                fontSize: 12,
                whiteSpace: "nowrap",
                background: active ? "var(--color-primary)" : "transparent",
                color: active ? "#fff" : "#888",
                fontFamily: "Oswald",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <Icon name={t.icon} size={14} strokeWidth={active ? 2 : 1.75} />
              {t.label}
              {t.badge && t.badge > 0 ? (
                <span
                  style={{
                    fontSize: 10,
                    fontFamily: "Oswald",
                    background: active ? "#fff" : "var(--color-accent-red)",
                    color: active ? "var(--color-primary)" : "#fff",
                    padding: "0 6px",
                    borderRadius: 8,
                    minWidth: 18,
                    textAlign: "center",
                    letterSpacing: ".04em",
                  }}
                >
                  {t.badge}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {tab === "payroll" && (
        <SubTabErrorBoundary label="Payroll"><Payroll /></SubTabErrorBoundary>
      )}
      {tab === "financials" && (
        <SubTabErrorBoundary label="Financials"><Financials setPage={setPage} /></SubTabErrorBoundary>
      )}
      {tab === "customers" && (
        <SubTabErrorBoundary label="Customers">
          {selectedCustomerId
            ? <CustomerDetail customerId={selectedCustomerId} onBack={() => setSelectedCustomerId(null)} />
            : <Customers setPage={setPage} onSelect={setSelectedCustomerId} />}
        </SubTabErrorBoundary>
      )}
      {tab === "hr" && (
        <SubTabErrorBoundary label="HR"><HR /></SubTabErrorBoundary>
      )}
      {tab === "team" && (
        <SubTabErrorBoundary label="Team"><TeamStats /></SubTabErrorBoundary>
      )}
      {tab === "billing" && (
        <SubTabErrorBoundary label="Billing"><BillingSettings /></SubTabErrorBoundary>
      )}
      {tab === "settings" && (
        <SubTabErrorBoundary label="Settings"><OpsSettings /></SubTabErrorBoundary>
      )}
    </div>
  );
}
