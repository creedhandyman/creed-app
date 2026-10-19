"use client";
import { apiFetch, getStatusLink } from "@/lib/api";
import { markQuoteSent, sentAgo } from "@/lib/quote-send";
import { useState, useRef, useEffect, useMemo } from "react";
import { useStore } from "@/lib/store";
import { db } from "@/lib/supabase";
import { uploadReceiptPrivate, signReceiptPaths, isPrivatePath } from "@/lib/receipt-storage";
import { exportJobReport } from "@/lib/export-job-report";
import { QRCodeSVG } from "qrcode.react";
import type { Job } from "@/lib/types";
import { statusColor } from "@/lib/status";
import { t } from "@/lib/i18n";
import { extractZip } from "@/lib/parser";
import { recordJobOutcome, jobHasOpenEntries } from "@/lib/learning";
import { Icon } from "../Icon";
import TopBar from "@/components/TopBar";
import { pickReceiptPhoto, pickReceiptPhotos } from "@/lib/image";
import PropertySearch from "../PropertySearch";
import ReviewRequestModal from "../ReviewRequestModal";
import RecordApprovalSheet from "../RecordApprovalSheet";
import SmsNotifyButtons from "../SmsNotifyButtons";
import { wrapPrint, openPrint } from "@/lib/print-template";
import { formatHours, parseEntryDate } from "@/lib/dates";
import { haversineMiles, ROAD_FACTOR, geocodeAddress, driveMinutes, cityContext } from "@/lib/geo";
import { residentContact } from "@/lib/resident";
import {
  CADENCES,
  CADENCE_LABELS,
  DAY_OF_WEEK_LABELS,
  computeNextFire,
  formatNextFire,
  type Cadence,
} from "@/lib/recurring";
import { stripAiHrsFromBlob } from "@/lib/ai-hours";
import { useBackLayer } from "@/lib/back-layer";
import { enqueueWoToggle, flushWoQueue } from "@/lib/wo-queue";

/* ── Closest-tech dispatch hint ─────────────────────────────────────
   Under the Requested-tech picker: ranks the crew by distance from
   their LAST GPS STAMP TODAY (clock-in/out fixes — no live tracking)
   to this job's address, with a rough drive ETA. Renders nothing when
   there's no address, no stamps today, or geocoding fails — a hint,
   never a blocker. */
function ClosestTechHint({ job }: { job: Job }) {
  const profiles = useStore((s) => s.profiles);
  const timeEntries = useStore((s) => s.timeEntries);
  const org = useStore((s) => s.org);
  const [rows, setRows] = useState<{ name: string; miles: number; asOf: string }[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    if (!job.property) return;
    (async () => {
      const dest = await geocodeAddress(job.property, cityContext(org?.address));
      if (!dest || cancelled) return;
      const toMin = (t?: string) => {
        const m = (t || "").match(/(\d+):(\d+)\s*([AP]M)?/i);
        if (!m) return 0;
        let h = parseInt(m[1]);
        const ap = m[3]?.toUpperCase();
        if (ap === "PM" && h < 12) h += 12;
        if (ap === "AM" && h === 12) h = 0;
        return h * 60 + parseInt(m[2]);
      };
      const todayKey = new Date().toDateString();
      const out: { name: string; miles: number; asOf: string }[] = [];
      for (const p of profiles) {
        // Most recent stamped entry TODAY; the clock-out fix wins over
        // clock-in when both exist (it's later).
        const todays = timeEntries
          .filter((e) => e.user_id === p.id)
          .filter((e) => (e.start_lat != null || e.end_lat != null))
          .filter((e) => parseEntryDate(e.entry_date)?.toDateString() === todayKey)
          .sort((a, b) => toMin(b.end_time || b.start_time) - toMin(a.end_time || a.start_time));
        const e = todays[0];
        if (!e) continue;
        const lat = e.end_lat ?? e.start_lat;
        const lng = e.end_lng ?? e.start_lng;
        if (lat == null || lng == null) continue;
        out.push({
          name: p.name,
          miles: Math.round(haversineMiles(lat, lng, dest.lat, dest.lng) * ROAD_FACTOR * 10) / 10,
          asOf: (e.end_lat != null ? e.end_time : e.start_time) || "",
        });
      }
      out.sort((a, b) => a.miles - b.miles);
      if (!cancelled && out.length) setRows(out.slice(0, 3));
    })();
    return () => { cancelled = true; };
  }, [job.id, job.property, profiles, timeEntries, org?.address]);

  if (!rows) return null;
  return (
    <div className="dim" style={{ fontSize: 12, padding: "2px 0 6px", lineHeight: 1.5 }}>
      <Icon name="navigation" size={11} color="#8cc0ff" />{" "}
      {rows.map((r, i) => (
        <span key={r.name}>
          {i > 0 && " · "}
          <b style={{ color: i === 0 ? "#8cc0ff" : undefined, fontWeight: i === 0 ? 600 : 400 }}>
            {r.name.split(" ")[0]} ~{r.miles} mi (~{driveMinutes(r.miles)} min)
          </b>
          {r.asOf ? ` ${t("loc.asOf")} ${r.asOf}` : ""}
        </span>
      ))}
    </div>
  );
}

/* ── Nav intent (Home → a filtered Jobs list, or one job) ──────────
   Dashboard tiles drop {page, tab?, filter?, jobId?, at} in sessionStorage
   and switch to Jobs. Read inline (not lib/nav-intent) so this screen has
   no hard dependency on the writer; a stale (>15s) or malformed intent is
   ignored. Consumed once on mount. */
const NAV_KEY = "c_nav_intent";
function peekNavIntent(page: string): { tab?: string; filter?: string; jobId?: string } | null { try { const raw = sessionStorage.getItem(NAV_KEY); if (!raw) return null; const v = JSON.parse(raw); if (!v || v.page !== page || typeof v.at !== "number" || Date.now() - v.at > 15000) return null; return v; } catch { return null; } }
type QuickKey = "lead" | "toSend" | "waiting" | "toInvoice" | "unpaid";
const QUICK: QuickKey[] = ["lead", "toSend", "waiting", "toInvoice", "unpaid"];
type JobTab = "active" | "billing" | "paid" | "archive";
const JOB_TABS: JobTab[] = ["active", "billing", "paid", "archive"];
// Same predicates as the Dashboard's Needs-attention counts, so a tile's
// number always equals the filtered list it opens.
const quickMatch = (j: Job, k: QuickKey): boolean => {
  if (j.archived) return false;
  switch (k) {
    case "lead":      return j.status === "lead";
    case "toSend":    return j.status === "quoted" && !j.quote_sent_at;
    case "waiting":   return j.status === "quoted" && !!j.quote_sent_at;
    case "toInvoice": return j.status === "complete";
    case "unpaid":    return j.status === "invoiced";
  }
};

interface Props {
  setPage: (p: string) => void;
  onEditJob?: (jobId: string) => void;
  onScheduleJob?: (jobName: string, jobId?: string) => void;
  /** Open straight to this job's detail screen (notification deep-link).
   *  Seeds detail state on mount; clearInitialDetail resets the parent so a
   *  later plain nav to Jobs lands on the list. */
  initialDetailJobId?: string | null;
  clearInitialDetail?: () => void;
  /** Open an Operations area (e.g. "billing" to connect Stripe). */
  openOps?: (tab?: string) => void;
}

