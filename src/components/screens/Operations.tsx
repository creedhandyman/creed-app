"use client";
import { Component, useEffect, useRef, useState, type ReactNode } from "react";
import { useStore } from "@/lib/store";
import { db, supabase } from "@/lib/supabase";
import { profitSnapshot } from "@/lib/financials";
import Payroll from "./Payroll";
import Financials from "./Financials";
import Customers from "./Customers";
import CustomerDetail from "./CustomerDetail";
import HR from "./HR";
import RecurringMemberships from "./RecurringMemberships";
import TeamStats from "../TeamStats";
import BillingSettings from "../BillingSettings";
import BrandingSettings from "../BrandingSettings";
import { Icon, type IconName } from "../Icon";
import TopBar from "@/components/TopBar";
import { t } from "@/lib/i18n";
import { goWithIntent } from "@/lib/nav-intent";
import { isPlatformAdmin } from "@/lib/platform-admin";
import { useBackLayer } from "@/lib/back-layer";
import ZipTaxRates from "../ZipTaxRates";

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

/* ── Beta preflight ─────────────────────────────────────────────────
   One-tap readiness check against /api/preflight (authed with the
   owner's Supabase JWT — same pattern as Payroll's "Run now (test)").
   Renders the endpoint's booleans as a green/red list so nothing has
   to be verified with curl. */
type PreflightReport = {
  ready: boolean;
  blockers: string[];
  env: Record<string, boolean>;
  usingServiceRole: boolean;
  db: Record<string, boolean>;
  stripe: { reachable: boolean };
  checkedAt: string;
};

function PreflightPanel() {
  const [report, setReport] = useState<PreflightReport | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      const res = await fetch("/api/preflight", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        cache: "no-store",
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        useStore.getState().showToast(j.error || `Preflight failed (${res.status})`, "error");
        return;
      }
      setReport(j as PreflightReport);
    } catch {
      useStore.getState().showToast("Network error — try again", "error");
    } finally {
      setBusy(false);
    }
  };

  const Row = ({ ok, label }: { ok: boolean; label: string }) => (
    <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13.5, padding: "2px 0", color: ok ? "inherit" : "var(--color-accent-red)" }}>
      <span style={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0, background: ok ? "var(--color-success)" : "var(--color-accent-red)", boxShadow: `0 0 6px 0 ${ok ? "var(--color-success)" : "var(--color-accent-red)"}` }} />
      {label}
    </div>
  );

  return (
    <div className="cd mb">
      <h4 style={{ fontSize: 16, marginBottom: 6, display: "inline-flex", alignItems: "center", gap: 6 }}>
        <Icon name="checkCircle" size={15} color="var(--color-primary)" /> Beta preflight
      </h4>
      <div className="dim" style={{ fontSize: 14, marginBottom: 8 }}>
        Checks env vars, database migrations, and Stripe on the live deployment. All green = ready for beta.
      </div>
      <button className="bb" onClick={run} disabled={busy} style={{ fontSize: 14, padding: "7px 14px" }}>
        {busy ? "Checking…" : report ? "Re-run checks" : "Run checks"}
      </button>

      {report && (
        <div style={{ marginTop: 12 }}>
          {/* Verdict banner */}
          <div
            className="statusstrip"
            style={{
              ["--c" as never]: report.ready ? "var(--color-success)" : "var(--color-accent-red)",
              padding: "8px 10px", borderRadius: 8, marginBottom: 10,
              background: report.ready ? "rgba(0,204,102,.08)" : "rgba(192,0,0,.08)",
            }}
          >
            <b style={{ fontSize: 15, color: report.ready ? "var(--color-success)" : "var(--color-accent-red)" }}>
              {report.ready ? "READY — all checks passed" : `${report.blockers.length} blocker${report.blockers.length === 1 ? "" : "s"} to clear`}
            </b>
          </div>

          {/* Blockers, plain language */}
          {report.blockers.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              {report.blockers.map((b, i) => (
                <div key={i} style={{ display: "flex", gap: 6, fontSize: 13.5, color: "var(--color-accent-red)", padding: "2px 0" }}>
                  <span>✗</span> {b}
                </div>
              ))}
            </div>
          )}

          <div className="seclabel" style={{ marginTop: 8 }}>Environment</div>
          {Object.entries(report.env).map(([k, v]) => <Row key={k} ok={v} label={k} />)}
          <Row ok={report.usingServiceRole} label="Service role (live database read)" />
          <Row ok={report.stripe?.reachable} label="Stripe API reachable" />

          <div className="seclabel" style={{ marginTop: 10 }}>Database migrations</div>
          {Object.entries(report.db).map(([k, v]) => <Row key={k} ok={v} label={k} />)}

          <div className="dim" style={{ fontSize: 12, marginTop: 10 }}>
            Checked {new Date(report.checkedAt).toLocaleString()}
          </div>
        </div>
      )}
    </div>
  );
}

