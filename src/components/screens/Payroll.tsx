"use client";
import { useState, useRef, useEffect } from "react";
import { useStore } from "@/lib/store";
import { db, supabase } from "@/lib/supabase";
import { t } from "@/lib/i18n";
import { Icon } from "../Icon";
import { openPrint } from "@/lib/print-template";
import { buildStubHtml, runPayrollForUser, type StubInput } from "@/lib/payroll-runner";

/** Trigger a browser download of an HTML string as a .html file. Used by
 *  the per-entry Download button so the employee can save the stub
 *  locally and open / print / save-as-PDF on their own time. */
function downloadHtmlFile(html: string, filename: string) {
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

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

  // Build the StubInput for the *current* unpaid cycle. Used both to save
  // the stub HTML at process-pay time and to populate the pre-pay
  // notification email.
  const buildCurrentStubInput = (): StubInput => ({
    empName: selUser.name,
    empNum: selUser.emp_num || "",
    rate: selUser.rate || 55,
    payDate: new Date().toLocaleDateString("en-US", {
      year: "numeric", month: "long", day: "numeric",
    }),
    stubNum: "PS-" + Date.now().toString(36).toUpperCase().slice(-6),
    totalHrs,
    laborPay,
    totalBonus,
    totalPay,
    jobs: Object.entries(byJob).map(([job, hrs]) => ({
      job,
      hrs,
      amount: parseFloat((hrs * (selUser.rate || 55)).toFixed(2)),
    })),
    bonuses: approvedQuests.map((q) => ({ name: q.name, amount: q.bonus })),
    org: org || {},
  });

  const processPay = async () => {
    if (!entries.length) return;
    if (!org?.id) return;

    // Double-submit guard — lock BEFORE the await so rapid double-clicks don't both pass
    if (processGuard.current) return;
    processGuard.current = true;

    try {
      // Confirmation step
      const confirmed = await useStore.getState().showConfirm(
        "Process Payment",
        `${selUser.name} — ${totalHrs.toFixed(1)} hrs × $${selUser.rate || 55}/hr = $${totalPay.toFixed(2)}${approvedQuests.length ? ` (includes $${totalBonus} approved bonus)` : ""}. Save pay stub?`
      );
      if (!confirmed) return;

      setProcessing(true);

      // Shared runner handles: atomic claim of unpaid time_entries,
      // pay_history row insert (with frozen stub HTML snapshot in
      // details), and quest_payouts inserts for approved bonuses.
      // The cron at /api/payroll/auto-run calls the same helper —
      // see src/lib/payroll-runner.ts.
      const result = await runPayrollForUser({
        supabase,
        orgId: org.id,
        userId: sel,
        userName: selUser.name,
        rate: selUser.rate || 55,
        empNum: selUser.emp_num,
        approvedBonuses: approvedQuests,
        org: org || {},
        // Manual flow preserves the legacy fallback so an owner viewing
        // their own pay still sees pre-user_id rows roll into the run.
        includeLegacyNameMatch: sel === user.id,
      });

      if (!result.ok) {
        useStore.getState().showToast(
          `Pay processing failed: ${result.error || "unknown error"}`,
          "error",
        );
        return;
      }
      if (result.skipped) {
        useStore.getState().showToast("No unpaid entries to process", "info");
        return;
      }

      setApprovedBonusKeys(new Set());
      // No auto-print, no auto-email — the saved row is now actionable from
      // the Payment History list (Print / Download / Email buttons per row).
      // Bernard hit cases where the auto-fire mailto stomped on his
      // workflow and the stub print only happened once.
      useStore.getState().showToast(
        `Pay processed: ${selUser.name} — $${result.totalPay.toFixed(2)}. Use Payment History to print / download / email.`,
        "success",
      );
      await loadAll();
    } finally {
      setProcessing(false);
      // Allow another submission after 3 seconds
      setTimeout(() => { processGuard.current = false; }, 3000);
    }
  };

  /** Fire a pre-pay notification email (mailto draft) so the employee
   *  knows what's coming on the next payday — no pay_history record
   *  created. Useful as a check-in before actually processing. */
  const notifyUpcomingPay = () => {
    if (!entries.length) return;
    const empEmail = selUser.email;
    if (!empEmail) {
      useStore.getState().showToast("No email on file for this employee", "warning");
      return;
    }
    const stub = buildCurrentStubInput();
    const subject = encodeURIComponent(`Upcoming pay — ${stub.payDate}`);
    const lines = [
      `Hi ${stub.empName},`,
      ``,
      `Here's a preview of your upcoming pay:`,
      ``,
      `Hours: ${stub.totalHrs.toFixed(1)}`,
      `Rate: $${stub.rate}/hr`,
      `Labor: $${stub.laborPay.toFixed(2)}`,
      ...(stub.totalBonus > 0 ? [`Bonuses: $${stub.totalBonus.toFixed(2)}`] : []),
      `Total: $${stub.totalPay.toFixed(2)}`,
      ``,
      `Job breakdown:`,
      ...stub.jobs.map((j) => `  ${j.job}: ${j.hrs.toFixed(1)}h → $${j.amount.toFixed(2)}`),
      ``,
      `This is a preview only — your final pay stub will be available in the app once processed.`,
      ``,
      `Thank you,`,
      `${useStore.getState().org?.name || "Management"}`,
    ].join("\n");
    window.open(`mailto:${empEmail}?subject=${subject}&body=${encodeURIComponent(lines)}`, "_self");
  };

  const userPayHistory = payHistory.filter((p) => p.user_id === sel);

  return (
    <div className="fi">
      <h2 style={{ fontSize: 24, color: "var(--color-primary)", marginBottom: 14, display: "inline-flex", alignItems: "center", gap: 8 }}>
        <Icon name="money" size={22} color="var(--color-primary)" />
        {t("pay.title")}
      </h2>

      {/* Auto Payroll — server-side scheduled run (cron hits
          /api/payroll/auto-run). Toggle, day/hour pickers, cadence. */}
      {isOwner && <AutoPayrollPanel />}

      {/* Pay-run block — employee selector, stats, quest bonuses, by-job
          breakdown, and the Run Payroll button. Collapsible (default
          expanded since this is the primary action surface). Collapsed
          header shows the selected employee + total so the at-a-glance
          number is still visible without expanding. */}
      <PayrollSection
        title="📋 Current Pay"
        subtitle={`${selUser.name} · ${totalHrs.toFixed(1)}h · $${totalPay.toFixed(2)}`}
        storageKey="payroll.main.collapsed"
        defaultCollapsed={false}
      >
      {/* Employee selector */}
      {isOwner && (
        <div className="cd mb">
          <div className="row">
            <span className="dim" style={{ fontSize: 14 }}>Employee:</span>
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
          <h4 style={{ fontSize: 15, marginBottom: 6, color: "var(--color-warning)" }}>
            🎯 Quest Bonuses — Pending Review ({earnedQuests.length})
          </h4>
          {earnedQuests.map((q) => {
            const approved = approvedBonusKeys.has(q.key);
            return (
              <div
                key={q.key}
                className="sep"
                style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 14, gap: 8 }}
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
                    {approved && <span style={{ fontSize: 12, color: "var(--color-success)", fontFamily: "Oswald" }}>APPROVED</span>}
                  </label>
                ) : (
                  <span style={{ flex: 1 }}>
                    {q.name}
                    <span className="dim" style={{ marginLeft: 6, fontSize: 12, fontFamily: "Oswald" }}>PENDING</span>
                  </span>
                )}
                <span style={{ color: approved ? "var(--color-success)" : "#888", fontFamily: "Oswald" }}>${q.bonus}</span>
              </div>
            );
          })}
          <div className="dim" style={{ fontSize: 14, marginTop: 6 }}>
            {isOwner
              ? "Check each bonus to approve it for this pay cycle. Unchecked bonuses stay pending and can be reviewed again later."
              : "Bonuses are reviewed by management before payout."}
          </div>
        </div>
      )}

      {/* By Job */}
      <div className="cd mb">
        <div className="row">
          <h4 style={{ fontSize: 15 }}>{t("pay.byJob")}</h4>
          <div style={{ flex: 1 }} />
          {isOwner && (
            <div className="row" style={{ gap: 6 }}>
              <button
                className="bo"
                onClick={notifyUpcomingPay}
                disabled={processing || !entries.length}
                title="Email this employee a preview of what they're going to be paid (no pay stub generated yet)"
                style={{
                  fontSize: 14,
                  padding: "5px 10px",
                  opacity: processing || !entries.length ? 0.5 : 1,
                }}
              >
                ✉ Notify
              </button>
              <button
                className="bg"
                onClick={processPay}
                disabled={processing || !entries.length}
                style={{
                  fontSize: 14,
                  padding: "5px 12px",
                  opacity: processing || !entries.length ? 0.5 : 1,
                }}
              >
                {processing ? "Processing..." : t("pay.processPay")}
              </button>
            </div>
          )}
        </div>

        {Object.keys(byJob).length === 0 ? (
          <p className="dim" style={{ fontSize: 14, marginTop: 6 }}>{t("pay.noEntries")}</p>
        ) : (
          Object.entries(byJob).map(([job, hrs]) => (
            <div
              key={job}
              className="sep"
              style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}
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
      </PayrollSection>

      {/* Payment History — collapsible, default collapsed (reference data
          for re-printing / re-emailing past stubs, not the primary surface). */}
      {userPayHistory.length > 0 && (
        <PayrollSection
          title={t("pay.history")}
          subtitle={`${userPayHistory.length} ${userPayHistory.length === 1 ? "stub" : "stubs"}`}
          storageKey="payroll.timelogs.collapsed"
          defaultCollapsed={true}
        >
          {userPayHistory.map((p) => {
            const isOpen = openPay === p.id;
            let jobDetails: { job: string; hrs: number; amount: number }[] = [];
            let bonusDetails: { name: string; amount: number }[] = [];
            let savedRate: number | undefined;
            let savedStubNum: string | undefined;
            let savedStubHtml: string | undefined;
            try {
              if (p.details) {
                const parsed = JSON.parse(p.details);
                // Support both old format (array) and new format (object with jobs+bonuses+stubHtml)
                if (Array.isArray(parsed)) jobDetails = parsed;
                else {
                  jobDetails = parsed.jobs || [];
                  bonusDetails = parsed.bonuses || [];
                  savedRate = parsed.rate;
                  savedStubNum = parsed.stubNum;
                  savedStubHtml = parsed.stubHtml;
                }
              }
            } catch { /* ignore */ }

            // Reconstruct stub HTML on the fly for legacy pay_history rows
            // that don't have it saved. Uses the rate captured at process
            // time when available, else the employee's current rate (best
            // effort — older entries from before the schema change).
            const rateForStub = savedRate ?? selUser.rate ?? 55;
            const laborForStub = (p.hours || 0) * rateForStub;
            const bonusForStub = bonusDetails.reduce((s, b) => s + (b.amount || 0), 0);
            const stubInput: StubInput = {
              empName: p.name || selUser.name,
              empNum: selUser.emp_num || "",
              rate: rateForStub,
              payDate: p.pay_date || new Date().toLocaleDateString(),
              stubNum: savedStubNum || ("PS-" + String(p.id ?? "").slice(0, 6).toUpperCase()),
              totalHrs: p.hours || 0,
              laborPay: laborForStub,
              totalBonus: bonusForStub,
              totalPay: p.amount || 0,
              jobs: jobDetails,
              bonuses: bonusDetails,
              org: org || {},
            };
            const stubHtml = () => savedStubHtml || buildStubHtml(stubInput);

            const handlePrint = () => {
              if (!openPrint(stubHtml())) {
                useStore.getState().showToast("Allow popups to print pay stub", "error");
              }
            };
            const handleDownload = () => {
              const safe = stubInput.empName.replace(/[^\w\s-]/g, "").replace(/\s+/g, "-");
              const datePart = (p.pay_date || "").replace(/[^\w-]/g, "-");
              downloadHtmlFile(stubHtml(), `paystub-${safe}-${datePart}.html`);
              useStore.getState().showToast("Pay stub downloaded", "success");
            };
            const handleEmail = () => {
              const target = selUser.id === p.user_id ? selUser.email : profiles.find((u) => u.id === p.user_id)?.email;
              if (!target) {
                useStore.getState().showToast("No email on file for this employee", "warning");
                return;
              }
              const subject = encodeURIComponent(`Pay Stub — ${p.pay_date}`);
              const lines = [
                `Hi ${stubInput.empName},`,
                ``,
                `Your pay stub for ${p.pay_date}:`,
                ``,
                `Hours: ${stubInput.totalHrs.toFixed(1)}`,
                `Rate: $${stubInput.rate}/hr`,
                `Total: $${stubInput.totalPay.toFixed(2)}`,
                ``,
                ...stubInput.jobs.map((j) => `  ${j.job}: ${j.hrs.toFixed(1)}h → $${j.amount.toFixed(2)}`),
                ...(stubInput.bonuses.length ? ["", "Bonuses:", ...stubInput.bonuses.map((b) => `  ★ ${b.name}: $${b.amount.toFixed(2)}`)] : []),
                ``,
                `The full stub is saved in the app — you can also re-print or download it any time.`,
                ``,
                `Thank you,`,
                `${useStore.getState().org?.name || "Management"}`,
              ].join("\n");
              window.open(`mailto:${target}?subject=${subject}&body=${encodeURIComponent(lines)}`, "_self");
            };

            return (
              <div key={p.id} style={{ marginBottom: 4 }}>
                <div
                  onClick={() => setOpenPay(isOpen ? null : p.id)}
                  className="sep"
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: 14,
                    cursor: "pointer",
                    alignItems: "center",
                  }}
                >
                  <span>{p.pay_date}</span>
                  <span>{(p.hours || 0).toFixed(1)}h · {p.entries || 0} entries</span>
                  <span style={{ color: "var(--color-success)", fontFamily: "Oswald" }}>
                    ${(p.amount || 0).toFixed(2)}
                  </span>
                  <span style={{ fontSize: 14, color: "#888" }}>{isOpen ? "▲" : "▼"}</span>
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
                            fontSize: 15,
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
                      <span className="dim" style={{ fontSize: 13 }}>No job breakdown saved</span>
                    )}
                    {bonusDetails.length > 0 && (
                      <>
                        <div style={{ fontSize: 14, color: "var(--color-warning)", fontWeight: 600, marginTop: 6, marginBottom: 2 }}>🎯 Quest Bonuses</div>
                        {bonusDetails.map((b, bi) => (
                          <div key={bi} style={{ display: "flex", justifyContent: "space-between", fontSize: 15, padding: "1px 0" }}>
                            <span>{b.name}</span>
                            <span style={{ color: "var(--color-success)" }}>${b.amount.toFixed(2)}</span>
                          </div>
                        ))}
                      </>
                    )}
                    {/* Per-row actions: print / download / email. Available
                        to admins (acting on an employee's stub) AND to
                        employees on their own stubs (so they can grab a
                        copy any time without admin involvement). */}
                    <div className="row" style={{ marginTop: 10, gap: 6, flexWrap: "wrap" }}>
                      <button
                        className="bo"
                        onClick={handlePrint}
                        title="Open the pay stub in a print window"
                        style={{ fontSize: 13, padding: "4px 10px" }}
                      >
                        🖨 Print
                      </button>
                      <button
                        className="bo"
                        onClick={handleDownload}
                        title="Save the pay stub as an .html file (open / save-as-PDF locally)"
                        style={{ fontSize: 13, padding: "4px 10px" }}
                      >
                        📥 Download
                      </button>
                      <button
                        className="bo"
                        onClick={handleEmail}
                        title="Email the pay stub to the employee on file"
                        style={{ fontSize: 13, padding: "4px 10px" }}
                      >
                        ✉ Email
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </PayrollSection>
      )}
    </div>
  );
}

/* ── Auto Payroll Panel ─────────────────────────────────────────────
   Owner-only. Toggles auto_payroll_enabled and exposes day-of-week,
   hour-of-day, and cadence. Persists onChange so Bernard can flip a
   field and walk away without a Save button. Next-run preview is
   computed locally; the actual fire happens server-side via
   /api/payroll/auto-run (Vercel cron). */
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const HOUR_PRESETS = [6, 9, 12, 17, 21];

function fmtHour(h: number): string {
  const ampm = h >= 12 ? "PM" : "AM";
  const display = h % 12 === 0 ? 12 : h % 12;
  return `${display}:00 ${ampm}`;
}

function computeNextRun(day: number, hour: number, cadence: "weekly" | "biweekly", lastRunIso?: string): Date {
  const now = new Date();
  const next = new Date(now);
  next.setHours(hour, 0, 0, 0);
  // Days until target day (0..6)
  let delta = (day - now.getDay() + 7) % 7;
  if (delta === 0 && next <= now) delta = 7;
  next.setDate(now.getDate() + delta);
  // Biweekly: push forward another week if last run was less than 14 days ago
  if (cadence === "biweekly" && lastRunIso) {
    const last = new Date(lastRunIso);
    const diffDays = (next.getTime() - last.getTime()) / 86_400_000;
    if (diffDays < 14) next.setDate(next.getDate() + 7);
  }
  return next;
}

function AutoPayrollPanel() {
  const org = useStore((s) => s.org);
  const loadAll = useStore((s) => s.loadAll);
  const [busy, setBusy] = useState(false);
  const [collapsed, toggleCollapsed] = useCollapsed("payroll.autopayroll.collapsed", true);

  if (!org) return null;

  const enabled = org.auto_payroll_enabled === true;
  const day = typeof org.auto_payroll_day === "number" ? org.auto_payroll_day : 5;
  const hour = typeof org.auto_payroll_hour === "number" ? org.auto_payroll_hour : 17;
  const cadence: "weekly" | "biweekly" = org.auto_payroll_cadence === "biweekly" ? "biweekly" : "weekly";
  const lastRun = org.auto_payroll_last_run;

  const patch = async (fields: Partial<typeof org>) => {
    setBusy(true);
    try {
      await db.patch("organizations", org.id, fields);
      await loadAll();
    } finally {
      setBusy(false);
    }
  };

  // Fire the EXACT scheduled job right now (force=1 bypasses the day +
  // cadence gates) and report what happened in plain language. This is
  // the diagnostic: if this pays the crew but the schedule doesn't, the
  // day/cadence is the issue; if it skips people for "no pay rate", that's
  // the fix. Safe to tap repeatedly — already-paid hours are never re-paid.
  const runNow = async () => {
    const ok = await useStore.getState().showConfirm(
      "Run Auto Payroll now?",
      "Pays every crew member who has a pay rate set, for all their unpaid hours (no quest bonuses). Safe to run anytime — already-paid hours are never paid twice.",
    );
    if (!ok) return;
    setBusy(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      const res = await fetch("/api/payroll/auto-run?force=1", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const j = await res.json();
      const toast = useStore.getState().showToast;
      if (!res.ok || j.error) {
        toast(j.hint || j.error || `Run failed (${res.status})`, "error");
        return;
      }
      const mine = (j.fired || []).find((f: { id: string }) => f.id === org.id);
      if (!mine) {
        toast("Ran, but your org wasn't processed — make sure Auto Payroll is enabled and saved.", "warning");
      } else {
        const paidTotal = mine.paid.reduce((s: number, p: { totalPay: number }) => s + p.totalPay, 0);
        const parts = [`Paid ${mine.paid.length} ($${paidTotal.toFixed(2)})`];
        if (mine.skipped.length) {
          const reasons = Array.from(
            new Set(mine.skipped.map((s: { reason: string }) => s.reason)),
          ).join(", ");
          parts.push(`${mine.skipped.length} skipped (${reasons})`);
        }
        if (mine.errors.length) parts.push(`${mine.errors.length} errored`);
        toast(parts.join(" · "), mine.paid.length ? "success" : "warning");
      }
      await loadAll();
    } catch (e) {
      useStore.getState().showToast(e instanceof Error ? e.message : "Run failed", "error");
    } finally {
      setBusy(false);
    }
  };

  const nextRun = computeNextRun(day, hour, cadence, lastRun);
  const nextRunStr = nextRun.toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric",
  }) + ", " + fmtHour(hour);
  const lastRunStr = lastRun
    ? new Date(lastRun).toLocaleDateString("en-US", {
        weekday: "short", month: "short", day: "numeric",
        hour: "numeric", minute: "2-digit",
      })
    : null;
  // Compact schedule string for the collapsed header badge — "Sun 6 AM
  // weekly" rather than the verbose next-run sentence. Drops minutes
  // since the picker only offers on-the-hour presets.
  const badgeLabel = enabled
    ? `ON · ${DAY_NAMES[day]} ${fmtHourCompact(hour)} ${cadence}`
    : "OFF";

  return (
    <div className="cd mb" style={{ borderLeft: `3px solid ${enabled ? "var(--color-success)" : "#888"}` }}>
      <button
        type="button"
        onClick={toggleCollapsed}
        className="row"
        aria-expanded={!collapsed}
        style={{
          width: "100%",
          background: "transparent",
          border: 0,
          padding: 0,
          textAlign: "left",
          alignItems: "center",
          cursor: "pointer",
          color: "inherit",
        }}
      >
        <h4 style={{ fontSize: 15, display: "inline-flex", alignItems: "center", gap: 6 }}>
          🤖 Auto Payroll
        </h4>
        <span
          style={{
            fontSize: 12,
            padding: "2px 8px",
            borderRadius: 8,
            background: enabled ? "var(--color-success)22" : "#88888822",
            color: enabled ? "var(--color-success)" : "#888",
            fontFamily: "Oswald",
            letterSpacing: ".05em",
            marginLeft: 8,
            whiteSpace: "nowrap",
            textTransform: "uppercase",
          }}
        >
          {badgeLabel}
        </span>
        <div style={{ flex: 1 }} />
        <Icon name={collapsed ? "expand" : "collapse"} size={16} color="#888" />
      </button>

      {!collapsed && (
        <div style={{ marginTop: 10 }}>
          <label
            style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer", marginBottom: 8 }}
          >
            <input
              type="checkbox"
              checked={enabled}
              disabled={busy}
              onChange={(e) => patch({ auto_payroll_enabled: e.target.checked })}
            />
            <span style={{ fontSize: 14, color: enabled ? "var(--color-success)" : "#888", fontFamily: "Oswald" }}>
              {enabled ? "ENABLED" : "DISABLED"}
            </span>
          </label>

          <div className="dim" style={{ fontSize: 13, marginBottom: 8 }}>
            Runs payroll automatically on a schedule. Approve quest bonuses ahead of time — auto-runs include unpaid time entries only (no quest bonuses) for the configured day.
          </div>

          {enabled && (
            <>
              <div className="g2 mb">
                <div>
                  <label className="sl">Day</label>
                  <select
                    value={day}
                    disabled={busy}
                    onChange={(e) => patch({ auto_payroll_day: parseInt(e.target.value, 10) })}
                    style={{ marginTop: 4, width: "100%" }}
                  >
                    {DAY_NAMES.map((n, i) => (
                      <option key={i} value={i}>{n}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="sl">Time</label>
                  <select
                    value={hour}
                    disabled={busy}
                    onChange={(e) => patch({ auto_payroll_hour: parseInt(e.target.value, 10) })}
                    style={{ marginTop: 4, width: "100%" }}
                  >
                    {HOUR_PRESETS.map((h) => (
                      <option key={h} value={h}>{fmtHour(h)}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="mb">
                <label className="sl">Cadence</label>
                <div className="row" style={{ gap: 6, marginTop: 4 }}>
                  {(["weekly", "biweekly"] as const).map((c) => (
                    <button
                      key={c}
                      onClick={() => patch({ auto_payroll_cadence: c })}
                      disabled={busy}
                      style={{
                        flex: 1,
                        padding: "6px 10px",
                        fontSize: 14,
                        fontFamily: "Oswald",
                        borderRadius: 6,
                        background: cadence === c ? "var(--color-primary)" : "transparent",
                        color: cadence === c ? "#fff" : "#888",
                        border: `1px solid ${cadence === c ? "var(--color-primary)" : "#ddd"}`,
                        cursor: busy ? "default" : "pointer",
                        textTransform: "capitalize",
                      }}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ fontSize: 14 }}>
                <div><span className="dim">Next run:</span> <b>{nextRunStr}</b></div>
                {lastRunStr && (
                  <div className="dim" style={{ fontSize: 13, marginTop: 2 }}>
                    Last run: {lastRunStr}
                  </div>
                )}
              </div>

              <button
                onClick={runNow}
                disabled={busy}
                className="bo"
                style={{ width: "100%", marginTop: 12, fontSize: 14, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6 }}
              >
                <Icon name="pay" size={14} />
                {busy ? "Running…" : "Run now (test)"}
              </button>
              <div className="dim" style={{ fontSize: 12.5, marginTop: 5, lineHeight: 1.5 }}>
                Runs the scheduled job immediately and reports who got paid or skipped. If this pays the crew but the schedule doesn&apos;t, the day/cadence is the issue. If crew are skipped for &quot;no pay rate&quot;, set their hourly rate in Team.
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Persist a section's collapsed/expanded state across reloads. Returns
 *  [collapsed, toggle]. Storage key should namespace the section, e.g.
 *  "payroll.autopayroll.collapsed". Safe on SSR — falls back to the
 *  default if window/localStorage isn't available. */
function useCollapsed(storageKey: string, defaultCollapsed: boolean): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return defaultCollapsed;
    try {
      const stored = window.localStorage.getItem(storageKey);
      if (stored === "true") return true;
      if (stored === "false") return false;
    } catch { /* localStorage may be unavailable (private mode, etc.) */ }
    return defaultCollapsed;
  });
  const toggle = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try { window.localStorage.setItem(storageKey, String(next)); } catch { /* ignore */ }
      return next;
    });
  };
  return [collapsed, toggle];
}

/** Compact hour label for the collapsed Auto Payroll badge — "6 AM",
 *  "5 PM". The full picker uses fmtHour ("6:00 AM") with minutes. */
function fmtHourCompact(h: number): string {
  const ampm = h >= 12 ? "PM" : "AM";
  const display = h % 12 === 0 ? 12 : h % 12;
  return `${display} ${ampm}`;
}

/** Collapsible section wrapper for the page-level Payroll cards. Renders
 *  a click-toggleable header (title + optional subtitle/badge + chevron)
 *  and shows children only when expanded. Used for the main pay-run
 *  block and the payment history list. */
function PayrollSection({
  title,
  subtitle,
  storageKey,
  defaultCollapsed,
  children,
}: {
  title: string;
  subtitle?: React.ReactNode;
  storageKey: string;
  defaultCollapsed: boolean;
  children: React.ReactNode;
}) {
  const [collapsed, toggle] = useCollapsed(storageKey, defaultCollapsed);
  return (
    <div className="cd mb">
      <button
        type="button"
        onClick={toggle}
        className="row"
        aria-expanded={!collapsed}
        style={{
          width: "100%",
          background: "transparent",
          border: 0,
          padding: 0,
          textAlign: "left",
          alignItems: "center",
          cursor: "pointer",
          color: "inherit",
        }}
      >
        <h4 style={{ fontSize: 15 }}>{title}</h4>
        {subtitle && (
          <span className="dim" style={{ fontSize: 13, marginLeft: 8, fontFamily: "Oswald", letterSpacing: ".04em" }}>
            {subtitle}
          </span>
        )}
        <div style={{ flex: 1 }} />
        <Icon name={collapsed ? "expand" : "collapse"} size={16} color="#888" />
      </button>
      {!collapsed && <div style={{ marginTop: 10 }}>{children}</div>}
    </div>
  );
}
