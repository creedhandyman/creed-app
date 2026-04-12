"use client";
import { useState, useRef } from "react";
import { useStore } from "@/lib/store";
import { db } from "@/lib/supabase";

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

  const entries = timeEntries.filter(
    (e) => e.user_id === sel || (sel === user.id && !e.user_id && e.user_name === user.name)
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

  const totalBonus = earnedQuests.reduce((s, q) => s + q.bonus, 0);
  const totalPay = laborPay + totalBonus;

  const [processing, setProcessing] = useState(false);
  const [openPay, setOpenPay] = useState<string | number | null>(null);
  const processGuard = useRef(false);

  const processPay = async () => {
    if (!entries.length) return;

    // Confirmation step
    const bonusText = earnedQuests.length
      ? `\n\n🎯 Quest Bonuses:\n` + earnedQuests.map((q) => `  ${q.name}: $${q.bonus}`).join("\n") + `\n  Bonus Total: $${totalBonus}`
      : "";
    const confirmed = confirm(
      `Process payment for ${selUser.name}?\n\n` +
      `Hours: ${totalHrs.toFixed(1)}\n` +
      `Rate: $${selUser.rate || 55}/hr\n` +
      `Labor: $${laborPay.toFixed(2)}` +
      bonusText +
      `\n\nTotal Pay: $${totalPay.toFixed(2)}\n\n` +
      `This will generate a pay stub.`
    );
    if (!confirmed) return;

    // Double-submit guard
    if (processGuard.current) return;
    processGuard.current = true;
    setProcessing(true);

    try {
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
          bonuses: earnedQuests.map((q) => ({ name: q.name, amount: q.bonus })),
        }),
      });
      // Clear time entries for this employee
      for (const entry of entries) {
        await db.del("time_entries", entry.id);
      }
      // Record quest payouts to prevent double-counting
      for (const quest of earnedQuests) {
        await db.post("quest_payouts", {
          user_id: sel,
          quest_key: quest.key,
          bonus_amount: quest.bonus,
          paid_date: new Date().toLocaleDateString(),
        });
      }
      generatePayStub();
      // Prompt to email pay stub
      const empEmail = selUser.email;
      if (empEmail && confirm(`Email pay stub to ${selUser.name} (${empEmail})?`)) {
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
    const today = new Date().toLocaleDateString("en-US", {
      year: "numeric", month: "long", day: "numeric",
    });
    const jobRows = Object.entries(byJob)
      .map(([job, hrs]) =>
        `<tr><td>${job}</td><td style="text-align:right">${hrs.toFixed(2)}</td><td style="text-align:right">$${(hrs * (selUser.rate || 55)).toFixed(2)}</td></tr>`
      )
      .join("");
    const bonusRows = earnedQuests
      .map((q) => `<tr><td>🎯 ${q.name}</td><td style="text-align:right">Bonus</td><td style="text-align:right">$${q.bonus.toFixed(2)}</td></tr>`)
      .join("");

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Pay Stub — ${selUser.name}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Oswald:wght@400;600;700&family=Source+Sans+3:wght@400;500;600&display=swap');
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Source Sans 3',sans-serif;color:#1a1a2a;padding:0}
.page{max-width:600px;margin:0 auto;padding:40px}
.header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px;padding-bottom:16px;border-bottom:3px solid #2E75B6}
.brand h1{font-family:Oswald;font-size:22px;color:#2E75B6;text-transform:uppercase;letter-spacing:.05em}
.brand .llc{font-family:Oswald;font-size:10px;color:#C00000;letter-spacing:.15em}
.brand .info{font-size:10px;color:#666;margin-top:4px;line-height:1.6}
.stub-label h2{font-family:Oswald;font-size:18px;color:#2E75B6;text-transform:uppercase}
.stub-label .date{font-size:11px;color:#666;margin-top:2px}
.emp-box{background:#f5f7fa;border-radius:8px;padding:14px 18px;margin-bottom:20px;display:flex;justify-content:space-between}
.emp-box .label{font-family:Oswald;font-size:10px;text-transform:uppercase;color:#888;letter-spacing:.08em}
.emp-box .value{font-size:14px;font-weight:600;margin-top:2px}
table{width:100%;border-collapse:collapse;margin-bottom:20px;font-size:13px}
th{font-family:Oswald;text-transform:uppercase;font-size:10px;letter-spacing:.08em;color:#fff;background:#2E75B6;padding:8px 12px;text-align:left}
th:nth-child(2),th:nth-child(3){text-align:right}
td{padding:6px 12px;border-bottom:1px solid #eee}
td:nth-child(2),td:nth-child(3){text-align:right;font-family:Oswald}
.totals{background:#f5f7fa;border-radius:8px;padding:16px 20px;margin-bottom:24px}
.totals-row{display:flex;justify-content:space-between;padding:4px 0;font-size:13px}
.totals-row.grand{border-top:2px solid #2E75B6;margin-top:8px;padding-top:10px;font-size:20px;font-family:Oswald;font-weight:700;color:#2E75B6}
.footer{border-top:1px solid #ddd;padding-top:12px;text-align:center;font-size:10px;color:#888}
@media print{body{padding:0}.page{padding:20px}}
</style></head><body><div class="page">
<div class="header">
  <div class="brand"><h1>${org?.name || "Service Provider"}</h1>
  <div class="info">${org?.address || ""}${org?.phone ? "<br/>" + org.phone : ""}${org?.license_num ? "<br/>License #" + org.license_num : ""}</div></div>
  <div class="stub-label"><h2>Pay Stub</h2><div class="date">${today}</div></div>
</div>
<div style="display:flex;gap:12px;margin-bottom:20px">
  <div class="emp-box" style="flex:1"><div><div class="label">Employee</div><div class="value">${selUser.name}</div></div></div>
  <div class="emp-box" style="flex:1"><div><div class="label">Employee #</div><div class="value">${selUser.emp_num || "—"}</div></div></div>
  <div class="emp-box" style="flex:1"><div><div class="label">Rate</div><div class="value">$${selUser.rate || 55}/hr</div></div></div>
</div>
<table><thead><tr><th>Job</th><th>Hours</th><th>Amount</th></tr></thead><tbody>${jobRows}${bonusRows}</tbody></table>
<div class="totals">
  <div class="totals-row"><span>Total Hours</span><span>${totalHrs.toFixed(2)}</span></div>
  <div class="totals-row"><span>Rate</span><span>$${selUser.rate || 55}/hr</span></div>
  <div class="totals-row"><span>Labor</span><span>$${laborPay.toFixed(2)}</span></div>
  ${totalBonus > 0 ? `<div class="totals-row"><span>🎯 Quest Bonuses</span><span>$${totalBonus.toFixed(2)}</span></div>` : ""}
  <div class="totals-row grand"><span>Net Pay</span><span>$${totalPay.toFixed(2)}</span></div>
</div>
<div class="footer">
  <p>${org?.name || "Service Provider"}${org?.address ? " · " + org.address : ""}${org?.phone ? " · " + org.phone : ""}${org?.license_num ? " · Lic #" + org.license_num : ""}</p>
  <p style="margin-top:8px">This is not an official tax document. For tax purposes, refer to your W-2 or 1099.</p>
</div>
</div></body></html>`;

    const win = window.open("", "_blank");
    if (!win) { alert(`Processed: ${selUser.name} — $${totalPay.toFixed(2)}`); return; }
    win.document.write(html);
    win.document.close();
    setTimeout(() => win.print(), 600);
  };

  const userPayHistory = payHistory.filter((p) => p.user_id === sel);

  return (
    <div className="fi">
      <h2 style={{ fontSize: 22, color: "var(--color-primary)", marginBottom: 14 }}>
        💰 Payroll
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

      {/* Quest bonuses earned */}
      {earnedQuests.length > 0 && (
        <div className="cd mb" style={{ borderLeft: "3px solid var(--color-warning)" }}>
          <h4 style={{ fontSize: 13, marginBottom: 6, color: "var(--color-warning)" }}>🎯 Quest Bonuses Earned</h4>
          {earnedQuests.map((q) => (
            <div key={q.key} className="sep" style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
              <span>{q.name}</span>
              <span style={{ color: "var(--color-success)", fontFamily: "Oswald" }}>${q.bonus}</span>
            </div>
          ))}
          <div className="dim" style={{ fontSize: 10, marginTop: 4 }}>These bonuses will be included when you process pay.</div>
        </div>
      )}

      {/* By Job */}
      <div className="cd mb">
        <div className="row">
          <h4 style={{ fontSize: 13 }}>By Job</h4>
          <div style={{ flex: 1 }} />
          {isOwner && (
            <button
              className="bg"
              onClick={processPay}
              disabled={processing || !entries.length}
              style={{
                fontSize: 10,
                padding: "5px 12px",
                opacity: processing || !entries.length ? 0.5 : 1,
              }}
            >
              {processing ? "Processing..." : "Process Pay"}
            </button>
          )}
        </div>
        {Object.keys(byJob).length === 0 ? (
          <p className="dim" style={{ fontSize: 12, marginTop: 6 }}>No time entries</p>
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
          <h4 style={{ fontSize: 13, marginBottom: 6 }}>Payment History</h4>
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
                  <span style={{ fontSize: 10, color: "#888" }}>{isOpen ? "▲" : "▼"}</span>
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
                            fontSize: 11,
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
                        <div style={{ fontSize: 10, color: "var(--color-warning)", fontWeight: 600, marginTop: 6, marginBottom: 2 }}>🎯 Quest Bonuses</div>
                        {bonusDetails.map((b, bi) => (
                          <div key={bi} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, padding: "1px 0" }}>
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
