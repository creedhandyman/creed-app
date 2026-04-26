"use client";
import { useState, useRef, useEffect } from "react";
import { useStore } from "@/lib/store";
import { db } from "@/lib/supabase";
import { t } from "@/lib/i18n";
import { Icon } from "../Icon";
import { wrapPrint, openPrint } from "@/lib/print-template";

export default function Payroll() {
  const user = useStore((s) => s.user)!;
  const org = useStore((s) => s.org);
  const profiles = useStore((s) => s.profiles);
  const jobs = useStore((s) => s.jobs);
  const reviews = useStore((s) => s.reviews);
  const referrals = useStore((s) => s.referrals);
  const timeEntries = useStore((s) => s.timeEntries);
  const payHistory = useStore((s) => s.payHistory);
  const questPayouts = useStore((s) => s.questPayouts);
  const loadAll = useStore((s) => s.loadAll);

  const isOwner = user.role === "owner" || user.role === "manager";
  const [sel, setSel] = useState(user.id);
  const selUser = profiles.find((u) => u.id === sel) || user;

  // Only UNPAID entries roll into the next payroll run. Paid entries
  // stay in the table forever so Team Stats can compute lifetime hours
  // and earnings — see TeamStats.tsx careerStats().
  const entries = timeEntries.filter(
    (e) =>
      !e.paid_at &&
      (e.user_id === sel || (sel === user.id && !e.user_id && e.user_name === user.name))
  );
  const totalHrs = entries.reduce((s, e) => s + (e.hours || 0), 0);
  const laborPay = totalHrs * (selUser.rate || 55);

  // Group by job
  const byJob: Record<string, number> = {};
  entries.forEach((e) => {
    byJob[e.job || "General"] = (byJob[e.job || "General"] || 0) + (e.hours || 0);
  });

  // Quest bonus detection — find completed quests not yet paid
  // 6-month quest cycle — only count payouts from current cycle
  const now = new Date();
  const cycleStart = new Date(now.getFullYear(), now.getMonth() < 6 ? 0 : 6, 1);
  const paidQuests = questPayouts
    .filter((qp) => {
      if (qp.user_id !== sel) return false;
      try { return new Date(qp.created_at || qp.paid_date) >= cycleStart; } catch { return false; }
    })
    .map((qp) => qp.quest_key);

  // Get quest config bonuses from org
  let questConfig: Record<string, { enabled: boolean; bonus: number }> = {};
  try { questConfig = org?.quest_config ? JSON.parse(org.quest_config) : {}; } catch { /* */ }

  const defaultBonuses: Record<string, number> = {
    review_favor: 75, five_star: 100, super_handy: 50, network_scout: 50,
    critical_referral: 150, deal_closer: 25, repeat_machine: 100,
    skill_mastery: 100, make_ready: 350, zero_callback: 150, mr_speed: 25, handy_king: 750,
  };

  const getBonus = (key: string) => questConfig[key]?.bonus ?? defaultBonuses[key] ?? 0;
  const isEnabled = (key: string) => questConfig[key]?.enabled !== false;

  // Check completions for selected user
  const completedJobs = jobs.filter((j) => j.status === "complete" || j.status === "invoiced" || j.status === "paid").length;
  const positiveReviews = reviews.filter((r) => (r.rating || 0) >= 3).length;
  const fiveStarReviews = reviews.filter((r) => r.rating === 5).length;
  const convertedReferrals = referrals.filter((r) => r.status === "converted").length;
  const upsellJobs = jobs.filter((j) => j.is_upsell).length;
  const bigJobs = jobs.filter((j) => (j.status === "complete" || j.status === "paid") && (j.total_hrs || 0) >= 24).length;

  const earnedQuests: { key: string; name: string; bonus: number }[] = [];
  if (isEnabled("review_favor") && positiveReviews >= 15 && !paidQuests.includes("review_favor"))
    earnedQuests.push({ key: "review_favor", name: "Review Favor", bonus: getBonus("review_favor") });
  if (isEnabled("five_star") && fiveStarReviews >= 10 && !paidQuests.includes("five_star"))
    earnedQuests.push({ key: "five_star", name: "Five Star Tech", bonus: getBonus("five_star") });
  if (isEnabled("super_handy") && completedJobs >= 10 && !paidQuests.includes("super_handy"))
    earnedQuests.push({ key: "super_handy", name: "Super Handy", bonus: getBonus("super_handy") });
  if (isEnabled("network_scout") && convertedReferrals >= 1 && !paidQuests.includes("network_scout"))
    earnedQuests.push({ key: "network_scout", name: "Network Scout", bonus: getBonus("network_scout") });
  if (isEnabled("deal_closer") && upsellJobs >= 1 && !paidQuests.includes("deal_closer"))
    earnedQuests.push({ key: "deal_closer", name: "Deal Closer", bonus: getBonus("deal_closer") });
  if (isEnabled("make_ready") && bigJobs >= 7 && !paidQuests.includes("make_ready"))
    earnedQuests.push({ key: "make_ready", name: "Make Ready Pro", bonus: getBonus("make_ready") });

  // Admins must explicitly approve each earned bonus before it's added to pay.
  // Quests start as "pending" and aren't paid until checked.
  const [approvedBonusKeys, setApprovedBonusKeys] = useState<Set<string>>(() => new Set());
  // Reset approvals when admin switches to a different employee — bonuses are per-person
  useEffect(() => { setApprovedBonusKeys(new Set()); }, [sel]);
  const approvedQuests = earnedQuests.filter((q) => approvedBonusKeys.has(q.key));
  const totalBonus = approvedQuests.reduce((s, q) => s + q.bonus, 0);
  const totalPay = laborPay + totalBonus;

  const [processing, setProcessing] = useState(false);
  const [openPay, setOpenPay] = useState<string | number | null>(null);
  const processGuard = useRef(false);

  const processPay = async () => {
    if (!entries.length) return;

    // Double-submit guard — lock BEFORE the await so rapid double-clicks don't both pass
    if (processGuard.current) return;
    processGuard.current = true;

    try {
      // Confirmation step
      const confirmed = await useStore.getState().showConfirm(
        "Process Payment",
        `${selUser.name} — ${totalHrs.toFixed(1)} hrs × $${selUser.rate || 55}/hr = $${totalPay.toFixed(2)}${approvedQuests.length ? ` (includes $${totalBonus} approved bonus)` : ""}. Generate pay stub?`
      );
      if (!confirmed) return;

      setProcessing(true);

      await db.post("pay_history", {
        user_id: sel,
        name: selUser.name,
        pay_date: new Date().toLocaleDateString(),
        hours: totalHrs,
        amount: totalPay,
        entries: entries.length,
        details: JSON.stringify({
          jobs: Object.entries(byJob).map(([job, hrs]) => ({
            job,
            hrs,
            amount: parseFloat((hrs * (selUser.rate || 55)).toFixed(2)),
          })),
          bonuses: approvedQuests.map((q) => ({ name: q.name, amount: q.bonus })),
        }),
      });
      // Mark these entries as paid instead of deleting them — Team
      // Stats reads ALL time_entries (paid + unpaid) for lifetime
      // career totals. Filtering on `paid_at` above keeps them out
      // of future pay cycles.
      const paidAt = new Date().toISOString();
      for (const entry of entries) {
        await db.patch("time_entries", entry.id, { paid_at: paidAt });
      }
      // Record only the admin-approved quest payouts so the others remain pending
      // (still showing as "pending review" next cycle).
      for (const quest of approvedQuests) {
        await db.post("quest_payouts", {
          user_id: sel,
          quest_key: quest.key,
          bonus_amount: quest.bonus,
          paid_date: new Date().toLocaleDateString(),
        });
      }
      setApprovedBonusKeys(new Set());
      generatePayStub();
      // Prompt to email pay stub
      const empEmail = selUser.email;
      if (empEmail && await useStore.getState().showConfirm("Email Pay Stub", `Email pay stub to ${selUser.name} (${empEmail})?`)) {
        const subject = encodeURIComponent(`Pay Stub — ${new Date().toLocaleDateString()}`);
        const body = encodeURIComponent(
          `Hi ${selUser.name},\n\n` +
          `Your pay has been processed.\n\n` +
          `Hours: ${totalHrs.toFixed(1)}\n` +
          `Rate: $${selUser.rate || 55}/hr\n` +
          `Total: $${totalPay.toFixed(2)}\n\n` +
          Object.entries(byJob).map(([job, hrs]) => `  ${job}: ${hrs.toFixed(1)}h → $${(hrs * (selUser.rate || 55)).toFixed(2)}`).join("\n") +
          `\n\nThank you,\n${useStore.getState().org?.name || "Management"}\n`
        );
        window.open(`mailto:${empEmail}?subject=${subject}&body=${body}`, "_self");
      }
      await loadAll();
    } finally {
      setProcessing(false);
      // Allow another submission after 3 seconds
      setTimeout(() => { processGuard.current = false; }, 3000);
    }
  };

  const generatePayStub = () => {
    const esc = (s: string) =>
      String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const today = new Date().toLocaleDateString("en-US", {
      year: "numeric", month: "long", day: "numeric",
    });
    const stubNum = "PS-" + Date.now().toString(36).toUpperCase().slice(-6);
    const orgName = org?.name || "Service Provider";

    const jobRows = Object.entries(byJob)
      .map(([job, hrs]) =>
        `<tr><td>${esc(job)}</td><td class="r">${hrs.toFixed(2)}</td><td class="r">$${(hrs * (selUser.rate || 55)).toFixed(2)}</td></tr>`,
      )
      .join("");
    const bonusRows = approvedQuests
      .map(
        (q) =>
          `<tr><td><span style="color:#9d4edd;font-weight:600">★ ${esc(q.name)}</span></td><td class="r dim">Bonus</td><td class="r">$${q.bonus.toFixed(2)}</td></tr>`,
      )
      .join("");

    const body = `
<section style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:20px">
  <div class="box">
    <div class="label">Employee</div>
    <div class="value">${esc(selUser.name)}</div>
  </div>
  <div class="box">
    <div class="label">Employee #</div>
    <div class="value">${esc(selUser.emp_num || "—")}</div>
  </div>
  <div class="box">
    <div class="label">Hourly Rate</div>
    <div class="value">$${selUser.rate || 55}/hr</div>
  </div>
</section>

<h2>Earnings Detail</h2>
<table>
  <thead>
    <tr>
      <th>Job / Item</th>
      <th class="r" style="width:90px">Hours</th>
      <th class="r" style="width:110px">Amount</th>
    </tr>
  </thead>
  <tbody>
    ${jobRows || '<tr><td colspan="3" class="dim">No labor entries</td></tr>'}
    ${bonusRows}
  </tbody>
</table>

<section style="background:linear-gradient(135deg,#f0f4f8 0%,#e8eef5 100%);border-radius:10px;padding:18px 22px;margin:18px 0;border-left:4px solid #2E75B6">
  <div style="display:flex;justify-content:space-between;font-size:13px;padding:3px 0">
    <span class="muted">Total Hours</span><span style="font-family:Oswald,sans-serif">${totalHrs.toFixed(2)}</span>
  </div>
  <div style="display:flex;justify-content:space-between;font-size:13px;padding:3px 0">
    <span class="muted">Labor (${totalHrs.toFixed(2)} × $${selUser.rate || 55}/hr)</span><span style="font-family:Oswald,sans-serif">$${laborPay.toFixed(2)}</span>
  </div>
  ${totalBonus > 0 ? `<div style="display:flex;justify-content:space-between;font-size:13px;padding:3px 0;color:#9d4edd"><span>★ Quest Bonuses (${approvedQuests.length})</span><span style="font-family:Oswald,sans-serif">$${totalBonus.toFixed(2)}</span></div>` : ""}
  <div style="display:flex;justify-content:space-between;align-items:center;border-top:2px solid #2E75B6;margin-top:10px;padding-top:12px">
    <span style="font-family:Oswald,sans-serif;font-size:13px;text-transform:uppercase;letter-spacing:.1em;color:#2E75B6">Net Pay</span>
    <span style="font-family:Oswald,sans-serif;font-size:28px;font-weight:700;color:#2E75B6">$${totalPay.toFixed(2)}</span>
  </div>
</section>

<div style="font-size:10.5px;color:#888;margin-top:12px;line-height:1.6">
  <p>This statement reflects gross earnings only. It is not an official tax document. For tax purposes, refer to your W-2 or 1099.</p>
</div>
`;

    const html = wrapPrint(
      {
        orgName,
        orgPhone: org?.phone,
        orgEmail: org?.email,
        orgAddress: org?.address,
        orgLicense: org?.license_num,
        orgLogo: org?.logo_url,
        docTitle: "Pay Stub",
        docNumber: stubNum,
        docDate: today,
        docSubtitle: selUser.name,
      },
      body,
    );
    if (!openPrint(html)) {
      useStore
        .getState()
        .showToast(`Processed: ${selUser.name} — $${totalPay.toFixed(2)}`, "success");
    }
  };

  const userPayHistory = payHistory.filter((p) => p.user_id === sel);

  return (
    <div className="fi">
      <h2 style={{ fontSize: 22, color: "var(--color-primary)", marginBottom: 14, display: "inline-flex", alignItems: "center", gap: 8 }}>
        <Icon name="money" size={22} color="var(--color-primary)" />
        {t("pay.title")}
      </h2>

      {/* Employee selector */}
      {isOwner && (
        <div className="cd mb">
          <div className="row">
            <span className="dim" style={{ fontSize: 12 }}>Employee:</span>
            <select
              value={sel}
              onChange={(e) => setSel(e.target.value)}
              style={{ flex: 1 }}
            >
              {profiles.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} (${u.rate}/hr)
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: totalBonus > 0 ? "1fr 1fr 1fr 1fr" : "1fr 1fr 1fr", gap: 10, marginBottom: 14 }}>
        <div className="cd" style={{ textAlign: "center" }}>
          <div className="sl">Hours</div>
          <div className="sv" style={{ color: "var(--color-primary)" }}>{totalHrs.toFixed(1)}</div>
        </div>
        <div className="cd" style={{ textAlign: "center" }}>
          <div className="sl">Rate</div>
          <div className="sv">${selUser.rate || 55}/hr</div>
        </div>
        {totalBonus > 0 && (
          <div className="cd" style={{ textAlign: "center", borderLeft: "3px solid var(--color-warning)" }}>
            <div className="sl">🎯 Bonus</div>
            <div className="sv" style={{ color: "var(--color-warning)" }}>${totalBonus}</div>
          </div>
        )}
        <div className="cd" style={{ textAlign: "center" }}>
          <div className="sl">Total</div>
          <div className="sv" style={{ color: "var(--color-success)" }}>${totalPay.toFixed(2)}</div>
        </div>
      </div>

      {/* Quest bonuses earned — admin must approve before they're added to pay */}
      {earnedQuests.length > 0 && (
        <div className="cd mb" style={{ borderLeft: "3px solid var(--color-warning)" }}>
          <h4 style={{ fontSize: 13, marginBottom: 6, color: "var(--color-warning)" }}>
            🎯 Quest Bonuses — Pending Review ({earnedQuests.length})
          </h4>
          {earnedQuests.map((q) => {
            const approved = approvedBonusKeys.has(q.key);
            return (
              <div
                key={q.key}
                className="sep"
                style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, gap: 8 }}
              >
                {isOwner ? (
                  <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", flex: 1 }}>
                    <input
                      type="checkbox"
                      checked={approved}
                      onChange={(e) => {
                        setApprovedBonusKeys((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(q.key);
                          else next.delete(q.key);
                          return next;
                        });
                      }}
                    />
                    <span style={{ color: approved ? "var(--color-success)" : undefined }}>
                      {q.name}
                    </span>
                    {approved && <span style={{ fontSize: 10, color: "var(--color-success)", fontFamily: "Oswald" }}>APPROVED</span>}
                  </label>
                ) : (
                  <span style={{ flex: 1 }}>
                    {q.name}
                    <span className="dim" style={{ marginLeft: 6, fontSize: 10, fontFamily: "Oswald" }}>PENDING</span>
                  </span>
                )}
                <span style={{ color: approved ? "var(--color-success)" : "#888", fontFamily: "Oswald" }}>${q.bonus}</span>
              </div>
            );
          })}
          <div className="dim" style={{ fontSize: 12, marginTop: 6 }}>
            {isOwner
              ? "Check each bonus to approve it for this pay cycle. Unchecked bonuses stay pending and can be reviewed again later."
              : "Bonuses are reviewed by management before payout."}
          </div>
        </div>
      )}

      {/* By Job */}
      <div className="cd mb">
        <div className="row">
          <h4 style={{ fontSize: 13 }}>{t("pay.byJob")}</h4>
          <div style={{ flex: 1 }} />
          {isOwner && (
            <button
              className="bg"
              onClick={processPay}
              disabled={processing || !entries.length}
              style={{
                fontSize: 12,
                padding: "5px 12px",
                opacity: processing || !entries.length ? 0.5 : 1,
              }}
            >
              {processing ? "Processing..." : t("pay.processPay")}
            </button>
          )}
        </div>

        {Object.keys(byJob).length === 0 ? (
          <p className="dim" style={{ fontSize: 12, marginTop: 6 }}>{t("pay.noEntries")}</p>
        ) : (
          Object.entries(byJob).map(([job, hrs]) => (
            <div
              key={job}
              className="sep"
              style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}
            >
              <span>{job}</span>
              <span>
                {hrs.toFixed(1)}h →{" "}
                <span style={{ color: "var(--color-success)" }}>
                  ${(hrs * (selUser.rate || 55)).toFixed(2)}
                </span>
              </span>
            </div>
          ))
        )}
      </div>

      {/* Payment History */}
      {userPayHistory.length > 0 && (
        <div className="cd">
          <h4 style={{ fontSize: 13, marginBottom: 6 }}>{t("pay.history")}</h4>
          {userPayHistory.map((p) => {
            const isOpen = openPay === p.id;
            let jobDetails: { job: string; hrs: number; amount: number }[] = [];
            let bonusDetails: { name: string; amount: number }[] = [];
            try {
              if (p.details) {
                const parsed = JSON.parse(p.details);
                // Support both old format (array) and new format (object with jobs+bonuses)
                if (Array.isArray(parsed)) jobDetails = parsed;
                else { jobDetails = parsed.jobs || []; bonusDetails = parsed.bonuses || []; }
              }
            } catch { /* ignore */ }

            return (
              <div key={p.id} style={{ marginBottom: 4 }}>
                <div
                  onClick={() => setOpenPay(isOpen ? null : p.id)}
                  className="sep"
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: 12,
                    cursor: "pointer",
                    alignItems: "center",
                  }}
                >
                  <span>{p.pay_date}</span>
                  <span>{(p.hours || 0).toFixed(1)}h · {p.entries || 0} entries</span>
                  <span style={{ color: "var(--color-success)", fontFamily: "Oswald" }}>
                    ${(p.amount || 0).toFixed(2)}
                  </span>
                  <span style={{ fontSize: 12, color: "#888" }}>{isOpen ? "▲" : "▼"}</span>
                </div>
                {isOpen && (
                  <div style={{ padding: "6px 0 6px 12px", borderLeft: "2px solid var(--color-primary)" }}>
                    {jobDetails.length > 0 ? (
                      jobDetails.map((d, i) => (
                        <div
                          key={i}
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            fontSize: 13,
                            padding: "2px 0",
                          }}
                        >
                          <span style={{ color: "var(--color-primary)" }}>{d.job}</span>
                          <span>
                            {d.hrs.toFixed(1)}h → <span style={{ color: "var(--color-success)" }}>${d.amount.toFixed(2)}</span>
                          </span>
                        </div>
                      ))
                    ) : (
                      <span className="dim" style={{ fontSize: 11 }}>No job breakdown saved</span>
                    )}
                    {bonusDetails.length > 0 && (
                      <>
                        <div style={{ fontSize: 12, color: "var(--color-warning)", fontWeight: 600, marginTop: 6, marginBottom: 2 }}>🎯 Quest Bonuses</div>
                        {bonusDetails.map((b, bi) => (
                          <div key={bi} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "1px 0" }}>
                            <span>{b.name}</span>
                            <span style={{ color: "var(--color-success)" }}>${b.amount.toFixed(2)}</span>
                          </div>
                        ))}
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
