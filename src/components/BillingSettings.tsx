"use client";
import { useStore } from "@/lib/store";
import { db } from "@/lib/supabase";
import { Icon } from "./Icon";
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
        <h4 style={{ fontSize: 14, marginBottom: 8, display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Icon name="money" size={16} color="var(--color-primary)" />
          Payment Processing
        </h4>
        {org?.stripe_connected ? (
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <Icon name="checkCircle" size={20} color="var(--color-success)" />
              <div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>Stripe Connected</div>
                <div className="dim" style={{ fontSize: 11 }}>
                  Account: {org.stripe_account_id?.slice(0, 12)}...
                </div>
              </div>
            </div>
            <p className="dim" style={{ fontSize: 11 }}>
              You can generate payment links from the Jobs screen. Clients pay online and the money goes directly to your Stripe account.
            </p>
          </div>
        ) : (
          <div>
            <p style={{ fontSize: 12, marginBottom: 12, color: darkMode ? "#ccc" : "#333" }}>
              Connect your Stripe account to accept online payments from clients.
              Money goes directly to your bank — we take a small 2% platform fee.
            </p>
            {isOwner ? (
              <button
                className="bb"
                onClick={async () => {
                  const btn = document.activeElement as HTMLButtonElement;
                  if (btn) btn.textContent = "Connecting...";
                  try {
                    const res = await fetch("/api/stripe/connect", {
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
                style={{ fontSize: 13, padding: "10px 20px", display: "inline-flex", alignItems: "center", gap: 6 }}
              >
                <Icon name="link" size={14} />
                Connect Stripe Account
              </button>
            ) : (
              <p className="dim" style={{ fontSize: 11 }}>
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
              fontSize: 14,
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
            const trialStart = org?.trial_start ? new Date(org.trial_start) : new Date();
            const trialEnd = new Date(trialStart);
            trialEnd.setDate(trialEnd.getDate() + 30);
            const daysLeft = Math.max(
              0,
              Math.ceil((trialEnd.getTime() - Date.now()) / (1000 * 60 * 60 * 24)),
            );
            const plan = org?.plan || "solo";

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
                      fontSize: 13,
                      padding: "2px 10px",
                      borderRadius: 10,
                      fontFamily: "Oswald",
                      background:
                        status === "active"
                          ? "var(--color-success)" + "22"
                          : status === "trial"
                          ? "var(--color-warning)" + "22"
                          : "var(--color-accent-red)" + "22",
                      color:
                        status === "active"
                          ? "var(--color-success)"
                          : status === "trial"
                          ? "var(--color-warning)"
                          : "var(--color-accent-red)",
                    }}
                  >
                    {status === "active"
                      ? "Active"
                      : status === "trial"
                      ? `Trial — ${daysLeft} days left`
                      : status}
                  </span>
                  <span className="dim" style={{ fontSize: 10, fontFamily: "Oswald", letterSpacing: ".06em" }}>
                    {plan === "business"
                      ? "Business $149/mo"
                      : plan === "team"
                      ? "Team $99/mo"
                      : "Solo $49/mo"}
                  </span>
                </div>

                {status === "trial" && (
                  <div className="dim" style={{ fontSize: 13, marginBottom: 10, lineHeight: 1.45 }}>
                    Your free trial {daysLeft > 0 ? `ends ${trialEnd.toLocaleDateString()}` : "has ended"}. Subscribe to keep all features.
                  </div>
                )}

                <div className="row">
                  {status !== "active" && (
                    <button
                      className="bb"
                      onClick={async () => {
                        const res = await fetch("/api/billing", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            action: "create-checkout",
                            orgId: org?.id,
                            orgName: org?.name,
                            email: user.email,
                            plan,
                            returnUrl: window.location.origin,
                          }),
                        });
                        const data = await res.json();
                        if (data.url) window.location.href = data.url;
                        else
                          useStore
                            .getState()
                            .showToast(data.error || "Failed to start checkout", "error");
                      }}
                      style={{ fontSize: 13, padding: "6px 14px", display: "inline-flex", alignItems: "center", gap: 6 }}
                    >
                      <Icon name="money" size={14} />
                      Subscribe Now
                    </button>
                  )}
                  {org?.stripe_customer_id && (
                    <button
                      className="bo"
                      onClick={async () => {
                        const res = await fetch("/api/billing", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            action: "create-portal",
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
                      style={{ fontSize: 13, padding: "6px 14px" }}
                    >
                      Manage Billing
                    </button>
                  )}
                  {status === "trial" && (
                    <select
                      value={plan}
                      onChange={async (e) => {
                        if (!org) return;
                        await db.patch("organizations", org.id, { plan: e.target.value });
                        const orgs = await db.get<Organization>("organizations", { id: org.id });
                        if (orgs.length) setOrg(orgs[0]);
                      }}
                      style={{ width: "auto", fontSize: 12, padding: "3px 6px" }}
                    >
                      <option value="solo">Solo — $49/mo (1 user)</option>
                      <option value="team">Team — $99/mo (up to 5)</option>
                      <option value="business">Business — $149/mo (up to 10)</option>
                    </select>
                  )}
                </div>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