function OpsSettings() {
  const org = useStore((s) => s.org);
  const userEmail = useStore((s) => s.user?.email);
  const loadAll = useStore((s) => s.loadAll);
  const darkMode = useStore((s) => s.darkMode);

  if (!org) return null;

  const refreshOrg = async () => {
    await loadAll();
    const orgs = await db.get("organizations", { id: org.id });
    if (orgs.length) useStore.getState().setOrg(orgs[0] as never);
  };

  // One save path for every business setting: a quiet "Saved" when the
  // write lands, then refresh. A failed write already toasted its own
  // error (db.patch), so it shows only that — never a false "Saved".
  const saveOrg = async (u: Record<string, unknown>) => {
    if (await db.patch("organizations", org.id, u)) {
      useStore.getState().showToast(t("settings.saved"), "success");
      await refreshOrg();
    }
  };

  const tradeRates: Record<string, number> = (() => {
    try { return org.trade_rates ? JSON.parse(org.trade_rates) : {}; } catch { return {}; }
  })();

  let licensed: string[] = [];
  try { licensed = org.licensed_trades ? JSON.parse(org.licensed_trades) : []; } catch { /* */ }

  return (
    <div>
      {/* Beta preflight — one-tap deployment readiness check. Platform
          operators only: customers shouldn't see env vars / migrations. */}
      {isPlatformAdmin(userEmail) && <PreflightPanel />}

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
                  await saveOrg({ licensed_trades: JSON.stringify(updated) });
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
        {/* The base hourly rate every quote is priced from (trade-specific
            rates below override it per trade). */}
        <div className="mb">
          <label className="sl">{t("ops.laborRate")}</label>
          <div className="row" style={{ gap: 6, marginTop: 4, alignItems: "center" }}>
            <span>$</span>
            <input
              type="number"
              key={`dr-${org.default_rate ?? 55}`}
              defaultValue={org.default_rate ?? 55}
              min="1"
              step="1"
              placeholder="55"
              style={{ flex: "0 0 100px" }}
              onBlur={async (e) => {
                const v = parseFloat(e.target.value);
                if (!(v > 0) || v === org.default_rate) return;
                await saveOrg({ default_rate: v });
              }}
            />
            <span style={{ fontSize: 13 }}>/hr</span>
          </div>
          <div className="dim" style={{ fontSize: 14, marginTop: 2 }}>{t("ops.laborRateHelp")}</div>
        </div>
        <div className="g2 mb">
          <div>
            <label className="sl">{t("ops.markup")}</label>
            <input type="number" key={`mk-${org.markup_pct}`} defaultValue={org.markup_pct || 0} min="0" step="1" placeholder="0" style={{ marginTop: 4 }}
              onBlur={async (e) => {
                const v = parseFloat(e.target.value) || 0;
                if (v === Number(org.markup_pct || 0)) return;
                await saveOrg({ markup_pct: v });
              }} />
            <div className="dim" style={{ fontSize: 14, marginTop: 2 }}>{t("ops.markupHelp")}</div>
          </div>
          <div>
            <label className="sl">{t("ops.materialTax")}</label>
            <input type="number" key={`mt-${org.material_tax_pct}`} defaultValue={org.material_tax_pct || 0} min="0" step="0.1" placeholder="0" style={{ marginTop: 4 }}
              onBlur={async (e) => {
                const v = Math.max(0, parseFloat(e.target.value) || 0);
                if (v === Number(org.material_tax_pct || 0)) return;
                await saveOrg({ material_tax_pct: v });
              }} />
            <div className="dim" style={{ fontSize: 14, marginTop: 2 }}>{t("ops.materialTaxHelp")}</div>
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
                onBlur={async (e) => {
                  const v = parseFloat(e.target.value) || 0;
                  if (v === Number(org.tax_pct || 0)) return;
                  await saveOrg({ tax_pct: v });
                }}
              />
              <select
                key={`txm-${org.tax_mode || "total"}`}
                defaultValue={org.tax_mode || "total"}
                onChange={async (e) => { await saveOrg({ tax_mode: e.target.value }); }}
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
        <ZipTaxRates raw={org.material_tax_by_zip} save={saveOrg} />
        <div className="g2">
          <div>
            <label className="sl">{t("ops.tripFee")}</label>
            <input type="number" key={`tf-${org.trip_fee}`} defaultValue={org.trip_fee || 0} min="0" step="5" placeholder="0" style={{ marginTop: 4 }}
              onBlur={async (e) => {
                const v = parseFloat(e.target.value) || 0;
                if (v === Number(org.trip_fee || 0)) return;
                await saveOrg({ trip_fee: v });
              }} />
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
                if (next === Number(org.min_labor_hours ?? 1)) return;
                await saveOrg({ min_labor_hours: next });
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
                const next = Number.isFinite(v) && v >= 0 ? Math.min(100, v) : 0;
                if (next === Number(org.deposit_pct ?? 50)) return;
                await saveOrg({ deposit_pct: next });
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
                const next = Number.isFinite(v) && v > 0 ? Math.round(v) : 30;
                if (next === Number(org.quote_valid_days ?? 30)) return;
                await saveOrg({ quote_valid_days: next });
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
              const v = e.target.value.trim();
              if (v === (org.quote_terms || "").trim()) return;
              await saveOrg({ quote_terms: v });
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
            <input type="number" key={`${trade}-${tradeRates[trade] || ""}`} defaultValue={tradeRates[trade] || ""} placeholder={String(org.default_rate || 55)} min="0" step="1" style={{ width: 70, fontSize: 14 }}
              onBlur={async (e) => {
                const val = parseFloat(e.target.value);
                const updated = { ...tradeRates };
                if (val && val > 0) updated[trade] = val; else delete updated[trade];
                if (JSON.stringify(updated) === JSON.stringify(tradeRates)) return;
                await saveOrg({ trade_rates: JSON.stringify(updated) });
              }} />
            <span style={{ fontSize: 13 }}>/hr</span>
            {tradeRates[trade] ? <Icon name="check" size={14} color="var(--color-success)" /> : null}
          </div>
        ))}
      </div>

      {/* Review Automation — auto-schedules a review-request SMS / email
          N hours after a Stripe-paid invoice. Wires the gamification quest
          flywheel without the owner having to remember. */}
      <ReviewAutomationCard org={org} saveOrg={saveOrg} />
      <QuoteFollowupCard org={org} saveOrg={saveOrg} />
    </div>
  );
}