export default function Jobs({ setPage, onEditJob, onScheduleJob, initialDetailJobId, clearInitialDetail, openOps }: Props) {
  const user = useStore((s) => s.user)!;
  const org = useStore((s) => s.org);
  const profiles = useStore((s) => s.profiles);
  const jobs = useStore((s) => s.jobs);
  const receipts = useStore((s) => s.receipts);
  const timeEntries = useStore((s) => s.timeEntries);
  const payHistory = useStore((s) => s.payHistory);
  const reviewRequests = useStore((s) => s.reviewRequests);
  const customers = useStore((s) => s.customers);
  const equipment = useStore((s) => s.equipment);
  const flipProjects = useStore((s) => s.flipProjects);
  const loadAll = useStore((s) => s.loadAll);
  const darkMode = useStore((s) => s.darkMode);
  const navBottom = useStore((s) => s.navBottom);
  // Every table has loaded at least once (or jobs themselves are in) — until
  // then an empty list is "not loaded yet", never "all done here" / "no jobs".
  const storeLoading = useStore((s) => s.loading);
  const fullSyncAt = useStore((s) => s.fullSyncAt);
  const dataReady = !storeLoading && (fullSyncAt !== null || jobs.length > 0);
  // Owner/manager — money actions (record payment / approval) are their APIs.
  const isAdmin = user.role === "owner" || user.role === "manager";
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

  // Home deep link (read once). A quick filter picks its tab: invoice/unpaid
  // live under Billing, the rest under Active.
  const [navIntent] = useState(() => peekNavIntent("jobs"));
  const navFilter: QuickKey | null =
    navIntent && typeof navIntent.filter === "string" && (QUICK as string[]).includes(navIntent.filter)
      ? (navIntent.filter as QuickKey) : null;
  const navTab: JobTab | null =
    navIntent && typeof navIntent.tab === "string" && (JOB_TABS as string[]).includes(navIntent.tab)
      ? (navIntent.tab as JobTab) : null;
  const [jobTab, setJobTab] = useState<JobTab>(() =>
    navFilter ? (navFilter === "toInvoice" || navFilter === "unpaid" ? "billing" : "active") : (navTab ?? "active"));
  const [quickFilter, setQuickFilter] = useState<QuickKey | null>(navFilter ?? null);
  // Phase 2 redesign: id of the job shown in the separate detail screen
  // (null = the Jobs list). Set by tapping a card; cleared by the Back button.
  const [detailJobId, setDetailJobId] = useState<string | null>(
    initialDetailJobId ?? (typeof navIntent?.jobId === "string" ? navIntent.jobId : null),
  );
  // Consume the deep-link target once: reset the parent so navigating back
  // to Jobs via the nav tab later opens the list, not this job again.
  useEffect(() => {
    if (initialDetailJobId) clearInitialDetail?.();
    if (navIntent) { try { sessionStorage.removeItem(NAV_KEY); } catch { /* storage blocked */ } }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Phase 3: sub-screen opened from the detail's Work section (work order /
  // receipts). null = show the detail (or the list). Back clears it.
  const [subScreen, setSubScreen] = useState<{ id: string; kind: "workorder" | "receipts" } | null>(null);
  // Opened straight onto a job (bell, a Home row, Schedule's "Open job"):
  // back returns to where you came from, not to a job list you never saw.
  // That detail gets no layer of its own (the page entry IS its back step).
  const deepLinkedJobRef = useRef<string | null>(detailJobId);
  const isDeepLinkedDetail = !!detailJobId && detailJobId === deepLinkedJobRef.current;
  useEffect(() => {
    if (detailJobId !== deepLinkedJobRef.current) deepLinkedJobRef.current = null;
  }, [detailJobId]);
  const closeDetail = () => {
    if (isDeepLinkedDetail) window.history.back();
    else setDetailJobId(null);
  };
  // System back closes the sub-screen, then the detail — instead of leaving Jobs.
  useBackLayer(!!detailJobId && !isDeepLinkedDetail, () => setDetailJobId(null));
  useBackLayer(!!subScreen, () => setSubScreen(null));
  // "Send to client" SMS strip — once the (tokenized) status link is minted we
  // open an editable strip that fires a native sms: deep link, matching the
  // notify buttons. Scoped by jobId so switching jobs hides a stale draft.
  // kind "invoice": sending (Open Messages / Copy) is what marks the job
  // invoiced — not generating a PDF nobody received.
  // PM jobs with a tenant on file get `recipients` (client + tenant, each
  // with its own pre-addressed message) and a "Send to" chip row; `to` is
  // the active index. Switching recipients replaces the draft.
  const [sendStrip, setSendStrip] = useState<{
    jobId: string; phone: string; msg: string; kind?: "invoice" | "quote";
    recipients?: { label: string; phone: string; msg: string }[]; to?: number;
  } | null>(null);
  // Bring a freshly opened send strip into view (it sits under the CTA, which
  // may be scrolled off on a long detail screen).
  const sendStripRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    sendStripRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [sendStrip?.jobId]);
  // Record a payment taken outside Stripe (cash/check/…). `ref` is minted
  // when the sheet opens → the server's idempotency key for this payment.
  // confirmOver: an amount above the balance was tapped once — the next tap saves.
  const [recordPay, setRecordPay] = useState<{ jobId: string; amount: string; method: "cash" | "check" | "card" | "other"; ref: string; busy?: boolean; confirmOver?: boolean } | null>(null);
  // Status → Paid while money is still owed: ask how before writing anything
  // (record the payment, or just mark it). Cancel leaves the status alone.
  const [paidChoice, setPaidChoice] = useState<{ jobId: string; due: number } | null>(null);
  // Bulk → Paid with jobs still owing: log each balance as one payment method.
  const [bulkPaid, setBulkPaid] = useState<{ method: "cash" | "check" | "card" | "other"; busy?: boolean } | null>(null);
  // Property typeahead query — drives both the dropdown suggestions
  // (in <PropertySearch>) and the inline filter on the visible list,
  // so the list and the typeahead stay in sync.
  const [searchQuery, setSearchQuery] = useState("");
  // Bulk status edit — "Select" in the list header enters select mode: cards
  // toggle membership instead of opening, and a sticky bar applies one status
  // to every selected job (same side effects as a single status change).
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkStatus, setBulkStatus] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const toggleSelected = (id: string) =>
    setSelectedIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  // Drives the review-request modal. Set to a job when status transitions
  // to "complete" or "paid" AND the job hasn't had a review request yet.
  const [reviewJob, setReviewJob] = useState<Job | null>(null);
  // Record an approval for a homeowner who said yes offline (in person / phone / paper).
  const [approvalJob, setApprovalJob] = useState<Job | null>(null);
  const [rn, setRn] = useState("");
  const [ra, setRa] = useState("");
  // Pending receipt pages — uploaded as attached, saved as ONE receipt.
  const [pendingPages, setPendingPages] = useState<{ path: string; url: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  // Receipt scan state — once a photo is attached we upload + AI-scan
  // immediately so the form can auto-fill before the user hits Add.
  const [scanning, setScanning] = useState(false);
  // Receipts use the device's NATIVE camera/photo picker (HD) via
  // pickReceiptPhoto — reliable on iOS where the in-app camera can't open,
  // and high-res enough for the AI scan to read line items.
  const [signedReceipts, setSignedReceipts] = useState<Record<string, string>>({});
  const [scannedItems, setScannedItems] = useState<{ name?: string; qty?: number; price?: number }[]>([]);
  const [scannedVendor, setScannedVendor] = useState("");
  const [viewPhoto, setViewPhoto] = useState<string | null>(null);

  // Sign private-bucket receipt photos for display (legacy public URLs pass
  // through unchanged). Only signs paths not already cached, so the 15s store
  // refresh doesn't re-hit the endpoint.
  useEffect(() => {
    const need = receipts
      .filter((r) => isPrivatePath(r.photo_url) && !signedReceipts[r.photo_url])
      .map((r) => r.photo_url);
    if (need.length === 0) return;
    let cancelled = false;
    signReceiptPaths(need).then((map) => {
      if (!cancelled) setSignedReceipts((prev) => ({ ...prev, ...map }));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receipts]);
  // startPaid = the job's amount_paid when the QR opened; a rise means the
  // customer paid, so the overlay flips to "Payment received".
  const [payQR, setPayQR] = useState<{ url: string; jobId: string; amount: number; startPaid: number } | null>(null);
  // While the QR is up, refresh faster than the 15s store poll so the
  // payment shows up within a few seconds of the customer paying.
  const payQRJobId = payQR?.jobId;
  useEffect(() => {
    if (!payQRJobId) return;
    const timer = setInterval(() => { void loadAll(); }, 8000);
    return () => clearInterval(timer);
  }, [payQRJobId, loadAll]);
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

  const uploadPhoto = async (file: File, jobId: string): Promise<{ path: string; url: string }> => {
    // Receipts go to the PRIVATE bucket. We persist the object path and
    // display via short-lived signed URLs (see lib/receipt-storage).
    return uploadReceiptPrivate(file, jobId);
  };

  const resetReceiptForm = () => {
    setRn("");
    setRa("");
    setPendingPages([]);
    setScannedItems([]);
    setScannedVendor("");
    if (photoRef.current) photoRef.current.value = "";
  };

  // Scan one or more receipt photos as a SINGLE receipt. Multi-page receipts (a
  // long receipt shot across several photos) are sent together so the AI returns
  // ONE combined result — all line items + the one final grand total — instead
  // of being misread as separate receipts. Items feed price_corrections on save.
  const scanReceiptPages = async (urls: string[]) => {
    if (!urls.length) return;
    setScanning(true);
    try {
      const res = await apiFetch("/api/ai/receipt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrls: urls }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        useStore.getState().showToast(t("jobs.scanFailedManual") + " " + (err?.error || res.statusText), "warning");
        return;
      }
      const { data } = await res.json();
      if (!data) return;

      const vendor = (data.vendor as string | undefined)?.trim() || "";
      const items = (Array.isArray(data.items) ? data.items : []) as { name?: string; qty?: number; price?: number }[];
      const total = typeof data.total === "number" ? data.total : 0;

      setScannedVendor(vendor);
      setScannedItems(items);
      if (total > 0) setRa(total.toFixed(2));

      const itemSummary = items.filter((it) => it?.name).slice(0, 4).map((it) => it.name).join(", ");
      const more = items.length > 4 ? ` (+${items.length - 4} more)` : "";
      const note = vendor ? `${vendor}${itemSummary ? ` — ${itemSummary}${more}` : ""}` : `${itemSummary}${more}`;
      if (note.trim()) setRn(note);

      useStore.getState().showToast(
        total > 0
          ? `${t("jobs.scanned")}: $${total.toFixed(2)}${vendor ? ` ${t("jobs.scannedAt")} ${vendor}` : ""} — ${t("jobs.reviewAndAdd")}`
          : t("jobs.scannedReviewFields"),
        "success",
      );
    } catch (err) {
      console.error("receipt scan error:", err);
      useStore.getState().showToast(t("jobs.scanFailedManual") + " " + (err instanceof Error ? err.message : String(err)), "warning");
    }
    setScanning(false);
  };

  // Attach one or more pages: upload each, then re-scan the whole set as one.
  const addReceiptPages = async (files: File[], jobId: string) => {
    if (!files.length) return;
    setScanning(true);
    const uploaded: { path: string; url: string }[] = [];
    try {
      for (const f of files) uploaded.push(await uploadPhoto(f, jobId));
    } catch (err) {
      useStore.getState().showToast(t("jobs.scanFailedManual") + " " + (err instanceof Error ? err.message : String(err)), "warning");
    }
    if (!uploaded.length) { setScanning(false); return; }
    const next = [...pendingPages, ...uploaded];
    setPendingPages(next);
    await scanReceiptPages(next.map((p) => p.url));
  };

  const removePendingPage = (i: number) => {
    const next = pendingPages.filter((_, idx) => idx !== i);
    setPendingPages(next);
    if (next.length) scanReceiptPages(next.map((p) => p.url));
    else { setScannedItems([]); setScannedVendor(""); }
  };

  const addReceipt = async (jobId: string) => {
    if (!rn.trim()) { useStore.getState().showToast(t("jobs.enterReceiptNote"), "warning"); return; }
    const amt = parseFloat(ra);
    if (!amt || amt <= 0) { useStore.getState().showToast(t("jobs.enterValidAmount"), "warning"); return; }
    setUploading(true);
    try {
      // Pages were uploaded as they were attached. photo_url = page 1; the rest
      // ride in `pages` for multi-page receipts.
      const pagePaths = pendingPages.map((p) => p.path);
      const photo_url = pagePaths[0] || "";
      // Pass org_id explicitly rather than relying on db.post's localStorage
      // auto-inject — if org_id is missing the receipt is there but hidden by
      // the org-scoped filter on the next refresh.
      const base = {
        job_id: jobId,
        org_id: user.org_id,
        note: rn,
        amount: amt,
        receipt_date: new Date().toLocaleDateString(),
        photo_url,
      };
      // Persist every page when there's more than one. The `pages` column may
      // not be migrated yet — if that insert fails, retry without it so the
      // receipt (page 1 + the already-combined scan total) still saves.
      let result = await db.post<{ id: string }>(
        "receipts",
        pagePaths.length > 1 ? { ...base, pages: pagePaths } : base,
      );
      if (!result && pagePaths.length > 1) {
        result = await db.post<{ id: string }>("receipts", base);
      }
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

  // Unchecked work-order items on a job (0 when there's no work order).
  const uncheckedCount = (job: Job): number => {
    try {
      const jobData = typeof job.rooms === "string" ? JSON.parse(job.rooms) : job.rooms;
      const workOrder = (jobData?.workOrder || []) as { done: boolean }[];
      return workOrder.filter((w) => !w.done).length;
    } catch { return 0; }
  };

  // Core status write + completion side effects, shared by the single-job
  // setStatus and the bulk bar. No confirm and no reload — callers own those.
  // Resolves true when the status write landed (false = db.patch already
  // toasted why), so callers only confirm success when it really saved.
  const applyStatus = async (id: string, status: string): Promise<boolean> => {
    const ok = await db.patch("jobs", id, { status });
    if (!ok) return false;

    // When a job goes Complete, teach the AI quoter from its real hours
    // (job-level per trade + per item). Shared via recordJobOutcome with
    // WorkVision's Complete Job button so EVERY completion path feeds learning,
    // not just this admin one.
    if (status === "complete") {
      const completedJob = jobs.find((j) => j.id === id);
      if (completedJob) {
        try {
          await recordJobOutcome(completedJob, getJobLabor(completedJob).totalHrs, {
            crewStillClocked: jobHasOpenEntries(completedJob, useStore.getState().timeEntries),
          });
        } catch { /* learning is best-effort */ }
        // Stamp the serviced unit's last_service_at (equipment asset history).
        if (completedJob.equipment_id) {
          try { await db.patch("equipment", completedJob.equipment_id, { last_service_at: new Date().toISOString() }); } catch { /* best-effort */ }
        }
      }
    }
    return true;
  };

  // Resolves true only when the status was written; false when the paid
  // choice sheet took over, the confirm was cancelled, or the write failed.
  const setStatus = async (id: string, status: string): Promise<boolean> => {
    // Paid while money is still owed (owner/manager): don't just flip the
    // status — the books would say paid with no payment behind it. Ask how
    // they were paid first; nothing is written until they pick.
    if (status === "paid" && isAdmin) {
      const job = jobs.find((j) => j.id === id);
      const due = job ? balanceOf(job).due : 0;
      if (due > 0.009) { setPaidChoice({ jobId: id, due }); return false; }
    }
    // Warn if completing with unchecked work order items
    if (status === "complete") {
      const job = jobs.find((j) => j.id === id);
      const unchecked = job ? uncheckedCount(job) : 0;
      if (unchecked > 0) {
        if (!await useStore.getState().showConfirm(t("jobs.incompleteItems"), `${unchecked} ${unchecked !== 1 ? t("jobs.workOrderItemsPlural") : t("jobs.workOrderItemSingular")} ${t("jobs.stillUncheckedMarkComplete")}`)) return false;
      }
    }
    const ok = await applyStatus(id, status);
    loadAll();

    // Status changes are intentionally SILENT. Previously every flip (a)
    // auto-built a client SMS, copied it to the clipboard, and fired a
    // "message copied" toast, and (b) auto-opened the review-request modal on
    // the first complete/paid. Both were pop-ups triggered just by changing
    // status. Messaging the customer is now the explicit "Message customer"
    // button under the detail CTA (messageCustomer), and a review is requested
    // from the manual "Request Review" button in Manage plus the post-payment
    // automation — so changing status no longer pops anything up.
    return ok;
  };

  const statusLabel = (s: string) => (s === "lead" ? t("jobs.lead") : (t(`status.${s}`) || s));

  // Apply bulkStatus to every selected job. One confirm up front (it also
  // flags jobs that still have unchecked work-order items when completing),
  // then the same per-job side effects as setStatus, one reload at the end.
  // Jobs already at the target status are skipped so e.g. a re-complete can't
  // feed the AI learning twice.
  const bulkApply = async () => {
    if (!bulkStatus || !selectedIds.length || bulkBusy) return;
    const targets = jobs.filter((j) => selectedIds.includes(j.id) && j.status !== bulkStatus);
    const label = statusLabel(bulkStatus);
    if (!targets.length) {
      useStore.getState().showToast(`${t("jobs.bulkAlready")} ${label}`, "info");
      return;
    }
    // Bulk Paid with balances still owed → the record-payments sheet instead
    // of a bare status flip (same rule as the single-job dropdown).
    if (bulkStatus === "paid" && isAdmin && targets.some((j) => balanceOf(j).due > 0.009)) {
      setBulkPaid({ method: "cash" });
      return;
    }
    let msg = `${targets.length} ${targets.length === 1 ? t("jobs.bulkJobOne") : t("jobs.bulkJobMany")} → ${label}`;
    if (bulkStatus === "complete") {
      const open = targets.filter((j) => uncheckedCount(j) > 0).length;
      if (open) msg += ` · ${open} ${t("jobs.bulkHaveUnchecked")}`;
    }
    if (!await useStore.getState().showConfirm(t("jobs.bulkConfirmTitle"), msg)) return;
    setBulkBusy(true);
    let n = 0;
    try {
      for (const j of targets) if (await applyStatus(j.id, bulkStatus)) n++;
    } finally {
      setBulkBusy(false);
      await loadAll();
    }
    // Nothing landed: db.patch already toasted why — keep the selection so
    // the owner can retry instead of a green summary over the error.
    if (n === 0) return;
    useStore.getState().showToast(`${t("jobs.bulkUpdated")} ${n} → ${label}`, n < targets.length ? "warning" : "success");
    setSelectedIds([]);
    setBulkStatus("");
    setSelectMode(false);
  };

  // Confirm on the bulk-Paid sheet: each owing job gets ONE payment for its
  // remaining balance through the same /api/payments/record call as the
  // Record payment sheet (server flips it to paid once covered); jobs with
  // nothing owed just take the status. Sequential so a failure is counted
  // per job and never double-posts.
  const confirmBulkPaid = async () => {
    if (!bulkPaid || bulkPaid.busy) return;
    const method = bulkPaid.method;
    const targets = jobs.filter((j) => selectedIds.includes(j.id) && j.status !== "paid");
    const owing = targets.filter((j) => balanceOf(j).due > 0.009);
    const settled = targets.filter((j) => balanceOf(j).due <= 0.009);
    setBulkPaid({ method, busy: true });
    setBulkBusy(true);
    let ok = 0;
    let failed = 0;
    let recorded = 0;
    try {
      for (const j of owing) {
        const amount = balanceOf(j).due;
        try {
          const res = await apiFetch("/api/payments/record", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            // skipReview: a bulk cleanup must not text every customer in the
            // batch a review request (the single-job sheet still schedules it).
            body: JSON.stringify({ jobId: j.id, amount, method, ref: crypto.randomUUID(), skipReview: true }),
          });
          if (res.ok) { ok++; recorded += amount; } else failed++;
        } catch { failed++; }
      }
      // Already-covered jobs are status-only flips, not payments — they count
      // toward failures (so a failed flip warns) but not "Recorded N payments".
      for (const j of settled) {
        if (!(await applyStatus(j.id, "paid"))) failed++;
      }
    } finally {
      setBulkBusy(false);
      await loadAll();
    }
    setBulkPaid(null);
    const done = t("jobs.bulkPaidDone").replace("{n}", String(ok)).replace("{amt}", recorded.toFixed(2));
    // One toast slot — a failure line rides along with the summary rather
    // than replacing it.
    if (failed > 0) useStore.getState().showToast(`${done} · ${t("jobs.bulkPaidSomeFailed").replace("{n}", String(failed))}`, "warning");
    else useStore.getState().showToast(done, "success");
    setSelectedIds([]);
    setBulkStatus("");
    setSelectMode(false);
  };

  // Archive = hide from the work tabs (reversible from the Archive tab).
  // Returns how many writes landed (db.patch toasts its own failures).
  const archiveMany = async (ids: string[]): Promise<number> => {
    const at = new Date().toISOString();
    let n = 0;
    for (const id of ids) {
      if (await db.patch("jobs", id, { archived: true, archived_at: at })) n++;
    }
    await loadAll();
    return n;
  };
  const archiveJob = async (job: Job) => {
    if (!(await archiveMany([job.id]))) return;
    useStore.getState().showToast(t("jobs.archivedToast"), "success");
    setDetailJobId(null);
  };
  const bulkArchive = async () => {
    if (!selectedIds.length || bulkBusy) return;
    const ids = selectedIds.filter((id) => !jobs.find((j) => j.id === id)?.archived);
    setBulkBusy(true);
    let n = 0;
    try { n = await archiveMany(ids); } finally { setBulkBusy(false); }
    // Nothing landed: db.patch already toasted why — keep the selection so
    // the owner can retry instead of a green "Archived 0" over the error.
    if (n === 0) return;
    useStore.getState().showToast(t("jobs.archivedMany").replace("{n}", String(n)), n < ids.length ? "warning" : "success");
    setSelectedIds([]);
    setBulkStatus("");
    setSelectMode(false);
  };

  // Tenant/resident variant of a status update. Deliberately NO totals and
  // NO status/pay link — that page shows the quote price, which is between
  // the contractor and the paying client (the property manager).
  const tenantUpdateMsg = (job: Job, resName: string): string => {
    const orgName = org?.name || "us";
    const prop = job.property || "your home";
    const hello = resName ? `Hi ${resName.split(/\s+/)[0]}! ` : "Hi! ";
    switch (job.status) {
      case "scheduled":
        return `${hello}This is ${orgName} — repairs at ${prop} are scheduled${job.job_date ? ` for ${job.job_date}` : ""}. See you then!`;
      case "active":
        return `${hello}This is ${orgName} — we're on our way to ${prop}.`;
      case "complete":
      case "invoiced":
      case "paid":
        return `${hello}Work at ${prop} is complete — thanks for having us! — ${orgName}`;
      default:
        return `${hello}This is ${orgName} — your property manager has asked us to handle some repairs at ${prop}. We'll be in touch to schedule.`;
    }
  };

  // Client + (optional) tenant recipient list for the send strip. The tenant
  // only becomes a separate chip when they have their OWN phone number.
  const stripRecipients = (job: Job, clientMsg: string): { label: string; phone: string; msg: string }[] => {
    const cust = job.customer_id ? customers.find((c) => c.id === job.customer_id) : undefined;
    const clientPhone = cust?.phone || "";
    const list = [{ label: (job.client || cust?.name || "Client").split(/\s+/).slice(0, 2).join(" "), phone: clientPhone, msg: clientMsg }];
    const res = residentContact(job.rooms);
    if (res.phone && res.phone.replace(/[^\d]/g, "") !== clientPhone.replace(/[^\d]/g, "")) {
      list.push({
        label: res.name ? `${t("jobs.tenantLabel")} · ${res.name.split(/\s+/)[0]}` : t("jobs.tenantLabel"),
        phone: res.phone,
        msg: tenantUpdateMsg(job, res.name),
      });
    }
    return list;
  };

  // "Message customer" button under the CTA. Builds a status-aware, editable
  // text and opens the send strip (native SMS / Copy). This is the explicit
  // opt-in that replaced the old auto-copy-to-clipboard on every status change.
  // followUp: a nudge on a quote that already went out (the "Follow up" CTA).
  const messageCustomer = async (job: Job, opts?: { followUp?: boolean }) => {
    const orgName = org?.name || "us";
    const prop = job.property || "your property";
    const name = job.client || "there";
    let url = "";
    // A lead has no quote yet — its acknowledgement carries no link.
    if (job.status !== "lead") {
      try { url = await getStatusLink(job.id); } catch { url = ""; }
    }
    let msg: string;
    switch (job.status) {
      case "lead":
        msg = `Hi ${name}! Thanks for reaching out to ${orgName} about ${prop}. Got your request — I'll put a quote together and get back to you shortly.`;
        break;
      case "quoted":
      case "accepted": {
        if (opts?.followUp && job.status === "quoted") {
          msg = `Hi ${name}! Just checking in on the quote for ${prop} — happy to answer questions or adjust anything. Review & approve here: ${url}`;
          break;
        }
        // Good/Better/Best: job.total is the Best price — lead with the
        // cheapest option instead (same wording as QuoteForge's Send). Once
        // an option was picked (acceptedTier), total IS that price.
        let totalLine = `Total: $${(job.total || 0).toFixed(2)}`;
        try {
          const d = typeof job.rooms === "string" ? JSON.parse(job.rooms) : job.rooms;
          const tt = d?.tieredQuote && !d?.acceptedTier ? d?.tierTotals : null;
          const prices = tt ? [tt.base, tt.better, tt.best].filter((v): v is number => typeof v === "number" && v > 0) : [];
          if (prices.length) totalLine = `Options from $${Math.min(...prices).toFixed(2)}`;
        } catch { /* malformed rooms — plain total */ }
        msg = `Hi ${name}! Here's your quote from ${orgName} for ${prop}:\n\n${totalLine}\n\nView details & approve: ${url}`;
        break;
      }
      case "scheduled":
        msg = `Hi ${name}! Your job at ${prop} has been scheduled. View details: ${url}`;
        break;
      case "active":
        msg = `Hi ${name}! We're on our way to ${prop}. Track progress: ${url}`;
        break;
      case "complete":
        msg = `Hi ${name}! Work is complete at ${prop}. View details & sign off: ${url}`;
        break;
      case "invoiced":
        msg = invoiceText(job, url);
        break;
      case "paid":
        msg = `Thank you ${name}! Payment received for ${prop}. We appreciate your business!\n\n— ${orgName}`;
        break;
      default:
        msg = `Hi ${name}! Here's an update on your job at ${prop}:${url ? ` ${url}` : ""}`;
    }
    const recipients = stripRecipients(job, msg);
    setSendStrip({ jobId: job.id, phone: recipients[0].phone, msg, kind: job.status === "quoted" ? "quote" : undefined, recipients, to: 0 });
  };

  // Paid-to-date / balance — what the customer actually still owes.
  const balanceOf = (job: Job) => {
    const paid = Math.round((Number(job.amount_paid) || 0) * 100) / 100;
    const due = Math.round(Math.max(0, (job.total || 0) - paid) * 100) / 100;
    return { paid, due };
  };

  const invoiceText = (job: Job, url: string) => {
    const { paid, due } = balanceOf(job);
    const name = job.client || "there";
    const prop = job.property || "your property";
    const lines = [`Hi ${name}! Here's your invoice from ${org?.name || "us"} for ${prop}.`, ""];
    lines.push(paid > 0 ? `Balance due: $${due.toFixed(2)} (after the $${paid.toFixed(2)} you already paid)` : `Total due: $${due.toFixed(2)}`);
    if (url) lines.push("", org?.stripe_connected ? `View & pay online: ${url}` : `View your invoice: ${url}`);
    return lines.join("\n");
  };

  // "Send invoice": a ready-to-send text with the balance + the job link
  // (the customer pays there). The job flips to Invoiced when it's sent.
  const sendInvoice = async (job: Job) => {
    let url = "";
    try { url = await getStatusLink(job.id); } catch { url = ""; }
    const recipients = stripRecipients(job, invoiceText(job, url));
    setSendStrip({ jobId: job.id, phone: recipients[0].phone, msg: recipients[0].msg, kind: "invoice", recipients, to: 0 });
  };
  // A follow-up re-stamps quote_sent_at too — it's the "last contacted" mark.
  // quiet: the caller already toasted (Copy says "copied"; one toast slot).
  // The success toast only shows when the write landed — on a failure
  // db.patch's error toast stays up instead of being replaced by "sent".
  const markSent = (jobId: string, kind?: "invoice" | "quote", quiet?: boolean) => {
    const toast = useStore.getState().showToast;
    if (kind === "quote") {
      void markQuoteSent(jobId).then((ok) => { loadAll(); if (ok && !quiet) toast(t("jobs.quoteMarkedSent"), "success"); });
      return;
    }
    if (kind !== "invoice") return;
    const job = jobs.find((j) => j.id === jobId);
    if (job?.status === "complete") void setStatus(jobId, "invoiced").then((ok) => { if (ok && !quiet) toast(t("jobs.invoiceMarkedSent"), "success"); });
  };

  const openRecordPay = (job: Job) => {
    const { due } = balanceOf(job);
    setRecordPay({ jobId: job.id, amount: due > 0 ? due.toFixed(2) : "", method: "cash", ref: crypto.randomUUID() });
  };
  const saveRecordPay = async () => {
    if (!recordPay || recordPay.busy) return;
    const amount = parseFloat(recordPay.amount);
    const toast = useStore.getState().showToast;
    if (!(amount > 0)) { toast(t("jobs.enterAmount"), "warning"); return; }
    // More than the balance? Probably a typo — the first tap shows a warning,
    // the second saves it as entered.
    const rj = jobs.find((j) => j.id === recordPay.jobId);
    const due = rj ? balanceOf(rj).due : 0;
    if (amount > due + 0.009 && !recordPay.confirmOver) { setRecordPay({ ...recordPay, confirmOver: true }); return; }
    setRecordPay({ ...recordPay, busy: true });
    try {
      const res = await apiFetch("/api/payments/record", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: recordPay.jobId, amount, method: recordPay.method, ref: recordPay.ref }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast(data.error || t("jobs.recordFailed"), "error"); setRecordPay((r) => (r ? { ...r, busy: false } : r)); return; }
      setRecordPay(null);
      await loadAll();
      toast(data.fullyPaid ? t("jobs.paidInFull") : t("jobs.paymentRecordedBalance").replace("{due}", Number(data.balance || 0).toFixed(2)), "success");
    } catch {
      toast(t("jobs.recordFailed"), "error");
      setRecordPay((r) => (r ? { ...r, busy: false } : r));
    }
  };

  const deleteJob = async (id: string) => {
    const prop = jobs.find((j) => j.id === id)?.property;
    if (await useStore.getState().showConfirm(t("jobs.deleteJobTitle"), t("jobs.deleteJobBodyNamed").replace("{prop}", prop || t("jobs.noAddress")))) {
      await db.del("jobs", id);
      // Take its visits off the schedule too: entries linked to this job, and
      // legacy (unlinked) entries at its address when no other job is there.
      const st = useStore.getState();
      const addr = (prop || "").trim().toLowerCase();
      const otherAtAddr = !!addr && st.jobs.some((j) => j.id !== id && (j.property || "").trim().toLowerCase() === addr);
      const visits = st.schedule.filter((e) => e.job_id === id
        || (!e.job_id && !!addr && !otherAtAddr && (e.job || "").trim().toLowerCase() === addr));
      for (const e of visits) await db.del("schedule", e.id);
      setDetailJobId(null);
      loadAll();
    }
  };


  const escapeHtml = (s: string) =>
    String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  // After photos on the invoice — a per-job choice (rooms.invoiceAfterPhotos,
  // default off) toggled next to the Invoice PDF button.
  const jobRoomsOf = (j: Job): Record<string, unknown> => {
    try { return (typeof j.rooms === "string" ? JSON.parse(j.rooms) : j.rooms) || {}; } catch { return {}; }
  };
  const afterPhotosOf = (j: Job): { url: string; label?: string }[] => {
    const ph = jobRoomsOf(j).photos;
    return Array.isArray(ph) ? (ph as { url?: string; label?: string; type?: string }[])
      .filter((p) => p && p.type === "after" && typeof p.url === "string" && p.url)
      .map((p) => ({ url: p.url as string, label: p.label })) : [];
  };
  const setInvoiceAfterPhotos = (j: Job, on: boolean) => {
    // Optimistic: flip it in the store now, then write the blob in the queue.
    useStore.setState((st) => ({
      jobs: st.jobs.map((x) => (x.id === j.id ? { ...x, rooms: JSON.stringify({ ...jobRoomsOf(x), invoiceAfterPhotos: on }) } : x)),
    }));
    void enqueueRoomsWrite(async () => {
      const fresh = useStore.getState().jobs.find((x) => x.id === j.id) || j;
      await db.patch("jobs", j.id, { rooms: JSON.stringify({ ...jobRoomsOf(fresh), invoiceAfterPhotos: on }) });
    });
  };

  const generateInvoice = (j: typeof jobs[0]) => {
    const today = new Date().toLocaleDateString("en-US", {
      year: "numeric", month: "long", day: "numeric",
    });
    const invoiceNum = "INV-" + j.id.slice(0, 6).toUpperCase();
    const orgName = org?.name || "Service Provider";
    // A deposit already collected comes off what's due.
    const { paid: paidSoFar, due: balanceDueNow } = balanceOf(j);

    // Totals breakdown. The invoice used to print only labor + materials + the
    // grand total, so a per-quote discount was invisible (and labor+materials
    // didn't reconcile with the discounted total). Rebuild the same cascade the
    // quote PDF shows: subtotal → trip fee → discount → tax → total. `j.total`
    // is authoritative — it's what Stripe charges, already post-discount+tax
    // (QuoteForge stores lockTotal = baseAfterDiscount + tax) — so the tax line
    // is derived as the reconciling remainder and every line foots to it
    // exactly, even if an org setting changed since the quote was saved.
    const subtotal = Math.round(((j.total_labor || 0) + (j.total_mat || 0)) * 100) / 100;
    let discParsed: { type: string; value: number; label?: string } | null = null;
    try {
      const data = typeof j.rooms === "string" ? JSON.parse(j.rooms) : j.rooms;
      const d = data?.discount;
      if (d && (d.type === "percent" || d.type === "fixed") && typeof d.value === "number" && d.value > 0) {
        discParsed = { type: d.type, value: d.value, label: typeof d.label === "string" ? d.label : undefined };
      }
    } catch { /* malformed rooms — no discount line */ }
    const tripFee = org?.trip_fee || 0;
    const preBase = subtotal + tripFee;
    const discountAmount = discParsed
      ? (discParsed.type === "percent"
          ? Math.round(preBase * (discParsed.value / 100) * 100) / 100
          : Math.min(preBase, discParsed.value))
      : 0;
    const discountLabel = discParsed
      ? (discParsed.label && discParsed.label.trim()
          ? discParsed.label.trim()
          : (discParsed.type === "percent"
              ? `Discount (${discParsed.value}%)`
              : `Discount ($${discParsed.value.toFixed(2)} off)`))
      : "";
    const grand = j.total || 0;
    // Trip fee shows on its own line when set; the remaining gap (tax + any
    // drift) is the tax line. If trip-fee drift would push tax negative, fold
    // it into a combined "Tax & fees" line rather than printing a negative.
    let showTrip = tripFee > 0;
    let feeLabel = "Tax";
    let feeAmt = Math.round((grand - subtotal - tripFee + discountAmount) * 100) / 100;
    if (showTrip && feeAmt < 0) {
      showTrip = false;
      feeLabel = "Tax & fees";
      feeAmt = Math.round((grand - subtotal + discountAmount) * 100) / 100;
    }
    const totalsRows =
      `<tr><td>Subtotal</td><td class="r" style="width:120px">$${subtotal.toFixed(2)}</td></tr>` +
      (showTrip ? `<tr><td>Trip Fee</td><td class="r">$${tripFee.toFixed(2)}</td></tr>` : "") +
      (discountAmount > 0 ? `<tr style="color:#C00000"><td>${escapeHtml(discountLabel)}</td><td class="r">-$${discountAmount.toFixed(2)}</td></tr>` : "") +
      (feeAmt > 0.005 ? `<tr><td>${feeLabel}</td><td class="r">$${feeAmt.toFixed(2)}</td></tr>` : "");

    const afterPics = jobRoomsOf(j).invoiceAfterPhotos === true ? afterPhotosOf(j) : [];
    const invoicePhotosHtml = afterPics.length
      ? `<h2>Completed Work</h2>
<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-bottom:18px">
${afterPics.map((p) => `  <figure style="margin:0;break-inside:avoid;page-break-inside:avoid">
    <img src="${escapeHtml(p.url).replace(/"/g, "%22")}" alt="" style="width:100%;height:220px;object-fit:cover;border-radius:6px;border:1px solid #ddd;display:block"/>
    ${p.label ? `<figcaption style="font-size:11px;color:#555;margin-top:4px">${escapeHtml(p.label)}</figcaption>` : ""}
  </figure>`).join("")}
</div>`
      : "";

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
      <td class="r">$${subtotal.toFixed(2)}</td>
    </tr>
  </tbody>
</table>

<table style="margin:16px 0 6px">
  <tbody>
    ${totalsRows}
  </tbody>
</table>

<section style="margin:12px 0 20px;padding:22px 26px;background:linear-gradient(135deg,#f0f4f8 0%,#e8eef5 100%);border-radius:10px;border-left:4px solid #2E75B6;display:flex;justify-content:space-between;align-items:center">
  <div>
    <div style="font-family:Oswald,sans-serif;font-size:11px;text-transform:uppercase;color:#888;letter-spacing:.12em">${paidSoFar > 0 ? "Balance Due" : "Total Amount Due"}</div>
    <div style="font-size:11px;color:#666;margin-top:2px">Reference: ${invoiceNum}</div>
    ${paidSoFar > 0 ? `<div style="font-size:11.5px;color:#444;margin-top:6px">Invoice total $${(j.total || 0).toFixed(2)} · Paid $${paidSoFar.toFixed(2)}</div>` : ""}
  </div>
  <div style="font-family:Oswald,sans-serif;font-size:34px;color:#2E75B6;font-weight:700">$${balanceDueNow.toFixed(2)}</div>
</section>

${invoicePhotosHtml}
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
        accent: org?.brand_color,
        accent2: org?.brand_color_2,
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
  // Quote building/sending and recording money are owner/manager actions
  // (onEditJob is only passed to admins), so a tech sees no CTA there.
  const primaryCTA = (dj: typeof jobs[0]): { label: string; icon: string; onClick: () => void } | null => {
    switch (dj.status) {
      case "lead":      return onEditJob ? { label: t("jobs.buildQuote"), icon: "quote", onClick: () => onEditJob(dj.id) } : null;
      // Quoted: SEND is the next step (editing stays one tap away in Work /
      // the Money pencil); once it's out, the next step is a follow-up nudge.
      case "quoted":
        if (!onEditJob) return null;
        return !dj.quote_sent_at
          ? { label: t("jobs.sendQuote"), icon: "send", onClick: () => { void messageCustomer(dj); } }
          : { label: t("jobs.followUp"), icon: "send", onClick: () => { void messageCustomer(dj, { followUp: true }); } };
      case "accepted":  return { label: t("jobs.schedule"), icon: "schedule", onClick: () => (onScheduleJob ? onScheduleJob(dj.property, dj.id) : setPage("sched")) };
      case "scheduled": return { label: t("jobs.markActive"), icon: "play", onClick: () => setStatus(dj.id, "active") };
      case "active":    return { label: t("jobs.markComplete"), icon: "check", onClick: () => setStatus(dj.id, "complete") };
      case "complete":  return { label: t("jobs.sendInvoice"), icon: "send", onClick: () => { void sendInvoice(dj); } };
      case "invoiced":  return isAdmin ? { label: t("jobs.recordPayment"), icon: "checkCircle", onClick: () => openRecordPay(dj) } : null;
      case "paid": {
        // Review already queued/sent (or automation off) → the only thing
        // left is filing it away.
        const rr = reviewRequests
          .filter((r) => r.job_id === dj.id)
          .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))[0];
        const reviewHandled = rr?.status === "scheduled" || rr?.status === "sent" || !!dj.review_requested_at || org?.review_request_enabled === false;
        if (!reviewHandled) return { label: t("jobs.requestReview"), icon: "star", onClick: () => setReviewJob(dj) };
        return dj.archived ? null : { label: t("jobs.doneArchive"), icon: "package", onClick: () => { void archiveJob(dj); } };
      }
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
            // Website quote-form text consent (absent on older/other leads).
            smsConsent: typeof data?.smsConsent?.granted === "boolean" ? (data.smsConsent.granted as boolean) : null,
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
            <button className="bo" onClick={closeDetail} style={{ fontSize: 14, padding: "6px 10px", display: "inline-flex", alignItems: "center", gap: 5 }}>
              <Icon name="back" size={15} /> {isDeepLinkedDetail ? t("common.back") : t("nav.jobs")}
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
            {/* One-tap contact — call / text / email the customer on file. */}
            {(() => {
              const cust = dj.customer_id ? customers.find((c) => c.id === dj.customer_id) : undefined;
              const digits = (cust?.phone || "").replace(/[^\d+]/g, "");
              if (!digits && !cust?.email) return null;
              const chip = { fontSize: 13, padding: "4px 10px", display: "inline-flex", alignItems: "center", gap: 5, textDecoration: "none", fontFamily: "var(--font-heading)", textTransform: "uppercase" as const, letterSpacing: ".06em" };
              return (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                  {digits && (
                    <a className="bo" href={`tel:${digits}`} style={chip}>
                      <Icon name="phone" size={13} /> {t("jobs.call")}
                    </a>
                  )}
                  {digits && (
                    <button type="button" className="bo" onClick={() => { void messageCustomer(dj); }} style={chip}>
                      <Icon name="send" size={13} /> {t("jobs.textCustomer")}
                    </button>
                  )}
                  {cust?.email && (
                    <a className="bo" href={`mailto:${cust.email}`} style={chip}>
                      <Icon name="mail" size={13} /> {t("jobs.email")}
                    </a>
                  )}
                </div>
              );
            })()}
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
              <div style={{ textAlign: "right" }}>
                <div style={{ fontFamily: "Oswald", fontWeight: 700, fontSize: 24, color: "var(--color-money)" }}>${(dj.total || 0).toFixed(0)}</div>
                {/* A deposit is in but the job isn't paid off — say what's left. */}
                {(dj.amount_paid || 0) > 0 && dj.status !== "paid" && (() => {
                  const { paid, due } = balanceOf(dj);
                  return (
                    <div className="dim" style={{ fontSize: 12, marginTop: -2 }}>
                      {t("jobs.paidDue").replace("{paid}", paid.toFixed(2)).replace("{due}", due.toFixed(2))}
                    </div>
                  );
                })()}
              </div>
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
          {/* Crew can't log money — tell them who does instead of a dead end. */}
          {!cta && dj.status === "invoiced" && !isAdmin && (
            <div className="dim mb" style={{ fontSize: 13.5, display: "flex", alignItems: "center", gap: 7, padding: "2px 2px 4px" }}>
              <Icon name="money" size={14} /> {t("jobs.techCashHint")}
            </div>
          )}

          {/* Approved offline (in person / phone / paper)? Record it — locks the
              picked option's price + work order like the online approval.
              Owner/manager only (the record-approval API is). */}
          {isAdmin && (dj.status === "quoted" || dj.status === "accepted") && !dj.client_signature && (
            <button
              className="bo mb"
              onClick={() => setApprovalJob(dj)}
              style={{ width: "100%", padding: "10px", fontFamily: "Oswald", fontSize: 15, letterSpacing: ".3px", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8 }}
            >
              <Icon name="checkCircle" size={15} /> {t("jobs.recordApprovalBtn")}
            </button>
          )}

          {/* Message the customer — opt-in, status-aware text, editable before send.
              Not on an admin's quoted job: Send quote / Follow up above IS it. */}
          {(dj.client || dj.customer_id) && !(onEditJob && dj.status === "quoted") && (
            <button
              className="bo mb"
              onClick={() => messageCustomer(dj)}
              style={{ width: "100%", padding: "10px", fontFamily: "Oswald", fontSize: 15, letterSpacing: ".3px", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8 }}
            >
              <Icon name="send" size={15} /> {t("jobs.messageCustomer")}
            </button>
          )}
          {sendStrip && sendStrip.jobId === dj.id && (() => {
            // Sending to the TENANT never counts as sending the quote/invoice
            // to the customer — those stamps (quote_sent_at, complete→invoiced)
            // only fire for the client recipient (index 0).
            const toClient = !sendStrip.recipients || (sendStrip.to ?? 0) === 0;
            const markIfClient = (quiet?: boolean) => { if (toClient) markSent(sendStrip.jobId, sendStrip.kind, quiet); };
            return (
            <div ref={sendStripRef} style={{ marginBottom: 12, background: "var(--color-card-dark)", border: "1px solid var(--color-border-dark-2)", borderRadius: 12, padding: 11 }}>
              {(sendStrip.recipients?.length ?? 0) > 1 && (
                <div style={{ display: "flex", gap: 5, marginBottom: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <span className="dim" style={{ fontSize: 12.5, marginRight: 2 }}>{t("jobs.sendTo")}</span>
                  {sendStrip.recipients!.map((r, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setSendStrip({ ...sendStrip, to: i, phone: r.phone, msg: r.msg })}
                      style={{
                        padding: "3px 10px", borderRadius: 99, fontSize: 12.5, fontFamily: "Oswald",
                        background: (sendStrip.to ?? 0) === i ? "var(--color-primary)" : "transparent",
                        color: (sendStrip.to ?? 0) === i ? "#fff" : "var(--color-dim)",
                        border: `1px solid ${(sendStrip.to ?? 0) === i ? "var(--color-primary)" : "var(--color-border-dark-2)"}`,
                        cursor: "pointer",
                      }}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
              )}
              <div className="dim" style={{ fontSize: 12, marginBottom: 5 }}>
                {sendStrip.phone ? t("jobs.sendToEdit").replace("{phone}", sendStrip.phone) : t("jobs.noPhoneOnFile")}
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
                  onClick={() => { markIfClient(); setSendStrip(null); }}
                  className="bb"
                  style={{ flex: 1, textAlign: "center", textDecoration: "none", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, fontSize: 14 }}
                >
                  <Icon name="send" size={15} color="#fff" /> {t("jobs.openMessages")}
                </a>
                <button type="button" className="bo" onClick={async () => { try { await navigator.clipboard.writeText(sendStrip.msg); markIfClient(true); useStore.getState().showToast(t("jobs.messageCopiedSend"), "success"); } catch { useStore.getState().showToast(t("jobs.copyFailed"), "error"); } }} style={{ fontSize: 14 }}>{t("common.copy")}</button>
                <button type="button" className="bo" onClick={() => setSendStrip(null)} aria-label={t("common.cancel")} style={{ fontSize: 14, padding: "0 11px" }}><Icon name="close" size={14} /></button>
              </div>
            </div>
            );
          })()}

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
              {djLead.smsConsent !== null && (
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: djLead.smsConsent ? "var(--color-success)" : "var(--color-dim)", paddingBottom: 4 }}>
                  <Icon name={djLead.smsConsent ? "check" : "phone"} size={13} />
                  {djLead.smsConsent ? t("jobs.smsConsentYes") : t("jobs.smsConsentNo")}
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
            {/* Closest crew by today's GPS stamps — dispatch the nearest tech. */}
            <ClosestTechHint job={dj} />
            <div className="drow">
              <span className="l">{t("jobs.created")}</span>
              <span className="v">{dj.job_date || (dj.created_at ? dj.created_at.slice(0, 10) : "—")}</span>
            </div>
            {/* Resident (tenant) contact — review requests go HERE when set,
                so a PM client isn't asked to review every work order. Saved
                on the rooms blob (residentName/residentPhone); AppFolio
                imports pre-fill via tenantName/tenantPhone (lib/resident). */}
            {(() => {
              const res = residentContact(dj.rooms);
              const saveResident = (field: "residentName" | "residentPhone", val: string) =>
                enqueueRoomsWrite(async () => {
                  const fresh = useStore.getState().jobs.find((x) => x.id === dj.id);
                  if (!fresh) return;
                  let fd: Record<string, unknown> = {};
                  try { fd = typeof fresh.rooms === "string" ? JSON.parse(fresh.rooms) : (fresh.rooms || {}); } catch { return; }
                  if (((fd[field] as string) || "") === val) return;
                  await db.patch("jobs", dj.id, { rooms: JSON.stringify({ ...fd, [field]: val }) });
                  await loadAll();
                });
              const inputStyle = { flex: 1, maxWidth: 180, textAlign: "right" as const, background: "transparent", border: "none", borderBottom: "1px dashed var(--color-border-dark, #2a2a3e)", padding: "2px 4px", fontSize: 14, color: "inherit" };
              return (
                <>
                  <div className="drow">
                    <span className="l">{t("jobs.resident")}</span>
                    <input key={`rn-${dj.id}`} defaultValue={res.name} placeholder="—" aria-label={t("jobs.resident")}
                      onBlur={(e) => saveResident("residentName", e.target.value.trim())} style={inputStyle} />
                  </div>
                  <div className="drow">
                    <span className="l">{t("jobs.residentPhone")}</span>
                    <input key={`rp-${dj.id}`} type="tel" defaultValue={res.phone} placeholder="—" aria-label={t("jobs.residentPhone")}
                      onBlur={(e) => saveResident("residentPhone", e.target.value.trim())} style={inputStyle} />
                  </div>
                  <div className="dim" style={{ fontSize: 12, padding: "2px 0 4px" }}>{t("jobs.residentHint")}</div>
                </>
              );
            })()}
          </div>

          {/* Equipment — link this job to a serviced unit so completion stamps its history.
              Only shown when the customer/property already has equipment on file (added in CustomerDetail). */}
          {(() => {
            const jobEquip = equipment.filter((e) =>
              (dj.customer_id && e.customer_id === dj.customer_id) ||
              (!!dj.property && !!e.property && e.property === dj.property)
            );
            if (jobEquip.length === 0) return null;
            const KL: Record<string, string> = { hvac: "HVAC / AC", furnace: "Furnace", water_heater: "Water heater", panel: "Electrical panel", other: "Equipment" };
            const kindLabel = (k?: string) => KL[k || ""] || k || "Equipment";
            const unitLabel = (e: typeof jobEquip[number]) => `${kindLabel(e.kind)}${e.make || e.model ? ` — ${[e.make, e.model].filter(Boolean).join(" ")}` : ""}`;
            const linked = jobEquip.find((e) => e.id === dj.equipment_id);
            return (
              <div className="section">
                <div className="seclabel"><Icon name="settings" size={13} /> Equipment</div>
                <div className="drow">
                  <span className="l">Serviced unit</span>
                  <div style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 9px", borderRadius: 99, background: pillBg, border: `1px solid ${pillBorder}` }}>
                    <span style={{ fontSize: 14, fontWeight: 600 }}>{linked ? unitLabel(linked) : "None"}</span>
                    <Icon name="expand" size={12} color="var(--color-dim)" />
                    <select
                      value={dj.equipment_id || ""}
                      aria-label="Serviced unit"
                      onChange={async (e) => { await db.patch("jobs", dj.id, { equipment_id: e.target.value || null }); loadAll(); }}
                      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0, cursor: "pointer", WebkitAppearance: "none", appearance: "none" }}
                    >
                      <option value="">None</option>
                      {jobEquip.map((e) => <option key={e.id} value={e.id}>{unitLabel(e)}{e.serial ? ` (S/N ${e.serial})` : ""}</option>)}
                    </select>
                  </div>
                </div>
                {linked?.last_service_at && (
                  <div className="drow"><span className="l">Last serviced</span><span className="v">{new Date(linked.last_service_at).toLocaleDateString()}</span></div>
                )}
              </div>
            );
          })()}

          {/* Flip project — link this job to one of the org's own flips so its
              receipts + hours roll into that flip's budget vs actual. Owner/manager
              only, and only once a flip exists (crew get no flip_projects rows). */}
          {isAdmin && flipProjects.length > 0 && (() => {
            const linked = flipProjects.find((f) => f.id === dj.flip_project_id);
            return (
              <div className="section">
                <div className="seclabel"><Icon name="trending" size={13} /> {t("flip.title")}</div>
                <div className="drow">
                  <span className="l">{t("flip.jobLink")}</span>
                  <div style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 9px", borderRadius: 99, background: pillBg, border: `1px solid ${linked ? "var(--flip-gold)" : pillBorder}`, maxWidth: "60%" }}>
                    <span style={{ fontSize: 14, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{linked ? linked.address : t("flip.jobLinkNone")}</span>
                    <Icon name="expand" size={12} color="var(--color-dim)" />
                    <select
                      value={dj.flip_project_id || ""}
                      aria-label={t("flip.jobLink")}
                      onChange={async (e) => { await db.patch("jobs", dj.id, { flip_project_id: e.target.value || null }); loadAll(); }}
                      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0, cursor: "pointer", WebkitAppearance: "none", appearance: "none" }}
                    >
                      <option value="">{t("flip.jobLinkNone")}</option>
                      {flipProjects.map((f) => <option key={f.id} value={f.id}>{f.address}</option>)}
                    </select>
                  </div>
                </div>
              </div>
            );
          })()}

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
            {/* Partial payments — a deposit shows here without the job being
                marked paid. Balance due is what the Pay/Invoice buttons charge. */}
            {(dj.amount_paid || 0) > 0 && (() => {
              const paid = Math.round((dj.amount_paid || 0) * 100) / 100;
              const due = Math.round(Math.max(0, (dj.total || 0) - paid) * 100) / 100;
              return (
                <>
                  <div className="drow">
                    <span className="l" style={{ textTransform: "capitalize" }}>{t("jobs.alreadyPaid")}</span>
                    <span className="v" style={{ fontFamily: "Oswald", fontSize: 15, color: "var(--color-money)" }}>${paid.toFixed(2)}</span>
                  </div>
                  <div className="drow">
                    <span className="l" style={{ textTransform: "capitalize" }}>{t("jobs.balanceDue")}</span>
                    <span className="v" style={{ fontFamily: "Oswald", fontSize: 15, color: due > 0 ? "var(--color-warning)" : "var(--color-money)" }}>${due.toFixed(2)}</span>
                  </div>
                </>
              );
            })()}
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
                        {formatHours(labor.totalHrs)} {t("jobs.actual")}{quoted > 0 && ` (${variancePct >= 0 ? "+" : ""}${variancePct.toFixed(0)}%)`}
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
                        <span style={{ fontFamily: "Oswald", flexShrink: 0, marginLeft: 8, color: "var(--color-highlight)" }}>{formatHours(p.hrs)}</span>
                      </div>
                    ))}
                  </div>
                )}
                </>
              );
            })()}
            {(dj.status === "complete" || dj.status === "invoiced" || dj.status === "paid") && (() => {
              const { due: balanceDue } = balanceOf(dj);
              const btn = { fontSize: 14, padding: "8px", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6 } as const;
              return (
              <>
              {(() => {
                const nAfter = afterPhotosOf(dj).length;
                if (!nAfter) return null;
                const on = jobRoomsOf(dj).invoiceAfterPhotos === true;
                return (
                  <label style={{ display: "flex", alignItems: "center", gap: 10, paddingTop: 10, fontSize: 14, cursor: "pointer" }}>
                    <input type="checkbox" checked={on} onChange={(e) => setInvoiceAfterPhotos(dj, e.target.checked)} style={{ width: 18, height: 18, accentColor: "var(--color-success)" }} />
                    <span style={{ flex: 1 }}>{t("jobs.invoiceAfterPhotos").replace("{n}", String(nAfter))}</span>
                  </label>
                );
              })()}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 7, paddingTop: 8 }}>
                {/* Printing is just a PDF — it no longer marks the job invoiced. */}
                <button className="bo" onClick={() => generateInvoice(dj)} style={btn}>
                  <Icon name="receipt" size={14} /> {t("jobs.invoicePdf")}
                </button>
                {/* Complete → Send invoice is the CTA above, so not repeated
                    here; once invoiced it becomes a reminder. */}
                {dj.status !== "paid" && dj.status !== "complete" && balanceDue > 0 && (
                  <button className="bo" onClick={() => { void sendInvoice(dj); }} style={btn}>
                    <Icon name="send" size={14} /> {dj.status === "invoiced" ? t("jobs.sendReminder") : t("jobs.sendInvoice")}
                  </button>
                )}
                {dj.status !== "paid" && balanceDue > 0 && org?.stripe_connected && (
                  <button
                    className="bo"
                    onClick={async () => {
                      try {
                        const res = await fetch("/api/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId: dj.id, amount: balanceDue }) });
                        const data = await res.json();
                        if (data.url) {
                          // Baseline = the server's paid-to-date NOW, not the
                          // render-time copy (up to 15s old) — otherwise a
                          // deposit that landed meanwhile would flip the QR to
                          // "Payment received" before the customer scans it.
                          await loadAll().catch(() => { /* keep the render-time value */ });
                          const fresh = useStore.getState().jobs.find((x) => x.id === dj.id);
                          // Show what Stripe will actually charge (checkout caps at the live balance).
                          const freshDue = fresh ? balanceOf(fresh).due : balanceDue;
                          setPayQR({ url: data.url, jobId: dj.id, amount: Math.min(balanceDue, freshDue), startPaid: Number(fresh?.amount_paid ?? dj.amount_paid) || 0 });
                        }
                        else useStore.getState().showToast(data.error || t("jobs.couldNotCreatePayment"), "error");
                      } catch { useStore.getState().showToast(t("jobs.failedCreatePayment"), "error"); }
                    }}
                    style={btn}
                  >
                    <Icon name="qr" size={14} /> {t("jobs.collectNow")}
                  </button>
                )}
                {/* Owner/manager only; when invoiced it's already the CTA. */}
                {isAdmin && dj.status !== "paid" && dj.status !== "invoiced" && balanceDue > 0 && (
                  <button className="bg" onClick={() => openRecordPay(dj)} style={btn}>
                    <Icon name="check" size={14} /> {t("jobs.recordPayment")}
                  </button>
                )}
              </div>
              {dj.status !== "paid" && balanceDue > 0 && !org?.stripe_connected && user.role === "owner" && openOps && (
                <div onClick={() => openOps("billing")} className="dim" style={{ fontSize: 13, paddingTop: 8, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
                  <Icon name="money" size={13} /> {t("jobs.connectStripeHint")} <Icon name="next" size={13} />
                </div>
              )}
              </>
              );
            })()}
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
            {(dj.status === "complete" || dj.status === "invoiced" || (dj.status === "paid" && cta?.icon !== "star")) && (
              <div style={{ paddingTop: 8 }}>
                <button
                  className="bo"
                  onClick={() => setReviewJob(dj)}
                  style={{ width: "100%", fontSize: 14, padding: "8px", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, color: dj.review_requested_at ? "#888" : "var(--color-highlight)" }}
                >
                  <Icon name={dj.review_requested_at ? "mail" : "star"} size={13} /> {dj.review_requested_at ? t("jobs.reviewSent") : t("jobs.requestReview")}
                </button>
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
                  onClick={() => { void archiveJob(dj); }}
                  style={{ flex: 1, fontSize: 14, padding: "8px", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6 }}
                >
                  <Icon name="package" size={14} /> {t("jobs.archive")}
                </button>
              ) : (
                <button
                  className="bo"
                  onClick={async () => {
                    if (!(await db.patch("jobs", dj.id, { archived: false, archived_at: null }))) return;
                    await loadAll();
                    useStore.getState().showToast(t("jobs.restoredToast"), "success");
                  }}
                  style={{ flex: 1, fontSize: 14, padding: "8px", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6 }}
                >
                  <Icon name="refresh" size={14} /> {t("jobs.restore")}
                </button>
              )}
              {/* Quiet outline, red text — Archive is the everyday choice;
                  Delete is permanent. */}
              <button
                className="bo"
                onClick={() => deleteJob(dj.id)}
                style={{ flex: 1, fontSize: 14, padding: "8px", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, color: "var(--color-accent-red)" }}
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
                    // Optimistic: flip the box in the local store in the same
                    // frame — the old flow waited on the network patch plus a
                    // full loadAll() before rendering the check (the lag).
                    // The 15s poll reconciles if the write below ever fails.
                    const { jobs: allJobs } = useStore.getState();
                    useStore.setState({
                      jobs: allJobs.map((x) => {
                        if (x.id !== sj.id) return x;
                        try {
                          const d = (typeof x.rooms === "string" ? JSON.parse(x.rooms) : (x.rooms || {})) as Record<string, unknown>;
                          const wo: WOItem[] = Array.isArray(d.workOrder) ? [...(d.workOrder as WOItem[])] : [];
                          const mi = wo.findIndex((y) => woStableKey(y) === targetKey);
                          if (mi < 0) return x;
                          wo[mi] = { ...wo[mi], done: nextDone };
                          return { ...x, rooms: JSON.stringify({ ...d, workOrder: wo }) };
                        } catch { return x; }
                      }),
                    });
                    // Durable: queued first, then synced against the job's
                    // current server blob (replays on reconnect when offline).
                    enqueueWoToggle(sj.id, targetKey, nextDone);
                    enqueueRoomsWrite(async () => { await flushWoQueue(sj.id); });
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
                  onClick={async () => { const f = await pickReceiptPhoto(true); if (f) addReceiptPages([f], sj.id); }}
                  style={{ flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, fontSize: 14, opacity: scanning ? 0.5 : 1 }}
                >
                  <Icon name="camera" size={15} /> {pendingPages.length ? "Add page" : t("common.takePhoto")}
                </button>
                <button
                  type="button"
                  className="bo"
                  disabled={scanning}
                  onClick={async () => { const fs = await pickReceiptPhotos(false); if (fs.length) addReceiptPages(fs, sj.id); }}
                  style={{ flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, fontSize: 14, opacity: scanning ? 0.5 : 1 }}
                >
                  <Icon name="upload" size={15} /> {t("common.upload")}
                </button>
              </div>
              {/* Pending pages of the receipt being built — scanned together as one. */}
              {pendingPages.length > 0 && (
                <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                  {pendingPages.map((p, i) => (
                    <div key={i} style={{ position: "relative" }}>
                      <img src={p.url} alt="" onClick={() => setViewPhoto(p.url)} style={{ width: 46, height: 46, borderRadius: 7, objectFit: "cover", border: "1px solid var(--color-border-dark)", cursor: "pointer" }} />
                      <button
                        onClick={() => removePendingPage(i)}
                        aria-label="Remove page"
                        disabled={scanning}
                        style={{ position: "absolute", top: -6, right: -6, width: 18, height: 18, borderRadius: "50%", background: "var(--color-accent-red)", color: "#fff", border: "none", fontSize: 11, lineHeight: 1, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}
                      >
                        ✕
                      </button>
                      <span style={{ position: "absolute", bottom: -3, left: -3, fontSize: 8, background: "rgba(0,0,0,.65)", color: "#fff", padding: "0 3px", borderRadius: 3 }}>{i + 1}</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="dim" style={{ fontSize: 12.5, marginTop: 7, display: "flex", alignItems: "center", gap: 6 }}>
                <Icon name={scanning ? "time" : "sparkle"} size={13} color={scanning ? "var(--color-warning)" : "var(--color-primary)"} />
                {scanning
                  ? t("jobs.scanningReceipt")
                  : pendingPages.length > 1
                    ? `${pendingPages.length} pages — scanned as one receipt`
                    : pendingPages.length === 1
                      ? "1 page · add more for a multi-page receipt"
                      : t("jobs.attachPhotoAutoScan")}
              </div>
              <div style={{ display: "flex", gap: 7, marginTop: 8 }}>
                <input value={rn} onChange={(e) => setRn(e.target.value)} placeholder={scanning ? t("jobs.scanningShort") : t("jobs.noteVendor")} style={{ flex: 1 }} disabled={scanning} />
                <input type="number" value={ra} onChange={(e) => setRa(e.target.value)} placeholder="$" style={{ width: 72 }} disabled={scanning} />
                <button className="bg" onClick={() => addReceipt(sj.id)} style={{ fontSize: 14, padding: "6px 12px" }} disabled={uploading || scanning}>
                  {uploading ? "…" : t("common.add")}
                </button>
              </div>
            </div>

            {/* Receipt list */}
            <div className="section">
              <div className="seclabel" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Icon name="receipt" size={13} /> {t("jobs.receipts")}</span>
                {receipts.filter((r) => r.job_id === sj.id).length > 0 && (
                  <span style={{ color: "var(--color-success)", fontFamily: "Oswald", fontSize: 14 }}>
                    ${receipts.filter((r) => r.job_id === sj.id).reduce((s, r) => s + (r.amount || 0), 0).toFixed(2)} total
                  </span>
                )}
              </div>
              {receipts.filter((r) => r.job_id === sj.id).length === 0 ? (
                <div style={{ fontSize: 14, color: "var(--color-dim)", padding: "10px 0", textAlign: "center" }}>{t("jobs.noReceipts")}</div>
              ) : (
                receipts.filter((r) => r.job_id === sj.id).map((r) => {
                  const src = isPrivatePath(r.photo_url) ? signedReceipts[r.photo_url] : r.photo_url;
                  return (
                  <div key={r.id} className="drow">
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                      {src && (
                        <img src={src} alt="" onClick={() => setViewPhoto(src)} style={{ width: 32, height: 32, borderRadius: 6, objectFit: "cover", cursor: "pointer", flexShrink: 0, border: "1px solid var(--color-border-dark)" }} />
                      )}
                      <span style={{ minWidth: 0 }}>
                        <span style={{ fontSize: 14.5, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.note || t("jobs.receiptSingular")}</span>
                        <span className="dim" style={{ fontSize: 12 }}>{r.receipt_date}{r.pages && r.pages.length > 1 ? ` · ${r.pages.length} pages` : ""}</span>
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
                  );
                })
              )}
            </div>

            {/* Job photos (before / work / after / rendered) — these live on the
                rooms.photos blob in the PUBLIC bucket, so they render directly.
                Previously this screen showed receipts only. */}
            {(() => {
              let photos: { url: string; label?: string; type?: string }[] = [];
              try {
                const d = typeof sj.rooms === "string" ? JSON.parse(sj.rooms) : sj.rooms;
                photos = Array.isArray(d?.photos) ? d.photos : [];
              } catch { /* */ }
              if (!photos.length) return null;
              return (
                <div className="section">
                  <div className="seclabel"><Icon name="camera" size={13} /> Job Photos ({photos.length})</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6, marginTop: 8 }}>
                    {photos.map((p, i) => (
                      <div
                        key={i}
                        onClick={() => p.url && setViewPhoto(p.url)}
                        style={{ position: "relative", aspectRatio: "1", borderRadius: 8, overflow: "hidden", border: "1px solid var(--color-border-dark)", cursor: "pointer" }}
                      >
                        <img src={p.url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                        {p.type && (
                          <span style={{ position: "absolute", bottom: 0, left: 0, right: 0, fontSize: 9, textAlign: "center", background: "rgba(0,0,0,.55)", color: "#fff", padding: "1px 0", textTransform: "capitalize" }}>{p.type}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}
          </>
        )}
      </>
    );
  })();

  return (
    <div className="fi">
      {subScreenJsx || detailScreen || (
        <>
      <TopBar title={t("nav.jobs")} icon="jobs" color="#ef4444" right={
        <button
          className="bo"
          onClick={() => { setSelectMode((m) => !m); setSelectedIds([]); setBulkStatus(""); }}
          style={{ width: "auto", fontSize: 13.5, padding: "5px 12px", display: "inline-flex", alignItems: "center", gap: 6, ...(selectMode ? { color: "var(--color-primary)", borderColor: "var(--color-primary)" } : {}) }}
        >
          <Icon name={selectMode ? "close" : "checkCircle"} size={14} />
          {selectMode ? t("common.cancel") : t("jobs.select")}
        </button>
      } />

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
                onClick={() => { setJobTab(tab.id); setSelectedIds([]); setQuickFilter(null); }}
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

      {/* Billing tab header — two honest numbers: work done but not billed
          yet, and what invoiced customers still owe after any deposits. */}
      {jobTab === "billing" && jobs.some((j) => !j.archived && (j.status === "complete" || j.status === "invoiced")) && (
        <div className="cd mb" style={{ borderLeft: "3px solid var(--color-warning)", padding: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <div style={{ display: "flex", gap: 18 }}>
              <div>
                <div className="sl">{t("dash.toInvoice")}</div>
                <div style={{ fontSize: 22, fontFamily: "Oswald", fontWeight: 700, color: "var(--color-warning)" }}>
                  ${Math.round(jobs.filter((j) => !j.archived && j.status === "complete").reduce((s, j) => s + (j.total || 0), 0)).toLocaleString()}
                </div>
              </div>
              <div>
                <div className="sl">{t("jobs.awaitingPayment")}</div>
                <div style={{ fontSize: 22, fontFamily: "Oswald", fontWeight: 700, color: statusColor("invoiced") }}>
                  ${Math.round(jobs.filter((j) => !j.archived && j.status === "invoiced").reduce((s, j) => s + balanceOf(j).due, 0)).toLocaleString()}
                </div>
              </div>
            </div>
            {!org?.stripe_connected && user.role === "owner" && (
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
                      // Raw response bodies are for the console, not the owner.
                      const text = await res.text().catch(() => "");
                      console.error("[stripe/connect]", res.status, text);
                      useStore.getState().showToast(t("jobs.couldNotStartStripe"), "error");
                      setConnectingStripe(false);
                      return;
                    }
                    const data = await res.json();
                    if (data.url) {
                      // /api/stripe/connect already saved the account id.
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
        // Home's Needs-attention tiles open a slice of the tab (quickFilter).
        const quickFiltered = quickFilter ? baseFiltered.filter((j) => quickMatch(j, quickFilter)) : baseFiltered;
        // Apply the typeahead query as an inline filter so the visible
        // list narrows as the user types — keeps the dropdown and the
        // list view in sync.
        const q = searchQuery.toLowerCase();
        const queryFiltered = q
          ? quickFiltered.filter((j) => `${j.property || ""} ${j.client || ""} ${j.trade || ""}`.toLowerCase().includes(q))
          : quickFiltered;
        // Within the active tab, leads bubble to the top — they're the
        // newest external work and need triage before older quotes.
        // Waiting on customer: the longest-waiting quote first (chase it).
        // Billing: to-invoice before awaiting-payment (stable sort keeps the
        // existing order inside each group).
        const filtered = quickFilter === "waiting"
          ? [...queryFiltered].sort((a, b) => (a.quote_sent_at || "").localeCompare(b.quote_sent_at || ""))
          : jobTab === "active"
          ? [...queryFiltered].sort((a, b) => {
              const al = a.status === "lead" ? 0 : 1;
              const bl = b.status === "lead" ? 0 : 1;
              if (al !== bl) return al - bl;
              return (b.created_at || "").localeCompare(a.created_at || "");
            })
          : jobTab === "billing"
          ? [...queryFiltered].sort((a, b) => (a.status === "complete" ? 0 : 1) - (b.status === "complete" ? 0 : 1))
          : queryFiltered;

        const quickLabel = quickFilter === "lead" ? t("jobs.filterLead")
          : quickFilter === "toSend" ? t("dash.toSend")
          : quickFilter === "waiting" ? t("dash.waitingOnCustomer")
          : quickFilter === "toInvoice" ? t("dash.toInvoice")
          : quickFilter === "unpaid" ? t("dash.unpaid")
          : "";
        const filterChip = quickFilter ? (
          <div className="mb" style={{ display: "flex" }}>
            <span className="chip" style={{ background: pillBg, border: "1px solid var(--color-primary)", color: "var(--color-primary)", fontSize: 13 }}>
              {t("jobs.showing").replace("{label}", quickLabel).replace("{n}", String(quickFiltered.length))}
              <button
                type="button"
                onClick={() => setQuickFilter(null)}
                aria-label={t("jobs.showAll")}
                style={{ background: "transparent", border: "none", padding: "0 0 0 2px", color: "inherit", display: "inline-flex", alignItems: "center", cursor: "pointer" }}
              >
                <Icon name="close" size={13} />
              </button>
            </span>
          </div>
        ) : null;

        // Nothing to show yet because the data hasn't fully loaded (cold
        // start, a deep link written at boot, offline with no snapshot) —
        // say loading, not "all done here" / "no jobs".
        if (!filtered.length && !dataReady) {
          return (
            <>
              {filterChip}
              <div className="cd dim" style={{ textAlign: "center", padding: 24 }}>{t("common.loading")}</div>
            </>
          );
        }

        // A filtered slice that's empty means that pile is cleared — say so
        // calmly and offer a way out, instead of the generic "no jobs".
        if (quickFilter && !quickFiltered.length) {
          return (
            <>
              {filterChip}
              <div className="cd" style={{ textAlign: "center", padding: 24 }}>
                <Icon name="checkCircle" size={30} color="var(--color-success)" />
                <div style={{ fontFamily: "Oswald", fontSize: 18, marginTop: 8 }}>{t("jobs.filterDone")}</div>
                <p className="dim" style={{ fontSize: 14, margin: "4px 0 14px" }}>{t("jobs.filterDoneSub")}</p>
                <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
                  <button className="bo" onClick={() => setQuickFilter(null)}>{t("jobs.showAll")}</button>
                  <button className="bb" onClick={() => setPage("dash")}>{t("jobs.backHome")}</button>
                </div>
              </div>
            </>
          );
        }

        if (!filtered.length) {
          return (
            <>
            {filterChip}
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
            </>
          );
        }

        const cards = filtered.map((j) => {
          const w = getWorkers(j);
          const isSel = selectMode && selectedIds.includes(j.id);
          // Status-aware triage hint for the collapsed card's second row —
          // surfaces the job's next-action context the way the mockup does
          // (On site · <tech>, Ready to invoice, …). Icons are curated names
          // from Icon.tsx; an unknown name renders nothing rather than crash.
          const hint: { icon: string; text: string } = (() => {
            switch (j.status) {
              // A lead's own words ("Leaky faucet in the…") say more than "New lead".
              case "lead": {
                let desc = "";
                try {
                  const d = typeof j.rooms === "string" ? JSON.parse(j.rooms) : j.rooms;
                  desc = typeof d?.leadDescription === "string" ? d.leadDescription.replace(/\s+/g, " ").trim() : "";
                } catch { desc = ""; }
                return { icon: "quote", text: desc ? (desc.length > 40 ? `${desc.slice(0, 40).trimEnd()}…` : desc) : t("jobs.hintNewLead") };
              }
              case "quoted":    return j.quote_sent_at
                ? { icon: "send", text: t("jobs.hintSentAgo").replace("{ago}", sentAgo(j.quote_sent_at)) }
                : { icon: "warn", text: t("jobs.hintNotSent") };
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
            <div key={j.id} id={`job-row-${j.id}`} className="cd mb statusstrip" style={{ ["--c" as any]: statusColor(j.status), ...(isSel ? { outline: "2px solid var(--color-primary)", outlineOffset: -2 } : {}) }}>
              {/* Collapsed header — in select mode a tap toggles the checkbox
                  instead of opening the detail screen. */}
              <div
                style={{ cursor: "pointer", display: "flex", alignItems: "flex-start", gap: selectMode ? 10 : 0 }}
                onClick={() => (selectMode ? toggleSelected(j.id) : setDetailJobId(j.id))}
                {...(selectMode ? { role: "checkbox", "aria-checked": isSel } : {})}
              >
                {selectMode && (
                  <span
                    aria-hidden
                    style={{
                      width: 22, height: 22, borderRadius: 6, flexShrink: 0, marginTop: 2,
                      display: "inline-flex", alignItems: "center", justifyContent: "center",
                      border: `2px solid ${isSel ? "var(--color-primary)" : "var(--color-border-dark-2)"}`,
                      background: isSel ? "var(--color-primary)" : "transparent",
                    }}
                  >
                    {isSel && <Icon name="check" size={14} color="#fff" strokeWidth={3} />}
                  </span>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                {/* Row 1 — client headline + address (map pin) · amount */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontFamily: "Oswald", fontWeight: 600, fontSize: 17, letterSpacing: ".3px", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
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
                  {/* A lead has no price yet — show how long it's been waiting. */}
                  {j.status === "lead" ? (
                    <div style={{ fontFamily: "Oswald", fontWeight: 600, fontSize: 14, whiteSpace: "nowrap", color: "#ff3d6e", paddingTop: 2 }}>
                      {t("jobs.leadAge").replace("{ago}", sentAgo(j.created_at))}
                    </div>
                  ) : (
                    <div style={{ fontFamily: "Oswald", fontWeight: 700, fontSize: 20, whiteSpace: "nowrap", color: "var(--color-money)" }}>
                      ${(j.total || 0).toFixed(0)}
                    </div>
                  )}
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
                      flexShrink: 0,
                    }}
                  >
                    {j.status === "lead" ? t("jobs.lead") : (t(`status.${j.status}`) || j.status)}
                  </span>
                  {/* minWidth 0 + ellipsis: a long hint (a lead's request) trims
                      instead of pushing the card wider than the phone. */}
                  <span className="dim" style={{ fontSize: 12.5, display: "inline-flex", alignItems: "center", gap: 5, whiteSpace: "nowrap", minWidth: 0 }}>
                    <Icon name={hint.icon} size={12} />
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{hint.text}</span>
                    <Icon name="next" size={14} />
                  </span>
                </div>
                </div>
              </div>
            </div>
          );
        });

        const visibleIds = filtered.map((j) => j.id);
        const allSel = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.includes(id));
        // Paid tab: one tap files every paid job away (reversible).
        const archiveAllPaid = async () => {
          const ids = baseFiltered.map((j) => j.id);
          const n = String(ids.length);
          if (!await useStore.getState().showConfirm(t("jobs.archive"), t("jobs.archiveAllPaidQ").replace("{n}", n))) return;
          const done = await archiveMany(ids);
          // 0 = every write failed and db.patch already toasted why.
          if (done === 0) return;
          useStore.getState().showToast(t("jobs.archivedMany").replace("{n}", String(done)), done < ids.length ? "warning" : "success");
        };
        return (
          <>
            {filterChip}
            {cards}
            {jobTab === "paid" && !selectMode && baseFiltered.length > 0 && (
              <div className="linkrow dim" onClick={archiveAllPaid} style={{ cursor: "pointer", fontSize: 14, borderBottom: "none" }}>
                <span className="lf"><span className="ic"><Icon name="package" size={15} /></span> {t("jobs.archiveAllPaid").replace("{n}", String(baseFiltered.length))}</span>
                <Icon name="next" size={15} />
              </div>
            )}
            {/* Bulk status bar — sticks above the bottom nav while scrolling. */}
            {selectMode && (
              <div
                style={{
                  position: "sticky",
                  bottom: navBottom ? "calc(var(--nav-h) + env(safe-area-inset-bottom) + 8px)" : 12,
                  zIndex: 30, marginTop: 4, padding: 10, borderRadius: 14,
                  background: darkMode ? "var(--color-card-dark)" : "var(--color-card-light)",
                  border: "1.5px solid var(--color-primary)",
                  boxShadow: "0 10px 30px rgba(0,0,0,.55)",
                  display: "flex", flexDirection: "column", gap: 8,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <span style={{ fontFamily: "Oswald", fontSize: 15, letterSpacing: ".3px" }}>
                    {selectedIds.length} {t("jobs.selectedCount")}
                  </span>
                  <div style={{ display: "flex", gap: 6 }}>
                    {jobTab !== "archive" && (
                      <button
                        className="bo"
                        disabled={!selectedIds.length || bulkBusy}
                        onClick={bulkArchive}
                        style={{ width: "auto", fontSize: 13, padding: "4px 10px", display: "inline-flex", alignItems: "center", gap: 5 }}
                      >
                        <Icon name="package" size={13} /> {t("jobs.archive")}
                      </button>
                    )}
                    <button
                      className="bo"
                      onClick={() => setSelectedIds(allSel ? [] : visibleIds)}
                      style={{ width: "auto", fontSize: 13, padding: "4px 10px" }}
                    >
                      {allSel ? t("jobs.clearSelection") : t("jobs.selectAll")}
                    </button>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <select
                    value={bulkStatus}
                    onChange={(e) => setBulkStatus(e.target.value)}
                    aria-label={t("jobs.setStatusTo")}
                    style={{ flex: 1, fontSize: 15 }}
                  >
                    <option value="">{t("jobs.setStatusTo")}</option>
                    {["lead", "quoted", "accepted", "scheduled", "active", "complete", "invoiced", "paid"].map((st) => (
                      <option key={st} value={st}>{statusLabel(st)}</option>
                    ))}
                  </select>
                  <button
                    className="bb"
                    disabled={!selectedIds.length || !bulkStatus || bulkBusy}
                    onClick={bulkApply}
                    style={{ width: "auto", padding: "8px 16px", fontSize: 15, opacity: !selectedIds.length || !bulkStatus || bulkBusy ? 0.5 : 1 }}
                  >
                    {bulkBusy ? "…" : t("jobs.apply")}
                  </button>
                </div>
              </div>
            )}
          </>
        );
      })()}

      <div style={{ textAlign: "center", marginTop: 16 }}>
        <p className="dim" style={{ fontSize: 14 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, justifyContent: "center" }}>
            <Icon name="tip" size={14} color="var(--color-highlight)" />
            {jobTab === "active" ? t("jobs.tipActive") : jobTab === "billing" ? t("jobs.tipBilling") : jobTab === "archive" ? t("jobs.tipArchive") : t("jobs.tipPaid")}
          </span>
        </p>
      </div>
        </>
      )}

      {/* Record payment (cash / check / own card terminal) */}
      {recordPay && (() => {
        const rj = jobs.find((j) => j.id === recordPay.jobId);
        const { paid, due } = rj ? balanceOf(rj) : { paid: 0, due: 0 };
        const amt = parseFloat(recordPay.amount);
        const over = amt > due + 0.009 ? amt - due : 0;
        const methodLabel = t(`jobs.payMethod.${recordPay.method}`);
        return (
          <div onClick={() => !recordPay.busy && setRecordPay(null)} className="sheet-overlay">
            <div onClick={(e) => e.stopPropagation()} className="cd sheet" style={{ maxWidth: 420, paddingTop: 20 }}>
              <h3 style={{ fontFamily: "Oswald", fontSize: 19, textTransform: "uppercase", marginBottom: 4 }}>{t("jobs.recordPayment")}</h3>
              <div className="dim" style={{ fontSize: 13, marginBottom: 12 }}>
                {rj?.property}{paid > 0 ? ` · ${t("jobs.alreadyPaid")} $${paid.toFixed(2)}` : ""} · {t("jobs.balanceDue")} ${due.toFixed(2)}
              </div>
              <label className="sl">{t("jobs.amountReceived")}</label>
              <div className="row" style={{ gap: 6, margin: "4px 0 12px", alignItems: "center" }}>
                <span>$</span>
                <input type="number" inputMode="decimal" min="0" step="0.01" value={recordPay.amount} onChange={(e) => setRecordPay({ ...recordPay, amount: e.target.value, confirmOver: false })} style={{ flex: 1 }} />
                {due > 0 && (
                  <button
                    type="button"
                    className="chip"
                    onClick={() => setRecordPay({ ...recordPay, amount: due.toFixed(2), confirmOver: false })}
                    style={{ flexShrink: 0, cursor: "pointer", background: "transparent", border: "1px solid var(--color-success)", color: "var(--color-success)", fontSize: 12 }}
                  >
                    {t("jobs.fullBalance")}
                  </button>
                )}
              </div>
              {over > 0 && recordPay.confirmOver && (
                <div style={{ fontSize: 13, color: "var(--color-warning)", margin: "-6px 0 12px", display: "flex", alignItems: "flex-start", gap: 6 }}>
                  <Icon name="warn" size={14} color="var(--color-warning)" /> {t("jobs.overBalanceWarn").replace("{over}", over.toFixed(2))}
                </div>
              )}
              <label className="sl">{t("jobs.paidBy")}</label>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6, margin: "4px 0 16px" }}>
                {(["cash", "check", "card", "other"] as const).map((m) => (
                  <button key={m} type="button" className={recordPay.method === m ? "bb" : "bo"} onClick={() => setRecordPay({ ...recordPay, method: m })} style={{ fontSize: 13, padding: "7px 0" }}>
                    {t(`jobs.payMethod.${m}`)}
                  </button>
                ))}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="bo" onClick={() => setRecordPay(null)} disabled={recordPay.busy} style={{ flex: 1 }}>{t("common.cancel")}</button>
                {/* The label says exactly what gets saved: "Save $120.00 · Cash". */}
                <button className="bg" onClick={saveRecordPay} disabled={recordPay.busy} style={{ flex: 2 }}>
                  {recordPay.busy
                    ? t("jobs.savingPayment")
                    : amt > 0
                    ? t("jobs.savePaymentAmt").replace("{amt}", amt.toFixed(2)).replace("{method}", methodLabel)
                    : t("jobs.savePayment")}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Status → Paid with a balance still owed: record it, or just mark it. */}
      {paidChoice && (() => {
        const pj = jobs.find((j) => j.id === paidChoice.jobId);
        const full = { width: "100%", padding: "10px", fontSize: 15, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7 } as const;
        return (
          <div onClick={() => setPaidChoice(null)} className="sheet-overlay">
            <div onClick={(e) => e.stopPropagation()} className="cd sheet" style={{ maxWidth: 420, paddingTop: 20 }}>
              <h3 style={{ fontFamily: "Oswald", fontSize: 19, textTransform: "uppercase", marginBottom: 4 }}>
                {t("jobs.paidOwedTitle").replace("{due}", paidChoice.due.toFixed(2))}
              </h3>
              {pj?.property && <div className="dim" style={{ fontSize: 13, marginBottom: 8 }}>{pj.property}</div>}
              <p style={{ fontSize: 14, margin: "0 0 14px", lineHeight: 1.45 }}>{t("jobs.paidOwedBody")}</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <button className="bg" style={full} onClick={() => { setPaidChoice(null); if (pj) openRecordPay(pj); }}>
                  <Icon name="checkCircle" size={15} /> {t("jobs.recordPayment")}
                </button>
                <button
                  className="bo"
                  style={full}
                  onClick={async () => {
                    const id = paidChoice.jobId;
                    setPaidChoice(null);
                    await applyStatus(id, "paid");
                    loadAll();
                  }}
                >
                  {t("jobs.justMarkPaid")}
                </button>
                <button
                  type="button"
                  onClick={() => setPaidChoice(null)}
                  className="dim"
                  style={{ background: "none", border: "none", fontSize: 13, padding: 6, cursor: "pointer" }}
                >
                  {t("common.cancel")}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Bulk → Paid with balances owed: log each job's balance as a payment. */}
      {bulkPaid && (() => {
        const owing = jobs.filter((j) => selectedIds.includes(j.id) && j.status !== "paid" && balanceOf(j).due > 0.009);
        const totalDue = owing.reduce((s, j) => s + balanceOf(j).due, 0);
        return (
          <div onClick={() => !bulkPaid.busy && setBulkPaid(null)} className="sheet-overlay">
            <div onClick={(e) => e.stopPropagation()} className="cd sheet" style={{ maxWidth: 420, paddingTop: 20 }}>
              <h3 style={{ fontFamily: "Oswald", fontSize: 19, textTransform: "uppercase", marginBottom: 6 }}>
                {t("jobs.bulkPaidTitle").replace("{n}", String(owing.length))}
              </h3>
              <p style={{ fontSize: 14, margin: "0 0 10px", lineHeight: 1.45 }}>
                {t("jobs.bulkPaidBody").replace("{amt}", totalDue.toFixed(2))}
              </p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6, margin: "4px 0 16px" }}>
                {(["cash", "check", "card", "other"] as const).map((m) => (
                  <button key={m} type="button" className={bulkPaid.method === m ? "bb" : "bo"} disabled={bulkPaid.busy} onClick={() => setBulkPaid({ ...bulkPaid, method: m })} style={{ fontSize: 13, padding: "7px 0" }}>
                    {t(`jobs.payMethod.${m}`)}
                  </button>
                ))}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="bo" onClick={() => setBulkPaid(null)} disabled={bulkPaid.busy} style={{ flex: 1 }}>{t("common.cancel")}</button>
                <button className="bg" onClick={confirmBulkPaid} disabled={bulkPaid.busy} style={{ flex: 2 }}>
                  {bulkPaid.busy ? t("jobs.savingPayment") : t("jobs.bulkPaidConfirm")}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Payment QR overlay — flips to "Payment received" once the job's
          paid-to-date rises (the 8s poll above picks it up). */}
      {payQR && (() => {
        const live = jobs.find((j) => j.id === payQR.jobId);
        const received = !!live && ((live.amount_paid || 0) > payQR.startPaid + 0.009 || live.status === "paid");
        const liveDue = live ? balanceOf(live).due : 0;
        return (
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
            {received ? (
              <>
                <Icon name="checkCircle" size={64} color="var(--color-success)" style={{ margin: "0 auto 10px", display: "block" }} />
                <div style={{ fontSize: 26, fontFamily: "Oswald", fontWeight: 700, color: "#fff", marginBottom: 6 }}>
                  {t("jobs.paymentReceived")}
                </div>
                <div style={{ fontSize: 15, color: liveDue > 0.009 ? "var(--color-warning)" : "#00cc66", marginBottom: 18 }}>
                  {liveDue > 0.009 ? t("jobs.stillDue").replace("{due}", liveDue.toFixed(2)) : t("jobs.paidInFull")}
                </div>
                <button className="bg" onClick={() => setPayQR(null)} style={{ fontSize: 15, padding: "8px 28px" }}>
                  {t("common.done")}
                </button>
              </>
            ) : (
              <>
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
              </>
            )}
          </div>
        </div>
        );
      })()}

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

      {/* Record an offline approval — mounted with the other modals so it
          renders over the detail screen. */}
      {approvalJob && <RecordApprovalSheet job={approvalJob} onClose={() => setApprovalJob(null)} />}

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
      // stripAiHrs: each visit is its own job, not this quote's AI estimate.
      templateRooms = stripAiHrsFromBlob(typeof job.rooms === "string" ? JSON.parse(job.rooms) : job.rooms);
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
      className="sheet-overlay"
      style={{ zIndex: 1500 }}
    >
      <div
        className="cd sheet"
        onClick={(e) => e.stopPropagation()}
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
