"use client";
import { Component, useEffect, useState, type ReactNode } from "react";
import { useStore } from "@/lib/store";
import { db } from "@/lib/supabase";
import { parseEntryDate } from "@/lib/dates";
import Payroll from "./Payroll";
import Financials from "./Financials";
import Customers from "./Customers";
import CustomerDetail from "./CustomerDetail";
import HR from "./HR";
import Recurring from "./Recurring";
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
      <div className="cd statusstrip" style={{ ["--c" as any]: "var(--color-accent-red)" }}>
        <h4 style={{ color: "var(--color-accent-red)", fontSize: 16, marginBottom: 8 }}>
          {this.props.label} {t("ops.tabCrashed")}
        </h4>
        <p style={{ fontSize: 14, marginBottom: 8 }}>
          {String(this.state.error?.message || this.state.error)}
        </p>
        <details style={{ fontSize: 13, color: "#888" }}>
          <summary style={{ cursor: "pointer" }}>Stack</summary>
          <pre style={{ whiteSpace: "pre-wrap", marginTop: 6, fontSize: 12, fontFamily: "monospace" }}>
            {(this.state.error?.stack || "") + "\n" + this.state.info}
          </pre>
        </details>
        <button
          className="bo"
          onClick={() => this.setState({ error: null, info: "" })}
          style={{ fontSize: 14, padding: "4px 10px", marginTop: 8 }}
        >
          {t("common.tryAgain")}
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
        <h4 style={{ fontSize: 16, marginBottom: 8, display: "inline-flex", alignItems: "center", gap: 6 }}><Icon name="safety" size={15} color="var(--color-primary)" /> {t("ops.licensedTrades")}</h4>
        <div className="dim" style={{ fontSize: 14, marginBottom: 8 }}>{t("ops.licensedHelp")}</div>
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
                  borderRadius: 6, cursor: "pointer", fontSize: 14,
                  background: isLicensed ? "var(--color-success)15" : "transparent",
                  border: `1px solid ${isLicensed ? "var(--color-success)" : darkMode ? "#1e1e2e" : "#ddd"}`,
                }}
              >
                <span style={{ width: 16, height: 16, borderRadius: 4, flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", background: isLicensed ? "var(--color-success)" : "transparent", border: `1.5px solid ${isLicensed ? "var(--color-success)" : "var(--color-border-dark-2)"}` }}>{isLicensed && <Icon name="check" size={11} color="#fff" strokeWidth={3} />}</span>
                {trade}
              </label>
            );
          })}
        </div>
      </div>

      {/* Quote Settings */}
      <div className="cd mb">
        <h4 style={{ fontSize: 16, marginBottom: 12, display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Icon name="trending" size={16} color="var(--color-primary)" />
          {t("ops.quoteSettings")}
        </h4>
        <div className="g2 mb">
          <div>
            <label className="sl">{t("ops.markup")}</label>
            <input type="number" key={`mk-${org.markup_pct}`} defaultValue={org.markup_pct || 0} min="0" step="1" placeholder="0" style={{ marginTop: 4 }}
              onBlur={async (e) => { await db.patch("organizations", org.id, { markup_pct: parseFloat(e.target.value) || 0 }); refreshOrg(); }} />
            <div className="dim" style={{ fontSize: 14, marginTop: 2 }}>{t("ops.markupHelp")}</div>
          </div>
          <div>
            <label className="sl">{t("ops.tax")}</label>
            <div className="row" style={{ gap: 6, marginTop: 4, alignItems: "stretch" }}>
              <input
                type="number"
                key={`tx-${org.tax_pct}`}
                defaultValue={org.tax_pct || 0}
                min="0"
                step="0.1"
                placeholder="0"
                style={{ flex: "0 0 80px" }}
                onBlur={async (e) => { await db.patch("organizations", org.id, { tax_pct: parseFloat(e.target.value) || 0 }); refreshOrg(); }}
              />
              <select
                key={`txm-${org.tax_mode || "total"}`}
                defaultValue={org.tax_mode || "total"}
                onChange={async (e) => { await db.patch("organizations", org.id, { tax_mode: e.target.value }); refreshOrg(); }}
                style={{ flex: 1, fontSize: 14 }}
                title={t("ops.taxModeHelp")}
              >
                <option value="materials">{t("ops.taxMode.materials")}</option>
                <option value="total">{t("ops.taxMode.total")}</option>
                <option value="none">{t("ops.taxMode.none")}</option>
              </select>
            </div>
            <div className="dim" style={{ fontSize: 14, marginTop: 2 }}>{t("ops.taxHelp")}</div>
          </div>
        </div>
        <div className="g2">
          <div>
            <label className="sl">{t("ops.tripFee")}</label>
            <input type="number" key={`tf-${org.trip_fee}`} defaultValue={org.trip_fee || 0} min="0" step="5" placeholder="0" style={{ marginTop: 4 }}
              onBlur={async (e) => { await db.patch("organizations", org.id, { trip_fee: parseFloat(e.target.value) || 0 }); refreshOrg(); }} />
            <div className="dim" style={{ fontSize: 14, marginTop: 2 }}>{t("ops.tripFeeHelp")}</div>
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
            <div className="dim" style={{ fontSize: 14, marginTop: 2 }}>{t("ops.minLaborHoursHelp")}</div>
          </div>
        </div>
      </div>

      {/* Quote terms — drive the bottom "Notes & Exclusions" of every quote
          PDF so it reflects this business, not a fixed template. */}
      <div className="cd mb">
        <h4 style={{ fontSize: 16, marginBottom: 8, display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Icon name="doc" size={16} color="var(--color-primary)" />
          Quote terms
        </h4>
        <div className="g2">
          <div>
            <label className="sl">Deposit %</label>
            <input
              type="number"
              key={`dep-${org.deposit_pct ?? 50}`}
              defaultValue={org.deposit_pct ?? 50}
              min="0"
              max="100"
              step="5"
              placeholder="50"
              style={{ marginTop: 4 }}
              onBlur={async (e) => {
                const v = parseFloat(e.target.value);
                await db.patch("organizations", org.id, { deposit_pct: Number.isFinite(v) && v >= 0 ? Math.min(100, v) : 0 });
                refreshOrg();
              }}
            />
            <div className="dim" style={{ fontSize: 14, marginTop: 2 }}>Shown on the quote PDF. 0 = no deposit line.</div>
          </div>
          <div>
            <label className="sl">Quote valid (days)</label>
            <input
              type="number"
              key={`vd-${org.quote_valid_days ?? 30}`}
              defaultValue={org.quote_valid_days ?? 30}
              min="1"
              step="1"
              placeholder="30"
              style={{ marginTop: 4 }}
              onBlur={async (e) => {
                const v = parseFloat(e.target.value);
                await db.patch("organizations", org.id, { quote_valid_days: Number.isFinite(v) && v > 0 ? Math.round(v) : 30 });
                refreshOrg();
              }}
            />
            <div className="dim" style={{ fontSize: 14, marginTop: 2 }}>How long the estimate stays valid.</div>
          </div>
        </div>
        <div style={{ marginTop: 10 }}>
          <label className="sl">Custom terms <span className="dim">· optional, one per line</span></label>
          <textarea
            key={`qt-${org.quote_terms || ""}`}
            defaultValue={org.quote_terms || ""}
            placeholder={"e.g. Warranty: 1 year on workmanship.\nPrices subject to change after the validity window."}
            style={{ marginTop: 4, minHeight: 70, width: "100%" }}
            onBlur={async (e) => {
              await db.patch("organizations", org.id, { quote_terms: e.target.value.trim() });
              refreshOrg();
            }}
          />
          <div className="dim" style={{ fontSize: 14, marginTop: 2 }}>Added as extra lines at the bottom of every quote PDF.</div>
        </div>
      </div>

      {/* Trade Rates */}
      <div className="cd mb">
        <h4 style={{ fontSize: 16, marginBottom: 8, display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Icon name="money" size={16} color="var(--color-primary)" />
          {t("ops.customRates")}
        </h4>
        <div className="dim" style={{ fontSize: 14, marginBottom: 8 }}>{t("ops.customRatesHelp")}</div>
        {["Plumbing", "Electrical", "Carpentry", "HVAC", "Painting", "Flooring", "General"].map((trade) => (
          <div key={trade} className="row" style={{ marginBottom: 4 }}>
            <span style={{ fontSize: 14, width: 80 }}>{trade}</span>
            <span>$</span>
            <input type="number" key={`${trade}-${tradeRates[trade] || ""}`} defaultValue={tradeRates[trade] || ""} placeholder="55" min="0" step="1" style={{ width: 70, fontSize: 14 }}
              onBlur={async (e) => {
                const val = parseFloat(e.target.value);
                const updated = { ...tradeRates };
                if (val && val > 0) updated[trade] = val; else delete updated[trade];
                await db.patch("organizations", org.id, { trade_rates: JSON.stringify(updated) }); refreshOrg();
              }} />
            <span style={{ fontSize: 13 }}>/hr</span>
            {tradeRates[trade] ? <Icon name="check" size={14} color="var(--color-success)" /> : null}
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

  const defaultTemplate = t("ops.reviewTemplateDefault");

  return (
    <div className="cd">
      <h4 style={{ fontSize: 16, marginBottom: 8, display: "inline-flex", alignItems: "center", gap: 6 }}>
        <Icon name="star" size={16} color="var(--color-primary)" />
        {t("ops.reviewAutomation")}
      </h4>
      <div className="dim" style={{ fontSize: 14, marginBottom: 12 }}>
        {t("ops.reviewAutomationHelp")}
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
        <span style={{ fontSize: 15, fontWeight: 500 }}>
          {enabled ? t("ops.enabled") : t("ops.disabled")} — {t("ops.reviewToggleLabel")}
        </span>
      </label>

      {enabled && (
        <>
          <div className="g2 mb">
            <div>
              <label className="sl">{t("ops.delayAfterPayment")}</label>
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
              <div className="dim" style={{ fontSize: 14, marginTop: 2 }}>
                {t("ops.delayAfterPaymentHelp")}
              </div>
            </div>
            <div>
              <label className="sl">{t("ops.channel")}</label>
              <select
                value={channel}
                onChange={async (e) => {
                  await db.patch("organizations", org.id, { review_request_channel: e.target.value });
                  refreshOrg();
                }}
                style={{ marginTop: 4 }}
              >
                <option value="sms">{t("ops.channelSmsOnly")}</option>
                <option value="email">{t("ops.channelEmailOnly")}</option>
                <option value="both">{t("ops.channelBoth")}</option>
              </select>
              <div className="dim" style={{ fontSize: 14, marginTop: 2 }}>
                {t("ops.channelEmailHelp")}
              </div>
            </div>
          </div>

          <div className="mb">
            <label className="sl">{t("ops.googleReviewUrl")}</label>
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
            <div className="dim" style={{ fontSize: 14, marginTop: 2 }}>
              {t("ops.googleReviewUrlHelp")}
            </div>
          </div>

          <div>
            <label className="sl">{t("ops.messageTemplate")}</label>
            <textarea
              key={`tpl-${template.slice(0, 20)}`}
              defaultValue={template}
              placeholder={defaultTemplate}
              rows={4}
              style={{ marginTop: 4, width: "100%", fontSize: 14, fontFamily: "inherit" }}
              onBlur={async (e) => {
                const v = e.target.value.trim();
                await db.patch("organizations", org.id, { review_request_message: v || null });
                refreshOrg();
              }}
            />
            <div className="dim" style={{ fontSize: 14, marginTop: 2 }}>
              {t("ops.variables")}: <code>{"{customer_name}"}</code>, <code>{"{business_name}"}</code>, <code>{"{job_property}"}</code>, <code>{"{review_link}"}</code>. {t("ops.leaveBlankDefault")}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

type OpsTab = "payroll" | "financials" | "customers" | "recurring" | "hr" | "team" | "billing" | "settings";

const AREA_LABEL_KEY: Record<OpsTab, string> = {
  payroll: "ops.payroll", financials: "ops.financials", customers: "ops.customers", recurring: "ops.recurring",
  hr: "ops.hr", team: "ops.team", billing: "ops.billing", settings: "ops.settings",
};
const areaLabel = (tab: OpsTab): string => t(AREA_LABEL_KEY[tab]);

// Per-tile color + tint (matches the mock's launcher).
const TILE_STYLE: Record<OpsTab, { icon: IconName; color: string; bg: string }> = {
  payroll:    { icon: "money",    color: "#3ee08f", bg: "rgba(0,204,102,.14)" },
  financials: { icon: "trending", color: "#8cc0ff", bg: "rgba(46,139,255,.14)" },
  customers:  { icon: "clients",  color: "#3ee08f", bg: "rgba(0,204,102,.14)" },
  recurring:  { icon: "refresh",  color: "#3aa0ff", bg: "rgba(58,160,255,.14)" },
  hr:         { icon: "card",     color: "#ffb15e", bg: "rgba(255,136,0,.16)" },
  team:       { icon: "worker",   color: "#c9a6ff", bg: "rgba(157,78,221,.16)" },
  billing:    { icon: "receipt",  color: "#f5b400", bg: "rgba(245,180,0,.16)" },
  settings:   { icon: "settings", color: "#aab2c0", bg: "rgba(138,138,153,.18)" },
};

export default function Operations({ setPage, initialTab }: { setPage: (p: string) => void; initialTab?: string }) {
  const user = useStore((s) => s.user);
  const isAdmin = user?.role === "owner" || user?.role === "manager";
  const profiles = useStore((s) => s.profiles);
  const timeEntries = useStore((s) => s.timeEntries);
  const darkMode = useStore((s) => s.darkMode);
  const jobs = useStore((s) => s.jobs);
  const receipts = useStore((s) => s.receipts) ?? [];
  const customers = useStore((s) => s.customers) ?? [];
  const recurringJobs = useStore((s) => s.recurringJobs) ?? [];
  const org = useStore((s) => s.org);
  const timeOffRequests = useStore((s) => s.timeOffRequests) ?? [];
  // Pending badge is only meaningful to admins — non-admins can't act on
  // it and shouldn't see a count of org-wide pending requests.
  const pendingTimeOffCount = isAdmin
    ? timeOffRequests.filter((r) => r && r.status === "pending").length
    : 0;

  // tab = null → the launcher hub (admins). A non-null tab opens that
  // area's detail. Non-admins skip the hub entirely (HR is their root).
  const validTabs: OpsTab[] = ["payroll", "financials", "customers", "recurring", "hr", "team", "billing", "settings"];
  const adminOnly: OpsTab[] = ["payroll", "financials", "customers", "recurring", "team", "billing", "settings"];
  const [tab, setTab] = useState<OpsTab | null>(() => {
    // Deep-link (e.g. More hub → Customers) opens a specific area, but a
    // non-admin can't reach an admin-only area — bounce them to HR.
    if (initialTab && (validTabs as string[]).includes(initialTab)) {
      const it = initialTab as OpsTab;
      if (!isAdmin && adminOnly.includes(it)) return "hr";
      return it;
    }
    return isAdmin ? null : "hr";
  });
  // CustomerDetail is rendered inline within the customers area. Its state
  // lives here so leaving and re-entering customers resets to the list.
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  useEffect(() => {
    if (tab !== "customers") setSelectedCustomerId(null);
  }, [tab]);

  // ── Hub KPIs + tile subs. Glanceable — the detail screens hold the
  // exact breakdowns. Payroll due is exact (unpaid hours × each person's
  // rate); revenue / profit are this-month approximations keyed off
  // created_at (Financials has the precise figures). ──
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const rateOf = (uid?: string | null) => (uid ? profiles.find((p) => p.id === uid)?.rate || 0 : 0);
  // parseEntryDate parses LOCAL (handles "M/D/YYYY" + "YYYY-MM-DD") — raw
  // `new Date("YYYY-MM-DD")` is UTC midnight = the previous evening in US zones,
  // which dropped 1st-of-month jobs (revenue) and manual ISO entries (labor)
  // out of the month and skewed Net profit.
  const inMonth = (d?: string) => { const dt = parseEntryDate(d); return dt ? dt >= monthStart : false; };
  const payrollDue = timeEntries.filter((e) => !e.paid_at).reduce((s, e) => s + (e.hours || 0) * rateOf(e.user_id), 0);
  // Revenue = work EARNED this month (complete/invoiced/paid), keyed off
  // job_date||created_at — the same basis as the dashboard's "Revenue·mo".
  // (Was paid-only by created_at, which under-counted and didn't line up with
  // the labor population below, skewing Net profit.)
  const earnedJobs = jobs.filter((j) => ["complete", "invoiced", "paid"].includes(j.status) && inMonth(j.job_date || j.created_at));
  const revenueMonth = earnedJobs.reduce((s, j) => s + (j.total || 0), 0);
  // Labor COST this month — crew pay actually logged (recorded amount, falling
  // back to hours × current rate for older rows that predate the amount field).
  const laborMonth = timeEntries.filter((e) => inMonth(e.entry_date)).reduce((s, e) => s + (e.amount || (e.hours || 0) * rateOf(e.user_id)), 0);
  // Material COST this month — actual receipts when we have them, else the
  // materials charged on this month's earned jobs (markup-inclusive proxy).
  // Net profit previously omitted materials entirely, overstating it.
  const receiptsMonth = receipts.filter((r) => inMonth(r.receipt_date)).reduce((s, r) => s + (r.amount || 0), 0);
  const materialsMonth = receiptsMonth > 0 ? receiptsMonth : earnedJobs.reduce((s, j) => s + (j.total_mat || 0), 0);
  // Net profit = revenue earned − labor cost − material cost (a month
  // approximation; Financials has the exact per-job P&L).
  const netProfit = revenueMonth - laborMonth - materialsMonth;
  const monthLabel = now.toLocaleDateString("en-US", { month: "short" });
  const fmtMoney = (n: number) => (Math.abs(n) >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${Math.round(n)}`);
  const roleLabel = user?.role === "owner" ? t("team.roleOwner") : user?.role === "manager" ? t("team.roleManager") : (user?.role || t("ops.roleTeam"));
  const planLabel = org?.subscription_plan ? String(org.subscription_plan) : org?.plan ? String(org.plan) : t("ops.manage");

  const tileSub: Record<OpsTab, string> = {
    payroll: `${fmtMoney(payrollDue)} ${t("ops.due")}`,
    financials: `${fmtMoney(revenueMonth)} · ${monthLabel}`,
    customers: `${customers.length} ${customers.length === 1 ? t("ops.clientSingular") : t("ops.clientPlural")}`,
    recurring: `${recurringJobs.filter((r) => r.is_active).length} ${t("ops.active")}`,
    hr: pendingTimeOffCount ? `${pendingTimeOffCount} ${t("ops.timeOffPending")}` : t("ops.timeOffPto"),
    team: `${profiles.length} ${profiles.length === 1 ? t("ops.memberSingular") : t("ops.memberPlural")}`,
    billing: planLabel,
    settings: t("ops.ratesTaxBrand"),
  };

  // ── Launcher hub (admins) ──
  if (isAdmin && tab === null) {
    return (
      <div className="fi">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <span style={{ fontFamily: "Oswald", fontWeight: 700, fontSize: 21, letterSpacing: ".5px", textTransform: "uppercase" }}>{t("settings.operations")}</span>
          <span style={{ fontSize: 10, fontWeight: 600, color: "#3ee08f", background: "rgba(0,204,102,.12)", border: "1px solid rgba(0,204,102,.4)", padding: "4px 9px", borderRadius: 99, display: "inline-flex", alignItems: "center", gap: 4 }}>
            <Icon name="safety" size={12} color="#3ee08f" /> {roleLabel}
          </span>
        </div>

        {/* KPIs */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 13 }}>
          {[
            { l: t("ops.payrollDue"), v: fmtMoney(payrollDue), c: "var(--color-money)" },
            { l: `${t("ops.revenue")} · ${monthLabel}`, v: fmtMoney(revenueMonth), c: "inherit" },
            { l: t("ops.netProfit"), v: fmtMoney(netProfit), c: netProfit >= 0 ? "var(--color-money)" : "var(--color-accent-red)" },
          ].map((k) => (
            <div key={k.l} style={{ background: darkMode ? "var(--color-card-dark-3)" : "var(--color-card-light)", border: `1px solid ${darkMode ? "var(--color-border-dark-2)" : "var(--color-border-light)"}`, borderRadius: 13, padding: "11px 6px", textAlign: "center" }}>
              <div style={{ fontSize: 8.5, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--color-dim)" }}>{k.l}</div>
              <div style={{ fontFamily: "Oswald", fontWeight: 700, fontSize: 17, marginTop: 3, color: k.c }}>{k.v}</div>
            </div>
          ))}
        </div>

        {/* Tiles */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {validTabs.map((id) => {
            const st = TILE_STYLE[id];
            const badge = id === "hr" ? pendingTimeOffCount : 0;
            return (
              <button
                key={id}
                onClick={() => setTab(id)}
                style={{ position: "relative", textAlign: "left", background: darkMode ? "var(--color-card-dark-3)" : "var(--color-card-light)", border: `1px solid ${darkMode ? "var(--color-border-dark-2)" : "var(--color-border-light)"}`, borderRadius: 15, padding: 13, cursor: "pointer", color: "inherit" }}
              >
                {badge ? (
                  <span style={{ position: "absolute", top: 11, right: 11, minWidth: 18, height: 18, padding: "0 5px", borderRadius: 9, background: "var(--color-accent-red)", color: "#fff", fontSize: 9.5, fontWeight: 700, fontFamily: "Oswald", display: "flex", alignItems: "center", justifyContent: "center" }}>{badge}</span>
                ) : null}
                <div style={{ width: 38, height: 38, borderRadius: 11, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 9, background: st.bg }}>
                  <Icon name={st.icon} size={19} color={st.color} />
                </div>
                <div style={{ fontFamily: "Oswald", fontWeight: 600, fontSize: 13.5, letterSpacing: ".3px" }}>{areaLabel(id)}</div>
                <div style={{ fontSize: 10, color: "var(--color-dim)", marginTop: 2 }}>{tileSub[id]}</div>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // ── Area detail (back header + the existing sub-screen) ──
  return (
    <div className="fi">
      {isAdmin && tab && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
          <button
            onClick={() => setTab(null)}
            aria-label={t("ops.backToOperations")}
            style={{ width: 30, height: 30, borderRadius: 9, background: darkMode ? "var(--color-card-dark-3)" : "var(--color-card-light)", border: `1px solid ${darkMode ? "var(--color-border-dark-2)" : "var(--color-border-light)"}`, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "inherit" }}
          >
            <Icon name="back" size={16} />
          </button>
          <span style={{ fontFamily: "Oswald", fontWeight: 700, fontSize: 18, letterSpacing: ".5px", textTransform: "uppercase" }}>{areaLabel(tab)}</span>
        </div>
      )}

      {tab === "payroll" && (
        <SubTabErrorBoundary label="Payroll"><Payroll embedded /></SubTabErrorBoundary>
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
      {tab === "recurring" && (
        <SubTabErrorBoundary label="Recurring"><Recurring /></SubTabErrorBoundary>
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
