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
import type { Customer, Address, Job, Receipt, Organization } from "@/lib/types";

const PRIMARY = "#2E75B6";

interface PortalData {
  customer: Customer;
  addresses: Address[];
  jobs: Job[];
  receipts: Receipt[];
  org: Pick<Organization, "id" | "name" | "phone" | "email" | "logo_url" | "address" | "license_num"> | null;
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
