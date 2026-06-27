"use client";
import { apiFetch } from "@/lib/api";
import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { db } from "@/lib/supabase";
import { Icon } from "./Icon";
import { t } from "@/lib/i18n";
import { applyPromoCode } from "@/lib/promo-codes";
import { getUsage, getCap, type UsageInfo } from "@/lib/inspection-usage";
import type { Organization } from "@/lib/types";

/**
 * Billing & Payments — Stripe Connect (accept payments from clients) plus
 * subscription management (Solo / Team / Business plan + trial state).
 * Lives inside Operations, alongside Payroll / Financials / Clients / Team.
 */
export default function BillingSettings() {
  const user = useStore((s) => s.user)!;
  const org = useStore((s) => s.org);
  const setOrg = useStore((s) => s.setOrg);
  const darkMode = useStore((s) => s.darkMode);
  const isOwner = user.role === "owner" || user.role === "manager";

  return (
    <div>
      {/* ── Stripe Connect ── */}
      <div className="cd">
        <h4 style={{ fontSize: 16, marginBottom: 8, display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Icon name="money" size={16} color="var(--color-primary)" />
          {t("billing.processing")}
        </h4>
        {org?.stripe_connected ? (
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <Icon name="checkCircle" size={20} color="var(--color-success)" />
              <div>
                <div style={{ fontSize: 15, fontWeight: 600 }}>{t("billing.connected")}</div>
                <div className="dim" style={{ fontSize: 13 }}>
                  Account: {org.stripe_account_id?.slice(0, 12)}...
                </div>
              </div>
            </div>
            <p className="dim" style={{ fontSize: 13 }}>
              {t("billing.connectedHelp")}
            </p>
          </div>
        ) : (
          <div>
            <p style={{ fontSize: 14, marginBottom: 12, color: darkMode ? "#ccc" : "#333" }}>
              {t("billing.connectIntro")}
            </p>
            {isOwner ? (
              <button
                className="bb"
                onClick={async () => {
                  const btn = document.activeElement as HTMLButtonElement;
                  if (btn) btn.textContent = "Connecting...";
                  try {
                    const res = await apiFetch("/api/stripe/connect", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        orgId: user.org_id,
                        orgName: org?.name,
                        email: user.email,
                        returnUrl: window.location.origin,
                      }),
                    });
                    if (!res.ok) {
                      const text = await res.text();
                      useStore
                        .getState()
                        .showToast("Stripe error (" + res.status + "): " + text, "error");
                      return;
                    }
                    const data = await res.json();
                    if (data.url) {
                      await db.patch("organizations", user.org_id, {
                        stripe_account_id: data.accountId,
                      });
                      window.location.href = data.url;
                    } else {
                      useStore
                        .getState()
                        .showToast(
                          "Error: " + (data.error || "Could not start Stripe setup"),
                          "error",
                        );
                    }
                  } catch (e) {
                    useStore
                      .getState()
                      .showToast(
                        "Failed to start Stripe setup: " +
                          (e instanceof Error ? e.message : "Network error"),
                        "error",
                      );
                  }
                }}
                style={{ fontSize: 15, padding: "10px 20px", display: "inline-flex", alignItems: "center", gap: 6 }}
              >
                <Icon name="link" size={14} />
                {t("billing.connect")}
              </button>
            ) : (
              <p className="dim" style={{ fontSize: 13 }}>
                Ask your business owner to connect Stripe.
              </p>
            )}
          </div>
        )}
      </div>

      {/* ── Subscription / Billing (admin only) ── */}
      {isOwner && (
        <div className="cd" style={{ marginTop: 14 }}>
          <h4
            style={{
              fontSize: 16,
              marginBottom: 10,
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <Icon name="trending" size={16} color="var(--color-primary)" />
            Subscription
          </h4>
          {(() => {
            const status = org?.subscription_status || "trial";
            // Prefer Stripe's authoritative trial_ends_at (written by
            // the webhook); fall back to the org-create trial_start + 30
            // days for trials that pre-date Stripe wiring.
            const trialEnd = org?.trial_ends_at
              ? new Date(org.trial_ends_at)
              : (() => {
                  const t = new Date(org?.trial_start || new Date());
                  t.setDate(t.getDate() + 30);
                  return t;
                })();
            const daysLeft = Math.max(
              0,
              Math.ceil((trialEnd.getTime() - Date.now()) / (1000 * 60 * 60 * 24)),
            );
            const plan = org?.subscription_plan || org?.plan || "solo";
            const planLabel =
              plan === "pro"  ? "Pro $149.99/mo"
            : plan === "crew" ? "Crew $59.99/mo"
            : plan === "solo" ? "Solo $24.99/mo"
            // legacy values still surfaced from older orgs
            : plan === "business" ? "Business $149/mo"
            : plan === "team" ? "Team $99/mo"
            : `${plan}`;

            return (
              <div>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 8,
                  }}
                >
                  <span
                    style={{
                      fontSize: 15,
                      padding: "2px 10px",
                      borderRadius: 10,
                      fontFamily: "Oswald",
                      background:
                        status === "active"
                          ? "var(--color-success)" + "22"
                          : status === "trial" || status === "trialing"
                          ? "var(--color-warning)" + "22"
                          : "var(--color-accent-red)" + "22",
                      color:
                        status === "active"
                          ? "var(--color-success)"
                          : status === "trial" || status === "trialing"
                          ? "var(--color-warning)"
                          : "var(--color-accent-red)",
                    }}
                  >
                    {status === "active"
                      ? "Active"
                      : status === "trial" || status === "trialing"
                      ? `Trial — ${daysLeft} day${daysLeft === 1 ? "" : "s"} left`
                      : status === "past_due"
                      ? "Past due"
                      : status === "canceled"
                      ? "Canceled"
                      : status}
                  </span>
                  <span className="dim" style={{ fontSize: 12, fontFamily: "Oswald", letterSpacing: ".06em" }}>
                    {planLabel}
                  </span>
                </div>

                {(status === "trial" || status === "trialing") && (
                  <div className="dim" style={{ fontSize: 15, marginBottom: 10, lineHeight: 1.45 }}>
                    Your free trial {daysLeft > 0 ? `ends ${trialEnd.toLocaleDateString()}` : "has ended"}. Subscribe to keep all features.
                  </div>
                )}

                <div className="row">
                  {/* "Subscribe Now" — only shown when there's no Stripe
                      customer yet (i.e. a pre-Stripe trial that never
                      hit Checkout). Bounces back through /onboarding so
                      the owner re-enters the plan picker + Checkout
                      flow with the same wizard the new-signup funnel
                      uses. Owners with a customer record always see the
                      "Manage Subscription" button instead. */}
                  {!org?.stripe_customer_id && status !== "active" && (
                    <button
                      className="bb"
                      onClick={() => { window.location.href = "/onboarding?step=plan"; }}
                      style={{ fontSize: 15, padding: "6px 14px", display: "inline-flex", alignItems: "center", gap: 6 }}
                    >
                      <Icon name="money" size={14} />
                      Subscribe Now
                    </button>
                  )}
                  {org?.stripe_customer_id && (
                    <button
                      className="bo"
                      onClick={async () => {
                        const res = await apiFetch("/api/stripe/portal", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            orgId: org?.id,
                            returnUrl: window.location.origin,
                          }),
                        });
                        const data = await res.json();
                        if (data.url) window.location.href = data.url;
                        else
                          useStore
                            .getState()
                            .showToast(data.error || "Failed to open billing portal", "error");
                      }}
                      style={{ fontSize: 15, padding: "6px 14px" }}
                    >
                      Manage Subscription
                    </button>
                  )}
                  {(status === "trial" || status === "trialing") && !org?.stripe_customer_id && (
                    // Pre-Stripe trials can still pick a plan locally —
                    // it surfaces back in /onboarding's plan picker when
                    // the owner returns to finish checkout.
                    <select
                      value={plan}
                      onChange={async (e) => {
                        if (!org) return;
                        await db.patch("organizations", org.id, { plan: e.target.value, subscription_plan: e.target.value });
                        const orgs = await db.get<Organization>("organizations", { id: org.id });
                        if (orgs.length) setOrg(orgs[0]);
                      }}
                      style={{ width: "auto", fontSize: 14, padding: "3px 6px" }}
                    >
                      <option value="solo">Solo — $24.99/mo (1 user)</option>
                      <option value="crew">Crew — $59.99/mo (up to 8)</option>
                      <option value="pro">Pro — $149.99/mo (unlimited)</option>
                    </select>
                  )}
                </div>

                {/* Monthly inspection usage — shown for every tier
                    (Solo 75, Crew 175, Pro 450). Over-cap nudges an
                    upgrade rather than blocking. */}
                {org && getCap(plan) > 0 && (
                  <InspectionUsageRow orgId={org.id} plan={plan} />
                )}

                {/* Promo code — only surfaced to owners and only when billing
                    is still enforced (no need to show it once it's already
                    been applied or trial/paywall is irrelevant). */}
                {isOwner && org?.billing_enforced !== false && (
                  <PromoCodeForm orgId={org!.id} />
                )}
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}

/**
 * Read-only inspection-usage display: "127 / 200 inspections used this
 * month". Color shifts to amber at >= 80% and red at >= 100% so the
 * owner can spot pressure on the cap at a glance.
 */
function InspectionUsageRow({ orgId, plan }: { orgId: string; plan: string }) {
  const [usage, setUsage] = useState<UsageInfo | null>(null);
  useEffect(() => {
    let cancelled = false;
    getUsage(orgId, plan).then((u) => { if (!cancelled) setUsage(u); });
    return () => { cancelled = true; };
  }, [orgId, plan]);
  if (!usage) return null;
  const pct = usage.cap > 0 ? Math.min(100, Math.round((usage.count / usage.cap) * 100)) : 0;
  const color = usage.blocked
    ? "var(--color-accent-red)"
    : usage.warning
    ? "var(--color-warning)"
    : "var(--color-success)";
  return (
    <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px dashed #1e1e2e" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 14 }}>
        <span className="dim" style={{ fontFamily: "Oswald", textTransform: "uppercase", letterSpacing: ".06em" }}>
          Inspections this month
        </span>
        <span style={{ color, fontFamily: "Oswald" }}>
          {usage.count} / {usage.cap}
        </span>
      </div>
      <div style={{ marginTop: 6, height: 4, background: "#1e1e2e", borderRadius: 2, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, transition: "width .25s" }} />
      </div>
      {usage.blocked && (
        <div style={{ fontSize: 13, color: "var(--color-accent-red)", marginTop: 6 }}>
          Included quota used for this month — upgrade for a larger included pool to keep generating.
        </div>
      )}
    </div>
  );
}

/** Small form for entering a comp/promo code. On success, reloads org state
 *  in place so the subscription badge flips to "Active" without a hard page
 *  reload. */
function PromoCodeForm({ orgId }: { orgId: string }) {
  const setOrg = useStore((s) => s.setOrg);
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        style={{
          background: "none",
          color: "var(--color-primary)",
          fontSize: 13,
          padding: 0,
          marginTop: 10,
          textDecoration: "underline",
          cursor: "pointer",
        }}
      >
        Have a promo code?
      </button>
    );
  }

  return (
    <div className="row" style={{ marginTop: 10, gap: 6, alignItems: "center" }}>
      <input
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="Promo code"
        style={{ flex: 1, fontSize: 14, padding: "4px 8px", textTransform: "uppercase" }}
        autoFocus
      />
      <button
        className="bb"
        disabled={busy || !code.trim()}
        onClick={async () => {
          setBusy(true);
          const result = await applyPromoCode(orgId, code);
          if (result.ok) {
            const orgs = await db.get<Organization>("organizations", { id: orgId });
            if (orgs.length) setOrg(orgs[0]);
            useStore.getState().showToast("Promo code applied", "success");
            setCode("");
            setOpen(false);
          } else {
            useStore.getState().showToast(result.reason || "Invalid promo code", "error");
          }
          setBusy(false);
        }}
        style={{ fontSize: 14, padding: "4px 10px" }}
      >
        {busy ? "..." : "Apply"}
      </button>
      <button
        onClick={() => { setOpen(false); setCode(""); }}
        style={{
          background: "none",
          color: "var(--color-dim)",
          fontSize: 14,
          padding: "4px 6px",
          cursor: "pointer",
        }}
      >
        Cancel
      </button>
    </div>
  );
}