/** Quote follow-up automation toggle. The cron at /api/quotes/followup reads
 *  organizations.quote_followup_enabled; OFF by default (it texts/emails
 *  customers on the business's behalf, so the owner opts in). */
function QuoteFollowupCard({
  org,
  saveOrg,
}: {
  org: NonNullable<ReturnType<typeof useStore.getState>["org"]>;
  saveOrg: (u: Record<string, unknown>) => Promise<void>;
}) {
  const enabled = org.quote_followup_enabled === true;
  return (
    <div className="cd">
      <h4 style={{ fontSize: 16, marginBottom: 8, display: "inline-flex", alignItems: "center", gap: 6 }}>
        <Icon name="send" size={16} color="var(--color-primary)" />
        {t("ops.quoteFollowup")}
      </h4>
      <div className="dim" style={{ fontSize: 14, marginBottom: 12 }}>
        {t("ops.quoteFollowupHelp")}
      </div>
      <label className="row" style={{ gap: 8, cursor: "pointer" }}>
        <input
          type="checkbox"
          checked={enabled}
          onChange={async (e) => {
            await saveOrg({ quote_followup_enabled: e.target.checked });
          }}
          style={{ width: 16, height: 16, cursor: "pointer" }}
        />
        <span style={{ fontSize: 15, fontWeight: 500 }}>
          {enabled ? t("ops.enabled") : t("ops.disabled")} — {t("ops.quoteFollowupToggle")}
        </span>
      </label>
    </div>
  );
}

