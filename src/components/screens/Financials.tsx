"use client";
import { useState } from "react";
import { useStore } from "@/lib/store";
import { db } from "@/lib/supabase";
import { wrapPrint, openPrint } from "@/lib/print-template";
import { Icon } from "../Icon";

type Range = "week" | "month" | "quarter" | "year" | "all";

interface MileageRow {
  id: string;
  trip_date: string;
  total_miles: number;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export default function Financials({ setPage: _setPage }: { setPage: (p: string) => void }) {
  const jobs = useStore((s) => s.jobs);
  const timeEntries = useStore((s) => s.timeEntries);
  const profiles = useStore((s) => s.profiles);
  const reviews = useStore((s) => s.reviews);
  const clients = useStore((s) => s.clients);
  const receipts = useStore((s) => s.receipts);
  const darkMode = useStore((s) => s.darkMode);
  const org = useStore((s) => s.org);

  const [range, setRange] = useState<Range>("month");
  const [printing, setPrinting] = useState(false);

  // Date filter
  const now = new Date();
  const rangeStart = (() => {
    const d = new Date(now);
    if (range === "week") { d.setDate(d.getDate() - 7); return d; }
    if (range === "month") { d.setMonth(d.getMonth() - 1); return d; }
    if (range === "quarter") { d.setMonth(d.getMonth() - 3); return d; }
    if (range === "year") { d.setFullYear(d.getFullYear() - 1); return d; }
    return new Date(2020, 0, 1); // all
  })();

  const inRange = (dateStr?: string) => {
    if (!dateStr) return false;
    try { return new Date(dateStr) >= rangeStart; } catch { return false; }
  };

  // Filtered data
  const rangeJobs = jobs.filter((j) => inRange(j.created_at || j.job_date));
  const quoted = rangeJobs.filter((j) => j.status === "quoted");
  const accepted = rangeJobs.filter((j) => j.status !== "quoted");
  const completed = rangeJobs.filter((j) => ["complete", "invoiced", "paid"].includes(j.status));
  const paid = rangeJobs.filter((j) => j.status === "paid");
  const invoiced = rangeJobs.filter((j) => j.status === "invoiced");

  // Revenue
  const totalQuoteValue = rangeJobs.reduce((s, j) => s + (j.total || 0), 0);
  const completedRevenue = completed.reduce((s, j) => s + (j.total || 0), 0);
  const paidRevenue = paid.reduce((s, j) => s + (j.total || 0), 0);
  const outstandingInvoices = invoiced.reduce((s, j) => s + (j.total || 0), 0);
  const totalLaborCharged = completed.reduce((s, j) => s + (j.total_labor || 0), 0);
  const totalMaterials = completed.reduce((s, j) => s + (j.total_mat || 0), 0);

  // Conversion funnel
  const closeRate = rangeJobs.length > 0 ? Math.round((accepted.length / rangeJobs.length) * 100) : 0;
  const avgJobSize = completed.length > 0 ? Math.round(completedRevenue / completed.length) : 0;

  // Revenue by trade
  const byTrade: Record<string, { revenue: number; jobs: number }> = {};
  completed.forEach((j) => {
    const trade = j.trade || "General";
    if (!byTrade[trade]) byTrade[trade] = { revenue: 0, jobs: 0 };
    byTrade[trade].revenue += j.total || 0;
    byTrade[trade].jobs++;
  });
  const tradeEntries = Object.entries(byTrade).sort((a, b) => b[1].revenue - a[1].revenue);
  const maxTradeRevenue = tradeEntries.length ? tradeEntries[0][1].revenue : 1;

  // Revenue per tech
  const byTech: Record<string, { hours: number; pay: number }> = {};
  const rangeEntries = timeEntries.filter((e) => {
    try {
      const parts = e.entry_date?.split("/");
      if (parts?.length === 3) {
        const d = new Date(parseInt(parts[2]), parseInt(parts[0]) - 1, parseInt(parts[1]));
        return d >= rangeStart;
      }
      return new Date(e.entry_date) >= rangeStart;
    } catch { return false; }
  });
  rangeEntries.forEach((e) => {
    const name = e.user_name || "Unknown";
    if (!byTech[name]) byTech[name] = { hours: 0, pay: 0 };
    byTech[name].hours += e.hours || 0;
    byTech[name].pay += e.amount || 0;
  });
  const crewCost = rangeEntries.reduce((s, e) => s + (e.amount || 0), 0);
  // Split crew cost by paid status — Payroll now marks entries with
  // paid_at instead of deleting them (so Team Stats keeps lifetime
  // history). Surfacing the split here gives the manager a cash-flow
  // view: how much labor has already been paid out vs. how much is
  // still owed in the next pay run.
  const crewCostPaid = rangeEntries.reduce((s, e) => s + (e.paid_at ? e.amount || 0 : 0), 0);
  const crewCostOwed = rangeEntries.reduce((s, e) => s + (!e.paid_at ? e.amount || 0 : 0), 0);

  // Actual materials spend from receipts in the same period (real out-of-
  // pocket cost, vs. totalMaterials which is what was CHARGED to the
  // client). When receipts exist for the period we use actual; otherwise
  // fall back to charged so the profit number still works.
  const periodReceipts = receipts.filter((r) => inRange(r.receipt_date));
  const actualMaterialsSpent = periodReceipts.reduce((s, r) => s + (r.amount || 0), 0);
  const materialsForProfit = actualMaterialsSpent > 0 ? actualMaterialsSpent : totalMaterials;

  const profit = completedRevenue - materialsForProfit - crewCost;
  const techEntries = Object.entries(byTech).sort((a, b) => b[1].hours - a[1].hours);

  // Top clients
  const byClient: Record<string, { revenue: number; jobs: number }> = {};
  completed.forEach((j) => {
    const c = j.client || "Walk-in";
    if (!byClient[c]) byClient[c] = { revenue: 0, jobs: 0 };
    byClient[c].revenue += j.total || 0;
    byClient[c].jobs++;
  });
  const clientEntries = Object.entries(byClient).sort((a, b) => b[1].revenue - a[1].revenue).slice(0, 5);

  // Jobs per week (last 8 weeks)
  const weekBuckets: Record<string, number> = {};
  for (let i = 0; i < 8; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i * 7);
    const key = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    weekBuckets[key] = 0;
  }
  rangeJobs.forEach((j) => {
    try {
      const d = new Date(j.created_at || j.job_date);
      const weeksAgo = Math.floor((now.getTime() - d.getTime()) / (7 * 24 * 60 * 60 * 1000));
      if (weeksAgo >= 0 && weeksAgo < 8) {
        const wd = new Date(now);
        wd.setDate(wd.getDate() - weeksAgo * 7);
        const key = wd.toLocaleDateString("en-US", { month: "short", day: "numeric" });
        if (weekBuckets[key] !== undefined) weekBuckets[key]++;
      }
    } catch { /* */ }
  });
  const weekData = Object.entries(weekBuckets).reverse();
  const maxWeekJobs = Math.max(1, ...Object.values(weekBuckets));

