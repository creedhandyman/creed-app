"use client";
import { useState } from "react";

interface AdminData {
  totalOrgs: number;
  totalUsers: number;
  totalJobs: number;
  totalReviews: number;
  totalQuoteValue: number;
  totalRevenue: number;
  platformFees: number;
  activeSubscriptions: number;
  trialOrgs: number;
  stripeConnected: number;
  withSites: number;
  recentSignups: Record<string, number>;
  recentJobs: Record<string, number>;
  orgDetails: {
    name: string;
    created: string;
    users: number;
    jobs: number;
    reviews: number;
    revenue: number;
    status: string;
    plan: string;
    stripe: boolean;
    site: string;
  }[];
}

export default function AdminPage() {
  const [password, setPassword] = useState("");
  const [data, setData] = useState<AdminData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    if (!password) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        setError(res.status === 401 ? "Wrong password" : "Failed to load");
        setLoading(false);
        return;
      }
      setData(await res.json());
    } catch {
      setError("Failed to connect");
    }
    setLoading(false);
  };

  if (!data) {
    return (
      <div style={{
        minHeight: "100vh", background: "#0a0a0f",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <div style={{ width: 320, textAlign: "center" }}>
          <h1 style={{ fontFamily: "Oswald, sans-serif", fontSize: 24, color: "#2E75B6", marginBottom: 16 }}>
            CREED ADMIN
          </h1>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && load()}
            placeholder="Admin password"
            style={{ background: "#1a1a28", border: "1px solid #1e1e2e", color: "#e2e2e8", padding: "10px 14px", borderRadius: 8, width: "100%", fontSize: 14, marginBottom: 10 }}
          />
          <button
            onClick={load}
            disabled={loading}
            style={{ width: "100%", padding: 10, fontSize: 14, fontFamily: "Oswald, sans-serif", textTransform: "uppercase", background: "#2E75B6", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer" }}
          >
            {loading ? "Loading..." : "Access Dashboard"}
          </button>
          {error && <div style={{ color: "#C00000", fontSize: 13, marginTop: 8 }}>{error}</div>}
        </div>
      </div>
    );
  }

  const statCard = (label: string, value: string | number, color: string, sub?: string) => (
    <div style={{ background: "#12121a", border: "1px solid #1e1e2e", borderRadius: 12, padding: 16, textAlign: "center", borderLeft: `3px solid ${color}` }}>
      <div style={{ fontSize: 12, color: "#888", fontFamily: "Oswald, sans-serif", textTransform: "uppercase", letterSpacing: ".08em" }}>{label}</div>
      <div style={{ fontSize: 28, fontFamily: "Oswald, sans-serif", fontWeight: 700, color, marginTop: 4 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: "#666", marginTop: 2 }}>{sub}</div>}
    </div>
  );

  const statusColor = (s: string) => s === "active" ? "#00cc66" : s === "trial" ? "#ffcc00" : s === "canceled" ? "#C00000" : "#888";

  // Build sparkline from signup data
  const signupDays = Object.entries(data.recentSignups).sort((a, b) => a[0].localeCompare(b[0]));
  const jobDays = Object.entries(data.recentJobs).sort((a, b) => a[0].localeCompare(b[0]));

  return (
    <div style={{ minHeight: "100vh", background: "#0a0a0f", color: "#e2e2e8", padding: "24px 20px", maxWidth: 900, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <h1 style={{ fontFamily: "Oswald, sans-serif", fontSize: 24, color: "#2E75B6" }}>
          CREED ADMIN DASHBOARD
        </h1>
        <button onClick={() => setData(null)} style={{ background: "none", color: "#888", fontSize: 12, fontFamily: "Oswald, sans-serif", border: "1px solid #1e1e2e", padding: "4px 12px", borderRadius: 6, cursor: "pointer" }}>
          Logout
        </button>
      </div>

      {/* Main stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, marginBottom: 20 }}>
        {statCard("Organizations", data.totalOrgs, "#2E75B6")}
        {statCard("Total Users", data.totalUsers, "#00cc66")}
        {statCard("Total Jobs", data.totalJobs, "#ff8800")}
        {statCard("Reviews", data.totalReviews, "#ffcc00")}
      </div>

      {/* Revenue stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, marginBottom: 20 }}>
        {statCard("Quote Value", `$${data.totalQuoteValue.toLocaleString()}`, "#2E75B6", "all quotes")}
        {statCard("Paid Revenue", `$${data.totalRevenue.toLocaleString()}`, "#00cc66", "completed jobs")}
        {statCard("Platform Fees", `$${data.platformFees.toFixed(0)}`, "#ff8800", "2% of paid")}
        {statCard("Subscriptions", data.activeSubscriptions, "#00cc66", `${data.trialOrgs} on trial`)}
      </div>

      {/* Feature adoption */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, marginBottom: 20 }}>
        {statCard("Stripe Connected", data.stripeConnected, "#6D1ED4", `of ${data.totalOrgs} orgs`)}
        {statCard("Websites Live", data.withSites, "#3D95CE", `of ${data.totalOrgs} orgs`)}
      </div>

      {/* Recent activity */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
        <div style={{ background: "#12121a", border: "1px solid #1e1e2e", borderRadius: 12, padding: 16 }}>
          <h3 style={{ fontSize: 14, color: "#2E75B6", fontFamily: "Oswald, sans-serif", marginBottom: 8 }}>SIGNUPS (30 DAYS)</h3>
          {signupDays.length === 0 ? (
            <div style={{ color: "#555", fontSize: 13 }}>No signups yet</div>
          ) : (
            signupDays.slice(-10).map(([day, count]) => (
              <div key={day} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "3px 0", borderBottom: "1px solid #1e1e2e" }}>
                <span style={{ color: "#888" }}>{day}</span>
                <span style={{ color: "#00cc66", fontFamily: "Oswald" }}>{count}</span>
              </div>
            ))
          )}
        </div>
        <div style={{ background: "#12121a", border: "1px solid #1e1e2e", borderRadius: 12, padding: 16 }}>
          <h3 style={{ fontSize: 14, color: "#ff8800", fontFamily: "Oswald, sans-serif", marginBottom: 8 }}>JOBS CREATED (30 DAYS)</h3>
          {jobDays.length === 0 ? (
            <div style={{ color: "#555", fontSize: 13 }}>No jobs yet</div>
          ) : (
            jobDays.slice(-10).map(([day, count]) => (
              <div key={day} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "3px 0", borderBottom: "1px solid #1e1e2e" }}>
                <span style={{ color: "#888" }}>{day}</span>
                <span style={{ color: "#ff8800", fontFamily: "Oswald" }}>{count}</span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Org table */}
      <div style={{ background: "#12121a", border: "1px solid #1e1e2e", borderRadius: 12, padding: 16 }}>
        <h3 style={{ fontSize: 14, color: "#2E75B6", fontFamily: "Oswald, sans-serif", marginBottom: 12 }}>ALL ORGANIZATIONS</h3>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: "2px solid #2E75B6" }}>
                {["Name", "Created", "Users", "Jobs", "Reviews", "Revenue", "Status", "Plan", "Stripe", "Site"].map((h) => (
                  <th key={h} style={{ padding: "6px 8px", textAlign: "left", fontFamily: "Oswald, sans-serif", fontSize: 11, color: "#888", textTransform: "uppercase", letterSpacing: ".06em" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.orgDetails.map((o, i) => (
                <tr key={i} style={{ borderBottom: "1px solid #1e1e2e" }}>
                  <td style={{ padding: "6px 8px", fontWeight: 600 }}>{o.name}</td>
                  <td style={{ padding: "6px 8px", color: "#888" }}>{o.created}</td>
                  <td style={{ padding: "6px 8px", color: "#2E75B6", fontFamily: "Oswald" }}>{o.users}</td>
                  <td style={{ padding: "6px 8px", color: "#ff8800", fontFamily: "Oswald" }}>{o.jobs}</td>
                  <td style={{ padding: "6px 8px", color: "#ffcc00", fontFamily: "Oswald" }}>{o.reviews}</td>
                  <td style={{ padding: "6px 8px", color: "#00cc66", fontFamily: "Oswald" }}>${o.revenue.toLocaleString()}</td>
                  <td style={{ padding: "6px 8px" }}>
                    <span style={{ fontSize: 11, padding: "2px 6px", borderRadius: 4, background: statusColor(o.status) + "22", color: statusColor(o.status) }}>{o.status}</span>
                  </td>
                  <td style={{ padding: "6px 8px", color: "#888" }}>{o.plan}</td>
                  <td style={{ padding: "6px 8px" }}>{o.stripe ? "✅" : "—"}</td>
                  <td style={{ padding: "6px 8px", color: "#3D95CE", fontSize: 11 }}>{o.site || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ textAlign: "center", color: "#333", fontSize: 11, marginTop: 20 }}>
        Creed App Admin · Data refreshes on each login
      </div>
    </div>
  );
}
