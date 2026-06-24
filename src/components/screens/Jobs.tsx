"use client";
import { apiFetch, getStatusLink } from "@/lib/api";
import { useState, useRef, useEffect, useMemo } from "react";
import { useStore } from "@/lib/store";
import { db, supabase } from "@/lib/supabase";
import { exportJobReport } from "@/lib/export-job-report";
import { QRCodeSVG } from "qrcode.react";
import type { Job } from "@/lib/types";
import { statusColor } from "@/lib/status";
import { t } from "@/lib/i18n";
import { extractZip } from "@/lib/parser";
import { recordJobOutcome } from "@/lib/learning";
import { Icon } from "../Icon";
import { pickReceiptPhoto } from "@/lib/image";
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
  /** Open straight to this job's detail screen (notification deep-link).
   *  Seeds detail state on mount; clearInitialDetail resets the parent so a
   *  later plain nav to Jobs lands on the list. */
  initialDetailJobId?: string | null;
  clearInitialDetail?: () => void;
}

export default function Jobs({ setPage, onEditJob, onScheduleJob, initialDetailJobId, clearInitialDetail }: Props) {
  const user = useStore((s) => s.user)!;
  const org = useStore((s) => s.org);
  const profiles = useStore((s) => s.profiles);
  const jobs = useStore((s) => s.jobs);
  const receipts = useStore((s) => s.receipts);
  const timeEntries = useStore((s) => s.timeEntries);
  const payHistory = useStore((s) => s.payHistory);
  const reviewRequests = useStore((s) => s.reviewRequests);
  const customers = useStore((s) => s.customers);
  const loadAll = useStore((s) => s.loadAll);
  const darkMode = useStore((s) => s.darkMode);
  // Inline dark tokens are fixed values — the Properties value-pills sit on a
  // white .section card in light mode, so flip their fill/border or the
  // inherited (dark) text renders black-on-black.
  const pillBg = darkMode ? "var(--color-card-dark-2)" : "var(--color-light-bg)";
  const pillBorder = darkMode ? "var(--color-border-dark-2)" : "var(--color-border-light)";

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
  // Phase 2 redesign: id of the job shown in the separate detail screen
  // (null = the Jobs list). Set by tapping a card; cleared by the Back button.
  const [detailJobId, setDetailJobId] = useState<string | null>(initialDetailJobId ?? null);
  // Consume the deep-link target once: reset the parent so navigating back
  // to Jobs via the nav tab later opens the list, not this job again.
  useEffect(() => {
    if (initialDetailJobId) clearInitialDetail?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Phase 3: sub-screen opened from the detail's Work section (work order /
  // receipts). null = show the detail (or the list). Back clears it.
  const [subScreen, setSubScreen] = useState<{ id: string; kind: "workorder" | "receipts" } | null>(null);
  // "Send to client" SMS strip — once the (tokenized) status link is minted we
  // open an editable strip that fires a native sms: deep link, matching the
  // notify buttons. Scoped by jobId so switching jobs hides a stale draft.
  const [sendStrip, setSendStrip] = useState<{ jobId: string; phone: string; msg: string } | null>(null);
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
  // Receipts use the device's NATIVE camera/photo picker (HD) via
  // pickReceiptPhoto — reliable on iOS where the in-app camera can't open,
  // and high-res enough for the AI scan to read line items.
  const [scannedPhotoUrl, setScannedPhotoUrl] = useState("");
  const [scannedItems, setScannedItems] = useState<{ name?: string; qty?: number; price?: number }[]>([]);
  const [scannedVendor, setScannedVendor] = useState("");
  const [viewPhoto, setViewPhoto] = useState<string | null>(null);
  const [payQR, setPayQR] = useState<{ url: string; jobId: string; amount: number } | null>(null);
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
    const path = `${jobId}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
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

      const res = await apiFetch("/api/ai/receipt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl: photoUrl }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        useStore.getState().showToast(
          t("jobs.scanFailedManual") + " " + (err?.error || res.statusText),
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
          ? `${t("jobs.scanned")}: $${total.toFixed(2)}${vendor ? ` ${t("jobs.scannedAt")} ${vendor}` : ""} — ${t("jobs.reviewAndAdd")}`
          : t("jobs.scannedReviewFields"),
        "success",
      );
    } catch (err) {
      console.error("receipt scan error:", err);
      useStore.getState().showToast(
        t("jobs.scanFailedManual") + " " + (err instanceof Error ? err.message : String(err)),
        "warning",
      );
    }
    setScanning(false);
  };

  const addReceipt = async (jobId: string) => {
    if (!rn.trim()) { useStore.getState().showToast(t("jobs.enterReceiptNote"), "warning"); return; }
    const amt = parseFloat(ra);
    if (!amt || amt <= 0) { useStore.getState().showToast(t("jobs.enterValidAmount"), "warning"); return; }
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
      useStore.getState().showToast(t("jobs.receiptAdded"), "success");
    } catch (err) {
      console.error(err);
      useStore.getState().showToast(
        t("jobs.errorSavingReceipt") + " " + (err instanceof Error ? err.message : String(err)),
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
            if (!await useStore.getState().showConfirm(t("jobs.incompleteItems"), `${unchecked} ${unchecked !== 1 ? t("jobs.workOrderItemsPlural") : t("jobs.workOrderItemSingular")} ${t("jobs.stillUncheckedMarkComplete")}`)) return;
          }
        } catch { /* no work order, proceed */ }
      }
    }
    await db.patch("jobs", id, { status });

    // When a job goes Complete, teach the AI quoter from its real hours
    // (job-level per trade + per item). Shared via recordJobOutcome with
    // WorkVision's Complete Job button so EVERY completion path feeds learning,
    // not just this admin one.
    if (status === "complete") {
      const completedJob = jobs.find((j) => j.id === id);
      if (completedJob) {
        try {
          await recordJobOutcome(completedJob, getJobLabor(completedJob).totalHrs);
        } catch { /* learning is best-effort */ }
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
        useStore.getState().showToast(t("jobs.clientMsgCopiedSendTo") + " " + job.client, "success");
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
    if (await useStore.getState().showConfirm(t("jobs.deleteJobTitle"), t("jobs.deleteJobBody"))) {
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
      useStore.getState().showToast(t("jobs.allowPopupsInvoice"), "error");
    }
  };

  // Status-aware primary action for the detail header — the single
  // "what's next" button that advances a job through its lifecycle,
  // wired to the handlers that already exist on this screen.
  const primaryCTA = (dj: typeof jobs[0]): { label: string; icon: string; onClick: () => void } | null => {
    switch (dj.status) {
      case "lead":      return { label: t("jobs.buildQuote"), icon: "quote", onClick: () => onEditJob?.(dj.id) };
      case "quoted":    return { label: t("jobs.editSendQuote"), icon: "edit", onClick: () => onEditJob?.(dj.id) };
      case "accepted":  return { label: t("jobs.schedule"), icon: "schedule", onClick: () => (onScheduleJob ? onScheduleJob(dj.property) : setPage("sched")) };
      case "scheduled": return { label: t("jobs.markActive"), icon: "play", onClick: () => setStatus(dj.id, "active") };
      case "active":    return { label: t("jobs.markComplete"), icon: "check", onClick: () => setStatus(dj.id, "complete") };
      case "complete":  return { label: t("jobs.generateInvoice"), icon: "receipt", onClick: () => { generateInvoice(dj); setStatus(dj.id, "invoiced"); } };
      case "invoiced":  return { label: t("jobs.markPaid"), icon: "checkCircle", onClick: () => setStatus(dj.id, "paid") };
      case "paid":      return { label: t("jobs.requestReview"), icon: "star", onClick: () => setReviewJob(dj) };
      default:          return null;
    }
  };

  // ── PHASE 2: Job detail screen ──────────────────────────────
  // Separate-screen detail (per the redesign mockup): replaces the Jobs
  // list when a card is opened (detailJobId). Computed as a VALUE, not an
  // early return, so the modals at the end of the main return — recurring,
  // review, QR-collect — still render while the detail screen is open.
  const detailScreen = (() => {
    if (!detailJobId) return null;
    const dj = jobs.find((x) => x.id === detailJobId);
    if (!dj) return null;
      const cta = primaryCTA(dj);
      const djLead = dj.status === "lead" ? (() => {
        try {
          const data = typeof dj.rooms === "string" ? JSON.parse(dj.rooms) : dj.rooms;
          return {
            description: data?.leadDescription as string | undefined,
            photos: (Array.isArray(data?.leadPhotos) ? data.leadPhotos : []) as string[],
          };
        } catch { return null; }
      })() : null;
      // Editable job number + notes live in the rooms blob (no schema
      // migration), same pattern as jobNotes / workOrder.
      let djRoomsData: Record<string, unknown> = {};
      try { djRoomsData = typeof dj.rooms === "string" ? JSON.parse(dj.rooms) : (dj.rooms || {}); } catch { djRoomsData = {}; }
      const djJobNumber = typeof djRoomsData.jobNumber === "string" ? djRoomsData.jobNumber : "";
      return (
        <>
          {/* Topbar — back · JOB · print */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 11 }}>
            <button className="bo" onClick={() => setDetailJobId(null)} style={{ fontSize: 14, padding: "6px 10px", display: "inline-flex", alignItems: "center", gap: 5 }}>
              <Icon name="back" size={15} /> {t("nav.jobs")}
            </button>
            <div style={{ fontFamily: "Oswald", fontWeight: 700, fontSize: 20, letterSpacing: ".5px" }}>{t("jobs.jobUpper")}</div>
            <button className="bo" onClick={() => generateInvoice(dj)} title={t("jobs.printInvoice")} style={{ padding: "6px 9px", display: "inline-flex", alignItems: "center" }}>
              <Icon name="print" size={15} />
            </button>
          </div>

          {/* Detail header */}
          <div className="dhead">
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 12, fontFamily: "Oswald", letterSpacing: ".1em", textTransform: "uppercase", color: "#9db4d6", flexShrink: 0 }}>{t("jobs.jobNumberLabel")}</span>
              <input
                key={dj.id}
                defaultValue={djJobNumber}
                placeholder="—"
                onBlur={(e) => {
                  const val = e.target.value.trim();
                  enqueueRoomsWrite(async () => {
                    const fresh = useStore.getState().jobs.find((x) => x.id === dj.id);
                    if (!fresh) return;
                    let fd: Record<string, unknown> = {};
                    try { fd = typeof fresh.rooms === "string" ? JSON.parse(fresh.rooms) : (fresh.rooms || {}); } catch { return; }
                    if (((fd.jobNumber as string) || "") === val) return;
                    await db.patch("jobs", dj.id, { rooms: JSON.stringify({ ...fd, jobNumber: val }) });
                    await loadAll();
                  });
                }}
                style={{ flex: 1, background: "rgba(255,255,255,0.06)", border: "1px solid #243a5e", borderRadius: 6, padding: "3px 8px", fontFamily: "Oswald", fontSize: 15, color: "inherit", maxWidth: 150 }}
              />
            </div>
            <div style={{ fontFamily: "Oswald", fontWeight: 700, fontSize: 20, letterSpacing: ".4px" }}>
              {dj.property || t("jobs.noAddress")}
            </div>
            {dj.client && <div style={{ fontSize: 13.5, color: "#9db4d6", marginTop: 2 }}>{dj.client}</div>}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10, gap: 8 }}>
              <select
                value={dj.status || "quoted"}
                onChange={(e) => setStatus(dj.id, e.target.value)}
                aria-label={t("jobs.jobStatus")}
                style={{
                  WebkitAppearance: "none", MozAppearance: "none", appearance: "none",
                  fontFamily: "Oswald", fontSize: 13, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".06em",
                  color: statusColor(dj.status), backgroundColor: statusColor(dj.status) + "1f",
                  border: `1px solid ${statusColor(dj.status)}66`, borderRadius: 999,
                  padding: "3px 20px 3px 10px", cursor: "pointer",
                  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='5'%3E%3Cpath fill='${encodeURIComponent(statusColor(dj.status))}' d='M0 0 L8 0 L4 5 Z'/%3E%3C/svg%3E")`,
                  backgroundRepeat: "no-repeat", backgroundPosition: "right 8px center",
                }}
              >
                <option value="lead"      style={{ color: "#e8e8ee", background: "#1a1a28" }}>{t("jobs.lead")}</option>
                <option value="quoted"    style={{ color: "#e8e8ee", background: "#1a1a28" }}>{t("status.quoted")}</option>
                <option value="accepted"  style={{ color: "#e8e8ee", background: "#1a1a28" }}>{t("status.accepted")}</option>
                <option value="scheduled" style={{ color: "#e8e8ee", background: "#1a1a28" }}>{t("status.scheduled")}</option>
                <option value="active"    style={{ color: "#e8e8ee", background: "#1a1a28" }}>{t("status.active")}</option>
                <option value="complete"  style={{ color: "#e8e8ee", background: "#1a1a28" }}>{t("status.complete")}</option>
                <option value="invoiced"  style={{ color: "#e8e8ee", background: "#1a1a28" }}>{t("status.invoiced")}</option>
                <option value="paid"      style={{ color: "#e8e8ee", background: "#1a1a28" }}>{t("status.paid")}</option>
              </select>
              <div style={{ fontFamily: "Oswald", fontWeight: 700, fontSize: 24, color: "var(--color-money)" }}>${(dj.total || 0).toFixed(0)}</div>
            </div>
            {dj.property && (
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(dj.property)}`}
                target="_blank" rel="noopener noreferrer"
                style={{ fontSize: 13, color: "#7fb6ff", display: "inline-flex", alignItems: "center", gap: 5, marginTop: 9, textDecoration: "none" }}
              >
                <Icon name="mapPin" size={13} /> {t("jobs.showOnMap")}
              </a>
            )}
          </div>

          {/* Status-aware primary action */}
          {cta && (
            <button className="bb mb" onClick={cta.onClick} style={{ width: "100%", padding: "11px", fontFamily: "Oswald", fontSize: 16, letterSpacing: ".4px", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
              <Icon name={cta.icon} size={16} /> {cta.label}
            </button>
          )}

          {/* Lead context — the prospect's request + photos (lead jobs only) */}
          {djLead && (djLead.description || djLead.photos.length > 0) && (
            <div className="section" style={{ borderLeft: "3px solid #ff3d6e" }}>
              <div className="seclabel" style={{ color: "#ff3d6e", borderBottom: "none", marginBottom: 0 }}>
                <Icon name="star" size={13} /> {t("jobs.requestFromProspect")}
              </div>
              {djLead.description && (
                <div style={{ fontSize: 15, whiteSpace: "pre-wrap", padding: djLead.photos.length ? "0 0 8px" : "0 0 4px" }}>
                  {djLead.description}
                </div>
              )}
              {djLead.photos.length > 0 && (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(70px, 1fr))", gap: 6, paddingBottom: 4 }}>
                  {djLead.photos.map((url, i) => (
                    <a key={i} href={url} target="_blank" rel="noopener noreferrer">
                      <img src={url} alt="" style={{ width: "100%", height: 70, objectFit: "cover", borderRadius: 6, border: "1px solid var(--color-border-dark)" }} />
                    </a>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Properties */}
          <div className="section">
            <div className="seclabel"><Icon name="settings" size={13} /> {t("jobs.properties")}</div>
            <div className="drow">
              <span className="l">{t("jobs.trade")}</span>
              <div style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 9px", borderRadius: 99, background: pillBg, border: `1px solid ${pillBorder}` }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{dj.trade || t("jobs.none")}</span>
                <Icon name="expand" size={12} color="var(--color-dim)" />
                <select
                  value={dj.trade || ""}
                  onChange={async (e) => { await db.patch("jobs", dj.id, { trade: e.target.value }); loadAll(); }}
                  aria-label={t("jobs.trade")}
                  style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0, cursor: "pointer", WebkitAppearance: "none", appearance: "none" }}
                >
                  <option value="">{t("jobs.none")}</option>
                  <option value="Plumbing">Plumbing</option>
                  <option value="Electrical">Electrical</option>
                  <option value="Carpentry">Carpentry</option>
                  <option value="HVAC">HVAC</option>
                  <option value="Painting">Painting</option>
                  <option value="Flooring">Flooring</option>
                  <option value="General">General</option>
                </select>
              </div>
            </div>
            <div className="drow">
              <span className="l">{t("jobs.requestedTech")}</span>
              <div style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 9px", borderRadius: 99, background: pillBg, border: `1px solid ${pillBorder}` }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{dj.requested_tech || t("jobs.anyone")}</span>
                <Icon name="expand" size={12} color="var(--color-dim)" />
                <select
                  value={dj.requested_tech || ""}
                  aria-label={t("jobs.requestedTech")}
                  onChange={async (e) => {
                    const techName = e.target.value;
                    const prev = dj.requested_tech || "";
                    await db.patch("jobs", dj.id, { requested_tech: techName });
                    loadAll();
                    // Notify the newly-assigned tech. Skip clears ("Anyone"),
                    // re-selecting the same tech, and self-assignment. Fire-and-
                    // forget — the assignment itself already succeeded above.
                    if (techName && techName !== prev) {
                      const tech = profiles.find((p) => p.name === techName);
                      const orgId = user.org_id || org?.id;
                      if (tech && orgId && tech.id !== user.id) {
                        apiFetch("/api/notify", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ type: "job_assigned", orgId, jobId: dj.id, recipientId: tech.id, techName, actorId: user.id }),
                        }).catch(() => { /* non-blocking */ });
                      }
                    }
                  }}
                  style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0, cursor: "pointer", WebkitAppearance: "none", appearance: "none" }}
                >
                  <option value="">{t("jobs.anyone")}</option>
                  {profiles.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
                </select>
              </div>
            </div>
            <div className="drow">
              <span className="l">{t("jobs.created")}</span>
              <span className="v">{dj.job_date || (dj.created_at ? dj.created_at.slice(0, 10) : "—")}</span>
            </div>
          </div>

          {/* Notes */}
          <div className="section">
            <div className="seclabel"><Icon name="edit" size={13} /> {t("common.notes")}</div>
            <div style={{ paddingTop: 6 }}>
              <JobNotesInput job={dj} />
            </div>
          </div>

          {/* Money */}
          <div className="section">
            <div className="seclabel"><Icon name="money" size={13} /> {t("jobs.money")}</div>
            <div className="drow">
              <span className="l">{t("jobs.quoteTotal")}</span>
              <span className="v" style={{ fontFamily: "Oswald", fontSize: 16, color: "var(--color-money)" }}>
                ${(dj.total || 0).toFixed(0)}
                {onEditJob && (
                  <button onClick={() => onEditJob(dj.id)} title={t("jobs.editQuote")} style={{ background: "transparent", border: "none", color: "var(--color-primary)", cursor: "pointer", padding: 0, marginLeft: 6, display: "inline-flex", alignItems: "center" }}>
                    <Icon name="edit" size={13} />
                  </button>
                )}
              </span>
            </div>
            {(() => {
              const labor = getJobLabor(dj);
              const quoted = dj.total_hrs || 0;
              const variancePct = quoted > 0 ? ((labor.totalHrs - quoted) / quoted) * 100 : 0;
              const overBudget = labor.totalHrs > quoted && quoted > 0;
              const underBudget = quoted > 0 && labor.totalHrs > 0 && labor.totalHrs <= quoted;
              return (
                <>
                <div style={{ display: "flex", gap: 6, paddingTop: 8 }}>
                  <div style={{ flex: 1, textAlign: "center", padding: 6, borderRadius: 6, background: darkMode ? "#1a1a28" : "#f5f5f8" }}>
                    <div className="sl">{t("qf.labor")}</div>
                    <div style={{ fontFamily: "Oswald", color: "var(--color-primary)", fontSize: 16 }}>${(dj.total_labor || 0).toFixed(0)}</div>
                  </div>
                  <div style={{ flex: 1, textAlign: "center", padding: 6, borderRadius: 6, background: darkMode ? "#1a1a28" : "#f5f5f8" }}>
                    <div className="sl">{t("qf.materials")}</div>
                    <div style={{ fontFamily: "Oswald", color: "var(--color-warning)", fontSize: 16 }}>${(dj.total_mat || 0).toFixed(0)}</div>
                  </div>
                  <div style={{ flex: 1, textAlign: "center", padding: 6, borderRadius: 6, background: darkMode ? "#1a1a28" : "#f5f5f8" }}>
                    <div className="sl">{t("common.hours")}</div>
                    <div style={{ fontFamily: "Oswald", color: "var(--color-highlight)", fontSize: 16 }}>{quoted.toFixed(1)}</div>
                    {labor.totalHrs > 0 && (
                      <div
                        style={{ fontSize: 11, marginTop: 2, color: overBudget ? "var(--color-accent-red)" : underBudget ? "var(--color-success)" : "#888", fontFamily: "Oswald" }}
                        title={t("jobs.actualHoursLogged")}
                      >
                        {labor.totalHrs.toFixed(1)}h {t("jobs.actual")}{quoted > 0 && ` (${variancePct >= 0 ? "+" : ""}${variancePct.toFixed(0)}%)`}
                      </div>
                    )}
                  </div>
                </div>
                {labor.byPerson.length > 0 && (
                  <div style={{ paddingTop: 10 }}>
                    <div className="sl" style={{ marginBottom: 5 }}>{t("jobs.timeLogged")}</div>
                    {labor.byPerson.map((p, i) => (
                      <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13.5, padding: "3px 0" }}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                          <Icon name="worker" size={13} color="var(--color-dim)" />
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
                        </span>
                        <span style={{ fontFamily: "Oswald", flexShrink: 0, marginLeft: 8, color: "var(--color-highlight)" }}>{p.hrs.toFixed(1)}h</span>
                      </div>
                    ))}
                  </div>
                )}
                </>
              );
            })()}
            {(dj.status === "complete" || dj.status === "invoiced" || dj.status === "paid") && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 7, paddingTop: 8 }}>
                <button
                  className="bo"
                  onClick={() => { generateInvoice(dj); if (dj.status === "complete") setStatus(dj.id, "invoiced"); }}
                  style={{ fontSize: 14, padding: "8px", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6 }}
                >
                  <Icon name="receipt" size={14} /> {dj.status === "complete" ? t("jobs.invoice") : t("jobs.viewInvoice")}
                </button>
                {(dj.status === "invoiced" || dj.status === "complete") && dj.total > 0 && org?.stripe_connected && (
                  <>
                    <button
                      className="bo"
                      onClick={async () => {
                        try {
                          const res = await fetch("/api/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId: dj.id, property: dj.property, client: dj.client, amount: dj.total, orgName: org?.name || "Service Provider", stripeAccountId: org?.stripe_account_id || "" }) });
                          const data = await res.json();
                          if (data.url) { navigator.clipboard.writeText(data.url); useStore.getState().showToast(t("jobs.paymentLinkCopied"), "success"); if (dj.status === "complete") setStatus(dj.id, "invoiced"); }
                          else useStore.getState().showToast(t("jobs.errorPrefix") + " " + (data.error || t("jobs.couldNotCreateLink")), "error");
                        } catch { useStore.getState().showToast(t("jobs.failedCreateLink"), "error"); }
                      }}
                      style={{ fontSize: 14, padding: "8px", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6 }}
                    >
                      <Icon name="link" size={14} /> {t("jobs.sendLink")}
                    </button>
                    <button
                      className="bo"
                      onClick={async () => {
                        try {
                          const res = await fetch("/api/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId: dj.id, property: dj.property, client: dj.client, amount: dj.total, orgName: org?.name || "Service Provider", stripeAccountId: org?.stripe_account_id || "" }) });
                          const data = await res.json();
                          if (data.url) { setPayQR({ url: data.url, jobId: dj.id, amount: dj.total }); if (dj.status === "complete") setStatus(dj.id, "invoiced"); }
                          else useStore.getState().showToast(t("jobs.errorPrefix") + " " + (data.error || t("jobs.couldNotCreatePayment")), "error");
                        } catch { useStore.getState().showToast(t("jobs.failedCreatePayment"), "error"); }
                      }}
                      style={{ fontSize: 14, padding: "8px", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6 }}
                    >
                      <Icon name="qr" size={14} /> {t("jobs.collectNow")}
                    </button>
                  </>
                )}
                {dj.status === "invoiced" && (
                  <button
                    className="bg"
                    onClick={() => setStatus(dj.id, "paid")}
                    style={{ fontSize: 14, padding: "8px", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6 }}
                  >
                    <Icon name="check" size={14} /> {t("jobs.markPaid")}
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Work */}
          <div className="section">
            <div className="seclabel"><Icon name="list" size={13} /> {t("nav.work")}</div>
            {onEditJob && (
              <div className="linkrow" onClick={() => onEditJob(dj.id)}>
                <span className="lf"><span className="ic"><Icon name="edit" size={15} /></span> {t("jobs.editQuote")}</span>
                <Icon name="next" size={15} style={{ color: "var(--color-dim)" }} />
              </div>
            )}
            <div className="linkrow" onClick={() => setSubScreen({ id: dj.id, kind: "workorder" })}>
              <span className="lf"><span className="ic"><Icon name="list" size={15} /></span> {t("jobs.workOrder")}</span>
              <Icon name="next" size={15} style={{ color: "var(--color-dim)" }} />
            </div>
            <div className="linkrow" onClick={() => setSubScreen({ id: dj.id, kind: "receipts" })}>
              <span className="lf"><span className="ic" style={{ color: "var(--color-warning)" }}><Icon name="receipt" size={15} /></span> {t("jobs.receiptsAndPhotos")}</span>
              <Icon name="next" size={15} style={{ color: "var(--color-dim)" }} />
            </div>
          </div>

          {/* Manage */}
          <div className="section">
            <div className="seclabel"><Icon name="settings" size={13} /> {t("jobs.manage")}</div>
            <div className="linkrow" onClick={() => setRecurringFrom(dj)}>
              <span className="lf"><span className="ic"><Icon name="refresh" size={15} /></span> {t("jobs.makeRecurring")}</span>
              <Icon name="next" size={15} style={{ color: "var(--color-dim)" }} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 7, paddingTop: 8 }}>
              <button
                className="bo"
                onClick={async () => {
                  const cust = dj.customer_id ? customers.find((c) => c.id === dj.customer_id) : undefined;
                  const url = await getStatusLink(dj.id);
                  const msg = dj.status === "quoted" || dj.status === "accepted"
                    ? `Hi! Here's your quote from ${org?.name || "us"} for ${dj.property}:\n\nTotal: $${(dj.total || 0).toFixed(2)}\n\nView details & approve: ${url}`
                    : `Hi! Here's the status update for your job at ${dj.property}:\n\nView progress: ${url}`;
                  setSendStrip({ jobId: dj.id, phone: cust?.phone || "", msg });
                }}
                style={{ fontSize: 14, padding: "8px", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6 }}
              >
                <Icon name="send" size={13} /> {t("jobs.sendToClient")}
              </button>
              {(dj.status === "complete" || dj.status === "invoiced" || dj.status === "paid") && (
                <button
                  className="bo"
                  onClick={() => setReviewJob(dj)}
                  style={{ fontSize: 14, padding: "8px", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, color: dj.review_requested_at ? "#888" : "var(--color-highlight)" }}
                >
                  <Icon name={dj.review_requested_at ? "mail" : "star"} size={13} /> {dj.review_requested_at ? t("jobs.reviewSent") : t("jobs.requestReview")}
                </button>
              )}
            </div>
            {sendStrip && sendStrip.jobId === dj.id && (
              <div style={{ marginTop: 8, background: "var(--color-card-dark)", border: "1px solid var(--color-border-dark-2)", borderRadius: 12, padding: 11 }}>
                <div className="dim" style={{ fontSize: 12, marginBottom: 5 }}>
                  {sendStrip.phone ? `To ${sendStrip.phone} · edit if needed` : "No phone on file — Open Messages and pick a contact, or use Copy."}
                </div>
                <textarea
                  value={sendStrip.msg}
                  onChange={(e) => setSendStrip({ ...sendStrip, msg: e.target.value })}
                  rows={5}
                  style={{ width: "100%", fontSize: 14, padding: 9, borderRadius: 9, border: "1px solid var(--color-border-dark-2)", background: "var(--color-dark-bg)", color: "inherit", resize: "vertical", fontFamily: "Source Sans 3, sans-serif" }}
                />
                <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                  <a
                    href={`sms:${sendStrip.phone.replace(/[^\d+]/g, "")}?&body=${encodeURIComponent(sendStrip.msg)}`}
                    onClick={() => setSendStrip(null)}
                    className="bb"
                    style={{ flex: 1, textAlign: "center", textDecoration: "none", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, fontSize: 14 }}
                  >
                    <Icon name="send" size={15} color="#fff" /> Open Messages
                  </a>
                  <button type="button" className="bo" onClick={async () => { try { await navigator.clipboard.writeText(sendStrip.msg); useStore.getState().showToast(t("jobs.messageCopiedSend"), "success"); } catch { useStore.getState().showToast("Couldn't copy on this device", "error"); } }} style={{ fontSize: 14 }}>Copy</button>
                  <button type="button" className="bo" onClick={() => setSendStrip(null)} aria-label="Cancel" style={{ fontSize: 14, padding: "0 11px" }}><Icon name="close" size={14} /></button>
                </div>
              </div>
            )}
            {(dj.status === "scheduled" || dj.status === "active" || dj.status === "complete") && (
              <div style={{ paddingTop: 8 }}>
                <SmsNotifyButtons jobId={dj.id} variant="grid" />
              </div>
            )}
            {dj.status === "paid" && (() => {
              const rrows = reviewRequests
                .filter((r) => r.job_id === dj.id)
                .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
              const rr = rrows[0];
              const automationOn = org?.review_request_enabled !== false;
              let label: string;
              let color: string;
              let icon: "star" | "mail" | "info" = "star";
              if (rr?.status === "scheduled") {
                const hoursOut = Math.max(0, Math.round((new Date(rr.scheduled_for).getTime() - Date.now()) / 3600 / 1000));
                label = hoursOut <= 0 ? t("jobs.reviewQueued") : `${t("jobs.reviewScheduledIn")} ${hoursOut}h`;
                color = "var(--color-highlight)"; icon = "star";
              } else if (rr?.status === "sent") {
                label = `${t("jobs.reviewSentOn")} ${rr.sent_at ? new Date(rr.sent_at).toLocaleDateString() : "—"}`;
                color = "var(--color-success)"; icon = "mail";
              } else if (rr?.status === "failed") {
                label = `${t("jobs.reviewFailed")}${rr.error ? `: ${rr.error}` : ""}`;
                color = "var(--color-accent-red)"; icon = "info";
              } else if (rr?.status === "cancelled") {
                label = t("jobs.reviewCancelled"); color = "#888"; icon = "mail";
              } else if (!automationOn) {
                label = t("jobs.reviewOff"); color = "#888"; icon = "info";
              } else { return null; }
              return (
                <div
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, padding: "4px 8px", borderRadius: 6, background: darkMode ? "#0f0f18" : "#f5f5f8", color, marginTop: 8, fontFamily: "Oswald", letterSpacing: ".02em" }}
                  title={rr?.error || label}
                >
                  <Icon name={icon} size={12} color={color} />
                  {label}
                </div>
              );
            })()}
            <div style={{ display: "flex", gap: 7, paddingTop: 8 }}>
              {!dj.archived ? (
                <button
                  className="bo"
                  onClick={async () => { await db.patch("jobs", dj.id, { archived: true, archived_at: new Date().toISOString() }); loadAll(); }}
                  style={{ flex: 1, fontSize: 14, padding: "8px", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6 }}
                >
                  <Icon name="package" size={14} /> {t("jobs.archive")}
                </button>
              ) : (
                <button
                  className="bo"
                  onClick={async () => { await db.patch("jobs", dj.id, { archived: false, archived_at: null }); loadAll(); }}
                  style={{ flex: 1, fontSize: 14, padding: "8px", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6 }}
                >
                  <Icon name="refresh" size={14} /> {t("jobs.restore")}
                </button>
              )}
              <button
                className="br"
                onClick={() => deleteJob(dj.id)}
                style={{ flex: 1, fontSize: 14, padding: "8px", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6 }}
              >
                <Icon name="delete" size={14} /> {t("common.delete")}
              </button>
            </div>
          </div>
        </>
      );
  })();

  // ── PHASE 3: Work-order / Receipts sub-screens ──────────────
  // Opened from the detail's Work section. Rendered ahead of the detail
  // so Back (setSubScreen(null)) returns to the detail, which is still
  // mounted via detailJobId.
  type WOItem = { room: string; detail: string; action: string; pri: string; hrs: number; done: boolean };
  const subScreenJsx = (() => {
    if (!subScreen) return null;
    const sj = jobs.find((x) => x.id === subScreen.id);
    if (!sj) return null;
    return (
      <>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <button className="bo" onClick={() => setSubScreen(null)} style={{ fontSize: 14, padding: "6px 10px", display: "inline-flex", alignItems: "center", gap: 5 }}>
            <Icon name="back" size={15} /> {t("jobs.jobBack")}
          </button>
          <div style={{ fontFamily: "Oswald", fontWeight: 700, fontSize: 19, letterSpacing: ".5px" }}>
            {subScreen.kind === "workorder" ? t("jobs.workOrderUpper") : t("jobs.receiptsUpper")}
          </div>
          <span style={{ width: 56 }} />
        </div>
        <div className="dim" style={{ fontSize: 13.5, marginBottom: 11 }}>{sj.property}</div>

        {subScreen.kind === "workorder" && (() => {
          let jobData: Record<string, unknown> = {};
          try { jobData = typeof sj.rooms === "string" ? JSON.parse(sj.rooms) : (sj.rooms || {}); } catch { jobData = {}; }
          const workOrder: WOItem[] = Array.isArray(jobData.workOrder) ? (jobData.workOrder as WOItem[]) : [];
          if (!workOrder.length) {
            return (
              <div className="section">
                <div style={{ fontSize: 14, color: "var(--color-dim)", padding: "12px 0", textAlign: "center" }}>
                  {t("jobs.noWorkOrderItems")}
                </div>
              </div>
            );
          }
          const done = workOrder.filter((w) => w.done).length;
          const total = workOrder.length;
          return (
            <div>
              <div style={{ height: 7, background: "var(--color-card-dark-3)", borderRadius: 5, marginBottom: 4 }}>
                <div style={{ height: 7, background: "var(--color-success)", borderRadius: 5, width: `${(done / total) * 100}%`, transition: "width 0.3s" }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, color: "var(--color-dim)", marginBottom: 11 }}>
                <span>{t("jobs.progress")}</span><span>{done} / {total} {t("jobs.doneLower")}</span>
              </div>
              {workOrder.map((w, wi) => (
                <div
                  key={wi}
                  onClick={() => {
                    const targetKey = woStableKey(w);
                    const nextDone = !w.done;
                    enqueueRoomsWrite(async () => {
                      const fresh = useStore.getState().jobs.find((x) => x.id === sj.id);
                      if (!fresh) return;
                      let freshData: Record<string, unknown> = {};
                      try { freshData = typeof fresh.rooms === "string" ? JSON.parse(fresh.rooms) : (fresh.rooms || {}); } catch { return; }
                      const freshWO: WOItem[] = Array.isArray(freshData.workOrder) ? (freshData.workOrder as WOItem[]) : [];
                      const matchIdx = freshWO.findIndex((x) => woStableKey(x) === targetKey);
                      if (matchIdx < 0) return;
                      const updatedWO = [...freshWO];
                      updatedWO[matchIdx] = { ...updatedWO[matchIdx], done: nextDone };
                      await db.patch("jobs", sj.id, { rooms: JSON.stringify({ ...freshData, workOrder: updatedWO }) });
                      await loadAll();
                    });
                  }}
                  style={{ display: "flex", alignItems: "center", gap: 9, background: "var(--color-card-dark-2)", border: "1px solid var(--color-border-dark)", borderRadius: 12, padding: "9px 10px", marginBottom: 7, cursor: "pointer", opacity: w.done ? 0.6 : 1 }}
                >
                  <span style={{ width: 20, height: 20, borderRadius: 5, flexShrink: 0, border: `2px solid ${w.done ? "var(--color-success)" : "#555"}`, background: w.done ? "var(--color-success)" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, color: "#fff" }}>
                    {w.done && "✓"}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 500, textDecoration: w.done ? "line-through" : "none" }}>
                      <span style={{ fontSize: 11, padding: "1px 5px", borderRadius: 4, marginRight: 5, background: w.pri === "HIGH" ? "#C0000033" : w.pri === "MED" ? "#ff880033" : "#00cc6633", color: w.pri === "HIGH" ? "var(--color-accent-red)" : w.pri === "MED" ? "var(--color-warning)" : "var(--color-success)" }}>{w.pri}</span>
                      <b style={{ color: "var(--color-primary)" }}>{w.room}</b> — {w.detail}
                    </div>
                    {w.action && <div className="dim" style={{ fontSize: 12, marginTop: 1 }}>{w.action}</div>}
                  </div>
                  <span className="dim" style={{ fontSize: 12, flexShrink: 0 }}>{w.hrs}h</span>
                </div>
              ))}
            </div>
          );
        })()}

        {subScreen.kind === "receipts" && (
          <>
            {/* Add receipt — attach a photo to auto-scan (vendor/amount/items
                via AI -> price_corrections), or type the note + amount. */}
            <div className="section">
              <div className="seclabel"><Icon name="camera" size={13} /> {t("jobs.addReceipt")}</div>
              <div style={{ display: "flex", gap: 7, marginTop: 8 }}>
                <button
                  type="button"
                  className="bo"
                  disabled={scanning}
                  onClick={async () => { const f = await pickReceiptPhoto(true); if (f) handlePhotoAttach(f, sj.id); }}
                  style={{ flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, fontSize: 14, opacity: scanning ? 0.5 : 1 }}
                >
                  <Icon name="camera" size={15} /> {t("common.takePhoto")}
                </button>
                <button
                  type="button"
                  className="bo"
                  disabled={scanning}
                  onClick={async () => { const f = await pickReceiptPhoto(false); if (f) handlePhotoAttach(f, sj.id); }}
                  style={{ flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, fontSize: 14, opacity: scanning ? 0.5 : 1 }}
                >
                  <Icon name="upload" size={15} /> {t("common.upload")}
                </button>
              </div>
              <div className="dim" style={{ fontSize: 12.5, marginTop: 7, display: "flex", alignItems: "center", gap: 6 }}>
                <Icon name={scanning ? "time" : "sparkle"} size={13} color={scanning ? "var(--color-warning)" : "var(--color-primary)"} />
                {scanning ? t("jobs.scanningReceipt") : rPhoto ? rPhoto.name : t("jobs.attachPhotoAutoScan")}
              </div>
              <div style={{ display: "flex", gap: 7, marginTop: 8 }}>
                <input value={rn} onChange={(e) => setRn(e.target.value)} placeholder={scanning ? t("jobs.scanningShort") : t("jobs.noteVendor")} style={{ flex: 1 }} disabled={scanning} />
                <input type="number" value={ra} onChange={(e) => setRa(e.target.value)} placeholder="$" style={{ width: 72 }} disabled={scanning} />
                <button className="bg" onClick={() => addReceipt(sj.id)} style={{ fontSize: 14, padding: "6px 12px" }} disabled={uploading || scanning}>
                  {uploading ? "…" : t("common.add")}
                </button>
              </div>
              {rPhoto && !scanning && (
                <button
                  onClick={() => { setRPhoto(null); setScannedPhotoUrl(""); setScannedItems([]); setScannedVendor(""); if (photoRef.current) photoRef.current.value = ""; }}
                  style={{ background: "none", border: "none", color: "var(--color-accent-red)", fontSize: 14, padding: "8px 0 0", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}
                >
                  <Icon name="close" size={12} /> {t("jobs.removePhoto")}
                </button>
              )}
            </div>

            {/* Receipt list */}
            <div className="section">
              <div className="seclabel"><Icon name="receipt" size={13} /> {t("jobs.receipts")}</div>
              {receipts.filter((r) => r.job_id === sj.id).length === 0 ? (
                <div style={{ fontSize: 14, color: "var(--color-dim)", padding: "10px 0", textAlign: "center" }}>{t("jobs.noReceipts")}</div>
              ) : (
                receipts.filter((r) => r.job_id === sj.id).map((r) => (
                  <div key={r.id} className="drow">
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                      {r.photo_url && (
                        <img src={r.photo_url} alt="" onClick={() => setViewPhoto(r.photo_url)} style={{ width: 32, height: 32, borderRadius: 6, objectFit: "cover", cursor: "pointer", flexShrink: 0, border: "1px solid var(--color-border-dark)" }} />
                      )}
                      <span style={{ minWidth: 0 }}>
                        <span style={{ fontSize: 14.5, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.note || t("jobs.receiptSingular")}</span>
                        <span className="dim" style={{ fontSize: 12 }}>{r.receipt_date}</span>
                      </span>
                    </span>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                      <span style={{ color: "var(--color-success)", fontFamily: "Oswald", fontSize: 15 }}>${(r.amount || 0).toFixed(2)}</span>
                      <button
                        onClick={async () => { if (await useStore.getState().showConfirm(t("jobs.deleteReceiptTitle"), t("jobs.deleteReceiptBody"))) { await db.del("receipts", r.id); loadAll(); } }}
                        style={{ background: "none", border: "none", color: "var(--color-accent-red)", fontSize: 15, cursor: "pointer", padding: 0 }}
                      >
                        ✕
                      </button>
                    </span>
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </>
    );
  })();

  return (
    <div className="fi">
      {subScreenJsx || detailScreen || (
        <>
      <h2 style={{ fontSize: 24, color: "var(--color-primary)", marginBottom: 10, display: "inline-flex", alignItems: "center", gap: 8 }}>
        <Icon name="jobs" size={22} color="var(--color-primary)" />
        {t("nav.jobs")}
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
            ? [{ id: "archive" as const, icon: "package", label: t("jobs.archive"), count: archivedJobs.length, c: "#888" }]
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
                  fontSize: 15,
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
                <b>{j.property || t("jobs.noAddress")}</b>
                {j.client && <span className="dim"> · {j.client}</span>}
              </span>
              <span style={{ fontFamily: "Oswald", color: "var(--color-primary)", fontSize: 13, flexShrink: 0 }}>
                {j.status}
              </span>
            </div>
          )}
          onSelect={(j) => setDetailJobId(j.id)}
          onQueryChange={setSearchQuery}
          placeholder={t("jobs.searchJobs")}
        />
      </div>

      {/* Billing tab header */}
      {jobTab === "billing" && jobs.some((j) => j.status === "complete" || j.status === "invoiced") && (
        <div className="cd mb" style={{ borderLeft: "3px solid var(--color-warning)", padding: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div className="sl">{t("jobs.readyToInvoice")}</div>
              <div style={{ fontSize: 22, fontFamily: "Oswald", fontWeight: 700, color: "var(--color-warning)" }}>
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
                    const res = await apiFetch("/api/stripe/connect", {
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
                      useStore.getState().showToast(t("jobs.stripeError") + " (" + res.status + "): " + text, "error");
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
                      useStore.getState().showToast(t("jobs.errorPrefix") + " " + (data.error || t("jobs.couldNotStartStripe")), "error");
                      setConnectingStripe(false);
                    }
                  } catch (e) {
                    useStore.getState().showToast(
                      t("jobs.failedStartStripe") + " " + (e instanceof Error ? e.message : t("jobs.networkError")),
                      "error",
                    );
                    setConnectingStripe(false);
                  }
                }}
                style={{ fontSize: 14, padding: "5px 10px" }}
              >
                {connectingStripe ? t("jobs.connecting") : `${t("jobs.connectStripe")} →`}
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
                  : t("jobs.noArchived")}
              </p>
              {jobTab === "active" && (
                <button className="bb mt" onClick={() => setPage("qf")} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <Icon name="quote" size={14} />{t("jobs.startQuote")}
                </button>
              )}
            </div>
          );
        }

        return filtered.map((j) => {
          const w = getWorkers(j);
          // Status-aware triage hint for the collapsed card's second row —
          // surfaces the job's next-action context the way the mockup does
          // (On site · <tech>, Ready to invoice, …). Icons are curated names
          // from Icon.tsx; an unknown name renders nothing rather than crash.
          const hint: { icon: string; text: string } = (() => {
            switch (j.status) {
              case "lead":      return { icon: "quote", text: t("jobs.hintNewLead") };
              case "quoted":    return { icon: "send", text: j.job_date ? `${t("status.quoted")} · ${j.job_date}` : t("status.quoted") };
              case "accepted":  return { icon: "schedule", text: t("jobs.hintScheduleIt") };
              case "scheduled": return { icon: "schedule", text: j.job_date || t("status.scheduled") };
              case "active":    return { icon: "worker", text: w.length ? `${t("jobs.hintOnSite")} · ${w[0].name}` : t("jobs.hintInProgress") };
              case "complete":  return { icon: "receipt", text: t("jobs.hintReadyToInvoice") };
              case "invoiced":  return { icon: "receipt", text: t("jobs.hintInvoiceSent") };
              case "paid":      return { icon: "checkCircle", text: t("status.paid") };
              default:          return { icon: "dot", text: j.status || "" };
            }
          })();

          return (
            <div key={j.id} id={`job-row-${j.id}`} className="cd mb statusstrip" style={{ ["--c" as any]: statusColor(j.status) }}>
              {/* Collapsed header */}
              <div
                style={{ cursor: "pointer" }}
                onClick={() => setDetailJobId(j.id)}
              >
                {/* Row 1 — client headline + address (map pin) · amount */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontFamily: "Oswald", fontWeight: 600, fontSize: 17, letterSpacing: ".3px", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      {j.status === "lead" && (
                        <span style={{ fontSize: 11, fontFamily: "Oswald", letterSpacing: ".08em", padding: "2px 6px", borderRadius: 4, background: "#ff3d6e", color: "#fff" }}>
                          {t("jobs.newLead")}
                        </span>
                      )}
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
                        {j.property || t("jobs.noAddress")}
                      </span>
                      {j.property && (
                        <a
                          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(j.property)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          title={t("jobs.map")}
                          style={{ color: "var(--color-primary)", display: "inline-flex", flexShrink: 0 }}
                        >
                          <Icon name="mapPin" size={13} color="var(--color-primary)" />
                        </a>
                      )}
                    </div>
                    {j.client && (
                      <div className="dim" style={{ fontSize: 13.5, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {j.client}
                      </div>
                    )}
                  </div>
                  <div style={{ fontFamily: "Oswald", fontWeight: 700, fontSize: 20, whiteSpace: "nowrap", color: "var(--color-money)" }}>
                    ${(j.total || 0).toFixed(0)}
                  </div>
                </div>

                {/* Row 2 — status chip · next-action hint + chevron */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 9, gap: 8 }}>
                  <span
                    className="chip"
                    style={{
                      fontFamily: "Oswald",
                      textTransform: "uppercase",
                      letterSpacing: ".06em",
                      color: statusColor(j.status),
                      background: statusColor(j.status) + "1f",
                      border: `1px solid ${statusColor(j.status)}66`,
                    }}
                  >
                    {j.status === "lead" ? t("jobs.lead") : (t(`status.${j.status}`) || j.status)}
                  </span>
                  <span className="dim" style={{ fontSize: 12.5, display: "inline-flex", alignItems: "center", gap: 5, whiteSpace: "nowrap", flexShrink: 0 }}>
                    <Icon name={hint.icon} size={12} />
                    {hint.text}
                    <Icon name="next" size={14} />
                  </span>
                </div>
              </div>
            </div>
          );
        });
      })()}

      <div style={{ textAlign: "center", marginTop: 16 }}>
        <p className="dim" style={{ fontSize: 14 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, justifyContent: "center" }}>
            <Icon name="tip" size={14} color="var(--color-highlight)" />
            {jobTab === "active" ? t("jobs.tipActive") : jobTab === "billing" ? t("jobs.tipBilling") : t("jobs.tipPaid")}
          </span>
        </p>
      </div>
        </>
      )}

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
            <div style={{ fontSize: 16, color: "#888", fontFamily: "Oswald", textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 12 }}>
              {t("jobs.scanToPay")}
            </div>
            <div style={{ background: "#fff", display: "inline-block", padding: 16, borderRadius: 12, marginBottom: 12 }}>
              <QRCodeSVG value={payQR.url} size={200} level="M" />
            </div>
            <div style={{ fontSize: 32, fontFamily: "Oswald", fontWeight: 700, color: "#00cc66", marginBottom: 4 }}>
              ${payQR.amount.toLocaleString()}
            </div>
            <div style={{ fontSize: 14, color: "#888", marginBottom: 16 }}>
              {t("jobs.qrInstructions")}
            </div>
            <button
              className="bo"
              onClick={() => setPayQR(null)}
              style={{ fontSize: 15, padding: "6px 16px", color: "#888" }}
            >
              {t("common.close")}
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
            aria-label={t("common.close")}
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
              fontSize: 14,
              color: "rgba(255,255,255,0.7)",
              textDecoration: "underline",
              zIndex: 10000,
            }}
          >
            {t("jobs.openOriginal")}
          </a>
          <img
            src={viewPhoto}
            alt={t("jobs.receiptSingular")}
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
    useStore.getState().showToast(t("jobs.recurringCreated"), "success");
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
          <h3 style={{ fontSize: 17 }}>{t("jobs.makeRecurring")}</h3>
          <button className="bo" onClick={onClose} style={{ padding: "2px 8px" }}>
            <Icon name="close" size={14} />
          </button>
        </div>

        <div style={{ fontSize: 14, color: "#888", marginBottom: 10 }}>
          {t("jobs.recurringFrom")} <strong>{job.property}</strong>{job.client ? ` · ${job.client}` : ""}.
          {" "}{t("jobs.recurringDesc")}
        </div>

        <div className="g2 mb" style={{ gap: 8 }}>
          <div>
            <label className="sl">{t("jobs.title")}</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("jobs.titlePlaceholder")}
              style={{ marginTop: 4 }}
            />
          </div>
          <div>
            <label className="sl">{t("jobs.cadence")}</label>
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
              <label className="sl">{t("jobs.dayOfWeek")}</label>
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
              <label className="sl">{t("jobs.dayOfMonth")}</label>
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
            <label className="sl">{t("jobs.hourLabel")}</label>
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

        <div style={{ fontSize: 13, color: "#888", marginTop: 4 }}>
          {t("jobs.firstFire")} <strong>{formatNextFire(computeNextFire(new Date(), cadence, { dayOfWeek: isWeekly ? dayOfWeek : undefined, dayOfMonth: !isWeekly ? dayOfMonth : undefined, hour }).toISOString())}</strong>
        </div>

        <div className="row" style={{ marginTop: 12, gap: 6 }}>
          <button className="bb" onClick={save} disabled={saving} style={{ fontSize: 14 }}>
            {saving ? t("jobs.saving") : t("jobs.create")}
          </button>
          <button className="bo" onClick={onClose} style={{ fontSize: 14 }}>{t("common.cancel")}</button>
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
      style={{ fontSize: 14, height: 50, resize: "vertical" }}
    />
  );
}
