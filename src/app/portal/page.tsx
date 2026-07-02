"use client";
/**
 * Customer portal landing page. Reads /api/portal/me on mount; if no
 * session, redirects to /portal/login. Action-first layout (mock:
 * Creed_Portal_Full.html), priority-ordered:
 *  1. branded header
 *  2. greeting + summary line ("1 quote to review · 1 invoice due · member")
 *  3. ONE global "Request Work" button (per-property duplicates removed —
 *     each property card keeps a small "Request work here" link)
 *  4. Needs your attention — quotes to Approve & Sign (green glow) and
 *     invoices to Pay (gold glow); hidden when empty
 *  5. Your membership — plan card w/ next visit / next bill / perks +
 *     self-serve Update card / Pause / Cancel (click-to-cancel). No plan →
 *     a "Join" upsell card (hosted checkout via /api/portal/membership-checkout)
 *  6. Your properties — deduped by normalized address, jobs nested with
 *     status chips + glow dots
 *  7. Documents / renderings, then the contact footer
 *
 * No app-shell chrome — this is a public, mobile-first page.
 */
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Customer, Address, Job, Receipt, Organization } from "@/lib/types";
import { openJobQuotePdf } from "@/lib/quote-pdf";
import { exportJobReport } from "@/lib/export-job-report";
import { statusColor } from "@/lib/status";
import { Icon } from "@/components/Icon";

const PRIMARY = "#2E75B6";
const GOLD = "#f5b400";

type PortalOrg = Pick<
  Organization,
  | "id" | "name" | "phone" | "email" | "logo_url" | "address" | "license_num"
  | "default_rate" | "markup_pct" | "tax_pct" | "tax_mode" | "trip_fee" | "min_labor_hours"
  | "brand_color" | "brand_color_2" | "deposit_pct" | "quote_valid_days" | "quote_terms"
>;

type PortalPlan = {
  id: string;
  name?: string;
  price?: number;
  interval?: string;
  /** { description } free text from the plan editor — split into perk rows. */
  included?: unknown;
  visits_per_year?: number;
};

type PortalMembership = {
  id: string;
  status: string;
  next_bill_at?: string | null;
  next_visit_at?: string | null;
  plan?: PortalPlan | null;
};

interface PortalData {
  customer: Customer;
  addresses: Address[];
  jobs: Job[];
  receipts: Receipt[];
  memberships?: PortalMembership[];
  /** Active plans for the join-upsell — only sent when the customer has no
   *  live membership AND the org's Stripe is connected. */
  plans?: PortalPlan[];
  stripe_connected?: boolean;
  org: PortalOrg | null;
}

const STATUS_LABEL: Record<string, string> = {
  lead: "Requested",
  quoted: "Quote ready",
  accepted: "Accepted",
  scheduled: "Scheduled",
  active: "In progress",
  complete: "Complete",
  invoiced: "Invoiced",
  paid: "Paid",
  inspection: "Inspection",
};

