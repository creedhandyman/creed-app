"use client";
import { useState, useRef, useEffect, useMemo } from "react";
import { useStore } from "@/lib/store";
import { db, supabase } from "@/lib/supabase";
import { exportJobReport } from "@/lib/export-job-report";
import { QRCodeSVG } from "qrcode.react";
import type { Job } from "@/lib/types";
import { t } from "@/lib/i18n";
import { statusColor } from "@/lib/status";
import { extractZip } from "@/lib/parser";
import { Icon } from "../Icon";
import PropertySearch from "../PropertySearch";
import ReviewRequestModal from "../ReviewRequestModal";
import SmsNotifyButtons from "../SmsNotifyButtons";
import { wrapPrint, openPrint } from "@/lib/print-template";
import {
  CADENCES,
  CADENCE_LABELS,
  DAY_OF_WEEK_LABELS,
  computeNextFire,
  formatNextFire,
  type Cadence,
} from "@/lib/recurring";

interface Props {
  setPage: (p: string) => void;
  onEditJob?: (jobId: string) => void;
  onScheduleJob?: (jobName: string) => void;
}

export default function Jobs({ setPage, onEditJob, onScheduleJob }: Props) {
  const user = useStore((s) => s.user)!;
  const org = useStore((s) => s.org);
  const profiles = useStore((s) => s.profiles);
  const jobs = useStore((s) => s.jobs);
  const receipts = useStore((s) => s.receipts);
  const timeEntries = useStore((s) => s.timeEntries);
  const payHistory = useStore((s) => s.payHistory);
  const reviewRequests = useStore((s) => s.reviewRequests);
  const loadAll = useStore((s) => s.loadAll);
  const darkMode = useStore((s) => s.darkMode);

  // Serialize all `rooms` blob mutations on this screen — checkbox toggles,
  // after-photo uploads — so two quick taps can't race and clobber each
  // other (the bug Bernard hit where checked items kept un-checking).
  const roomsQueue = useRef<Promise<void>>(Promise.resolve());
  const enqueueRoomsWrite = (task: () => Promise<void>) => {
    roomsQueue.current = roomsQueue.current.then(task).catch((err) => {
      console.warn("[Jobs] rooms write failed:", err);
    });
    return roomsQueue.current;
  };
  const woStableKey = (w: { room?: string; detail?: string }) =>
    `${(w.room || "").toLowerCase().trim()}|||${(w.detail || "").toLowerCase().trim()}`;

  // ── Historical labor reconstruction ────────────────────────────────
  // Pre-c99d286, Payroll did `db.del("time_entries", id)` instead of
  // patching paid_at, so any job paid out before that fix has its
  // time_entries physically gone from Supabase — and Jobs' "actual
  // hours" stat went blank for those jobs.
  //
  // pay_history.details (JSON) preserved per-job hours per pay run, so
  // we can recover the totals (not the individual sessions). Build a
  // {job → {userKey → {hrs, cost}}} map from pay_history once per
  // payHistory change so each getJobLabor call is O(users-on-job).
  //
  // De-dup vs live time_entries: post-fix payruns DO leave time_entries
  // (with paid_at set), so for those (user, job) pairs we'd otherwise
  // double-count. We only "recover" the gap — max(0, historical -
  // live_paid) — so post-fix runs contribute zero recovery and pre-fix
  // runs contribute the full deleted amount.
  const userKey = (uid: string | undefined, name: string | undefined) =>
    (uid && uid.length > 0) ? uid : (name ? `name:${name}` : "unknown");

  const historicalByJobByUser = useMemo(() => {
    const out: Record<string, Record<string, { name: string; hrs: number; cost: number }>> = {};
    for (const ph of payHistory) {
      let details: { jobs?: { job?: string; hrs?: number; amount?: number }[] } = {};
      try { details = ph.details ? JSON.parse(ph.details) : {}; } catch { /* */ }
      if (!details.jobs) continue;
      const uid = userKey(ph.user_id, ph.name);
      for (const dj of details.jobs) {
        if (!dj.job) continue;
        if (!out[dj.job]) out[dj.job] = {};
        if (!out[dj.job][uid]) out[dj.job][uid] = { name: ph.name || "Unknown", hrs: 0, cost: 0 };
        out[dj.job][uid].hrs += dj.hrs || 0;
        out[dj.job][uid].cost += dj.amount || 0;
      }
    }
    return out;
  }, [payHistory]);

  // Aggregate actual labor logged for a job — sums time_entries that match
  // the job AND adds back any deleted-but-paid hours recovered from
  // pay_history. Used in the Hours card and the Time Logged breakdown so
  // quotes can be compared to reality and the AI can learn.
  //
  // Disambiguation when two jobs share an address (Bernard hit this on a
  // 1436 N Piet callback): time_entries.job_id (added 2026-04) is the
  // authoritative key. For entries that have it, only the matching job
  // gets credit. Legacy entries (no job_id, pre-migration) fall back to
  // address-match — but we only attribute them to the OLDEST job at that
  // address so a second job at the same property starts clean instead of
  // inheriting the prior job's history.
  const getJobLabor = (thisJob: Job) => {
    const jobProp = thisJob.property;
    const sameAddressJobs = jobs.filter((j) => j.property === jobProp);
    const isOldestAtAddress = sameAddressJobs.every(
      (j) => (thisJob.created_at || "") <= (j.created_at || ""),
    );
    const entries = timeEntries.filter((e) => {
      if ((e.hours || 0) <= 0) return false;
      if (e.job_id) return e.job_id === thisJob.id;
      // Legacy row with no job_id — only credit the oldest job at the address.
      return e.job === jobProp && isOldestAtAddress;
    });
    const loggedHrs = entries.reduce((s, e) => s + (e.hours || 0), 0);
    const loggedCost = entries.reduce((s, e) => s + (e.amount || 0), 0);

    // Live-paid totals per user (post-fix payruns where rows are kept).
    // These are already in `loggedHrs` — we use them only to compute the
    // gap, NOT to add again.
    const livePaidByUser: Record<string, { hrs: number; cost: number }> = {};
    for (const e of entries) {
      if (!e.paid_at) continue;
      const k = userKey(e.user_id, e.user_name);
      if (!livePaidByUser[k]) livePaidByUser[k] = { hrs: 0, cost: 0 };
      livePaidByUser[k].hrs += e.hours || 0;
      livePaidByUser[k].cost += e.amount || 0;
    }

    // Recover the gap per user — historical (from pay_history) minus
    // live-paid (already in entries). Anything pre-fix shows up here
    // because livePaidByUser[uid] is 0 for those users on this job.
    // pay_history.details is keyed by address (no job_id), so apply the
    // same oldest-at-address rule used for legacy time_entries above —
    // a second job at the same property doesn't inherit the prior job's
    // recovered hours.
    const histForJob = isOldestAtAddress ? (historicalByJobByUser[jobProp] || {}) : {};
    const recoveredByUser: Record<string, { name: string; hrs: number; cost: number }> = {};
    let recoveredHrs = 0;
    let recoveredCost = 0;
    for (const [uid, h] of Object.entries(histForJob)) {
      const livePaid = livePaidByUser[uid] || { hrs: 0, cost: 0 };
      const gapHrs = Math.max(0, h.hrs - livePaid.hrs);
      const gapCost = Math.max(0, h.cost - livePaid.cost);
      if (gapHrs > 0 || gapCost > 0) {
        recoveredByUser[uid] = { name: h.name, hrs: gapHrs, cost: gapCost };
        recoveredHrs += gapHrs;
        recoveredCost += gapCost;
      }
    }

    // Per-employee rollup — combine live entries and recovered hours.
    const byPerson: Record<string, { name: string; hrs: number; cost: number; rate: number }> = {};
    for (const e of entries) {
      const id = userKey(e.user_id, e.user_name);
      if (!byPerson[id]) {
        const p = profiles.find((x) => x.id === e.user_id);
        byPerson[id] = { name: e.user_name || p?.name || "Unknown", hrs: 0, cost: 0, rate: p?.rate || 0 };
      }
      byPerson[id].hrs += e.hours || 0;
      byPerson[id].cost += e.amount || 0;
    }
    for (const [uid, r] of Object.entries(recoveredByUser)) {
      if (!byPerson[uid]) {
        const p = uid.startsWith("name:") ? null : profiles.find((x) => x.id === uid);
        byPerson[uid] = { name: r.name, hrs: 0, cost: 0, rate: p?.rate || 0 };
      }
      byPerson[uid].hrs += r.hrs;
      byPerson[uid].cost += r.cost;
    }

    return {
      totalHrs: loggedHrs + recoveredHrs,
      totalCost: loggedCost + recoveredCost,
      loggedHrs,
      loggedCost,
      recoveredHrs,
      recoveredCost,
      byPerson: Object.values(byPerson),
      entries,
    };
  };

  const [jobTab, setJobTab] = useState<"active" | "billing" | "paid" | "archive">("active");
  const [open, setOpen] = useState<string | null>(null);
  // Property typeahead query — drives both the dropdown suggestions
  // (in <PropertySearch>) and the inline filter on the visible list,
  // so the list and the typeahead stay in sync.
  const [searchQuery, setSearchQuery] = useState("");
  // Drives the review-request modal. Set to a job when status transitions
  // to "complete" or "paid" AND the job hasn't had a review request yet.
  const [reviewJob, setReviewJob] = useState<Job | null>(null);
  const [rn, setRn] = useState("");
  const [ra, setRa] = useState("");
  const [rPhoto, setRPhoto] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  // Receipt scan state — once a photo is attached we upload + AI-scan
  // immediately so the form can auto-fill before the user hits Add.
  const [scanning, setScanning] = useState(false);
  const [scannedPhotoUrl, setScannedPhotoUrl] = useState("");
  const [scannedItems, setScannedItems] = useState<{ name?: string; qty?: number; price?: number }[]>([]);
  const [scannedVendor, setScannedVendor] = useState("");
  const [viewPhoto, setViewPhoto] = useState<string | null>(null);
  const [payQR, setPayQR] = useState<{ url: string; jobId: string; amount: number } | null>(null);
  const [expandedSection, setExpandedSection] = useState<string | null>(null);
  const [connectingStripe, setConnectingStripe] = useState(false);
  const photoRef = useRef<HTMLInputElement>(null);

  // Modal state for "Make recurring" from a job's expanded row. Holds the
  // source job so the modal can show context (address / client) and copy
  // its rooms blob into the new recurring_jobs row.
  const [recurringFrom, setRecurringFrom] = useState<Job | null>(null);

  const getWorkers = (j: typeof jobs[0]): { id: string; name: string }[] => {
    try {
      const d = typeof j.rooms === "string" ? JSON.parse(j.rooms) : j.rooms;
      return d?.workers || [];
    } catch {
      return [];
    }
  };

  const uploadPhoto = async (file: File, jobId: string): Promise<string> => {
    const ext = file.name.split(".").pop() || "jpg";
    const path = `${jobId}/${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("receipts").upload(path, file);
    if (error) throw error;
    const { data } = supabase.storage.from("receipts").getPublicUrl(path);
    return data.publicUrl;
  };

  const resetReceiptForm = () => {
    setRn("");
    setRa("");
    setRPhoto(null);
    setScannedPhotoUrl("");
    setScannedItems([]);
    setScannedVendor("");
    if (photoRef.current) photoRef.current.value = "";
  };

  // Fired the moment a photo is attached. Uploads to storage, then hits
  // /api/ai/receipt to extract vendor / total / items. Auto-fills the
  // note and $ inputs so the user can review and tap Add. Items are kept
  // in state to feed price_corrections on save.
  const handlePhotoAttach = async (file: File, jobId: string) => {
    setRPhoto(file);
    setScannedItems([]);
    setScannedVendor("");
    setScannedPhotoUrl("");
    setScanning(true);
    try {
      const photoUrl = await uploadPhoto(file, jobId);
      setScannedPhotoUrl(photoUrl);

      const res = await fetch("/api/ai/receipt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl: photoUrl }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        useStore.getState().showToast(
          "Scan failed — fill in manually: " + (err?.error || res.statusText),
          "warning",
        );
        return;
      }
      const { data } = await res.json();
      if (!data) return;

      const vendor = (data.vendor as string | undefined)?.trim() || "";
      const items = (Array.isArray(data.items) ? data.items : []) as {
        name?: string; qty?: number; price?: number;
      }[];
      const total = typeof data.total === "number" ? data.total : 0;

      setScannedVendor(vendor);
      setScannedItems(items);

      if (total > 0) setRa(total.toFixed(2));

      const itemSummary = items
        .filter((it) => it?.name)
        .slice(0, 4)
        .map((it) => it.name)
        .join(", ");
      const more = items.length > 4 ? ` (+${items.length - 4} more)` : "";
      const note = vendor
        ? `${vendor}${itemSummary ? ` — ${itemSummary}${more}` : ""}`
        : `${itemSummary}${more}`;
      if (note.trim()) setRn(note);

      useStore.getState().showToast(
        total > 0
          ? `Scanned: $${total.toFixed(2)}${vendor ? ` at ${vendor}` : ""} — review & Add`
          : "Scanned — review fields & Add",
        "success",
      );
    } catch (err) {
      console.error("receipt scan error:", err);
      useStore.getState().showToast(
        "Scan failed — fill in manually: " + (err instanceof Error ? err.message : String(err)),
        "warning",
      );
    }
    setScanning(false);
  };

  const addReceipt = async (jobId: string) => {
    if (!rn.trim()) { useStore.getState().showToast("Enter a receipt note", "warning"); return; }
    const amt = parseFloat(ra);
    if (!amt || amt <= 0) { useStore.getState().showToast("Enter a valid amount", "warning"); return; }
    setUploading(true);
    try {
      // Photo was uploaded the moment the user attached it. Fall back to
      // a fresh upload if scanning was skipped or failed mid-upload.
      let photo_url = scannedPhotoUrl;
      if (rPhoto && !photo_url) {
        photo_url = await uploadPhoto(rPhoto, jobId);
      }
      // Pass org_id explicitly rather than relying on db.post's localStorage
      // auto-inject — if org_id is missing the receipt is there but hidden by
      // the org-scoped filter on the next refresh.
      const result = await db.post<{ id: string }>("receipts", {
        job_id: jobId,
        org_id: user.org_id,
        note: rn,
        amount: amt,
        receipt_date: new Date().toLocaleDateString(),
        photo_url,
      });
      if (!result) {
        // db.post already toasted the underlying Supabase error; bail before
        // clearing the form so the user can retry.
        return;
      }

      // Feed each scanned line item into price_corrections so the quote AI
      // picks up actual supply costs. ZIP-tagged so same-area pricing wins.
      if (scannedItems.length > 0) {
        const job = jobs.find((j) => j.id === jobId);
        const trade = job?.trade || "General";
        const zip = extractZip(job?.property || "");
        const logs = scannedItems
          .filter((it) => it?.name && typeof it.price === "number" && it.price > 0)
          .map((it) => ({
            item_name: it.name!.slice(0, 120),
            material_name: scannedVendor
              ? `${scannedVendor}: ${it.name}`.slice(0, 160)
              : it.name!.slice(0, 160),
            original_mat_cost: 0,
            corrected_mat_cost: Number(it.price),
            original_hours: 0,
            corrected_hours: 0,
            trade,
            zip,
          }));
        for (const entry of logs) {
          await db.post("price_corrections", entry);
        }
      }

      resetReceiptForm();
      await loadAll();
      useStore.getState().showToast("Receipt added", "success");
    } catch (err) {
      console.error(err);
      useStore.getState().showToast(
        "Error saving receipt: " + (err instanceof Error ? err.message : String(err)),
        "error",
      );
    }
    setUploading(false);
  };

  const setStatus = async (id: string, status: string): Promise<void> => {
    // Warn if completing with unchecked work order items
    if (status === "complete") {
      const job = jobs.find((j) => j.id === id);
      if (job) {
        try {
          const jobData = typeof job.rooms === "string" ? JSON.parse(job.rooms) : job.rooms;
          const workOrder = jobData?.workOrder || [];
          const unchecked = workOrder.filter((w: { done: boolean }) => !w.done).length;
          if (unchecked > 0) {
            if (!await useStore.getState().showConfirm("Incomplete Items", `${unchecked} work order item${unchecked !== 1 ? "s" : ""} still unchecked. Mark complete anyway?`)) return;
          }
        } catch { /* no work order, proceed */ }
      }
    }
    await db.patch("jobs", id, { status });

    // When a job goes Complete, log the quoted-vs-actual hours variance into
    // price_corrections so the AI quoter learns from real outcomes. Tagged
    // with __job__:{trade} so parser.ts can surface it as a separate
    // "PAST JOB DURATIONS" prompt section.
    if (status === "complete") {
      const completedJob = jobs.find((j) => j.id === id);
      if (completedJob) {
        const labor = getJobLabor(completedJob);
        const quotedHrs = completedJob.total_hrs || 0;
        if (labor.totalHrs > 0 && quotedHrs > 0 && Math.abs(labor.totalHrs - quotedHrs) > 0.5) {
          const trade = completedJob.trade || "General";
          await db.post("price_corrections", {
            item_name: `__job__:${trade}`,
            original_hours: quotedHrs,
            corrected_hours: Math.round(labor.totalHrs * 100) / 100,
            original_mat_cost: completedJob.total_mat || 0,
            corrected_mat_cost: completedJob.total_mat || 0,
            material_name: "Full job calibration",
            trade,
            zip: extractZip(completedJob.property),
          });
        }
      }
    }

    loadAll();

    // Auto-generate client message on key status changes
    const job = jobs.find((j) => j.id === id);
    if (job?.client) {
      const orgName = org?.name || "Service Provider";
      const statusUrl = `${window.location.origin}/status?job=${id}`;
      const reviewUrl = `${window.location.origin}/review?org=${user.org_id}`;
      let msg = "";

      if (status === "scheduled") {
        msg = `Hi ${job.client}! Your job at ${job.property} has been scheduled. View details: ${statusUrl}`;
      } else if (status === "active") {
        msg = `Hi ${job.client}! We're on our way to ${job.property}. Track progress: ${statusUrl}`;
      } else if (status === "complete") {
        msg = `Hi ${job.client}! Work is complete at ${job.property}. View details and sign off: ${statusUrl}`;
      } else if (status === "invoiced") {
        msg = `Hi ${job.client}! Invoice for ${job.property}: $${(job.total || 0).toFixed(2)}. View & pay: ${statusUrl}`;
      } else if (status === "paid") {
        msg = `Thank you ${job.client}! Payment received for ${job.property}. We'd love a review: ${reviewUrl}\n\n— ${orgName}`;
      }

      if (msg) {
        navigator.clipboard.writeText(msg);
        useStore.getState().showToast("Client message copied — paste & send to " + job.client, "success");
      }
    }

    // Auto-fire the review-request modal on the first transition into
    // "complete" or "paid" — only if we haven't already prompted for this
    // job. The modal lets the user fire off a one-tap text/email asking
    // for a review while the job is still fresh in the client's mind.
    if ((status === "complete" || status === "paid") && job && !job.review_requested_at) {
      setReviewJob(job);
    }
  };

  const deleteJob = async (id: string) => {
    if (await useStore.getState().showConfirm("Delete Job", "Delete this job?")) {
      await db.del("jobs", id);
      loadAll();
    }
  };

  const escapeHtml = (s: string) =>
    String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const generateInvoice = (j: typeof jobs[0]) => {
    const today = new Date().toLocaleDateString("en-US", {
      year: "numeric", month: "long", day: "numeric",
    });
    const invoiceNum = "INV-" + j.id.slice(0, 6).toUpperCase();
    const orgName = org?.name || "Service Provider";

    const body = `
<section class="grid-2" style="margin-bottom:18px">
  <div class="box">
    <div class="label">Bill To</div>
    <div class="value">${escapeHtml(j.client || "Client")}</div>
  </div>
  <div class="box">
    <div class="label">Property</div>
    <div class="value">${escapeHtml(j.property)}</div>
  </div>
  <div class="box">
    <div class="label">Job Date</div>
    <div class="value">${escapeHtml(j.job_date || "—")}</div>
  </div>
  <div class="box">
    <div class="label">Payment Terms</div>
    <div class="value">Due Upon Receipt</div>
  </div>
</section>

<h2>Services Rendered</h2>
<table>
  <thead>
    <tr>
      <th>Description</th>
      <th class="r" style="width:80px">Hours</th>
      <th class="r" style="width:90px">Labor</th>
      <th class="r" style="width:90px">Materials</th>
      <th class="r" style="width:90px">Total</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><b>Property repairs at ${escapeHtml(j.property)}</b><br/><span class="dim" style="font-size:11px">Per accepted estimate, work completed ${escapeHtml(j.job_date || "")}</span></td>
      <td class="r">${(j.total_hrs || 0).toFixed(1)}</td>
      <td class="r">$${(j.total_labor || 0).toFixed(2)}</td>
      <td class="r">$${(j.total_mat || 0).toFixed(2)}</td>
      <td class="r">$${(j.total || 0).toFixed(2)}</td>
    </tr>
  </tbody>
</table>

<section style="margin:20px 0;padding:22px 26px;background:linear-gradient(135deg,#f0f4f8 0%,#e8eef5 100%);border-radius:10px;border-left:4px solid #2E75B6;display:flex;justify-content:space-between;align-items:center">
  <div>
    <div style="font-family:Oswald,sans-serif;font-size:11px;text-transform:uppercase;color:#888;letter-spacing:.12em">Total Amount Due</div>
    <div style="font-size:11px;color:#666;margin-top:2px">Reference: ${invoiceNum}</div>
  </div>
  <div style="font-family:Oswald,sans-serif;font-size:34px;color:#2E75B6;font-weight:700">$${(j.total || 0).toFixed(2)}</div>
</section>

<h2>Payment Terms</h2>
<div style="font-size:11.5px;color:#444;line-height:1.7">
  <p>Payment is due upon receipt unless other arrangements have been made.</p>
  <p style="margin-top:6px">Please make checks payable to <b>${escapeHtml(orgName)}</b>${org?.address ? " and mail to " + escapeHtml(org.address) : ""}.</p>
  <p style="margin-top:6px">For questions about this invoice, contact ${org?.phone ? escapeHtml(org.phone) : ""}${org?.phone && org?.email ? " or " : ""}${org?.email ? escapeHtml(org.email) : ""}.</p>
</div>

<div class="tape"></div>

<div style="text-align:center;font-size:11px;color:#666;margin-top:8px">
  Thank you for your business.
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
        docTitle: "Invoice",
        docNumber: invoiceNum,
        docDate: today,
        docSubtitle: j.property,
      },
      body,
    );
    if (!openPrint(html)) {
      useStore.getState().showToast("Allow popups to generate invoice", "error");
    }
  };

  return (
    <div className="fi">
      <h2 style={{ fontSize: 22, color: "var(--color-primary)", marginBottom: 10, display: "inline-flex", alignItems: "center", gap: 8 }}>
        <Icon name="jobs" size={22} color="var(--color-primary)" />
        Jobs
      </h2>

      {/* Job tabs */}
      {(() => {
        // Inspections live in QuoteForge's "Saved Inspections" cabinet, not here.
        // Archived jobs are filtered out of the work tabs and live in their
        // own tab so cold quotes don't clutter the active workload.
        const activeJobs = jobs.filter((j) => !j.archived && j.status !== "inspection" && !["complete", "invoiced", "paid"].includes(j.status));
        const billingJobs = jobs.filter((j) => !j.archived && (j.status === "complete" || j.status === "invoiced"));
        const paidJobs = jobs.filter((j) => !j.archived && j.status === "paid");
        const archivedJobs = jobs.filter((j) => j.archived);
        const tabs = [
          { id: "active" as const, icon: "hammer", label: t("jobs.active"), count: activeJobs.length, c: "var(--color-primary)" },
          { id: "billing" as const, icon: "receipt", label: t("jobs.billing"), count: billingJobs.length, c: "var(--color-warning)" },
          { id: "paid" as const, icon: "checkCircle", label: t("jobs.paid"), count: paidJobs.length, c: "var(--color-success)" },
          ...(archivedJobs.length > 0
            ? [{ id: "archive" as const, icon: "package", label: "Archive", count: archivedJobs.length, c: "#888" }]
            : []),
        ];
        return (
          <div style={{ display: "flex", gap: 3, marginBottom: 12 }}>
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setJobTab(tab.id)}
                style={{
                  padding: "5px 12px",
                  borderRadius: 6,
                  fontSize: 13,
                  background: jobTab === tab.id ? tab.c : "transparent",
                  color: jobTab === tab.id ? "#fff" : "#888",
                  fontFamily: "Oswald",
                  border: `1px solid ${jobTab === tab.id ? tab.c : darkMode ? "#1e1e2e" : "#ddd"}`,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <Icon name={tab.icon} size={14} />
                {tab.label} ({tab.count})
              </button>
            ))}
          </div>
        );
      })()}

      {/* Property / job typeahead — searches across the current tab's
          jobs by property and client. Selecting a suggestion expands
          that job's row and scrolls it into view. */}
      <div style={{ marginBottom: 10 }}>
        <PropertySearch<Job>
          items={jobs.filter((j) =>
            jobTab === "archive" ? j.archived
            : jobTab === "active" ? !j.archived && j.status !== "inspection" && !["complete", "invoiced", "paid"].includes(j.status)
            : jobTab === "billing" ? !j.archived && (j.status === "complete" || j.status === "invoiced")
            : !j.archived && j.status === "paid"
          )}
          getKey={(j) => j.id}
          match={(j) => `${j.property || ""} ${j.client || ""} ${j.trade || ""}`}
          render={(j) => (
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                <b>{j.property || "(no address)"}</b>
                {j.client && <span className="dim"> · {j.client}</span>}
              </span>
              <span style={{ fontFamily: "Oswald", color: "var(--color-primary)", fontSize: 11, flexShrink: 0 }}>
                {j.status}
              </span>
            </div>
          )}
          onSelect={(j) => {
            setOpen(j.id);
            // Defer scroll until React commits the expanded row.
            setTimeout(() => {
              const el = document.getElementById(`job-row-${j.id}`);
              el?.scrollIntoView({ behavior: "smooth", block: "center" });
            }, 50);
          }}
          onQueryChange={setSearchQuery}
          placeholder="Search jobs by property, client, or trade…"
        />
      </div>

      {/* Billing tab header */}
      {jobTab === "billing" && jobs.some((j) => j.status === "complete" || j.status === "invoiced") && (
        <div className="cd mb" style={{ borderLeft: "3px solid var(--color-warning)", padding: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div className="sl">Ready to Invoice</div>
              <div style={{ fontSize: 20, fontFamily: "Oswald", fontWeight: 700, color: "var(--color-warning)" }}>
                ${jobs.filter((j) => j.status === "complete" || j.status === "invoiced").reduce((s, j) => s + (j.total || 0), 0).toLocaleString()}
              </div>
            </div>
            {!org?.stripe_connected && (
              <button
                className="bb"
                disabled={connectingStripe}
                onClick={async () => {
                  setConnectingStripe(true);
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
                      useStore.getState().showToast("Stripe error (" + res.status + "): " + text, "error");
                      setConnectingStripe(false);
                      return;
                    }
                    const data = await res.json();
                    if (data.url) {
                      await db.patch("organizations", user.org_id, {
                        stripe_account_id: data.accountId,
                      });
                      window.location.href = data.url;
                    } else {
                      useStore.getState().showToast("Error: " + (data.error || "Could not start Stripe setup"), "error");
                      setConnectingStripe(false);
                    }
                  } catch (e) {
                    useStore.getState().showToast(
                      "Failed to start Stripe setup: " + (e instanceof Error ? e.message : "Network error"),
                      "error",
                    );
                    setConnectingStripe(false);
                  }
                }}
                style={{ fontSize: 12, padding: "5px 10px" }}
              >
                {connectingStripe ? "Connecting…" : `${t("jobs.connectStripe")} →`}
              </button>
            )}
          </div>
        </div>
      )}

      {(() => {
        const baseFiltered = jobTab === "archive"
          ? jobs.filter((j) => j.archived)
          : jobTab === "active"
          ? jobs.filter((j) => !j.archived && j.status !== "inspection" && !["complete", "invoiced", "paid"].includes(j.status))
          : jobTab === "billing"
          ? jobs.filter((j) => !j.archived && (j.status === "complete" || j.status === "invoiced"))
          : jobs.filter((j) => !j.archived && j.status === "paid");
        // Apply the typeahead query as an inline filter so the visible
        // list narrows as the user types — keeps the dropdown and the
        // list view in sync.
        const q = searchQuery.toLowerCase();
        const queryFiltered = q
          ? baseFiltered.filter((j) => `${j.property || ""} ${j.client || ""} ${j.trade || ""}`.toLowerCase().includes(q))
          : baseFiltered;
        // Within the active tab, leads bubble to the top — they're the
        // newest external work and need triage before older quotes.
        const filtered = jobTab === "active"
          ? [...queryFiltered].sort((a, b) => {
              const al = a.status === "lead" ? 0 : 1;
              const bl = b.status === "lead" ? 0 : 1;
              if (al !== bl) return al - bl;
              return (b.created_at || "").localeCompare(a.created_at || "");
            })
          : queryFiltered;

        if (!filtered.length) {
          return (
            <div className="cd" style={{ textAlign: "center", padding: 24 }}>
              <p className="dim">
                {jobTab === "active"
                  ? t("jobs.noActive")
                  : jobTab === "billing"
                  ? t("jobs.noBilling")
                  : jobTab === "paid"
                  ? t("jobs.noPaid")
                  : "No archived jobs."}
              </p>
              {jobTab === "active" && (
                <button className="bb mt" onClick={() => setPage("qf")} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <Icon name="quote" size={14} />Start Quote
                </button>
              )}
            </div>
          );
        }

        return filtered.map((j) => {
          const w = getWorkers(j);
          const isOpen = open === j.id;
          // For status="lead" jobs, the rooms JSON carries the
          // prospect's description + uploaded photos so Bernard can
          // triage without leaving Jobs.
          const leadInfo: { description?: string; photos?: string[] } | null = (() => {
            if (j.status !== "lead") return null;
            try {
              const data = typeof j.rooms === "string" ? JSON.parse(j.rooms) : j.rooms;
              return {
                description: data?.leadDescription,
                photos: Array.isArray(data?.leadPhotos) ? data.leadPhotos : [],
              };
            } catch { return null; }
          })();

          return (
            <div key={j.id} id={`job-row-${j.id}`} className="cd mb" style={{ borderLeft: `4px solid ${statusColor(j.status)}` }}>
              {/* Collapsed header */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  cursor: "pointer",
                  flexWrap: "wrap",
                  gap: 6,
                }}
                onClick={() => setOpen(isOpen ? null : j.id)}
              >
                <div>
                  <h4 style={{ fontSize: 14, display: "inline-flex", alignItems: "center", gap: 6 }}>
                    {j.status === "lead" && (
                      <span style={{
                        fontSize: 9,
                        fontFamily: "Oswald",
                        letterSpacing: ".08em",
                        padding: "2px 6px",
                        borderRadius: 4,
                        background: "#ff3d6e",
                        color: "#fff",
                      }}>
                        NEW LEAD
                      </span>
                    )}
                    {j.property}
                  </h4>
                  <div style={{ fontSize: 11 }} className="dim">
                    {j.client} · {j.job_date}
                    {w.length > 0 && (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 3, marginLeft: 4 }}>
                        · <Icon name="worker" size={11} />{w.map((x) => x.name).join(", ")}
                      </span>
                    )}
                    {j.referrer_tech_id && (() => {
                      const ref = profiles.find((p) => p.id === j.referrer_tech_id);
                      if (!ref) return null;
                      return (
                        <span style={{ marginLeft: 6, color: "var(--color-warning)", fontFamily: "Oswald", letterSpacing: ".04em" }}>
                          · via {ref.name}
                        </span>
                      );
                    })()}
                  </div>
                  {j.property && (
                    <a
                      href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(j.property)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      style={{ fontSize: 12, color: "var(--color-primary)", textDecoration: "none" }}
                    >
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                        <Icon name="mapPin" size={12} color="var(--color-primary)" />View on Map
                      </span>
                    </a>
                  )}
                </div>
                <div className="row">
                  <div
                    style={{
                      fontSize: 18,
                      fontFamily: "Oswald",
                      color: "var(--color-success)",
                    }}
                  >
                    ${(j.total || 0).toFixed(0)}
                  </div>
                  <select
                    value={j.status || "quoted"}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => {
                      e.stopPropagation();
                      setStatus(j.id, e.target.value);
                    }}
                    style={{
                      fontSize: 12,
                      padding: "2px 6px",
                      width: "auto",
                      background: statusColor(j.status) + "22",
                    }}
                  >
                    <option value="lead">Lead</option>
                    <option value="quoted">{t("status.quoted")}</option>
                    <option value="accepted">{t("status.accepted")}</option>
                    <option value="scheduled">{t("status.scheduled")}</option>
                    <option value="active">{t("status.active")}</option>
                    <option value="complete">{t("status.complete")}</option>
                    <option value="invoiced">{t("status.invoiced")}</option>
                    <option value="paid">{t("status.paid")}</option>
                  </select>
                  {isOpen && (
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteJob(j.id); }}
                      title={t("jobs.delete")}
                      style={{
                        background: "transparent",
                        border: "none",
                        padding: 4,
                        marginLeft: 2,
                        color: "var(--color-accent-red)",
                        cursor: "pointer",
                        opacity: 0.6,
                        display: "inline-flex",
                        alignItems: "center",
                      }}
                    >
                      <Icon name="delete" size={14} />
                    </button>
                  )}
                </div>
              </div>

              {/* Expanded content */}
              {isOpen && (
                <div
                  style={{
                    marginTop: 10,
                    paddingTop: 10,
                    borderTop: `1px solid ${darkMode ? "#1e1e2e" : "#eee"}`,
                  }}
                >
                  {/* Lead context — only on status="lead" rows. Shows the
                      prospect's free-text description + any photos they
                      uploaded so Bernard can triage and build the quote. */}
                  {leadInfo && (leadInfo.description || (leadInfo.photos?.length ?? 0) > 0) && (
                    <div className="cd mb" style={{ borderLeft: "3px solid #ff3d6e", padding: 10 }}>
                      <div style={{ fontSize: 10, fontFamily: "Oswald", letterSpacing: ".08em", color: "#ff3d6e", marginBottom: 6 }}>
                        REQUEST FROM PROSPECT
                      </div>
                      {leadInfo.description && (
                        <div style={{ fontSize: 13, color: "#e2e2e8", whiteSpace: "pre-wrap", marginBottom: leadInfo.photos?.length ? 8 : 0 }}>
                          {leadInfo.description}
                        </div>
                      )}
                      {leadInfo.photos && leadInfo.photos.length > 0 && (
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(70px, 1fr))", gap: 6 }}>
                          {leadInfo.photos.map((url, i) => (
                            <a
                              key={i}
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <img
                                src={url}
                                alt=""
                                style={{ width: "100%", height: 70, objectFit: "cover", borderRadius: 6, border: "1px solid #1e1e2e" }}
                              />
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Primary actions — Edit + Schedule. Equal-weight, full-width
                      split. These are the two most-tapped actions on any job. */}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 6, marginBottom: 6 }}>
                    {onEditJob && (
                      <button
                        className="bb"
                        onClick={(e) => { e.stopPropagation(); onEditJob(j.id); }}
                        style={{ fontSize: 12, padding: "8px 12px", width: "100%" }}
                      >
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, justifyContent: "center" }}>
                          <Icon name={j.status === "lead" ? "quote" : "edit"} size={14} />
                          {j.status === "lead" ? "Build Quote" : t("jobs.editQuote")}
                        </span>
                      </button>
                    )}
                    <button
                      className="bb"
                      onClick={(e) => { e.stopPropagation(); if (onScheduleJob) onScheduleJob(j.property); else setPage("sched"); }}
                      style={{ fontSize: 12, padding: "8px 12px", width: "100%" }}
                    >
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, justifyContent: "center" }}>
                        <Icon name="schedule" size={14} />
                        {t("jobs.scheduleThis")}
                      </span>
                    </button>
                  </div>

                  {/* Job lifecycle row — secondary actions for moving a job
                      forward (send to client, ask for review, notify SMS, job
                      complete SMS, archive). All ghost-style and uniform size
                      so none of them visually compete with the primary pair. */}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 6, marginBottom: 8 }}>
                    <button
                      className="bo"
                      onClick={(e) => {
                        e.stopPropagation();
                        const url = `${window.location.origin}/status?job=${j.id}`;
                        const msg = j.status === "quoted" || j.status === "accepted"
                          ? `Hi! Here's your quote from ${org?.name || "us"} for ${j.property}:\n\nTotal: $${(j.total || 0).toFixed(2)}\n\nView details & approve: ${url}`
                          : `Hi! Here's the status update for your job at ${j.property}:\n\nView progress: ${url}`;
                        navigator.clipboard.writeText(msg);
                        useStore.getState().showToast("Message copied! Paste & send to client.", "success");
                      }}
                      style={{ fontSize: 12, padding: "7px 10px", width: "100%" }}
                    >
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, justifyContent: "center" }}>
                        <Icon name="send" size={13} />Send Job to Client
                      </span>
                    </button>
                    {/* Manual review-request — appears on completed/paid jobs. */}
                    {(j.status === "complete" || j.status === "invoiced" || j.status === "paid") && (
                      <button
                        className="bo"
                        onClick={(e) => { e.stopPropagation(); setReviewJob(j); }}
                        style={{
                          fontSize: 12,
                          padding: "7px 10px",
                          width: "100%",
                          color: j.review_requested_at ? "#888" : "var(--color-highlight)",
                        }}
                        title={j.review_requested_at ? "Already requested — tap to send another" : "Send a review request to this client"}
                      >
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, justifyContent: "center" }}>
                          <Icon name={j.review_requested_at ? "mail" : "star"} size={13} />
                          {j.review_requested_at ? "Review Sent" : "Request Review"}
                        </span>
                      </button>
                    )}
                    {/* Twilio SMS templates — collapsed into a "Notify ▾"
                        dropdown + standalone "Job complete" button. Only the
                        statuses where each makes sense in the lifecycle. */}
                    {(j.status === "scheduled" || j.status === "active" || j.status === "complete") && (
                      <SmsNotifyButtons jobId={j.id} variant="grid" />
                    )}
                    {/* Archive / Restore — preserves status field so Restore
                        returns the job to its prior state with no data loss. */}
                    {!j.archived && (j.status === "quoted" || j.status === "accepted") && (
                      <button
                        className="bo"
                        onClick={async (e) => {
                          e.stopPropagation();
                          await db.patch("jobs", j.id, {
                            archived: true,
                            archived_at: new Date().toISOString(),
                          });
                          loadAll();
                        }}
                        style={{ fontSize: 12, padding: "7px 10px", width: "100%", color: "#888" }}
                        title="Hide this quote from active jobs without deleting it"
                      >
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, justifyContent: "center" }}>
                          <Icon name="package" size={13} />Archive
                        </span>
                      </button>
                    )}
                    {j.archived && (
                      <button
                        className="bo"
                        onClick={async (e) => {
                          e.stopPropagation();
                          await db.patch("jobs", j.id, {
                            archived: false,
                            archived_at: null,
                          });
                          loadAll();
                        }}
                        style={{ fontSize: 12, padding: "7px 10px", width: "100%", color: "var(--color-success)" }}
                        title="Restore this job to its original status"
                      >
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, justifyContent: "center" }}>
                          <Icon name="refresh" size={13} />Restore
                        </span>
                      </button>
                    )}
                  </div>

                  {/* Payment actions — appears once a job is in the
                      billable lifecycle (complete / invoiced / paid). Same
                      grid weight as the lifecycle row so the eye treats this
                      as a sibling group, not a louder layer. */}
                  {(j.status === "complete" || j.status === "invoiced" || j.status === "paid") && (
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 6, marginBottom: 8 }}>
                      <button
                        className="bb"
                        onClick={(e) => {
                          e.stopPropagation();
                          generateInvoice(j);
                          if (j.status === "complete") {
                            setStatus(j.id, "invoiced");
                          }
                        }}
                        style={{ fontSize: 12, padding: "7px 10px", width: "100%" }}
                      >
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, justifyContent: "center" }}>
                          <Icon name="receipt" size={14} />
                          {j.status === "complete" ? t("jobs.generateInvoice") : t("jobs.viewInvoice")}
                        </span>
                      </button>
                      {(j.status === "invoiced" || j.status === "complete") && j.total > 0 && org?.stripe_connected && (<>
                        <button
                          className="bb"
                          onClick={async (e) => {
                            e.stopPropagation();
                            try {
                              const res = await fetch("/api/checkout", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({
                                  jobId: j.id,
                                  property: j.property,
                                  client: j.client,
                                  amount: j.total,
                                  orgName: org?.name || "Service Provider",
                                  stripeAccountId: org?.stripe_account_id || "",
                                }),
                              });
                              const data = await res.json();
                              if (data.url) {
                                navigator.clipboard.writeText(data.url);
                                useStore.getState().showToast("Payment link copied! Send it to the client.", "success");
                                if (j.status === "complete") setStatus(j.id, "invoiced");
                              } else {
                                useStore.getState().showToast("Error: " + (data.error || "Could not create payment link"), "error");
                              }
                            } catch { useStore.getState().showToast("Failed to create payment link", "error"); }
                          }}
                          style={{ fontSize: 12, padding: "7px 10px", width: "100%" }}
                        >
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, justifyContent: "center" }}>
                            <Icon name="link" size={14} />Send Link
                          </span>
                        </button>
                        <button
                          className="bb"
                          onClick={async (e) => {
                            e.stopPropagation();
                            try {
                              const res = await fetch("/api/checkout", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({
                                  jobId: j.id,
                                  property: j.property,
                                  client: j.client,
                                  amount: j.total,
                                  orgName: org?.name || "Service Provider",
                                  stripeAccountId: org?.stripe_account_id || "",
                                }),
                              });
                              const data = await res.json();
                              if (data.url) {
                                setPayQR({ url: data.url, jobId: j.id, amount: j.total });
                                if (j.status === "complete") setStatus(j.id, "invoiced");
                              } else {
                                useStore.getState().showToast("Error: " + (data.error || "Could not create payment"), "error");
                              }
                            } catch { useStore.getState().showToast("Failed to create payment", "error"); }
                          }}
                          style={{ fontSize: 12, padding: "7px 10px", width: "100%" }}
                        >
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, justifyContent: "center" }}>
                            <Icon name="qr" size={14} />Collect Now
                          </span>
                        </button>
                      </>)}
                      {j.status === "invoiced" && (
                        <button
                          className="bg"
                          onClick={(e) => {
                            e.stopPropagation();
                            setStatus(j.id, "paid");
                          }}
                          style={{ fontSize: 12, padding: "7px 10px", width: "100%" }}
                        >
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, justifyContent: "center" }}>
                            <Icon name="check" size={14} />Mark Paid
                          </span>
                        </button>
                      )}
                    </div>
                  )}

                  {/* Review-Request automation status — paid jobs only.
                      Reads the latest review_requests row for this job and
                      renders a one-line badge. Three states:
                        scheduled → "Review request in Xh"
                        sent / failed → "Review request sent on <date>"
                        none + disabled → "Review request off (disabled in Settings)" */}
                  {j.status === "paid" && (() => {
                    const rrows = reviewRequests
                      .filter((r) => r.job_id === j.id)
                      .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
                    const rr = rrows[0];
                    const automationOn = org?.review_request_enabled !== false; // default TRUE
                    let label: string;
                    let color: string;
                    let icon: "star" | "mail" | "info" = "star";
                    if (rr?.status === "scheduled") {
                      const diffMs = new Date(rr.scheduled_for).getTime() - Date.now();
                      const hoursOut = Math.max(0, Math.round(diffMs / 3600 / 1000));
                      label = hoursOut <= 0
                        ? "Review request queued — sending shortly"
                        : `Review request scheduled in ${hoursOut}h`;
                      color = "var(--color-highlight)";
                      icon = "star";
                    } else if (rr?.status === "sent") {
                      const sentDate = rr.sent_at ? new Date(rr.sent_at).toLocaleDateString() : "—";
                      label = `Review request sent on ${sentDate}`;
                      color = "var(--color-success)";
                      icon = "mail";
                    } else if (rr?.status === "failed") {
                      label = `Review request failed${rr.error ? `: ${rr.error}` : ""}`;
                      color = "var(--color-accent-red)";
                      icon = "info";
                    } else if (rr?.status === "cancelled") {
                      label = "Review request cancelled (manual send)";
                      color = "#888";
                      icon = "mail";
                    } else if (!automationOn) {
                      label = "Review request off (disabled in Settings)";
                      color = "#888";
                      icon = "info";
                    } else {
                      // No row, automation enabled — legacy paid job from
                      // before automation shipped, or the schedule insert
                      // hasn't run yet. Stay silent rather than imply state.
                      return null;
                    }
                    return (
                      <div
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          fontSize: 11,
                          padding: "4px 8px",
                          borderRadius: 6,
                          background: darkMode ? "#0f0f18" : "#f5f5f8",
                          color,
                          marginBottom: 8,
                          fontFamily: "Oswald",
                          letterSpacing: ".02em",
                        }}
                        title={rr?.error || label}
                      >
                        <Icon name={icon} size={12} color={color} />
                        {label}
                      </div>
                    );
                  })()}

                  {/* Job info cards */}
                  {(() => {
                    const labor = getJobLabor(j);
                    const quoted = j.total_hrs || 0;
                    const variancePct = quoted > 0 ? ((labor.totalHrs - quoted) / quoted) * 100 : 0;
                    const overBudget = labor.totalHrs > quoted && quoted > 0;
                    const underBudget = quoted > 0 && labor.totalHrs > 0 && labor.totalHrs <= quoted;
                    return (
                      <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                        <div style={{ flex: 1, textAlign: "center", padding: 6, borderRadius: 6, background: darkMode ? "#1a1a28" : "#f5f5f8" }}>
                          <div className="sl">Labor</div>
                          <div style={{ fontFamily: "Oswald", color: "var(--color-primary)", fontSize: 14 }}>${(j.total_labor || 0).toFixed(0)}</div>
                        </div>
                        <div style={{ flex: 1, textAlign: "center", padding: 6, borderRadius: 6, background: darkMode ? "#1a1a28" : "#f5f5f8" }}>
                          <div className="sl">Materials</div>
                          <div style={{ fontFamily: "Oswald", color: "var(--color-warning)", fontSize: 14 }}>${(j.total_mat || 0).toFixed(0)}</div>
                        </div>
                        <div style={{ flex: 1, textAlign: "center", padding: 6, borderRadius: 6, background: darkMode ? "#1a1a28" : "#f5f5f8" }}>
                          <div className="sl">Hours</div>
                          <div style={{ fontFamily: "Oswald", color: "var(--color-highlight)", fontSize: 14 }}>{quoted.toFixed(1)}</div>
                          {labor.totalHrs > 0 && (
                            <div
                              style={{
                                fontSize: 9,
                                marginTop: 2,
                                color: overBudget ? "var(--color-accent-red)" : underBudget ? "var(--color-success)" : "#888",
                                fontFamily: "Oswald",
                              }}
                              title="Actual hours logged via Timer"
                            >
                              {labor.totalHrs.toFixed(1)}h actual
                              {quoted > 0 && ` (${variancePct >= 0 ? "+" : ""}${variancePct.toFixed(0)}%)`}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })()}

                  {/* Time Logged detail — only when entries exist */}
                  {(() => {
                    const labor = getJobLabor(j);
                    if (labor.totalHrs === 0) return null;
                    const isOpenSection = expandedSection === `time-${j.id}`;
                    return (
                      <div style={{ marginBottom: 8 }}>
                        <button
                          className="bo"
                          onClick={(e) => { e.stopPropagation(); setExpandedSection(isOpenSection ? null : `time-${j.id}`); }}
                          style={{ fontSize: 12, padding: "4px 10px", width: "100%", textAlign: "left" }}
                        >
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                            <Icon name="time" size={13} />
                            Time Logged: {labor.totalHrs.toFixed(1)}h · ${labor.totalCost.toFixed(0)} ({labor.byPerson.length} crew)
                            <Icon name={isOpenSection ? "expand" : "next"} size={12} />
                          </span>
                        </button>
                        {isOpenSection && (
                          <div style={{ marginTop: 6, padding: 8, background: darkMode ? "#0f0f18" : "#f7f7fa", borderRadius: 6 }}>
                            {labor.byPerson
                              .sort((a, b) => b.hrs - a.hrs)
                              .map((p) => (
                                <div key={p.name} className="sep" style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                                    <Icon name="worker" size={12} />{p.name}
                                  </span>
                                  <span style={{ color: "var(--color-highlight)", fontFamily: "Oswald" }}>{p.hrs.toFixed(1)}h</span>
                                  <span style={{ color: "var(--color-success)", fontFamily: "Oswald", minWidth: 60, textAlign: "right" }}>${p.cost.toFixed(0)}</span>
                                </div>
                              ))}
                            {labor.recoveredHrs > 0 && (
                              <div className="dim" style={{ fontSize: 10, marginTop: 6 }}>
                                {labor.loggedHrs.toFixed(1)}h logged · {labor.recoveredHrs.toFixed(1)}h recovered from past payroll
                              </div>
                            )}
                            <div className="dim" style={{ fontSize: 10, marginTop: 6, fontStyle: "italic" }}>
                              Quoted {(j.total_hrs || 0).toFixed(1)}h · Actual {labor.totalHrs.toFixed(1)}h · This data trains the AI quoter for similar future jobs.
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* Inspection + Work Order — collapsible side by side */}
                  {(() => {
                    try {
                      const jd = typeof j.rooms === "string" ? JSON.parse(j.rooms) : j.rooms;
                      const hasInspection = jd?.inspection?.rooms?.length > 0;
                      const hasWorkOrder = jd?.workOrder?.length > 0;
                      if (!hasInspection && !hasWorkOrder) return null;

                      const findingsCount = jd?.inspection?.rooms?.reduce((s: number, r: { items: { condition: string }[] }) => s + r.items.filter((it) => it.condition !== "S").length, 0) || 0;
                      const woTotal = jd?.workOrder?.length || 0;
                      const woDone = jd?.workOrder?.filter((w: { done: boolean }) => w.done).length || 0;

                      return (
                        <div className="row" style={{ gap: 6, marginBottom: 8 }}>
                          {hasInspection && (
                            <button
                              className="bo"
                              onClick={(e) => { e.stopPropagation(); setExpandedSection(expandedSection === `insp-${j.id}` ? null : `insp-${j.id}`); }}
                              style={{ flex: 1, fontSize: 12, padding: "6px 10px", textAlign: "left" }}
                            >
                              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                                <Icon name="list" size={13} />
                                Inspection ({findingsCount} findings)
                                <Icon name={expandedSection === `insp-${j.id}` ? "collapse" : "expand"} size={12} />
                              </span>
                            </button>
                          )}
                          {hasWorkOrder && (
                            <button
                              className="bo"
                              onClick={(e) => { e.stopPropagation(); setExpandedSection(expandedSection === `wo-${j.id}` ? null : `wo-${j.id}`); }}
                              style={{ flex: 1, fontSize: 12, padding: "6px 10px", textAlign: "left" }}
                            >
                              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                                <Icon name="checkCircle" size={13} />
                                Work Order ({woDone}/{woTotal})
                                <Icon name={expandedSection === `wo-${j.id}` ? "collapse" : "expand"} size={12} />
                              </span>
                            </button>
                          )}
                        </div>
                      );
                    } catch { return null; }
                  })()}

                  {/* Expanded Inspection */}
                  {expandedSection === `insp-${j.id}` && (() => {
                    try {
                      const jd = typeof j.rooms === "string" ? JSON.parse(j.rooms) : j.rooms;
                      if (!jd?.inspection?.rooms?.length) return null;
                      return (
                        <div style={{ marginBottom: 10 }}>
                          {jd.inspection.rooms.map((r: { name: string; items: { name: string; condition: string; comment: string; photos?: string[] }[] }, ri: number) => (
                            <div key={ri} style={{ marginBottom: 6 }}>
                              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--color-primary)" }}>{r.name}</div>
                              {r.items.map((it: { name: string; condition: string; comment: string; photos?: string[] }, ii: number) => (
                                <div key={ii} style={{ fontSize: 12, padding: "3px 0 3px 12px", borderBottom: `1px solid ${darkMode ? "#1e1e2e11" : "#eee"}` }}>
                                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                                    <span>{it.name}</span>
                                    <span style={{ fontSize: 11, padding: "0 4px", borderRadius: 3, background: it.condition === "D" ? "#C0000022" : it.condition === "P" ? "#ff880022" : it.condition === "F" ? "#ffcc0022" : "#00cc6622", color: it.condition === "D" ? "#C00000" : it.condition === "P" ? "#ff8800" : it.condition === "F" ? "#ffcc00" : "#00cc66" }}>
                                      {it.condition || "S"}
                                    </span>
                                  </div>
                                  {it.comment && <div className="dim" style={{ fontSize: 12 }}>{it.comment}</div>}
                                  {it.photos && it.photos.length > 0 && (
                                    <div style={{ display: "flex", gap: 3, marginTop: 3 }}>
                                      {it.photos.slice(0, 4).map((url: string, pi: number) => (
                                        <img key={pi} src={url} alt="" style={{ width: 40, height: 40, objectFit: "cover", borderRadius: 4 }} />
                                      ))}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          ))}
                        </div>
                      );
                    } catch { return null; }
                  })()}

                  {/* Work Order Checklist — expanded via button above */}
                  {expandedSection === `wo-${j.id}` && (() => {
                    try {
                      const jobData = typeof j.rooms === "string" ? JSON.parse(j.rooms) : j.rooms;
                      const workOrder: { room: string; detail: string; action: string; pri: string; hrs: number; done: boolean }[] = jobData?.workOrder || [];
                      if (!workOrder.length) return null;

                      const completedCount = workOrder.filter((w) => w.done).length;
                      const totalCount = workOrder.length;

                      return (
                        <div className="mt">
                          {/* Progress bar */}
                          <div style={{ height: 4, background: darkMode ? "#1e1e2e" : "#eee", borderRadius: 2, marginBottom: 6 }}>
                            <div style={{ height: 4, background: completedCount === totalCount ? "var(--color-success)" : "var(--color-primary)", borderRadius: 2, width: `${(completedCount / totalCount) * 100}%`, transition: "width 0.3s" }} />
                          </div>
                          {workOrder.map((w, wi) => (
                            <div
                              key={wi}
                              onClick={(e) => {
                                e.stopPropagation();
                                // Read fresh blob from the store at save-time
                                // (the render closure can be stale if a prior
                                // toggle's loadAll hasn't completed). Match
                                // the clicked task by (room, detail) so a
                                // mid-flight reorder can't redirect the toggle
                                // to the wrong row.
                                const targetKey = woStableKey(w);
                                const nextDone = !w.done;
                                enqueueRoomsWrite(async () => {
                                  const fresh = useStore.getState().jobs.find((x) => x.id === j.id);
                                  if (!fresh) return;
                                  let freshData: Record<string, unknown> = {};
                                  try {
                                    freshData = typeof fresh.rooms === "string" ? JSON.parse(fresh.rooms) : (fresh.rooms || {});
                                  } catch { return; }
                                  const freshWO = Array.isArray(freshData.workOrder)
                                    ? (freshData.workOrder as { room: string; detail: string; action: string; pri: string; hrs: number; done: boolean }[])
                                    : [];
                                  const matchIdx = freshWO.findIndex((x) => woStableKey(x) === targetKey);
                                  if (matchIdx < 0) return;
                                  const updatedWO = [...freshWO];
                                  updatedWO[matchIdx] = { ...updatedWO[matchIdx], done: nextDone };
                                  await db.patch("jobs", j.id, {
                                    rooms: JSON.stringify({ ...freshData, workOrder: updatedWO }),
                                  });
                                  await loadAll();
                                });
                              }}
                              style={{
                                display: "flex", alignItems: "center", gap: 6, padding: "3px 0",
                                borderBottom: `1px solid ${darkMode ? "#1e1e2e" : "#eee"}`,
                                cursor: "pointer", opacity: w.done ? 0.5 : 1,
                                textDecoration: w.done ? "line-through" : "none",
                              }}
                            >
                              <span style={{
                                width: 16, height: 16, borderRadius: 3, flexShrink: 0,
                                border: `2px solid ${w.done ? "var(--color-success)" : "#555"}`,
                                background: w.done ? "var(--color-success)" : "transparent",
                                display: "flex", alignItems: "center", justifyContent: "center",
                                fontSize: 12, color: "#fff",
                              }}>
                                {w.done && "✓"}
                              </span>
                              <div style={{ flex: 1, fontSize: 11 }}>
                                <span style={{
                                  fontSize: 13, padding: "1px 4px", borderRadius: 3, marginRight: 4,
                                  background: w.pri === "HIGH" ? "#C0000033" : w.pri === "MED" ? "#ff880033" : "#00cc6633",
                                  color: w.pri === "HIGH" ? "var(--color-accent-red)" : w.pri === "MED" ? "var(--color-warning)" : "var(--color-success)",
                                }}>
                                  {w.pri}
                                </span>
                                <b style={{ color: "var(--color-primary)" }}>{w.room}</b> — {w.detail}
                                <div className="dim" style={{ fontSize: 10 }}>{w.action}</div>
                              </div>
                              <span className="dim" style={{ fontSize: 9 }}>{w.hrs}h</span>
                            </div>
                          ))}
                        </div>
                      );
                    } catch { return null; }
                  })()}

                  {/* Job Notes */}
                  <div style={{ marginTop: 8 }}>
                    <JobNotesInput job={j} />
                  </div>

                  {/* Job Properties — form-style settings (not actions).
                      2-col grid: label on the left, control on the right.
                      Section divider above pulls these visually away from
                      the Job Notes textarea so they read as metadata. */}
                  <div style={{ marginTop: 12, paddingTop: 8, borderTop: `1px solid ${darkMode ? "#1e1e2e" : "#eee"}` }}>
                    <div style={{ fontSize: 10, fontFamily: "Oswald", letterSpacing: ".08em", textTransform: "uppercase", color: "#888", marginBottom: 8 }}>
                      Job Properties
                    </div>
                    <div
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "auto 1fr",
                        gap: "6px 10px",
                        alignItems: "center",
                        fontSize: 12,
                      }}
                    >
                      <span className="dim">Trade</span>
                      <select
                        value={j.trade || ""}
                        onClick={(e) => e.stopPropagation()}
                        onChange={async (e) => {
                          e.stopPropagation();
                          await db.patch("jobs", j.id, { trade: e.target.value });
                          loadAll();
                        }}
                        style={{ width: "100%", fontSize: 12, padding: "3px 6px" }}
                      >
                        <option value="">None</option>
                        <option value="Plumbing">Plumbing</option>
                        <option value="Electrical">Electrical</option>
                        <option value="Carpentry">Carpentry</option>
                        <option value="HVAC">HVAC</option>
                        <option value="Painting">Painting</option>
                        <option value="Flooring">Flooring</option>
                        <option value="General">General</option>
                      </select>

                      <span className="dim">Client requested</span>
                      <select
                        value={j.requested_tech || ""}
                        onClick={(e) => e.stopPropagation()}
                        onChange={async (e) => {
                          e.stopPropagation();
                          await db.patch("jobs", j.id, { requested_tech: e.target.value });
                          loadAll();
                        }}
                        style={{ width: "100%", fontSize: 12, padding: "3px 6px" }}
                      >
                        <option value="">No one specific</option>
                        {profiles.map((p) => (
                          <option key={p.id} value={p.name}>{p.name}</option>
                        ))}
                      </select>

                      <span className="dim">Recurring</span>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <button
                          className="bo"
                          onClick={(e) => { e.stopPropagation(); setRecurringFrom(j); }}
                          style={{ fontSize: 12, padding: "3px 10px" }}
                        >
                          <Icon name="refresh" size={12} /> Make recurring…
                        </button>
                        <span className="dim" style={{ fontSize: 11 }}>Manage in Ops → Recurring</span>
                      </div>

                      <span className="dim">Callback</span>
                      <label
                        onClick={(e) => e.stopPropagation()}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          fontSize: 12,
                          cursor: "pointer",
                          color: j.callback ? "var(--color-accent-red)" : "#888",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={j.callback || false}
                          onChange={async (e) => {
                            e.stopPropagation();
                            await db.patch("jobs", j.id, { callback: e.target.checked });
                            loadAll();
                          }}
                          style={{ width: "auto", accentColor: "var(--color-accent-red)" }}
                        />
                        Mark as callback
                      </label>

                      <span className="dim">Upsell</span>
                      <label
                        onClick={(e) => e.stopPropagation()}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          fontSize: 12,
                          cursor: "pointer",
                          color: j.is_upsell ? "var(--color-success)" : "#888",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={j.is_upsell || false}
                          onChange={async (e) => {
                            e.stopPropagation();
                            await db.patch("jobs", j.id, { is_upsell: e.target.checked });
                            loadAll();
                          }}
                          style={{ width: "auto", accentColor: "var(--color-success)" }}
                        />
                        Mark as upsell
                      </label>
                    </div>
                  </div>

                  {/* Before/After Photos */}
                  {(j.status === "complete" || j.status === "invoiced" || j.status === "paid") && (() => {
                    const jobData = (() => { try { return typeof j.rooms === "string" ? JSON.parse(j.rooms) : j.rooms; } catch { return {}; } })();
                    const photos: { url: string; label: string; type: string }[] = jobData?.photos || [];
                    const beforePhotos = photos.filter((p) => p.type === "before");
                    const afterPhotos = photos.filter((p) => p.type === "after");

                    return (
                      <div style={{ marginTop: 12, paddingTop: 8, borderTop: `1px solid ${darkMode ? "#1e1e2e" : "#eee"}` }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                          <span style={{ fontSize: 10, fontFamily: "Oswald", letterSpacing: ".08em", textTransform: "uppercase", color: "#888" }}>Completion Photos</span>
                          <div className="row" style={{ gap: 4 }}>
                            <button
                              className="bo"
                              onClick={async (e) => {
                                e.stopPropagation();
                                const input = document.createElement("input");
                                input.type = "file";
                                input.accept = "image/*";
                                input.multiple = true;
                                input.onchange = async () => {
                                  if (!input.files?.length) return;
                                  // Upload to storage first (no blob mutation
                                  // yet) so the rooms-write step is short-
                                  // lived and serializable.
                                  const newPhotos: { url: string; label: string; type: "after" }[] = [];
                                  for (let i = 0; i < input.files.length; i++) {
                                    const file = input.files[i];
                                    const ext = file.name.split(".").pop() || "jpg";
                                    const path = `gallery/${j.id}/${Date.now()}_${Math.random().toString(36).slice(2, 6)}.${ext}`;
                                    const { error } = await supabase.storage.from("receipts").upload(path, file);
                                    if (!error) {
                                      const { data } = supabase.storage.from("receipts").getPublicUrl(path);
                                      if (data?.publicUrl) newPhotos.push({ url: data.publicUrl, label: "", type: "after" });
                                    }
                                  }
                                  if (!newPhotos.length) return;
                                  await enqueueRoomsWrite(async () => {
                                    const fresh = useStore.getState().jobs.find((x) => x.id === j.id);
                                    if (!fresh) return;
                                    let freshData: Record<string, unknown> = {};
                                    try {
                                      freshData = typeof fresh.rooms === "string" ? JSON.parse(fresh.rooms) : (fresh.rooms || {});
                                    } catch { return; }
                                    const existingPhotos = Array.isArray(freshData.photos)
                                      ? (freshData.photos as Array<{ url: string; label: string; type: string }>)
                                      : [];
                                    const seen = new Set(existingPhotos.map((p) => p.url));
                                    const merged = [
                                      ...existingPhotos,
                                      ...newPhotos.filter((p) => !seen.has(p.url)),
                                    ];
                                    await db.patch("jobs", j.id, {
                                      rooms: JSON.stringify({ ...freshData, photos: merged }),
                                    });
                                    await loadAll();
                                  });
                                  useStore.getState().showToast("After photos uploaded", "success");
                                };
                                input.click();
                              }}
                              style={{ fontSize: 12, padding: "3px 8px" }}
                            >
                              + After Photos
                            </button>
                            {(beforePhotos.length > 0 || afterPhotos.length > 0) && (
                              <button
                                className="bo"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  // Generate before/after report PDF
                                  const orgName = org?.name || "Service Provider";
                                  const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
                                  const photoRows = [...new Set([...beforePhotos.map(p => p.label), ...afterPhotos.map(p => p.label)])].filter(Boolean).map((label) => {
                                    const before = beforePhotos.find(p => p.label === label);
                                    const after = afterPhotos.find(p => p.label === label);
                                    return `<tr><td style="font-weight:600;font-size:12px">${label}</td><td style="text-align:center">${before ? `<img src="${before.url}" style="width:200px;height:130px;object-fit:cover;border-radius:6px" />` : '<span style="color:#888">—</span>'}</td><td style="text-align:center">${after ? `<img src="${after.url}" style="width:200px;height:130px;object-fit:cover;border-radius:6px" />` : '<span style="color:#888">—</span>'}</td></tr>`;
                                  }).join("");
                                  // Also show unlabeled photos
                                  const unlabeledBefore = beforePhotos.filter(p => !p.label);
                                  const unlabeledAfter = afterPhotos.filter(p => !p.label);
                                  let extraHtml = "";
                                  if (unlabeledBefore.length || unlabeledAfter.length) {
                                    extraHtml = `<h3 style="font-family:Oswald;font-size:14px;color:#2E75B6;margin:16px 0 8px">Additional Photos</h3><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px">${[...unlabeledBefore, ...unlabeledAfter].map(p => `<div style="text-align:center"><img src="${p.url}" style="width:100%;height:100px;object-fit:cover;border-radius:6px" /><div style="font-size:10px;color:#666;margin-top:2px">${p.type}</div></div>`).join("")}</div>`;
                                  }
                                  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Photo Report — ${j.property}</title><style>@import url('https://fonts.googleapis.com/css2?family=Oswald:wght@400;600;700&family=Source+Sans+3:wght@400;500;600&display=swap');*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Source Sans 3',sans-serif;color:#1a1a2a;font-size:13px}.page{max-width:800px;margin:0 auto;padding:32px 40px}h1{font-family:Oswald;font-size:22px;color:#2E75B6;text-transform:uppercase}h2{font-family:Oswald;font-size:15px;color:#2E75B6;text-transform:uppercase;margin:20px 0 8px;border-bottom:2px solid #2E75B6;padding-bottom:4px}table{width:100%;border-collapse:collapse}th{font-family:Oswald;font-size:12px;color:#fff;background:#2E75B6;padding:8px;text-align:center}td{padding:8px;border-bottom:1px solid #e8e8e8;vertical-align:middle}.header{display:flex;justify-content:space-between;margin-bottom:16px;padding-bottom:12px;border-bottom:3px solid #2E75B6}.footer{border-top:1px solid #ddd;padding-top:8px;text-align:center;font-size:11px;color:#888;margin-top:24px}@media print{.page{padding:16px 24px}}</style></head><body><div class="page"><div class="header"><div><h1>${orgName}</h1><div style="font-size:12px;color:#666;margin-top:4px">Before & After Photo Report</div></div><div style="text-align:right"><div style="font-size:14px;font-family:Oswald;color:#2E75B6">PHOTO REPORT</div><div style="font-size:12px;color:#666">${today}</div><div style="font-size:12px;color:#666">${j.property}</div></div></div><h2>Before & After Comparison</h2><table><thead><tr><th style="text-align:left;width:30%">Location</th><th>Before</th><th>After</th></tr></thead><tbody>${photoRows || '<tr><td colspan="3" style="text-align:center;color:#888;padding:20px">Upload before and after photos to generate comparison</td></tr>'}</tbody></table>${extraHtml}<div style="margin-top:20px;font-size:12px;color:#666"><b>Before photos:</b> ${beforePhotos.length} · <b>After photos:</b> ${afterPhotos.length}</div><div class="footer">${orgName}</div></div></body></html>`;
                                  const win = window.open("", "_blank");
                                  if (win) { win.document.write(html); win.document.close(); setTimeout(() => win.print(), 600); }
                                }}
                                style={{ fontSize: 12, padding: "3px 8px", display: "inline-flex", alignItems: "center", gap: 6 }}
                              >
                                <Icon name="photo" size={13} />Photo Report
                              </button>
                            )}
                          </div>
                        </div>
                        {(beforePhotos.length > 0 || afterPhotos.length > 0) && (
                          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                            {photos.filter(p => p.type === "before" || p.type === "after").slice(0, 8).map((p, i) => (
                              <div key={i} style={{ position: "relative" }}>
                                <img src={p.url} alt="" style={{ width: 50, height: 50, objectFit: "cover", borderRadius: 4, border: `1px solid ${darkMode ? "#1e1e2e" : "#ddd"}` }} />
                                <span style={{ position: "absolute", bottom: 1, left: 1, fontSize: 8, background: p.type === "before" ? "#ff8800" : "#00cc66", color: "#fff", padding: "0 3px", borderRadius: 2 }}>
                                  {p.type === "before" ? "B" : "A"}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* Receipts — existing list + Add Receipt form, grouped
                      under a single section divider/label. */}
                  <div style={{ marginTop: 12, paddingTop: 8, borderTop: `1px solid ${darkMode ? "#1e1e2e" : "#eee"}` }}>
                    <div style={{ fontSize: 10, fontFamily: "Oswald", letterSpacing: ".08em", textTransform: "uppercase", color: "#888", marginBottom: 8 }}>
                      Receipts
                    </div>
                    {receipts.filter((r) => r.job_id === j.id).length > 0 && (
                      <div style={{ marginBottom: 8 }}>
                        {receipts
                          .filter((r) => r.job_id === j.id)
                          .map((r) => (
                            <div
                              key={r.id}
                              className="sep"
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                                fontSize: 12,
                                gap: 8,
                              }}
                            >
                              <div style={{ flex: 1 }}>
                                <span>{r.note || "Receipt"}</span>
                                <span className="dim" style={{ marginLeft: 6 }}>{r.receipt_date}</span>
                              </div>
                              <span style={{ color: "var(--color-success)", fontFamily: "Oswald" }}>
                                ${(r.amount || 0).toFixed(2)}
                              </span>
                              {r.photo_url && (
                                <img
                                  src={r.photo_url}
                                  alt="receipt"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setViewPhoto(r.photo_url);
                                  }}
                                  style={{
                                    width: 36,
                                    height: 36,
                                    borderRadius: 4,
                                    objectFit: "cover",
                                    cursor: "pointer",
                                    border: `1px solid ${darkMode ? "#1e1e2e" : "#ddd"}`,
                                  }}
                                />
                              )}
                              <button
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  if (await useStore.getState().showConfirm("Delete Receipt", "Delete receipt?")) {
                                    await db.del("receipts", r.id);
                                    loadAll();
                                  }
                                }}
                                style={{ background: "none", color: "var(--color-accent-red)", fontSize: 12, padding: 0 }}
                              >
                                ✕
                              </button>
                            </div>
                          ))}
                      </div>
                    )}

                    {/* Add Receipt — form (recent AI-scan flow lives here). */}
                    <div className="dim" style={{ fontSize: 11, marginBottom: 4 }}>Add receipt</div>
                    <div className="row">
                      <input
                        value={rn}
                        onChange={(e) => setRn(e.target.value)}
                        placeholder={scanning ? "Scanning…" : "Note"}
                        style={{ flex: 1 }}
                        disabled={scanning}
                      />
                      <input
                        type="number"
                        value={ra}
                        onChange={(e) => setRa(e.target.value)}
                        placeholder={scanning ? "…" : "$"}
                        style={{ width: 60 }}
                        disabled={scanning}
                      />
                      <button
                        className="bg"
                        onClick={(e) => {
                          e.stopPropagation();
                          addReceipt(j.id);
                        }}
                        style={{ fontSize: 12, padding: "5px 10px" }}
                        disabled={uploading || scanning}
                      >
                        {uploading ? "..." : "Add"}
                      </button>
                    </div>
                    <div className="row" style={{ marginTop: 6 }}>
                      <label
                        onClick={(e) => { e.stopPropagation(); if (!scanning) photoRef.current?.click(); }}
                        style={{
                          fontSize: 13,
                          color: scanning ? "var(--color-warning)" : "var(--color-primary)",
                          cursor: scanning ? "wait" : "pointer",
                          display: "flex",
                          alignItems: "center",
                          gap: 4,
                        }}
                      >
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, justifyContent: "center" }}>
                          <Icon name="camera" size={13} />
                          {scanning
                            ? "Scanning receipt…"
                            : rPhoto
                              ? rPhoto.name
                              : "Attach photo (auto-scan)"}
                        </span>
                      </label>
                      <input
                        ref={photoRef}
                        type="file"
                        accept="image/*"
                        capture="environment"
                        style={{ display: "none" }}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => {
                          e.stopPropagation();
                          const f = e.target.files?.[0];
                          if (f) handlePhotoAttach(f, j.id);
                        }}
                      />
                      {rPhoto && !scanning && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setRPhoto(null);
                            setScannedPhotoUrl("");
                            setScannedItems([]);
                            setScannedVendor("");
                            if (photoRef.current) photoRef.current.value = "";
                          }}
                          style={{ background: "none", color: "var(--color-accent-red)", fontSize: 13, padding: 0 }}
                        >
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, justifyContent: "center" }}>
                            <Icon name="close" size={12} />Remove
                          </span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        });
      })()}

      <div style={{ textAlign: "center", marginTop: 16 }}>
        <p className="dim" style={{ fontSize: 12 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, justifyContent: "center" }}>
            <Icon name="tip" size={14} color="var(--color-highlight)" />
            {jobTab === "active" ? "Next step: Schedule a job → then start the Timer" : jobTab === "billing" ? "Send payment links to collect from clients" : "All paid — great work!"}
          </span>
        </p>
      </div>

      {/* Payment QR overlay */}
      {payQR && (
        <div
          onClick={() => setPayQR(null)}
          style={{
            position: "fixed", inset: 0,
            background: "rgba(0,0,0,0.9)",
            display: "flex", alignItems: "center", justifyContent: "center",
            zIndex: 999, cursor: "pointer",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ textAlign: "center", cursor: "default" }}
          >
            <div style={{ fontSize: 14, color: "#888", fontFamily: "Oswald", textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 12 }}>
              Scan to Pay
            </div>
            <div style={{ background: "#fff", display: "inline-block", padding: 16, borderRadius: 12, marginBottom: 12 }}>
              <QRCodeSVG value={payQR.url} size={200} level="M" />
            </div>
            <div style={{ fontSize: 32, fontFamily: "Oswald", fontWeight: 700, color: "#00cc66", marginBottom: 4 }}>
              ${payQR.amount.toLocaleString()}
            </div>
            <div style={{ fontSize: 12, color: "#888", marginBottom: 16 }}>
              Customer scans with phone camera → pays with Apple Pay, Google Pay, or card
            </div>
            <button
              className="bo"
              onClick={() => setPayQR(null)}
              style={{ fontSize: 13, padding: "6px 16px", color: "#888" }}
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* Photo viewer overlay — full-screen lightbox with close button.
          touch-action:pinch-zoom lets the browser handle pinch-to-zoom on
          mobile; double-tap on iOS / Android also zooms by default. */}
      {viewPhoto && (
        <div
          onClick={() => setViewPhoto(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.95)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
            cursor: "pointer",
            overflow: "auto",
          }}
        >
          <button
            onClick={(e) => { e.stopPropagation(); setViewPhoto(null); }}
            aria-label="Close"
            style={{
              position: "fixed",
              top: 12,
              right: 12,
              width: 40,
              height: 40,
              borderRadius: 20,
              background: "rgba(255,255,255,0.15)",
              border: "1px solid rgba(255,255,255,0.3)",
              color: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              zIndex: 10000,
              padding: 0,
            }}
          >
            <Icon name="close" size={20} color="#fff" />
          </button>
          <a
            href={viewPhoto}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "fixed",
              top: 16,
              left: 16,
              fontSize: 12,
              color: "rgba(255,255,255,0.7)",
              textDecoration: "underline",
              zIndex: 10000,
            }}
          >
            Open original
          </a>
          <img
            src={viewPhoto}
            alt="Receipt"
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: "100vw",
              maxHeight: "100vh",
              objectFit: "contain",
              touchAction: "pinch-zoom",
              cursor: "default",
            }}
          />
        </div>
      )}

      {/* Review-request modal — auto-opens when a job hits complete/paid,
          or when the user clicks "📨 Request Review" on a job row. */}
      <ReviewRequestModal
        job={reviewJob}
        onClose={() => setReviewJob(null)}
        onSent={() => loadAll()}
      />

      {/* Make-recurring modal — converts a one-off job into a recurring
          template by inserting a recurring_jobs row. Original job is
          left untouched; the cron at /api/recurring/fire spawns fresh
          jobs from the template on cadence. */}
      {recurringFrom && (
        <MakeRecurringModal
          job={recurringFrom}
          orgId={user.org_id}
          onClose={() => setRecurringFrom(null)}
          onCreated={async () => {
            setRecurringFrom(null);
            await loadAll();
          }}
        />
      )}
    </div>
  );
}