/** Owner-facing controls for the Review Automation pipeline. The
 *  enable toggle / channel / delay / template / Google review URL all
 *  live on the organizations row; the cron at /api/reviews/dispatch
 *  reads them at send time. Defaults match what the migration sets. */
function ReviewAutomationCard({
  org,
  saveOrg,
}: {
  org: NonNullable<ReturnType<typeof useStore.getState>["org"]>;
  saveOrg: (u: Record<string, unknown>) => Promise<void>;
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
            await saveOrg({ review_request_enabled: e.target.checked });
          }}
          style={{ width: 16, height: 16, cursor: "pointer" }}
        />
        <span style={{ fontSize: 15, fontWeight: 500 }}>
          {enabled ? t("ops.enabled") : t("ops.disabled")} — {t("ops.reviewToggleLabel")}
        </span>
      </label>

      {/* Always shown (also feeds the Quests → Reviews QR), not just while automation is on. */}
      <div className="mb">
        <label className="sl">{t("ops.googleReviewUrl")}</label>
        <input
          type="url"
          key={`gr-${reviewUrl}`}
          defaultValue={reviewUrl}
          placeholder="https://g.page/r/..."
          style={{ marginTop: 4 }}
          onBlur={async (e) => {
            const v = e.target.value.trim();
            if (v === reviewUrl.trim()) return;
            await saveOrg({ google_review_url: v || null });
          }}
        />
        <div className="dim" style={{ fontSize: 14, marginTop: 2 }}>
          {t("ops.googleReviewUrlHelp")}
        </div>
      </div>

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
                  if (next === delayHours) return;
                  await saveOrg({ review_request_delay_hours: next });
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
                  await saveOrg({ review_request_channel: e.target.value });
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
                if (v === template.trim()) return;
                await saveOrg({ review_request_message: v || null });
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
  const membershipPlans = useStore((s) => s.membershipPlans) ?? [];
  const org = useStore((s) => s.org);
  const timeOffRequests = useStore((s) => s.timeOffRequests) ?? [];
  // Pending badge is only meaningful to admins — non-admins can't act on
  // it and shouldn't see a count of org-wide pending requests.
  const pendingTimeOffCount = isAdmin
    ? timeOffRequests.filter((r) => r && r.status === "pending").length
    : 0;
  // Join requests waiting for approval (Team tile badge).
  const pendingMembers = useStore((s) => s.pendingMembers) ?? [];
  const pendingJoinCount = isAdmin ? pendingMembers.length : 0;

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
  // Opened straight into an area (More → Customers / Business settings, a
  // Home row): back returns to where you came from, not to the Ops hub you
  // never saw. That area gets no layer (the page entry is its back step).
  const deepAreaRef = useRef<OpsTab | null>(initialTab && isAdmin ? tab : null);
  const isDeepArea = tab !== null && tab === deepAreaRef.current;
  useEffect(() => {
    if (tab !== deepAreaRef.current) deepAreaRef.current = null;
  }, [tab]);
  // System back: customer → customer list → Ops hub (instead of leaving Ops).
  useBackLayer(isAdmin && tab !== null && !isDeepArea, () => setTab(null));
  useBackLayer(!!selectedCustomerId, () => setSelectedCustomerId(null));

  // ── Hub KPIs + tile subs. Payroll due is exact (unpaid hours × each
  // person's rate). Revenue + Net profit come from the SAME shared math
  // the Financials screen shows (profitSnapshot, calendar month-to-date),
  // so the KPI teased here is the number Financials opens on — the hub
  // used to run its own approximation (all labor logged this month,
  // archived jobs included) and the two never matched. ──
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const rateOf = (uid?: string | null) => (uid ? profiles.find((p) => p.id === uid)?.rate || 0 : 0);
  const payrollDue = timeEntries.filter((e) => !e.paid_at).reduce((s, e) => s + (e.hours || 0) * rateOf(e.user_id), 0);
  const { completedRevenue: revenueMonth, netProfit } = profitSnapshot({ jobs, timeEntries, receipts, profiles, rangeStart: monthStart });
  const monthLabel = now.toLocaleDateString("en-US", { month: "short" });
  const fmtMoney = (n: number) => (Math.abs(n) >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${Math.round(n)}`);
  const roleLabel = user?.role === "owner" ? t("team.roleOwner") : user?.role === "manager" ? t("team.roleManager") : (user?.role || t("ops.roleTeam"));
  const planLabel = org?.subscription_plan ? String(org.subscription_plan) : org?.plan ? String(org.plan) : t("ops.manage");

  const tileSub: Record<OpsTab, string> = {
    payroll: `${fmtMoney(payrollDue)} ${t("ops.due")}`,
    financials: `${fmtMoney(revenueMonth)} · ${monthLabel}`,
    customers: `${customers.length} ${customers.length === 1 ? t("ops.clientSingular") : t("ops.clientPlural")}`,
    recurring: `${recurringJobs.filter((r) => r.is_active).length} recurring · ${membershipPlans.filter((p) => p.is_active).length} plans`,
    hr: pendingTimeOffCount ? `${pendingTimeOffCount} ${t("ops.timeOffPending")}` : t("ops.timeOffPto"),
    team: `${profiles.length} ${profiles.length === 1 ? t("ops.memberSingular") : t("ops.memberPlural")}`,
    billing: planLabel,
    settings: t("ops.ratesTaxBrand"),
  };

  // ── Launcher hub (admins) ──
  if (isAdmin && tab === null) {
    return (
      <div className="fi">
        <TopBar title={t("settings.operations")} icon="ops" color="#06b6d4" right={
          <span style={{ fontSize: 11, fontWeight: 600, color: "#3ee08f", background: "rgba(0,204,102,.12)", border: "1px solid rgba(0,204,102,.4)", padding: "4px 9px", borderRadius: 99, display: "inline-flex", alignItems: "center", gap: 4 }}>
            <Icon name="safety" size={12} color="#3ee08f" /> {roleLabel}
          </span>
        } />

        {/* KPIs — each one opens the area behind its number. */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 13 }}>
          {([
            { l: t("ops.payrollDue"), v: fmtMoney(payrollDue), c: "var(--color-money)", to: "payroll" },
            { l: `${t("ops.revenue")} · ${monthLabel}`, v: fmtMoney(revenueMonth), c: "inherit", to: "financials" },
            { l: t("ops.netProfit"), v: fmtMoney(netProfit), c: netProfit >= 0 ? "var(--color-money)" : "var(--color-accent-red)", to: "financials" },
          ] as { l: string; v: string; c: string; to: OpsTab }[]).map((k) => (
            <button
              key={k.l}
              onClick={() => setTab(k.to)}
              style={{ background: darkMode ? "var(--color-card-dark-3)" : "var(--color-card-light)", border: `1px solid ${darkMode ? "var(--color-border-dark-2)" : "var(--color-border-light)"}`, borderRadius: 13, padding: "11px 6px", textAlign: "center", width: "100%", minWidth: 0, font: "inherit", textTransform: "none", letterSpacing: "normal", color: "inherit", cursor: "pointer" }}
            >
              <div style={{ fontSize: 10.5, lineHeight: 1.25, letterSpacing: ".04em", textTransform: "uppercase", color: "var(--color-dim)" }}>{k.l}</div>
              <div style={{ fontFamily: "Oswald", fontWeight: 700, fontSize: 17, marginTop: 3, color: k.c }}>{k.v}</div>
            </button>
          ))}
        </div>

        {/* Tiles */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {validTabs.map((id) => {
            const st = TILE_STYLE[id];
            const badge = id === "hr" ? pendingTimeOffCount : id === "team" ? pendingJoinCount : 0;
            return (
              <button
                key={id}
                onClick={() => setTab(id)}
                style={{ position: "relative", textAlign: "left", background: darkMode ? "var(--color-card-dark-3)" : "var(--color-card-light)", border: `1px solid ${darkMode ? "var(--color-border-dark-2)" : "var(--color-border-light)"}`, borderRadius: 15, padding: 13, cursor: "pointer", color: "inherit" }}
              >
                {badge ? (
                  <span style={{ position: "absolute", top: 11, right: 11, minWidth: 18, height: 18, padding: "0 5px", borderRadius: 9, background: "var(--color-accent-red)", color: "#fff", fontSize: 11, fontWeight: 700, fontFamily: "Oswald", display: "flex", alignItems: "center", justifyContent: "center" }}>{badge}</span>
                ) : null}
                <div style={{ width: 38, height: 38, borderRadius: 11, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 9, background: st.bg }}>
                  <Icon name={st.icon} size={19} color={st.color} />
                </div>
                <div style={{ fontFamily: "Oswald", fontWeight: 600, fontSize: 13.5, letterSpacing: ".3px" }}>{areaLabel(id)}</div>
                <div style={{ fontSize: 11.5, color: "var(--color-dim)", marginTop: 2 }}>{tileSub[id]}</div>
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
        <TopBar
          title={areaLabel(tab)}
          onBack={() => (selectedCustomerId ? setSelectedCustomerId(null) : isDeepArea ? window.history.back() : setTab(null))}
          backLabel={t("ops.backToOperations")}
        />
      )}

      {tab === "payroll" && (
        <SubTabErrorBoundary label="Payroll"><Payroll embedded /></SubTabErrorBoundary>
      )}
      {tab === "financials" && (
        <SubTabErrorBoundary label="Financials"><Financials setPage={setPage} embedded /></SubTabErrorBoundary>
      )}
      {tab === "customers" && (
        <SubTabErrorBoundary label="Customers">
          {selectedCustomerId
            ? (
              <CustomerDetail
                customerId={selectedCustomerId}
                onBack={() => setSelectedCustomerId(null)}
                embedded
                // Related-work row → that job's detail in Jobs. The intent is
                // a one-shot sessionStorage handoff Jobs reads on mount.
                onOpenJob={(id) => {
                  goWithIntent(setPage, { page: "jobs", jobId: id });
                }}
              />
            )
            : <Customers setPage={setPage} onSelect={setSelectedCustomerId} />}
        </SubTabErrorBoundary>
      )}
      {tab === "recurring" && (
        <SubTabErrorBoundary label="Recurring"><RecurringMemberships /></SubTabErrorBoundary>
      )}
      {tab === "hr" && (
        // Admins see it under the Ops back header (no second title); crew
        // land here directly, so HR shows its own "Time Off" header.
        <SubTabErrorBoundary label="HR"><HR embedded={isAdmin} /></SubTabErrorBoundary>
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