const fmtMoney = (n: number) => `$${(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const fmtDate = (s: string | undefined | null) => {
  if (!s) return "";
  const d = new Date(s);
  return isNaN(d.getTime()) ? String(s).split("T")[0] : d.toLocaleDateString();
};

function formatAddress(a: Address): string {
  const line = [a.street, a.city, a.state, a.zip].filter(Boolean).join(", ");
  return a.label || line || "(no address)";
}

function extractPhotos(j: Job): { url: string; type: string; label?: string }[] {
  const out: { url: string; type: string; label?: string }[] = [];
  try {
    const data = typeof j.rooms === "string" ? JSON.parse(j.rooms) : j.rooms;
    if (Array.isArray(data?.photos)) {
      for (const p of data.photos) {
        if (p?.url) out.push({ url: p.url, type: p.type || "work", label: p.label });
      }
    }
    // Inspection items also carry photos — surface those when the
    // workOrder photo bucket is empty so completed-job thumbnails
    // aren't blank when the crew used Inspector instead.
    if (out.length === 0 && Array.isArray(data?.inspection?.rooms)) {
      for (const room of data.inspection.rooms) {
        for (const item of room.items || []) {
          for (const url of item.photos || []) {
            if (typeof url === "string") out.push({ url, type: "inspection", label: item.name });
          }
        }
      }
    }
    // Lead-form photos (status="lead" jobs uploaded via /api/leads).
    if (out.length === 0 && Array.isArray(data?.leadPhotos)) {
      for (const url of data.leadPhotos) {
        if (typeof url === "string") out.push({ url, type: "lead" });
      }
    }
  } catch { /* malformed rooms JSON — show no photos */ }
  return out;
}

/* ─── Property grouping ─────────────────────────────────────────────
 *
 * One card per REAL address. The old page rendered a card per addresses
 * row (duplicate rows in the table = duplicate cards) plus an "Other"
 * bucket for jobs with no address_id whose property string was the same
 * street. Group by a normalized address key instead: every addresses row
 * AND every free-text job.property that normalizes to the same string
 * lands in one group.
 */
const norm = (s: string) =>
  s.toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();

type PropGroup = { key: string; display: string; addressId?: string; jobs: Job[] };

function groupProperties(addresses: Address[], jobs: Job[]): PropGroup[] {
  const groups: PropGroup[] = [];
  const byKey = new Map<string, PropGroup>();
  const addrById = new Map<string, PropGroup>();

  const claim = (key: string, display: string, addressId?: string): PropGroup => {
    const existing = byKey.get(key);
    if (existing) {
      if (!existing.addressId && addressId) existing.addressId = addressId;
      return existing;
    }
    const g: PropGroup = { key, display, addressId, jobs: [] };
    byKey.set(key, g);
    groups.push(g);
    return g;
  };

  for (const a of addresses) {
    const display = formatAddress(a);
    const g = claim(norm(display), display, a.id);
    addrById.set(a.id, g);
    // Register alternate keys (label vs street line) → the same group, so a
    // job whose property string is the raw street folds into a labeled card.
    const streetLine = [a.street, a.city, a.state, a.zip].filter(Boolean).join(", ");
    if (streetLine && !byKey.has(norm(streetLine))) byKey.set(norm(streetLine), g);
    if (a.label && !byKey.has(norm(a.label))) byKey.set(norm(a.label), g);
  }

  for (const j of jobs) {
    let g = j.address_id ? addrById.get(j.address_id) : undefined;
    if (!g) {
      const pk = norm(j.property || "");
      if (pk) {
        g = byKey.get(pk);
        if (!g) {
          // Prefix match — "151 n gow st" folds into "151 n gow st wichita ks".
          for (const [k, grp] of byKey) {
            if (k.startsWith(pk) || pk.startsWith(k)) { g = grp; break; }
          }
        }
        if (!g) g = claim(pk, j.property);
      } else {
        g = claim("__none", "Other");
      }
    }
    g.jobs.push(j);
  }

  // Actionable work floats to the top of each card; terminal states sink.
  const RANK: Record<string, number> = {
    active: 0, scheduled: 1, accepted: 2, quoted: 3, lead: 4,
    invoiced: 5, complete: 6, paid: 7, inspection: 8,
  };
  for (const g of groups) {
    g.jobs.sort(
      (x, y) =>
        (RANK[x.status] ?? 9) - (RANK[y.status] ?? 9) ||
        (y.created_at || "").localeCompare(x.created_at || ""),
    );
  }
  return groups;
}

/* ─── Membership helpers ─── */
const intervalWord = (i?: string) => (i === "annual" ? "yr" : i === "quarterly" ? "qtr" : "mo");

function perkList(plan?: PortalPlan | null): string[] {
  const out: string[] = [];
  const v = Number(plan?.visits_per_year) || 0;
  if (v > 0) {
    out.push(v === 1 ? "1 service visit a year" : v === 2 ? "2 seasonal visits a year" : `${v} service visits a year`);
  }
  const desc = (plan?.included as { description?: string } | null | undefined)?.description || "";
  for (const part of desc.split(/\n|·|;|,/)) {
    const t = part.trim();
    if (t) out.push(t);
  }
  return out.slice(0, 5);
}

export default function PortalPage() {
  const router = useRouter();
  const [data, setData] = useState<PortalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [errored, setErrored] = useState(false);
  // ?joined=1 = back from the membership checkout success URL. The webhook
  // creates the row, which can lag the redirect by a few seconds — show a
  // "it's activating" note instead of the upsell flashing back.
  const [joined] = useState(
    () => typeof window !== "undefined" && new URLSearchParams(window.location.search).has("joined"),
  );

  useEffect(() => {
    let cancelled = false;
    fetch("/api/portal/me", { cache: "no-store" })
      .then((res) => {
        if (res.status === 401) {
          router.replace("/portal/login");
          return null;
        }
        if (!res.ok) {
          setErrored(true);
          return null;
        }
        return res.json();
      })
      .then((j) => {
        if (cancelled || !j) return;
        setData(j as PortalData);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setErrored(true);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [router]);

  // Archived jobs (dead quotes) and internal inspection records stay out of
  // the customer-facing lists.
  const visibleJobs = useMemo(
    () => (data?.jobs || []).filter((j) => !j.archived && j.status !== "inspection"),
    [data],
  );
  const groups = useMemo(
    () => (data ? groupProperties(data.addresses, visibleJobs) : []),
    [data, visibleJobs],
  );

  if (loading) {
    return (
      <div className="pub" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ color: "#7fb6ff", fontFamily: "Oswald, sans-serif", fontSize: 20 }}>Loading…</div>
      </div>
    );
  }
  if (errored || !data) {
    return (
      <div className="pub" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>⚠️</div>
          <h1 style={{ fontFamily: "Oswald, sans-serif", fontSize: 24, color: "#ff7a7a", textTransform: "uppercase" }}>Portal unavailable</h1>
          <p style={{ color: "#8a8a99", fontSize: 15, marginTop: 8 }}>
            We couldn&apos;t load your data. <a href="/portal/login" style={{ color: "#7fb6ff" }}>Request a new link</a>.
          </p>
        </div>
      </div>
    );
  }

  const { customer, org } = data;
  const accent = org?.brand_color || PRIMARY;
  const greetName = (customer.primary_contact || customer.name || "").split(/\s+/)[0] || "there";

  const memberships = (data.memberships || []).filter((m) => m.status !== "cancelled");
  const quotesToReview = visibleJobs.filter((j) => j.status === "quoted" && !j.client_signature);
  const invoicesDue = visibleJobs.filter((j) => j.status === "invoiced");
  const isMember = memberships.some((m) => m.status === "active" || m.status === "past_due");
  const activeCount = visibleJobs.filter((j) => !["paid", "complete"].includes(j.status)).length;

  const summaryParts: string[] = [];
  if (quotesToReview.length) summaryParts.push(`${quotesToReview.length} quote${quotesToReview.length === 1 ? "" : "s"} to review`);
  if (invoicesDue.length) summaryParts.push(`${invoicesDue.length} invoice${invoicesDue.length === 1 ? "" : "s"} due`);
  if (isMember) summaryParts.push("member");
  const summary = summaryParts.join(" · ")
    || (activeCount > 0 ? `${activeCount} active job${activeCount === 1 ? "" : "s"}` : "You're all caught up");

  return (
    <div className="pub">
      <div className="pub-wrap" style={{ maxWidth: 600 }}>
        {/* Brand header */}
        <div className="bh">
          <div className="logo">
            {org?.logo_url
              ? <img src={org.logo_url} alt="" onError={(e) => ((e.target as HTMLImageElement).style.display = "none")} />
              : (org?.name?.[0]?.toUpperCase() || "C")}
          </div>
          <div className="nm">{org?.name || "Customer Portal"}</div>
          {org?.phone && (
            <div className="ph"><a href={`tel:${org.phone}`} style={{ color: "inherit", textDecoration: "none" }}>{org.phone}</a></div>
          )}
        </div>

        {/* Greeting + summary */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <span style={{ fontSize: 24 }}>👋</span>
          <div>
            <div style={{ fontFamily: "Oswald, sans-serif", fontWeight: 600, fontSize: 19 }}>Hi, {greetName}</div>
            <div className="muted" style={{ fontSize: 13 }}>{summary}</div>
          </div>
        </div>

        {/* THE one global Request Work button */}
        <a href="/portal/request" className="btn glow-blue" style={{ textDecoration: "none", marginBottom: 4 }}>
          <Icon name="add" size={17} /> Request Work
        </a>

        {joined && !isMember && (
          <div style={{ background: "rgba(0,204,102,.1)", border: "1px solid rgba(0,204,102,.5)", borderRadius: 12, padding: "10px 12px", fontSize: 13, color: "#7dffb8", margin: "10px 0 2px" }}>
            Thanks for joining! Your membership is activating — refresh in a minute if it doesn&apos;t appear below.
          </div>
        )}

        {/* Needs your attention */}
        {(quotesToReview.length > 0 || invoicesDue.length > 0) && (
          <>
            <SectionLabel icon="alert" tint="#ffce54">Needs your attention</SectionLabel>
            {quotesToReview.map((j) => <AttentionCard key={j.id} job={j} kind="quote" />)}
            {invoicesDue.map((j) => <AttentionCard key={j.id} job={j} kind="invoice" />)}
          </>
        )}

        {/* Your membership — active card(s) OR the join upsell; nothing if
            the org has no plans / no Stripe. */}
        <MembershipArea memberships={memberships} plans={data.plans || []} accent={accent} />

        {/* Your properties — one card per deduped address */}
        {groups.length > 0 && (
          <>
            <SectionLabel icon="home" tint={accent} count={groups.length}>Your properties</SectionLabel>
            {groups.map((g) => (
              <PropertyCard key={g.key} group={g} receipts={data.receipts} accent={accent} />
            ))}
          </>
        )}

        {/* Documents — global, across every property. Each row is a
            downloadable file (signed quote, job report, receipt). */}
        <DocumentsSection jobs={data.jobs} org={data.org} />

        {/* Project renderings — every photo across every job, surfaced
            as a thumbnail grid. These are the AI/inspection/work photos
            attached to the customer's jobs over time. */}
        <RenderingsSection jobs={data.jobs} />

        {/* Contact footer */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, fontSize: 13, color: "#9a9aa8", marginTop: 18, paddingTop: 14, borderTop: "1px solid #1e1e2e" }}>
          <Icon name="phone" size={14} color="#7fb6ff" />
          {org?.phone
            ? <span>Questions? <a href={`tel:${org.phone}`} style={{ color: "#7fb6ff", textDecoration: "none" }}>Call {org.phone}</a></span>
            : <span>Questions? Reach out any time.</span>}
        </div>
        <div style={{ textAlign: "center", color: "#555", fontSize: 13, marginTop: 10 }}>
          {org?.license_num && <div>License #{org.license_num}</div>}
          <div style={{ marginTop: 4 }}>Powered by Creed App</div>
        </div>
      </div>
    </div>
  );
}

/* ─── Section label (mock .sl) ─── */
function SectionLabel({ icon, tint, count, children }: {
  icon: string;
  tint?: string;
  count?: number;
  children: React.ReactNode;
}) {
  const c = tint || "#9a9aa8";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 7, fontFamily: "Oswald, sans-serif", fontWeight: 600, fontSize: 12, letterSpacing: ".1em", textTransform: "uppercase", color: c, margin: "18px 2px 9px" }}>
      <Icon name={icon} size={14} color={c} />
      {children}
      {count != null && (
        <span style={{ marginLeft: "auto", fontSize: 11, background: "#1c1c28", border: "1px solid #2a2a3a", padding: "1px 8px", borderRadius: 99, color: "#cfd2da" }}>
          {count}
        </span>
      )}
    </div>
  );
}

/* ─── Needs-attention cards ─── */
function AttentionCard({ job, kind }: { job: Job; kind: "quote" | "invoice" }) {
  const strip = kind === "quote" ? statusColor("quoted") : GOLD;
  const date = fmtDate(job.job_date) || fmtDate(job.created_at);
  return (
    <div style={{ position: "relative", background: "#12121a", border: "1px solid #1e1e2e", borderRadius: 14, padding: "12px 13px 12px 17px", marginBottom: 9, overflow: "hidden" }}>
      <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 4, background: strip, boxShadow: `0 0 10px 0 ${strip}` }} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: "Oswald, sans-serif", fontWeight: 600, fontSize: 15 }}>
            {kind === "invoice" ? "Invoice" : "Your quote"}{job.property ? ` · ${job.property}` : ""}
          </div>
          <div style={{ fontSize: 12.5, color: "#9a9aa8", marginTop: 2 }}>
            {kind === "quote" ? `Quoted ${date}` : `Due · issued ${date}`}
          </div>
        </div>
        {job.total > 0 && (
          <div style={{ fontFamily: "Oswald, sans-serif", fontWeight: 700, fontSize: 16, whiteSpace: "nowrap", color: kind === "quote" ? "#ff8a8a" : "#ffd76b" }}>
            {fmtMoney(job.total)}
          </div>
        )}
      </div>
      <a
        href={`/status?job=${job.id}`}
        className={`btn ${kind === "quote" ? "glow-green" : "glow-gold"}`}
        style={{ textDecoration: "none", marginTop: 10, padding: 10, fontSize: 13, borderRadius: 10 }}
      >
        <Icon name={kind === "quote" ? "edit" : "pay"} size={14} /> {kind === "quote" ? "Approve & Sign" : "Pay Invoice"}
      </a>
    </div>
  );
}

/* ─── Membership area ─── */
function MembershipArea({ memberships, plans, accent }: {
  memberships: PortalMembership[];
  plans: PortalPlan[];
  accent: string;
}) {
  const [list, setList] = useState(memberships);
  const onStatus = (id: string, status: string) =>
    setList((l) => status === "cancelled" ? l.filter((x) => x.id !== id) : l.map((x) => (x.id === id ? { ...x, status } : x)));

  if (list.length === 0) {
    if (plans.length === 0) return null;
    return (
      <>
        <SectionLabel icon="award" tint={accent}>Your membership</SectionLabel>
        {plans.map((p) => <JoinPlanCard key={p.id} plan={p} />)}
      </>
    );
  }
  return (
    <>
      <SectionLabel icon="award" tint={accent}>Your membership{list.length > 1 ? "s" : ""}</SectionLabel>
      {list.map((m) => <MembershipCard key={m.id} m={m} onStatus={onStatus} />)}
    </>
  );
}

const postJson = (path: string, body: object) =>
  fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

function MembershipCard({ m, onStatus }: { m: PortalMembership; onStatus: (id: string, status: string) => void }) {
  const [busy, setBusy] = useState<"" | "card" | "pause" | "cancel">("");
  const paused = m.status === "paused";
  const chip =
    m.status === "active" ? { bg: "rgba(0,204,102,.18)", c: "#3ee08f", label: "Active" }
    : m.status === "past_due" ? { bg: "rgba(245,180,0,.18)", c: "#ffd76b", label: "Past due" }
    : { bg: "#1c1c28", c: "#cfd2da", label: "Paused" };
  const perks = perkList(m.plan);
  const price = m.plan?.price != null ? `$${Number(m.plan.price).toFixed(0)}` : "";
  const priceLine = paused
    ? "Billing paused"
    : m.status === "past_due"
      ? "Payment past due — update your card"
      : price ? `${price} / ${intervalWord(m.plan?.interval)} · renews automatically` : "";

  const updateCard = async () => {
    setBusy("card");
    try {
      const res = await postJson("/api/portal/membership-card", { membershipId: m.id });
      const d = await res.json().catch(() => ({}));
      if (res.ok && d.url) { window.location.href = d.url; return; }
      window.alert(d?.error || "Couldn't open the card update page — please try again.");
    } catch { window.alert("Network error — please try again."); }
    setBusy("");
  };

  const pauseResume = async () => {
    const action = paused ? "resume" : "pause";
    if (!paused && !window.confirm("Pause your plan? Billing and service visits stop until you resume.")) return;
    setBusy("pause");
    try {
      const res = await postJson("/api/portal/membership-pause", { membershipId: m.id, action });
      if (res.ok) {
        onStatus(m.id, action === "pause" ? "paused" : "active");
      } else {
        const d = await res.json().catch(() => ({}));
        window.alert(d?.error || "Couldn't update the plan — please try again.");
      }
    } catch { window.alert("Network error — please try again."); }
    setBusy("");
  };

  const cancel = async () => {
    if (!window.confirm(`Cancel your ${m.plan?.name || "membership"}? Billing will stop and no more visits will be scheduled.`)) return;
    setBusy("cancel");
    try {
      const res = await postJson("/api/portal/membership-cancel", { membershipId: m.id });
      if (res.ok) { onStatus(m.id, "cancelled"); return; }
      const d = await res.json().catch(() => ({}));
      window.alert(d?.error || "Couldn't cancel — please try again or contact your provider.");
    } catch { window.alert("Network error — please try again."); }
    setBusy("");
  };

  const cellStyle: React.CSSProperties = { background: "rgba(0,0,0,.25)", border: "1px solid rgba(255,255,255,.06)", borderRadius: 10, padding: "8px 10px" };
  const cellLabel: React.CSSProperties = { fontSize: 9.5, letterSpacing: ".06em", textTransform: "uppercase", color: "#b9a6d6" };
  const cellValue: React.CSSProperties = { fontFamily: "Oswald, sans-serif", fontWeight: 600, fontSize: 14, marginTop: 2 };
  const btnStyle: React.CSSProperties = { flex: 1, textAlign: "center", fontFamily: "Oswald, sans-serif", fontWeight: 600, fontSize: 11.5, letterSpacing: ".03em", textTransform: "uppercase", padding: "9px 6px", borderRadius: 10, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 5 };

  return (
    <div style={{ borderRadius: 16, padding: 14, marginBottom: 10, position: "relative", overflow: "hidden", background: "linear-gradient(150deg, rgba(157,78,221,.2), rgba(46,117,182,.08))", border: "1px solid rgba(157,78,221,.4)", boxShadow: "0 0 24px -10px rgba(157,78,221,.6)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <div>
          <div style={{ fontFamily: "Oswald, sans-serif", fontWeight: 700, fontSize: 16 }}>{m.plan?.name || "Service plan"}</div>
          {priceLine && <div style={{ fontSize: 12, color: "#cdb6f0", marginTop: 1 }}>{priceLine}</div>}
        </div>
        <span style={{ fontSize: 10, fontWeight: 700, fontFamily: "Oswald, sans-serif", letterSpacing: ".05em", textTransform: "uppercase", padding: "3px 9px", borderRadius: 99, background: chip.bg, color: chip.c, flexShrink: 0 }}>
          {chip.label}
        </span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, margin: "12px 0" }}>
        <div style={cellStyle}>
          <div style={cellLabel}>Next visit</div>
          <div style={cellValue}>{paused ? "Paused" : fmtDate(m.next_visit_at) || "—"}</div>
        </div>
        <div style={cellStyle}>
          <div style={cellLabel}>Next bill</div>
          <div style={cellValue}>
            {paused ? "Paused" : fmtDate(m.next_bill_at) || "—"}
            {!paused && price && fmtDate(m.next_bill_at) && (
              <small style={{ fontFamily: "'Source Sans 3', sans-serif", fontWeight: 400, fontSize: 10.5, color: "#9a9aa8" }}> · {price}</small>
            )}
          </div>
        </div>
      </div>

      {perks.length > 0 && (
        <div style={{ margin: "8px 0 11px" }}>
          {perks.map((p, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "#e6dcf5", padding: "2px 0" }}>
              <Icon name="check" size={12} color="#d8b6ff" /> {p}
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={updateCard}
          disabled={busy !== ""}
          style={{ ...btnStyle, background: "rgba(46,117,182,.18)", border: "1px solid rgba(46,117,182,.7)", color: "#acd2ff", opacity: busy === "card" ? 0.6 : 1 }}
        >
          <Icon name="pay" size={12} color="#acd2ff" /> {busy === "card" ? "Opening…" : "Update card"}
        </button>
        <button
          onClick={pauseResume}
          disabled={busy !== ""}
          style={{ ...btnStyle, background: "#1c1c28", border: "1px solid #2a2a3a", color: "#cfd2da", opacity: busy === "pause" ? 0.6 : 1 }}
        >
          <Icon name={paused ? "start" : "pause"} size={12} color="#cfd2da" /> {busy === "pause" ? "Working…" : paused ? "Resume plan" : "Pause plan"}
        </button>
      </div>
      <button
        onClick={cancel}
        disabled={busy !== ""}
        style={{ display: "block", width: "100%", textAlign: "center", fontSize: 11.5, color: "#666", marginTop: 10, textDecoration: "underline", cursor: busy === "cancel" ? "wait" : "pointer", background: "none", border: "none", padding: 0, fontFamily: "inherit" }}
      >
        {busy === "cancel" ? "Cancelling…" : "Cancel membership"}
      </button>
    </div>
  );
}

function JoinPlanCard({ plan }: { plan: PortalPlan }) {
  const [busy, setBusy] = useState(false);
  const perks = perkList(plan);
  const join = async () => {
    setBusy(true);
    try {
      const res = await postJson("/api/portal/membership-checkout", { planId: plan.id });
      const d = await res.json().catch(() => ({}));
      if (res.ok && d.url) { window.location.href = d.url; return; }
      window.alert(d?.error || "Couldn't start checkout — please try again.");
    } catch { window.alert("Network error — please try again."); }
    setBusy(false);
  };
  return (
    <div style={{ borderRadius: 16, padding: 14, marginBottom: 10, border: "1.5px dashed rgba(157,78,221,.55)", background: "rgba(157,78,221,.07)" }}>
      <div style={{ fontFamily: "Oswald, sans-serif", fontWeight: 700, fontSize: 16 }}>Join the {plan.name || "Home Care Plan"}</div>
      <div style={{ fontSize: 12.5, color: "#cdb6f0", marginTop: 2 }}>
        {plan.price != null ? `$${Number(plan.price).toFixed(0)} / ${intervalWord(plan.interval)}` : ""} · cancel anytime
      </div>
      {perks.length > 0 && (
        <div style={{ margin: "9px 0 2px" }}>
          {perks.map((p, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "#e6dcf5", padding: "2px 0" }}>
              <Icon name="check" size={12} color="#d8b6ff" /> {p}
            </div>
          ))}
        </div>
      )}
      <button
        onClick={join}
        disabled={busy}
        className="btn"
        style={{ marginTop: 10, padding: 10, fontSize: 13, borderRadius: 10, background: "rgba(157,78,221,.16)", border: "1.5px solid rgba(157,78,221,.85)", color: "#d8b6ff", boxShadow: "0 0 18px -6px rgba(157,78,221,.6)" }}
      >
        <Icon name="sparkle" size={14} color="#d8b6ff" /> {busy ? "Opening…" : "Join now"}
      </button>
    </div>
  );
}

/* ─── Property cards ─── */
function PropertyCard({ group, receipts, accent }: { group: PropGroup; receipts: Receipt[]; accent: string }) {
  return (
    <div style={{ background: "#12121a", border: "1px solid #1e1e2e", borderRadius: 14, padding: "12px 13px", marginBottom: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <Icon name="pin" size={14} color={accent} />
        <span style={{ fontFamily: "Oswald, sans-serif", fontWeight: 600, fontSize: 14, letterSpacing: ".02em", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {group.display}
        </span>
        <span style={{ marginLeft: "auto", fontSize: 11, color: "#9a9aa8", flexShrink: 0 }}>
          {group.jobs.length} job{group.jobs.length === 1 ? "" : "s"}
        </span>
      </div>
      <div style={{ marginTop: 5 }}>
        {group.jobs.map((j, i) => (
          <JobRow key={j.id} job={j} first={i === 0} receiptCount={receipts.filter((r) => r.job_id === j.id).length} />
        ))}
        {group.jobs.length === 0 && (
          <div style={{ fontSize: 12.5, color: "#666", fontStyle: "italic", padding: "8px 0 2px" }}>No jobs here yet.</div>
        )}
      </div>
      <a
        href={group.addressId ? `/portal/request?address=${group.addressId}` : "/portal/request"}
        style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, color: "#7fb6ff", marginTop: 9, fontWeight: 600, textDecoration: "none" }}
      >
        <Icon name="add" size={12} color="#7fb6ff" /> Request work here
      </a>
    </div>
  );
}

function JobRow({ job, first, receiptCount }: { job: Job; first: boolean; receiptCount: number }) {
  const c = statusColor(job.status);
  const title = job.trade || (job.status === "lead" ? "Work request" : "Job");
  const sub = [
    fmtDate(job.job_date) || fmtDate(job.created_at),
    job.total > 0 ? fmtMoney(job.total) : "",
    receiptCount > 0 ? `${receiptCount} receipt${receiptCount === 1 ? "" : "s"}` : "",
  ].filter(Boolean).join(" · ");
  return (
    <a
      href={`/status?job=${job.id}`}
      style={{ display: "flex", alignItems: "center", gap: 9, padding: "9px 0", borderTop: first ? "none" : "1px solid #1e1e2e", textDecoration: "none", color: "inherit" }}
    >
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: c, boxShadow: `0 0 7px 0 ${c}`, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</div>
        <div style={{ fontSize: 11.5, color: "#9a9aa8" }}>{sub}</div>
      </div>
      <span className="chip" style={{ background: `${c}22`, color: c, flexShrink: 0 }}>
        {STATUS_LABEL[job.status] || job.status}
      </span>
    </a>
  );
}

/* ─── Documents ─────────────────────────────────────────────────────
 *
 * One row per downloadable file across every job. Quote and Job Report
 * regenerate the same print-ready PDF the contractor uses internally
 * (no separate PDF storage — these files are template-driven). Receipts
 * link to the existing /status page since that's where the signed
 * approval, payment record, and worklist already live.
 */
type DocRow = {
  id: string;
  type: "quote" | "report" | "receipt";
  label: string;
  date: string;
  job: Job;
  total: number;
};

function buildDocRows(jobs: Job[]): DocRow[] {
  const rows: DocRow[] = [];
  for (const job of jobs) {
    const dateBase =
      job.signature_date ||
      job.approved_at?.split("T")[0] ||
      job.job_date ||
      (job.created_at || "").split("T")[0] ||
      "";

    // Quote PDF — surfaced for any job past the lead stage. The signed
    // version is implied when approved_at / client_signature is set; we
    // label the row that way so the customer knows it's the executed
    // copy, not a draft estimate.
    if (job.status !== "lead" && (job.total > 0 || job.client_signature || job.approved_at)) {
      const signed = !!(job.approved_at || job.client_signature);
      rows.push({
        id: `${job.id}:quote`,
        type: "quote",
        label: signed ? "Signed Quote" : "Estimate / Quote",
        date: dateBase,
        job,
        total: job.total || 0,
      });
    }

    // Job report — once work is complete or beyond.
    if (["complete", "invoiced", "paid"].includes(job.status)) {
      rows.push({
        id: `${job.id}:report`,
        type: "report",
        label: "Job Completion Report",
        date: dateBase,
        job,
        total: job.total || 0,
      });
    }

    // Receipt / invoice — paid jobs link to /status (which renders the
    // amount, paid date, and signed work order). Invoiced-but-unpaid
    // jobs still get a row so the customer can find the invoice without
    // hunting through Jobs.
    if (job.status === "paid" || job.status === "invoiced") {
      rows.push({
        id: `${job.id}:receipt`,
        type: "receipt",
        label: job.status === "paid" ? "Receipt" : "Invoice",
        date: dateBase,
        job,
        total: job.total || 0,
      });
    }
  }
  rows.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  return rows;
}

function DocumentsSection({ jobs, org }: { jobs: Job[]; org: PortalOrg | null }) {
  const rows = useMemo(() => buildDocRows(jobs), [jobs]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const clearBusy = () => setTimeout(() => setBusyId(null), 1200);

  if (rows.length === 0) return null;

  const openQuote = (doc: DocRow) => {
    setBusyId(doc.id);
    // Shared builder (src/lib/quote-pdf.ts) — same estimate the status page
    // serves, so portal + status can't drift on pricing.
    openJobQuotePdf(doc.job, org);
    clearBusy();
  };

  const openReport = (doc: DocRow) => {
    const job = doc.job;
    let workerNames: string[] = [];
    try {
      const data = typeof job.rooms === "string" ? JSON.parse(job.rooms) : job.rooms;
      workerNames = (data?.workers || [])
        .map((w: { name?: string }) => w?.name || "")
        .filter(Boolean);
    } catch { /* */ }
    setBusyId(doc.id);
    exportJobReport({
      job,
      orgName: org?.name || "",
      orgPhone: org?.phone || "",
      orgEmail: org?.email || "",
      orgLicense: org?.license_num || "",
      orgAddress: org?.address || "",
      orgLogo: org?.logo_url,
      accent: org?.brand_color,
      accent2: org?.brand_color_2,
      workerNames,
    });
    clearBusy();
  };

  return (
    <div style={{ background: "#12121a", border: "1px solid #1e1e2e", borderRadius: 12, padding: 16, margin: "18px 0 16px" }}>
      <h3 style={{ fontFamily: "Oswald, sans-serif", fontSize: 14, color: PRIMARY, textTransform: "uppercase", letterSpacing: ".08em", margin: "0 0 4px" }}>
        📄 Documents
      </h3>
      <div style={{ fontSize: 13, color: "#666", marginBottom: 10 }}>
        Tap a row to open a printable PDF. Use your browser to save or share.
      </div>
      <div style={{ background: "#0a0a0f", border: "1px solid #1e1e2e", borderRadius: 8, overflow: "hidden" }}>
        {rows.map((row, i) => {
          const busy = busyId === row.id;
          const tint =
            row.type === "quote" ? PRIMARY :
            row.type === "report" ? "#00cc66" :
            "#9b59b6";
          const icon = row.type === "quote" ? "📄" : row.type === "report" ? "📋" : "🧾";
          return (
            <div
              key={row.id}
              style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "10px 12px",
                borderTop: i === 0 ? "none" : "1px solid #1e1e2e",
              }}
            >
              <div style={{
                width: 32, height: 32, borderRadius: 6,
                background: tint + "22", color: tint,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 16, flexShrink: 0,
              }}>
                {icon}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, color: "#e2e2e8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {row.label} — {row.job.property || "(no address)"}
                </div>
                <div style={{ fontSize: 13, color: "#666" }}>
                  PDF · {row.date}
                  {row.total > 0 && row.type !== "report" ? ` · ${fmtMoney(row.total)}` : ""}
                </div>
              </div>
              {row.type === "quote" && (
                <button
                  onClick={() => openQuote(row)}
                  disabled={busy}
                  style={{
                    flexShrink: 0,
                    padding: "5px 12px", borderRadius: 6,
                    border: `1px solid ${tint}`, background: "transparent",
                    color: tint, fontSize: 13, fontFamily: "Oswald, sans-serif",
                    textTransform: "uppercase", letterSpacing: ".06em",
                    cursor: busy ? "wait" : "pointer", opacity: busy ? 0.5 : 1,
                  }}
                >
                  {busy ? "Opening…" : "View"}
                </button>
              )}
              {row.type === "report" && (
                <button
                  onClick={() => openReport(row)}
                  disabled={busy}
                  style={{
                    flexShrink: 0,
                    padding: "5px 12px", borderRadius: 6,
                    border: `1px solid ${tint}`, background: "transparent",
                    color: tint, fontSize: 13, fontFamily: "Oswald, sans-serif",
                    textTransform: "uppercase", letterSpacing: ".06em",
                    cursor: busy ? "wait" : "pointer", opacity: busy ? 0.5 : 1,
                  }}
                >
                  {busy ? "Opening…" : "View"}
                </button>
              )}
              {row.type === "receipt" && (
                <a
                  href={`/status?job=${row.job.id}`}
                  style={{
                    flexShrink: 0,
                    padding: "5px 12px", borderRadius: 6,
                    border: `1px solid ${tint}`, background: "transparent",
                    color: tint, fontSize: 13, fontFamily: "Oswald, sans-serif",
                    textTransform: "uppercase", letterSpacing: ".06em",
                    textDecoration: "none",
                  }}
                >
                  Open
                </a>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RenderingsSection({ jobs }: { jobs: Job[] }) {
  // Project photos across every job. We treat them all as "renderings"
  // here since to the customer they're all images of their property.
  // We keep the per-job grouping so they can tell which property a
  // shot belongs to when there are multiple.
  const groups = useMemo(() => {
    const out: { jobId: string; property: string; photos: { url: string; type: string; label?: string }[] }[] = [];
    for (const j of jobs) {
      const ps = extractPhotos(j);
      if (ps.length) out.push({ jobId: j.id, property: j.property || "(no address)", photos: ps });
    }
    return out;
  }, [jobs]);

  if (groups.length === 0) return null;

  return (
    <div style={{ background: "#12121a", border: "1px solid #1e1e2e", borderRadius: 12, padding: 16, marginBottom: 16 }}>
      <h3 style={{ fontFamily: "Oswald, sans-serif", fontSize: 14, color: PRIMARY, textTransform: "uppercase", letterSpacing: ".08em", margin: "0 0 4px" }}>
        🖼 Project Renderings
      </h3>
      <div style={{ fontSize: 13, color: "#666", marginBottom: 10 }}>
        Photos from inspections, work-in-progress, and finished jobs. Tap any image to open it full-size.
      </div>
      {groups.map((g) => (
        <div key={g.jobId} style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 13, color: "#888", fontFamily: "Oswald, sans-serif", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 6 }}>
            {g.property}
            <span style={{ color: "#555", marginLeft: 6 }}>· {g.photos.length} photo{g.photos.length === 1 ? "" : "s"}</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(90px, 1fr))", gap: 6 }}>
            {g.photos.map((p, i) => (
              <a
                key={i}
                href={p.url}
                target="_blank"
                rel="noopener noreferrer"
                title={p.label || p.type || ""}
                style={{ display: "block", borderRadius: 6, overflow: "hidden", border: "1px solid #1e1e2e", aspectRatio: "1", position: "relative" }}
              >
                <img
                  src={p.url}
                  alt={p.label || ""}
                  style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                  onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
                />
                {(p.label || p.type) && (
                  <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: "10px 4px 3px", background: "linear-gradient(transparent, rgba(0,0,0,.85))", fontSize: 12, color: "#ddd", textAlign: "center" }}>
                    {p.label || p.type}
                  </div>
                )}
              </a>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
