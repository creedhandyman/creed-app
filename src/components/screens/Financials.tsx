"use client";
import { useState } from "react";
import { useStore } from "@/lib/store";
import { Icon } from "../Icon";

type Range = "week" | "month" | "quarter" | "year" | "all";

export default function Financials({ setPage }: { setPage: (p: string) => void }) {
  const jobs = useStore((s) => s.jobs);
  const timeEntries = useStore((s) => s.timeEntries);
  const profiles = useStore((s) => s.profiles);
  const reviews = useStore((s) => s.reviews);
  const clients = useStore((s) => s.clients);
  const darkMode = useStore((s) => s.darkMode);
  const org = useStore((s) => s.org);

  const [range, setRange] = useState<Range>("month");

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
  const profit = completedRevenue - totalMaterials - crewCost;
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

  const statCard = (label: string, value: string | number, color: string, sub?: string) => (
    <div className="cd" style={{ textAlign: "center", padding: 12, borderLeft: `3px solid ${color}` }}>
      <div className="sl">{label}</div>
      <div style={{ fontSize: 22, fontFamily: "Oswald", fontWeight: 700, color, marginTop: 4 }}>{value}</div>
      {sub && <div className="dim" style={{ fontSize: 12, marginTop: 2 }}>{sub}</div>}
    </div>
  );

  return (
    <div className="fi">
      {/* Header */}
      <div className="row mb" style={{ justifyContent: "space-between" }}>
        <h2 style={{ fontSize: 22, color: "var(--color-primary)", display: "inline-flex", alignItems: "center", gap: 8 }}>
          <Icon name="trending" size={22} color="var(--color-primary)" />
          Financials
        </h2>
        <button className="bo" onClick={() => setPage("dash")} style={{ fontSize: 12, padding: "4px 10px" }}>← Dashboard</button>
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
              <span className="dim">Materials cost</span>
              <span style={{ fontFamily: "Oswald", color: "var(--color-accent-red)" }}>-${totalMaterials.toLocaleString()}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span className="dim">Crew pay (actual hours)</span>
              <span style={{ fontFamily: "Oswald", color: "var(--color-accent-red)" }}>-${crewCost.toLocaleString()}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", borderTop: `2px solid var(--color-primary)`, paddingTop: 6, marginTop: 6 }}>
              <span style={{ fontWeight: 700, fontSize: 14 }}>Net Profit</span>
              <span style={{ fontFamily: "Oswald", fontSize: 18, color: profit > 0 ? "var(--color-success)" : "var(--color-accent-red)" }}>${profit.toLocaleString()}</span>
            </div>
          </div>
          <div className="dim" style={{ fontSize: 12, marginTop: 6 }}>Margin: <b>{completedRevenue > 0 ? Math.round((profit / completedRevenue) * 100) : 0}%</b></div>
        </div>
      </div>

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
