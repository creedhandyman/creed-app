"use client";
/**
 * Customer portal landing page. Reads /api/portal/me on mount; if no
 * session, redirects to /portal/login. Otherwise renders a dark-themed
 * dashboard that mirrors /status, /review, /lead/<slug> styling:
 *  - greeting + branded header
 *  - per-property tile when the customer is a property manager (or has
 *    multiple addresses); flat sections otherwise
 *  - open quotes (with Approve link to /status?job=...)
 *  - scheduled jobs
 *  - in-progress jobs
 *  - completed jobs (with photo grid)
 *  - documents (signed quotes, invoices, paid receipts)
 *  - "Request work" CTA at top of every property/section
 *
 * No app-shell chrome — this is a public, mobile-first page.
 */
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Customer, Address, Job, Receipt, Organization, Room } from "@/lib/types";
import { exportQuotePdf } from "@/lib/export-pdf";
import { exportJobReport } from "@/lib/export-job-report";

const PRIMARY = "#2E75B6";

type PortalOrg = Pick<
  Organization,
  | "id" | "name" | "phone" | "email" | "logo_url" | "address" | "license_num"
  | "default_rate" | "markup_pct" | "tax_pct" | "trip_fee"
>;

interface PortalData {
  customer: Customer;
  addresses: Address[];
  jobs: Job[];
  receipts: Receipt[];
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
const STATUS_COLOR: Record<string, string> = {
  lead: "#888",
  quoted: "#C00000",
  accepted: "#ff8800",
  scheduled: "#ffcc00",
  active: "#00cc66",
  complete: PRIMARY,
  invoiced: "#5a5af0",
  paid: "#9b59b6",
  inspection: "#888",
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

export default function PortalPage() {
  const router = useRouter();
  const [data, setData] = useState<PortalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [errored, setErrored] = useState(false);

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

  const groups = useMemo(() => {
    if (!data) return null;
    const isPM = data.customer.type === "property_manager" || data.addresses.length > 1;
    if (!isPM) {
      return { byProperty: false as const, all: data.jobs };
    }
    // Bucket jobs by address_id (preferred) then by property string.
    const buckets = new Map<string, Job[]>();
    for (const a of data.addresses) buckets.set(a.id, []);
    const noAddr: Job[] = [];
    for (const j of data.jobs) {
      if (j.address_id && buckets.has(j.address_id)) {
        buckets.get(j.address_id)!.push(j);
      } else {
        noAddr.push(j);
      }
    }
    return {
      byProperty: true as const,
      addresses: data.addresses,
      buckets,
      noAddr,
    };
  }, [data]);

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", background: "#0a0a0f", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ color: PRIMARY, fontFamily: "Oswald, sans-serif", fontSize: 18 }}>Loading…</div>
      </div>
    );
  }
  if (errored || !data) {
    return (
      <div style={{ minHeight: "100vh", background: "linear-gradient(135deg, #0a0a0f, #0d1530)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>⚠️</div>
          <h1 style={{ fontFamily: "Oswald, sans-serif", fontSize: 22, color: "#C00000" }}>Portal unavailable</h1>
          <p style={{ color: "#888", fontSize: 13, marginTop: 8 }}>
            We couldn&apos;t load your data. <a href="/portal/login" style={{ color: PRIMARY }}>Request a new link</a>.
          </p>
        </div>
      </div>
    );
  }

  const { customer, org } = data;
  const greetName = (customer.primary_contact || customer.name || "").split(/\s+/)[0] || "there";

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(135deg, #0a0a0f, #0d1530)", padding: "24px 16px 60px", color: "#e2e2e8" }}>
      <div style={{ maxWidth: 640, margin: "0 auto" }}>
        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: 22 }}>
          {org?.logo_url && (
            <img
              src={org.logo_url}
              alt=""
              style={{ height: 56, display: "block", margin: "0 auto 10px" }}
              onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
            />
          )}
          <h1 style={{ fontFamily: "Oswald, sans-serif", fontSize: 22, color: PRIMARY, textTransform: "uppercase", letterSpacing: ".05em", margin: 0 }}>
            {org?.name || "Customer Portal"}
          </h1>
          {org?.phone && (
            <div style={{ fontSize: 12, color: "#666", marginTop: 4 }}>
              <a href={`tel:${org.phone}`} style={{ color: "#888", textDecoration: "none" }}>{org.phone}</a>
            </div>
          )}
        </div>

        {/* Greeting */}
        <div style={{ background: "#12121a", border: "1px solid #1e1e2e", borderRadius: 12, padding: 18, marginBottom: 16 }}>
          <h2 style={{ fontFamily: "Oswald, sans-serif", fontSize: 18, color: "#e2e2e8", margin: 0 }}>
            Hi {greetName} 👋
          </h2>
          <p style={{ color: "#888", fontSize: 13, margin: "6px 0 0" }}>
            Welcome to your portal. Track open quotes, scheduled work, completed jobs, and request something new.
          </p>
        </div>

        {/* Top-level Request work CTA */}
        <RequestWorkButton />

        {groups?.byProperty ? (
          <>
            {groups.addresses.map((a) => (
              <PropertySection
                key={a.id}
                address={a}
                jobs={groups.buckets.get(a.id) || []}
                receipts={data.receipts}
              />
            ))}
            {groups.noAddr.length > 0 && (
              <PropertySection
                address={null}
                jobs={groups.noAddr}
                receipts={data.receipts}
              />
            )}
          </>
        ) : (
          <FlatSections jobs={data.jobs} receipts={data.receipts} />
        )}

        {/* Documents — global, across every property. Each row is a
            downloadable file (signed quote, job report, receipt). */}
        <DocumentsSection jobs={data.jobs} org={data.org} />

        {/* Project renderings — every photo across every job, surfaced
            as a thumbnail grid. These are the AI/inspection/work photos
            attached to the customer's jobs over time. */}
        <RenderingsSection jobs={data.jobs} />

        {/* Footer */}
        <div style={{ textAlign: "center", color: "#555", fontSize: 11, marginTop: 24 }}>
          {org?.license_num && <div>License #{org.license_num}</div>}
          <div style={{ marginTop: 4 }}>Powered by Creed App</div>
        </div>
      </div>
    </div>
  );
}

function RequestWorkButton({ addressId }: { addressId?: string }) {
  const href = addressId ? `/portal/request?address=${addressId}` : "/portal/request";
  return (
    <a
      href={href}
      style={{
        display: "block", textAlign: "center",
        padding: "12px", borderRadius: 8, marginBottom: 16,
        background: PRIMARY, color: "#fff",
        fontFamily: "Oswald, sans-serif", fontSize: 14,
        textTransform: "uppercase", letterSpacing: ".05em",
        textDecoration: "none",
      }}
    >
      ＋ Request Work
    </a>
  );
}

function PropertySection({
  address,
  jobs,
  receipts,
}: {
  address: Address | null;
  jobs: Job[];
  receipts: Receipt[];
}) {
  return (
    <div
      style={{
        background: "#12121a",
        border: "1px solid #1e1e2e",
        borderRadius: 12,
        padding: 16,
        marginBottom: 16,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <h3 style={{ fontFamily: "Oswald, sans-serif", fontSize: 15, color: PRIMARY, margin: 0, textTransform: "uppercase", letterSpacing: ".04em" }}>
          📍 {address ? formatAddress(address) : "Other"}
        </h3>
        <span style={{ fontSize: 11, color: "#666" }}>
          {jobs.length} {jobs.length === 1 ? "job" : "jobs"}
        </span>
      </div>

      {address && <RequestWorkButton addressId={address.id} />}
      <FlatSections jobs={jobs} receipts={receipts} compact />
    </div>
  );
}

function FlatSections({ jobs, receipts, compact }: { jobs: Job[]; receipts: Receipt[]; compact?: boolean }) {
  const open = jobs.filter((j) => j.status === "quoted" || j.status === "lead");
  const upcoming = jobs.filter((j) => j.status === "accepted" || j.status === "scheduled");
  const inProgress = jobs.filter((j) => j.status === "active");
  const done = jobs.filter((j) => j.status === "complete");
  const invoiced = jobs.filter((j) => j.status === "invoiced" || j.status === "paid");

  if (jobs.length === 0) {
    return (
      <p style={{ color: "#666", fontSize: 12, fontStyle: "italic", margin: compact ? "0" : "10px 0" }}>
        Nothing here yet.
      </p>
    );
  }

  return (
    <div>
      {open.length > 0 && (
        <Section title="Open quotes" tint="#C00000">
          {open.map((j) => <QuoteCard key={j.id} job={j} />)}
        </Section>
      )}
      {upcoming.length > 0 && (
        <Section title="Scheduled" tint="#ffcc00">
          {upcoming.map((j) => <ScheduledCard key={j.id} job={j} />)}
        </Section>
      )}
      {inProgress.length > 0 && (
        <Section title="In progress" tint="#00cc66">
          {inProgress.map((j) => <ScheduledCard key={j.id} job={j} />)}
        </Section>
      )}
      {done.length > 0 && (
        <Section title="Recently completed" tint={PRIMARY}>
          {done.map((j) => <CompletedCard key={j.id} job={j} />)}
        </Section>
      )}
      {invoiced.length > 0 && (
        <Section title="Invoices & receipts" tint="#9b59b6">
          {invoiced.map((j) => <InvoiceCard key={j.id} job={j} receipts={receipts.filter((r) => r.job_id === j.id)} />)}
        </Section>
      )}
    </div>
  );
}

function Section({ title, tint, children }: { title: string; tint: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <h4
        style={{
          fontFamily: "Oswald, sans-serif", fontSize: 11,
          color: tint, textTransform: "uppercase", letterSpacing: ".08em",
          margin: "0 0 6px",
        }}
      >
        {title}
      </h4>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{children}</div>
    </div>
  );
}

function statusBadge(status: string) {
  const color = STATUS_COLOR[status] || "#888";
  return (
    <span
      style={{
        fontSize: 10, fontFamily: "Oswald, sans-serif", letterSpacing: ".06em",
        padding: "2px 7px", borderRadius: 10, textTransform: "uppercase",
        background: `${color}22`, color,
      }}
    >
      {STATUS_LABEL[status] || status}
    </span>
  );
}

function QuoteCard({ job }: { job: Job }) {
  return (
    <a
      href={`/status?job=${job.id}`}
      style={{
        display: "block",
        background: "#0a0a0f", border: "1px solid #1e1e2e",
        borderRadius: 8, padding: 12, textDecoration: "none", color: "inherit",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <b style={{ fontSize: 13 }}>{job.property || "(address pending)"}</b>
        {statusBadge(job.status)}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12 }}>
        <span style={{ color: "#888" }}>{fmtDate(job.job_date) || fmtDate(job.created_at)}</span>
        {job.total > 0 && <b style={{ color: "#00cc66" }}>{fmtMoney(job.total)}</b>}
      </div>
      <div style={{ fontSize: 11, color: PRIMARY, marginTop: 6 }}>
        {job.client_signature ? "View status" : "Approve & sign →"}
      </div>
    </a>
  );
}

function ScheduledCard({ job }: { job: Job }) {
  let note = "";
  try {
    const data = typeof job.rooms === "string" ? JSON.parse(job.rooms) : job.rooms;
    note = data?.scheduleNote || data?.notes || "";
  } catch { /* no note */ }
  return (
    <a
      href={`/status?job=${job.id}`}
      style={{
        display: "block",
        background: "#0a0a0f", border: "1px solid #1e1e2e",
        borderRadius: 8, padding: 12, textDecoration: "none", color: "inherit",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <b style={{ fontSize: 13 }}>{job.property || "(address pending)"}</b>
        {statusBadge(job.status)}
      </div>
      <div style={{ fontSize: 12, color: "#888" }}>
        {fmtDate(job.job_date) || fmtDate(job.created_at)}
        {job.requested_tech && <> · 👷 {job.requested_tech}</>}
      </div>
      {note && (
        <div style={{ fontSize: 12, color: "#bbb", marginTop: 6, fontStyle: "italic" }}>
          {note}
        </div>
      )}
      <div style={{ fontSize: 11, color: PRIMARY, marginTop: 6 }}>View status →</div>
    </a>
  );
}

function CompletedCard({ job }: { job: Job }) {
  const photos = extractPhotos(job);
  const beforePhotos = photos.filter((p) => p.type === "before");
  const afterPhotos = photos.filter((p) => p.type === "after");
  const otherPhotos = photos.filter((p) => p.type !== "before" && p.type !== "after");
  return (
    <div
      style={{
        background: "#0a0a0f", border: "1px solid #1e1e2e",
        borderRadius: 8, padding: 12,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <b style={{ fontSize: 13 }}>{job.property || "(address pending)"}</b>
        {statusBadge(job.status)}
      </div>
      <div style={{ fontSize: 12, color: "#888", marginBottom: 8 }}>
        {fmtDate(job.job_date) || fmtDate(job.created_at)}
        {job.trade && <> · {job.trade}</>}
      </div>
      {beforePhotos.length > 0 && <PhotoStrip label="Before" photos={beforePhotos} />}
      {afterPhotos.length > 0 && <PhotoStrip label="After" photos={afterPhotos} />}
      {beforePhotos.length === 0 && afterPhotos.length === 0 && otherPhotos.length > 0 && (
        <PhotoStrip label="Photos" photos={otherPhotos} />
      )}
      <a
        href={`/status?job=${job.id}`}
        style={{ fontSize: 11, color: PRIMARY, textDecoration: "none", display: "inline-block", marginTop: 6 }}
      >
        View details →
      </a>
    </div>
  );
}

function PhotoStrip({ label, photos }: { label: string; photos: { url: string; label?: string }[] }) {
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ fontSize: 10, color: "#666", fontFamily: "Oswald, sans-serif", letterSpacing: ".06em", textTransform: "uppercase", marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(80px, 1fr))", gap: 4 }}>
        {photos.slice(0, 6).map((p, i) => (
          <a key={i} href={p.url} target="_blank" rel="noopener noreferrer" style={{ display: "block" }}>
            <img
              src={p.url}
              alt={p.label || ""}
              style={{ width: "100%", height: 70, objectFit: "cover", borderRadius: 6, border: "1px solid #1e1e2e", display: "block" }}
              onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
            />
          </a>
        ))}
      </div>
    </div>
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
    const job = doc.job;
    let rooms: Room[] = [];
    let workers: { id: string; name: string }[] = [];
    let photos: { url: string; label: string; type: string }[] = [];
    try {
      const data = typeof job.rooms === "string" ? JSON.parse(job.rooms) : job.rooms;
      rooms = (data?.rooms || []) as Room[];
      workers = (data?.workers || []).map((w: { id?: string; name?: string }) => ({
        id: w.id || "",
        name: w.name || "",
      }));
      photos = (data?.photos || []).map((p: { url?: string; label?: string; type?: string }) => ({
        url: p.url || "",
        label: p.label || "",
        type: p.type || "",
      }));
    } catch { /* malformed rooms — render with defaults */ }

    setBusyId(doc.id);
    exportQuotePdf({
      property: job.property,
      client: job.client,
      rooms,
      rate: org?.default_rate || 55,
      workers,
      grandTotal: job.total || 0,
      totalLabor: job.total_labor || 0,
      totalMat: job.total_mat || 0,
      totalHrs: job.total_hrs || 0,
      trade: job.trade,
      jobId: job.id,
      orgName: org?.name,
      orgPhone: org?.phone,
      orgEmail: org?.email,
      orgLicense: org?.license_num,
      orgAddress: org?.address,
      orgLogo: org?.logo_url,
      photos,
      markupPct: org?.markup_pct,
      taxPct: org?.tax_pct,
      tripFee: org?.trip_fee,
      statusUrl: typeof window !== "undefined" ? `${window.location.origin}/status?job=${job.id}` : "",
    });
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
      workerNames,
    });
    clearBusy();
  };

  return (
    <div style={{ background: "#12121a", border: "1px solid #1e1e2e", borderRadius: 12, padding: 16, marginBottom: 16 }}>
      <h3 style={{ fontFamily: "Oswald, sans-serif", fontSize: 12, color: PRIMARY, textTransform: "uppercase", letterSpacing: ".08em", margin: "0 0 4px" }}>
        📄 Documents
      </h3>
      <div style={{ fontSize: 11, color: "#666", marginBottom: 10 }}>
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
                fontSize: 14, flexShrink: 0,
              }}>
                {icon}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, color: "#e2e2e8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {row.label} — {row.job.property || "(no address)"}
                </div>
                <div style={{ fontSize: 11, color: "#666" }}>
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
                    color: tint, fontSize: 11, fontFamily: "Oswald, sans-serif",
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
                    color: tint, fontSize: 11, fontFamily: "Oswald, sans-serif",
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
                    color: tint, fontSize: 11, fontFamily: "Oswald, sans-serif",
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
      <h3 style={{ fontFamily: "Oswald, sans-serif", fontSize: 12, color: PRIMARY, textTransform: "uppercase", letterSpacing: ".08em", margin: "0 0 4px" }}>
        🖼 Project Renderings
      </h3>
      <div style={{ fontSize: 11, color: "#666", marginBottom: 10 }}>
        Photos from inspections, work-in-progress, and finished jobs. Tap any image to open it full-size.
      </div>
      {groups.map((g) => (
        <div key={g.jobId} style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: "#888", fontFamily: "Oswald, sans-serif", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 6 }}>
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
                  <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: "10px 4px 3px", background: "linear-gradient(transparent, rgba(0,0,0,.85))", fontSize: 10, color: "#ddd", textAlign: "center" }}>
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

function InvoiceCard({ job, receipts }: { job: Job; receipts: Receipt[] }) {
  return (
    <a
      href={`/status?job=${job.id}`}
      style={{
        display: "block",
        background: "#0a0a0f", border: "1px solid #1e1e2e",
        borderRadius: 8, padding: 12, textDecoration: "none", color: "inherit",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <b style={{ fontSize: 13 }}>{job.property || "(address pending)"}</b>
        {statusBadge(job.status)}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12 }}>
        <span style={{ color: "#888" }}>{fmtDate(job.job_date) || fmtDate(job.created_at)}</span>
        {job.total > 0 && (
          <b style={{ color: job.status === "paid" ? "#9b59b6" : "#00cc66" }}>{fmtMoney(job.total)}</b>
        )}
      </div>
      {receipts.length > 0 && (
        <div style={{ fontSize: 11, color: "#666", marginTop: 4 }}>
          {receipts.length} receipt{receipts.length === 1 ? "" : "s"} on file
        </div>
      )}
      <div style={{ fontSize: 11, color: PRIMARY, marginTop: 6 }}>
        {job.status === "paid" ? "View paid invoice →" : "Pay invoice →"}
      </div>
    </a>
  );
}