  // Rating
  const avgRating = reviews.length ? (reviews.reduce((s, r) => s + (r.rating || 0), 0) / reviews.length).toFixed(1) : "—";

  const border = darkMode ? "#1e1e2e" : "#eee";

  /* ── Print Profit & Loss statement ───────────────────────────────── */
  const periodLabel = (() => {
    if (range === "week") return "Last 7 Days";
    if (range === "month") return "Last 30 Days";
    if (range === "quarter") return "Last 90 Days";
    if (range === "year") return "Last 12 Months";
    return "All Time";
  })();

  const printPL = async () => {
    setPrinting(true);
    try {
      // Fetch mileage from the DB (not in store — each user fetches their own
      // on demand). For org-wide P&L, db.get applies the org_id filter.
      let mileageRows: MileageRow[] = [];
      try {
        mileageRows = await db.get<MileageRow>("mileage");
      } catch { /* fall through with empty mileage */ }
      const periodMileage = mileageRows.filter((m) => inRange(m.trip_date));
      const totalMiles = periodMileage.reduce((s, m) => s + (m.total_miles || 0), 0);
      const IRS_RATE = 0.70;
      const mileageExpense = Math.round(totalMiles * IRS_RATE * 100) / 100;

      // Use ACTUAL materials spend from receipts when available; fall back to
      // the materials CHARGED on completed jobs (less precise but always
      // present).
      const cogsMaterials = actualMaterialsSpent > 0 ? actualMaterialsSpent : totalMaterials;
      const materialsLabel = actualMaterialsSpent > 0
        ? `Materials (actual receipts, ${periodReceipts.length})`
        : "Materials (charged to clients)";

      const totalCogs = cogsMaterials + crewCost;
      const grossProfit = completedRevenue - totalCogs;
      const grossMargin = completedRevenue > 0 ? (grossProfit / completedRevenue) * 100 : 0;
      const totalOpex = mileageExpense;
      const netProfit = grossProfit - totalOpex;
      const netMargin = completedRevenue > 0 ? (netProfit / completedRevenue) * 100 : 0;

      const fmt$ = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      const sectionRow = (label: string) =>
        `<tr><td colspan="2" style="background:#f0f4f8;color:#2E75B6;font-family:Oswald,sans-serif;font-size:12px;letter-spacing:.08em;text-transform:uppercase;padding:6px 10px;border-top:2px solid #2E75B6">${label}</td></tr>`;
      const lineRow = (label: string, amount: number, indent = false) =>
        `<tr><td style="${indent ? "padding-left:24px;" : ""}padding:4px 10px">${label}</td><td style="text-align:right;padding:4px 10px;font-family:Oswald,sans-serif">${fmt$(amount)}</td></tr>`;
      const subtotalRow = (label: string, amount: number) =>
        `<tr style="font-weight:600;border-top:1px solid #ddd"><td style="padding:6px 10px">${label}</td><td style="text-align:right;padding:6px 10px;font-family:Oswald,sans-serif">${fmt$(amount)}</td></tr>`;
      const totalRow = (label: string, amount: number, color: string) =>
        `<tr style="font-weight:700;font-size:14px;border-top:2px solid ${color}"><td style="padding:8px 10px;color:${color}">${label}</td><td style="text-align:right;padding:8px 10px;font-family:Oswald,sans-serif;color:${color}">${fmt$(amount)}</td></tr>`;
      const marginRow = (label: string, pct: number) =>
        `<tr><td style="padding:4px 10px;color:#666">${label}</td><td style="text-align:right;padding:4px 10px;font-family:Oswald,sans-serif;color:#666">${pct.toFixed(1)}%</td></tr>`;

      const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
      const periodFromTo = `${rangeStart.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} – ${now.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;

      const body = `
<section style="margin-bottom:18px">
  <h2>Profit &amp; Loss Statement</h2>
  <div style="font-size:12px;color:#666;margin-bottom:14px">
    Period: <b>${periodLabel}</b> &nbsp;·&nbsp; ${periodFromTo}
  </div>
  <table style="border-collapse:collapse;font-size:13px">
    ${sectionRow("Revenue")}
    ${lineRow("Service Income (paid jobs)", paidRevenue, true)}
    ${lineRow("Outstanding Invoices", outstandingInvoices, true)}
    ${lineRow("Completed (not yet invoiced)", completedRevenue - paidRevenue - outstandingInvoices, true)}
    ${subtotalRow("Total Revenue", completedRevenue)}
    ${sectionRow("Cost of Goods Sold")}
    ${lineRow(materialsLabel, cogsMaterials, true)}
    ${lineRow(`Direct Labor (crew pay, ${rangeEntries.length} entries)`, crewCost, true)}
    ${crewCostOwed > 0 && crewCostPaid > 0 ? lineRow(`&nbsp;&nbsp;&nbsp;&nbsp;↳ Already paid out`, crewCostPaid, true) : ""}
    ${crewCostOwed > 0 ? lineRow(`&nbsp;&nbsp;&nbsp;&nbsp;↳ Owed in next pay run`, crewCostOwed, true) : ""}
    ${subtotalRow("Total COGS", totalCogs)}
    ${totalRow("Gross Profit", grossProfit, "#2E75B6")}
    ${marginRow("Gross Margin", grossMargin)}
    ${sectionRow("Operating Expenses")}
    ${lineRow(`Mileage (${totalMiles.toFixed(1)} mi × $${IRS_RATE.toFixed(2)})`, mileageExpense, true)}
    ${subtotalRow("Total Operating Expenses", totalOpex)}
    ${totalRow("Net Profit", netProfit, netProfit >= 0 ? "#00cc66" : "#C00000")}
    ${marginRow("Net Margin", netMargin)}
  </table>
</section>

<section style="margin-top:18px">
  <h3>Job Activity Summary</h3>
  <table style="font-size:12px">
    <tr><td>Jobs in period</td><td style="text-align:right;font-family:Oswald,sans-serif">${rangeJobs.length}</td></tr>
    <tr><td>Jobs completed</td><td style="text-align:right;font-family:Oswald,sans-serif">${completed.length}</td></tr>
    <tr><td>Jobs paid</td><td style="text-align:right;font-family:Oswald,sans-serif">${paid.length}</td></tr>
    <tr><td>Average job size</td><td style="text-align:right;font-family:Oswald,sans-serif">${fmt$(avgJobSize)}</td></tr>
    <tr><td>Close rate</td><td style="text-align:right;font-family:Oswald,sans-serif">${closeRate}%</td></tr>
  </table>
</section>

<div style="margin-top:24px;padding-top:12px;border-top:1px solid #ddd;font-size:11px;color:#888">
  Generated ${today}. ${actualMaterialsSpent > 0 ? "Material costs reflect actual receipt data for the period." : "Material costs reflect amounts charged to clients (no receipt data for this period)."} Mileage at the IRS standard rate of $${IRS_RATE.toFixed(2)}/mi.
</div>
`;

      const html = wrapPrint(
        {
          orgName: org?.name || "",
          orgPhone: org?.phone,
          orgEmail: org?.email,
          orgAddress: org?.address,
          orgLicense: org?.license_num,
          orgLogo: org?.logo_url,
          docTitle: "Profit & Loss",
          docNumber: `P&L-${range.toUpperCase()}`,
          docDate: today,
          docSubtitle: periodLabel,
        },
        body,
      );
      if (!openPrint(html)) {
        useStore.getState().showToast("Allow popups to print P&L", "error");
      }
    } finally {
      setPrinting(false);
    }
  };

  const statCard = (label: string, value: string | number, color: string, sub?: string) => (
    <div className="cd" style={{ textAlign: "center", padding: 12, borderLeft: `3px solid ${color}` }}>
      <div className="sl">{label}</div>
      <div style={{ fontSize: 22, fontFamily: "Oswald", fontWeight: 700, color, marginTop: 4 }}>{value}</div>
      {sub && <div className="dim" style={{ fontSize: 12, marginTop: 2 }}>{sub}</div>}
    </div>
  );

  return (
    <div className="fi">
      {/* Header — Financials is rendered inside the Ops tabs, so the
          old "← Dashboard" back button is redundant and removed. */}
      <div className="row mb" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ fontSize: 22, color: "var(--color-primary)", display: "inline-flex", alignItems: "center", gap: 8 }}>
          <Icon name="trending" size={22} color="var(--color-primary)" />
          Financials
        </h2>
        <button
          className="bo"
          onClick={printPL}
          disabled={printing}
          style={{
            fontSize: 12,
            padding: "5px 12px",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            opacity: printing ? 0.6 : 1,
          }}
          title="Print Profit & Loss statement for the selected period"
        >
          <Icon name="print" size={14} />
          {printing ? "Building..." : "Print P&L"}
        </button>
      </div>

      {/* Range selector */}
      <div style={{ display: "flex", gap: 3, marginBottom: 14 }}>
        {([
          { key: "week" as Range, label: "Week" },
          { key: "month" as Range, label: "Month" },
          { key: "quarter" as Range, label: "Quarter" },
          { key: "year" as Range, label: "Year" },
          { key: "all" as Range, label: "All" },
        ]).map((r) => (
          <button
            key={r.key}
            onClick={() => setRange(r.key)}
            style={{
              padding: "5px 12px", borderRadius: 6, fontSize: 12,
              background: range === r.key ? "var(--color-primary)" : "transparent",
              color: range === r.key ? "#fff" : "#888", fontFamily: "Oswald",
            }}
          >
            {r.label}
          </button>
        ))}
      </div>

      {/* Revenue stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 8, marginBottom: 14 }}>
        {statCard("Revenue", `$${completedRevenue.toLocaleString()}`, "var(--color-success)", `${completed.length} jobs`)}
        {statCard("Paid", `$${paidRevenue.toLocaleString()}`, "#00cc66", `${paid.length} collected`)}
        {statCard("Outstanding", `$${outstandingInvoices.toLocaleString()}`, "var(--color-warning)", `${invoiced.length} invoices`)}
        {statCard("Avg Job", `$${avgJobSize.toLocaleString()}`, "var(--color-primary)")}
      </div>

      {/* Funnel + Profit */}
      <div className="g2 mb">
        <div className="cd" style={{ padding: 14 }}>
          <h4 style={{ fontSize: 13, color: "var(--color-primary)", marginBottom: 10 }}>Quote Funnel</h4>
          {[
            { label: "Quoted", count: rangeJobs.length, color: "#888" },
            { label: "Accepted", count: accepted.length, color: "var(--color-primary)" },
            { label: "Completed", count: completed.length, color: "var(--color-warning)" },
            { label: "Paid", count: paid.length, color: "var(--color-success)" },
          ].map((s) => (
            <div key={s.label} style={{ marginBottom: 6 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 2 }}>
                <span>{s.label}</span>
                <span style={{ fontFamily: "Oswald", color: s.color }}>{s.count}</span>
              </div>
              <div style={{ height: 6, borderRadius: 3, background: border }}>
                <div style={{ height: "100%", borderRadius: 3, background: s.color, width: `${rangeJobs.length ? (s.count / rangeJobs.length) * 100 : 0}%`, transition: "width .3s" }} />
              </div>
            </div>
          ))}
          <div className="dim" style={{ fontSize: 12, marginTop: 6 }}>Close rate: <b>{closeRate}%</b></div>
        </div>

        <div className="cd" style={{ padding: 14 }}>
          <h4 style={{ fontSize: 13, color: "var(--color-success)", marginBottom: 10 }}>Profit Breakdown</h4>
          <div style={{ fontSize: 13, lineHeight: 2 }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>Revenue (jobs completed)</span>
              <span style={{ fontFamily: "Oswald", color: "var(--color-success)" }}>${completedRevenue.toLocaleString()}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span className="dim">&nbsp;&nbsp;Labor charged</span>
              <span style={{ fontFamily: "Oswald", color: "var(--color-primary)" }}>${totalLaborCharged.toLocaleString()}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span className="dim">&nbsp;&nbsp;Materials charged</span>
              <span style={{ fontFamily: "Oswald", color: "var(--color-warning)" }}>${totalMaterials.toLocaleString()}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", borderTop: `1px solid ${border}`, paddingTop: 4, marginTop: 4 }}>
              <span className="dim">
                {actualMaterialsSpent > 0 ? `Materials (actual, ${periodReceipts.length} receipts)` : "Materials (charged proxy)"}
              </span>
              <span style={{ fontFamily: "Oswald", color: "var(--color-accent-red)" }}>-${materialsForProfit.toLocaleString()}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span className="dim">Crew pay (actual hours)</span>
              <span style={{ fontFamily: "Oswald", color: "var(--color-accent-red)" }}>-${crewCost.toLocaleString()}</span>
            </div>
            {(crewCostPaid > 0 || crewCostOwed > 0) && (
              <div style={{ display: "flex", justifyContent: "space-between", paddingLeft: 12, fontSize: 11 }}>
                <span className="dim">↳ Paid ${crewCostPaid.toLocaleString()} · Owed ${crewCostOwed.toLocaleString()}</span>
                <span className="dim" style={{ fontFamily: "Oswald" }}>
                  {crewCostOwed > 0 ? `${Math.round((crewCostOwed / crewCost) * 100)}% unpaid` : "all paid"}
                </span>
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "space-between", borderTop: `2px solid var(--color-primary)`, paddingTop: 6, marginTop: 6 }}>
              <span style={{ fontWeight: 700, fontSize: 14 }}>Net Profit</span>
              <span style={{ fontFamily: "Oswald", fontSize: 18, color: profit > 0 ? "var(--color-success)" : "var(--color-accent-red)" }}>${profit.toLocaleString()}</span>
            </div>
          </div>
          <div className="dim" style={{ fontSize: 12, marginTop: 6 }}>
            Margin: <b>{completedRevenue > 0 ? Math.round((profit / completedRevenue) * 100) : 0}%</b>
            {actualMaterialsSpent === 0 && totalMaterials > 0 && (
              <span style={{ marginLeft: 8, color: "var(--color-warning)", fontSize: 11 }}>
                · Add receipts for true material cost
              </span>
            )}
          </div>
        </div>
      </div>

      {/* A/R Aging — outstanding invoices bucketed by age. Only shown when
          there's something to chase. Anchor is the job_date (closest proxy
          for invoice-issued; we don't track an explicit invoiced_at). */}
      {(() => {
        const invoicedAll = jobs.filter((j) => j.status === "invoiced" && !j.archived);
        if (invoicedAll.length === 0) return null;
        const today = new Date();
        const buckets = [
          { label: "Current (0-29 days)", min: 0, max: 29, color: "var(--color-success)", count: 0, total: 0 },
          { label: "30-59 days", min: 30, max: 59, color: "var(--color-warning)", count: 0, total: 0 },
          { label: "60-89 days", min: 60, max: 89, color: "#ff8800", count: 0, total: 0 },
          { label: "90+ days", min: 90, max: Infinity, color: "var(--color-accent-red)", count: 0, total: 0 },
        ];
        invoicedAll.forEach((j) => {
          let age = 0;
          try {
            const d = new Date(j.job_date || j.created_at);
            age = Math.floor((today.getTime() - d.getTime()) / (24 * 60 * 60 * 1000));
          } catch { /* age stays 0 */ }
          const bucket = buckets.find((b) => age >= b.min && age <= b.max);
          if (bucket) {
            bucket.count++;
            bucket.total += j.total || 0;
          }
        });
        const grandTotal = buckets.reduce((s, b) => s + b.total, 0);
        const overdueTotal = buckets.slice(1).reduce((s, b) => s + b.total, 0);
        return (
          <div className="cd mb" style={{ padding: 14, borderLeft: `3px solid ${overdueTotal > 0 ? "var(--color-warning)" : "var(--color-success)"}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
              <h4 style={{ fontSize: 13, color: "var(--color-warning)", margin: 0 }}>
                A/R Aging — Outstanding Invoices
              </h4>
              <span style={{ fontFamily: "Oswald", fontSize: 14, color: "var(--color-warning)" }}>
                ${grandTotal.toLocaleString()}
              </span>
            </div>
            {buckets.map((b) => (
              <div key={b.label} style={{ marginBottom: 6 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 2 }}>
                  <span>{b.label} <span className="dim">({b.count})</span></span>
                  <span style={{ fontFamily: "Oswald", color: b.color }}>${b.total.toLocaleString()}</span>
                </div>
                <div style={{ height: 6, borderRadius: 3, background: border }}>
                  <div style={{ height: "100%", borderRadius: 3, background: b.color, width: `${grandTotal > 0 ? (b.total / grandTotal) * 100 : 0}%`, transition: "width .3s" }} />
                </div>
              </div>
            ))}
            {overdueTotal > 0 && (
              <div className="dim" style={{ fontSize: 11, marginTop: 6, color: "var(--color-warning)" }}>
                ${overdueTotal.toLocaleString()} past due — worth a follow-up.
              </div>
            )}
          </div>
        );
      })()}

      {/* Jobs per week chart */}
      <div className="cd mb" style={{ padding: 14 }}>
        <h4 style={{ fontSize: 13, color: "var(--color-primary)", marginBottom: 10 }}>Jobs Per Week</h4>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 80 }}>
          {weekData.map(([label, count]) => (
            <div key={label} style={{ flex: 1, textAlign: "center" }}>
              <div style={{
                height: `${Math.max(4, (count / maxWeekJobs) * 60)}px`,
                background: "var(--color-primary)", borderRadius: "4px 4px 0 0",
                margin: "0 auto", width: "80%", transition: "height .3s",
              }} />
              <div style={{ fontSize: 10, color: "var(--color-primary)", fontFamily: "Oswald", marginTop: 2 }}>{count}</div>
              <div className="dim" style={{ fontSize: 8, marginTop: 1 }}>{label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Revenue by trade */}
      <div className="cd mb" style={{ padding: 14 }}>
        <h4 style={{ fontSize: 13, color: "var(--color-warning)", marginBottom: 10 }}>Revenue by Trade</h4>
        {tradeEntries.length === 0 ? (
          <p className="dim" style={{ fontSize: 12 }}>No completed jobs yet</p>
        ) : (
          tradeEntries.map(([trade, data]) => (
            <div key={trade} style={{ marginBottom: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 2 }}>
                <span>{trade} ({data.jobs})</span>
                <span style={{ fontFamily: "Oswald", color: "var(--color-warning)" }}>${data.revenue.toLocaleString()}</span>
              </div>
              <div style={{ height: 8, borderRadius: 4, background: border }}>
                <div style={{ height: "100%", borderRadius: 4, background: "var(--color-warning)", width: `${(data.revenue / maxTradeRevenue) * 100}%` }} />
              </div>
            </div>
          ))
        )}
      </div>

      {/* Team performance + Top clients */}
      <div className="g2 mb">
        <div className="cd" style={{ padding: 14 }}>
          <h4 style={{ fontSize: 13, color: "var(--color-highlight)", marginBottom: 8 }}>Team Performance</h4>
          {techEntries.length === 0 ? (
            <p className="dim" style={{ fontSize: 12 }}>No time logged</p>
          ) : (
            techEntries.map(([name, data]) => (
              <div key={name} className="sep" style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                <span style={{ fontWeight: 600 }}>{name}</span>
                <span>
                  <span style={{ fontFamily: "Oswald", color: "var(--color-primary)" }}>{data.hours.toFixed(1)}h</span>
                  <span className="dim" style={{ marginLeft: 6 }}>${data.pay.toFixed(0)}</span>
                </span>
              </div>
            ))
          )}
        </div>

        <div className="cd" style={{ padding: 14 }}>
          <h4 style={{ fontSize: 13, color: "var(--color-success)", marginBottom: 8 }}>Top Clients</h4>
          {clientEntries.length === 0 ? (
            <p className="dim" style={{ fontSize: 12 }}>No completed jobs</p>
          ) : (
            clientEntries.map(([name, data]) => (
              <div key={name} className="sep" style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                <span>{name} ({data.jobs})</span>
                <span style={{ fontFamily: "Oswald", color: "var(--color-success)" }}>${data.revenue.toLocaleString()}</span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Quick stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))", gap: 8 }}>
        {statCard("Total Clients", clients.length, "var(--color-primary)")}
        {statCard("Avg Rating", avgRating, "var(--color-highlight)", `${reviews.length} reviews`)}
        {statCard("Quote Value", `$${totalQuoteValue.toLocaleString()}`, "#888", "all quotes")}
      </div>
    </div>
  );
}