function MakeRecurringModal({
  job,
  orgId,
  onClose,
  onCreated,
}: {
  job: Job;
  orgId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [cadence, setCadence] = useState<Cadence>("monthly");
  const [dayOfWeek, setDayOfWeek] = useState<number>(1);
  const [dayOfMonth, setDayOfMonth] = useState<number>(1);
  const [hour, setHour] = useState<number>(9);
  const [title, setTitle] = useState<string>(job.property || "");
  const [saving, setSaving] = useState(false);

  const isWeekly = cadence === "weekly" || cadence === "biweekly";

  const save = async () => {
    setSaving(true);
    let templateRooms: unknown = {};
    try {
      templateRooms = typeof job.rooms === "string" ? JSON.parse(job.rooms) : job.rooms;
    } catch {
      templateRooms = {};
    }
    const nextFire = computeNextFire(new Date(), cadence, {
      dayOfWeek: isWeekly ? dayOfWeek : undefined,
      dayOfMonth: !isWeekly ? dayOfMonth : undefined,
      hour,
    });
    await db.post("recurring_jobs", {
      org_id: orgId,
      customer_id: job.customer_id ?? null,
      address_id: job.address_id ?? null,
      property: job.property,
      client: job.client,
      template_rooms: templateRooms,
      title: title.trim() || job.property || "Recurring service",
      cadence,
      day_of_week: isWeekly ? dayOfWeek : null,
      day_of_month: !isWeekly ? dayOfMonth : null,
      hour,
      is_active: true,
      next_fire_at: nextFire.toISOString(),
    });
    setSaving(false);
    useStore.getState().showToast("Recurring template created — manage in Ops → Recurring", "success");
    onCreated();
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", zIndex: 1500,
        display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
      }}
    >
      <div
        className="cd"
        onClick={(e) => e.stopPropagation()}
        style={{ width: "100%", maxWidth: 480 }}
      >
        <div className="row mb" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ fontSize: 15 }}>Make recurring</h3>
          <button className="bo" onClick={onClose} style={{ padding: "2px 8px" }}>
            <Icon name="close" size={14} />
          </button>
        </div>

        <div style={{ fontSize: 12, color: "#888", marginBottom: 10 }}>
          From <strong>{job.property}</strong>{job.client ? ` · ${job.client}` : ""}.
          A new scheduled job will be created on every fire, with the same line items + work order.
        </div>

        <div className="g2 mb" style={{ gap: 8 }}>
          <div>
            <label className="sl">Title</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Lawn maintenance"
              style={{ marginTop: 4 }}
            />
          </div>
          <div>
            <label className="sl">Cadence</label>
            <select
              value={cadence}
              onChange={(e) => setCadence(e.target.value as Cadence)}
              style={{ marginTop: 4 }}
            >
              {CADENCES.map((c) => (
                <option key={c} value={c}>{CADENCE_LABELS[c]}</option>
              ))}
            </select>
          </div>
          {isWeekly ? (
            <div>
              <label className="sl">Day of week</label>
              <select
                value={dayOfWeek}
                onChange={(e) => setDayOfWeek(parseInt(e.target.value, 10))}
                style={{ marginTop: 4 }}
              >
                {DAY_OF_WEEK_LABELS.map((lbl, i) => (
                  <option key={i} value={i}>{lbl}</option>
                ))}
              </select>
            </div>
          ) : (
            <div>
              <label className="sl">Day of month (1-28)</label>
              <input
                type="number"
                min={1}
                max={28}
                value={dayOfMonth}
                onChange={(e) => setDayOfMonth(parseInt(e.target.value, 10) || 1)}
                style={{ marginTop: 4 }}
              />
            </div>
          )}
          <div>
            <label className="sl">Hour (0-23)</label>
            <input
              type="number"
              min={0}
              max={23}
              value={hour}
              onChange={(e) => setHour(parseInt(e.target.value, 10) || 0)}
              style={{ marginTop: 4 }}
            />
          </div>
        </div>

        <div style={{ fontSize: 11, color: "#888", marginTop: 4 }}>
          First fire: <strong>{formatNextFire(computeNextFire(new Date(), cadence, { dayOfWeek: isWeekly ? dayOfWeek : undefined, dayOfMonth: !isWeekly ? dayOfMonth : undefined, hour }).toISOString())}</strong>
        </div>

        <div className="row" style={{ marginTop: 12, gap: 6 }}>
          <button className="bb" onClick={save} disabled={saving} style={{ fontSize: 12 }}>
            {saving ? "Saving…" : "Create"}
          </button>
          <button className="bo" onClick={onClose} style={{ fontSize: 12 }}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function JobNotesInput({ job }: { job: Job }) {
  const initial = (() => {
    try {
      const d = typeof job.rooms === "string" ? JSON.parse(job.rooms) : job.rooms;
      return d?.jobNotes || "";
    } catch { return ""; }
  })();
  const [value, setValue] = useState(initial);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSaved = useRef(initial);
  const valueRef = useRef(value);
  valueRef.current = value;

  const save = async (note: string) => {
    if (note === lastSaved.current) return;
    lastSaved.current = note;
    try {
      const fresh = useStore.getState().jobs.find((x) => x.id === job.id) || job;
      const d = typeof fresh.rooms === "string" ? JSON.parse(fresh.rooms) : (fresh.rooms || {});
      d.jobNotes = note;
      await db.patch("jobs", job.id, { rooms: JSON.stringify(d) });
    } catch { /* */ }
  };

  useEffect(() => {
    return () => {
      if (timer.current) {
        clearTimeout(timer.current);
        save(valueRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <textarea
      placeholder={t("jobs.jobNotes")}
      value={value}
      onChange={(e) => {
        const v = e.target.value;
        setValue(v);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => save(v), 500);
      }}
      onBlur={() => {
        if (timer.current) { clearTimeout(timer.current); timer.current = null; }
        save(valueRef.current);
      }}
      onClick={(e) => e.stopPropagation()}
      style={{ fontSize: 12, height: 50, resize: "vertical" }}
    />
  );
}
