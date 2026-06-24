"use client";
import { apiFetch } from "@/lib/api";
import { useState, useEffect, useRef, Fragment } from "react";
import { useStore } from "@/lib/store";
import { db, supabase } from "@/lib/supabase";
import { t } from "@/lib/i18n";
import { makeGuide, extractZip } from "@/lib/parser";
import { recordJobOutcome, jobActualHours } from "@/lib/learning";
import type { Job } from "@/lib/types";
import { statusColor } from "@/lib/status";
import { Icon } from "../Icon";
import MileageQuickTrack from "../MileageQuickTrack";
import RenderModal from "../RenderModal";
import { buildRenderPrompt } from "@/lib/render-prompt";
import ReviewRequestModal from "../ReviewRequestModal";
import CameraModal from "../CameraModal";

function ld<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try { const v = localStorage.getItem("c_" + key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}
function sv(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  localStorage.setItem("c_" + key, JSON.stringify(value));
}
function fmt(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 3600).toString().padStart(2, "0")}:${Math.floor((s % 3600) / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;
}
function fmtTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

// Stable identity for a work-order item across renders — used by toggleWO to
// find the right item in the latest store snapshot even if the array order
// shifted. Kept in sync with the merge key in QuoteForge.saveJob.
function woStableKey(w: { room?: string; detail?: string }): string {
  return `${(w.room || "").toLowerCase().trim()}|||${(w.detail || "").toLowerCase().trim()}`;
}

// Resolve a job_id from a property/address string when stamping a new
// time_entries row. Disambiguates the case where two jobs share an address
// (e.g. callback work at a property that's already had a prior job) by
// preferring the most current one: active > scheduled > accepted > quoted >
// complete > invoiced > paid, with most-recently-created winning ties.
// Returns undefined if no match — caller should fall back to address-only.
function resolveActiveJobId(jobs: Job[], address: string): string | undefined {
  if (!address || address === "General") return undefined;
  const matches = jobs.filter((j) => j.property === address);
  if (matches.length === 0) return undefined;
  if (matches.length === 1) return matches[0].id;
  const order = ["active", "scheduled", "accepted", "quoted", "complete", "invoiced", "paid", "lead", "inspection"];
  const sorted = [...matches].sort((a, b) => {
    const oa = order.indexOf(a.status);
    const ob = order.indexOf(b.status);
    if (oa !== ob) return oa - ob;
    return (b.created_at || "").localeCompare(a.created_at || "");
  });
  return sorted[0]?.id;
}

// Photo entries on a job. The shape was originally {url,label,type} for
// before/after/work uploads; rendered AI previews extend it with sourceUrl
// (the photo this was generated from) + the prompt used + createdAt.
type JobPhoto = {
  url: string;
  label: string;
  type: string;
  sourceUrl?: string;
  prompt?: string;
  createdAt?: string;
};

export default function WorkVision({ setPage }: { setPage: (p: string) => void }) {
  const user = useStore((s) => s.user)!;
  const jobs = useStore((s) => s.jobs);
  const schedule = useStore((s) => s.schedule);
  const loadAll = useStore((s) => s.loadAll);
  const darkMode = useStore((s) => s.darkMode);

  const [on, setOn] = useState(() => ld("t_on", false));
  const [st, setSt] = useState(() => ld<number | null>("t_st", null));
  const [sj, setSj] = useState(() => ld("t_sj", ""));
  const [el, setEl] = useState(0);
  // Serialize all writes that mutate the job's `rooms` blob (checkbox toggles,
  // photo uploads, completion notes, etc.). Two fast taps used to race: tap A
  // would `loadAll()` async, tap B's render closure still saw the pre-A
  // snapshot, and tap B's spread-and-write reverted A's flag. Each task here
  // chains onto the prior promise and reads the truly-current store state
  // right before it patches.
  const roomsQueue = useRef<Promise<void>>(Promise.resolve());
  const enqueueRoomsWrite = (task: () => Promise<void>) => {
    const next = roomsQueue.current.then(task).catch((err) => {
      console.warn("[WorkVision] rooms write failed:", err);
    });
    roomsQueue.current = next;
    return next;
  };
  // Active server-side time_entries row id, shared with Timer.tsx via localStorage
  // so clock-out in either screen patches the same row instead of creating a new
  // entry and orphaning the original.
  const [activeId, setActiveId] = useState<string | null>(() => ld<string | null>("t_active_id", null));
  // Picked-job FK for the current clock-in. Persisted so a refresh keeps the
  // right job pinned when two share an address. Address-only fallback at the
  // bottom of activeJob handles legacy rows that pre-date this state.
  const [activeJobId, setActiveJobId] = useState<string | null>(() => ld<string | null>("t_active_job_id", null));
  // Which task in the work order is expanded to show materials / photos / comment
  const [expandedTask, setExpandedTask] = useState<number | null>(null);
  // Photo capture type. Defaults to "after" because the most common
  // reason a tech is taking a photo while inside Work Vision is to
  // document completed work — and the completeJob() gate down below
  // only counts type==="after" photos as completion photos. Tech can
  // flip this to "before" or "work" before snapping if needed.
  const [photoType, setPhotoType] = useState<"before" | "work" | "after">("after");
  // Guide tab: tap-to-check tools and shopping items, plus custom additions.
  // Persisted into the job's `rooms` blob (same place workOrder lives) so
  // they survive remounts AND show up in the Jobs tab — Bernard wanted the
  // shopping list to actually save and sync, not reset every time he leaves
  // WorkVision. Checked items are keyed by stable identity (`n|room|trade`)
  // so the right boxes stay checked even if the underlying guide.shop array
  // reorders between renders.
  const [checkedTools, setCheckedTools] = useState<string[]>([]);
  const [checkedShop, setCheckedShop] = useState<string[]>([]);
  const [extraTools, setExtraTools] = useState<string[]>([]);
  const [extraShop, setExtraShop] = useState<{ n: string; c: number; room?: string; trade?: string }[]>([]);
  const [newTool, setNewTool] = useState("");
  const [newShopName, setNewShopName] = useState("");
  const [newShopCost, setNewShopCost] = useState("");
  // Quote-derived shop items the user has edited/removed (hidden from the
  // auto list; an edited copy lives in customShop). Keyed by shopKey.
  const [removedGuideShop, setRemovedGuideShop] = useState<string[]>([]);
  // Inline shopping-item editor: the shopKey being edited + draft name/cost.
  const [editShopKey, setEditShopKey] = useState<string | null>(null);
  const [editShopName, setEditShopName] = useState("");
  const [editShopCost, setEditShopCost] = useState("");
  const rate = user.rate || 55;

  // Persist timer
  useEffect(() => sv("t_on", on), [on]);
  useEffect(() => sv("t_st", st), [st]);
  useEffect(() => sv("t_sj", sj), [sj]);
  useEffect(() => sv("t_active_id", activeId), [activeId]);
  useEffect(() => sv("t_active_job_id", activeJobId), [activeJobId]);

  // Tick
  useEffect(() => {
    if (!on || !st) return;
    const tick = () => setEl(Date.now() - st);
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, [on, st]);

  // Find the active job. Prefer the explicit FK we stamped at clock-in so two
  // jobs at the same address don't collapse to whichever Array.find hits first.
  // Fall back to address match for legacy clock-ins from before this state
  // existed.
  const activeJob =
    (activeJobId ? jobs.find((j) => j.id === activeJobId) : undefined) ||
    jobs.find((j) => j.property === sj);
  const jobData = (() => {
    try { return activeJob ? (typeof activeJob.rooms === "string" ? JSON.parse(activeJob.rooms) : activeJob.rooms) : null; }
    catch { return null; }
  })();
  const workOrder: { room: string; detail: string; action: string; pri: string; hrs: number; done: boolean }[] = jobData?.workOrder || [];

  // ── Guide-tab persistence ────────────────────────────────────────
  // Stable identity for a shop item so checked-state survives reorders /
  // remounts. Trade can be missing on legacy custom items — fall back to "".
  const shopKey = (s: { n: string; room?: string; trade?: string }) =>
    `${(s.n || "").toLowerCase().trim()}|||${(s.room || "").toLowerCase().trim()}|||${(s.trade || "").toLowerCase().trim()}`;

  // Hydrate guide-tab state from the active job whenever it changes — so
  // switching between jobs shows each job's own custom items + checks, and a
  // page refresh doesn't wipe the shopping list.
  useEffect(() => {
    if (!activeJob || !jobData) {
      setCheckedTools([]); setCheckedShop([]); setExtraTools([]); setExtraShop([]); setRemovedGuideShop([]);
      return;
    }
    setCheckedTools(Array.isArray(jobData.checkedTools) ? jobData.checkedTools : []);
    setCheckedShop(Array.isArray(jobData.checkedShop) ? jobData.checkedShop : []);
    setExtraTools(Array.isArray(jobData.customTools) ? jobData.customTools : []);
    setExtraShop(Array.isArray(jobData.customShop) ? jobData.customShop : []);
    setRemovedGuideShop(Array.isArray(jobData.removedGuideShop) ? jobData.removedGuideShop : []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeJob?.id]);

  // Merge guide-tab updates into the job's rooms blob. Uses the same
  // serialized-write queue as workOrder toggles so a fast tap-add-tap
  // can't race and clobber sibling state.
  const persistGuide = (updates: {
    checkedTools?: string[];
    checkedShop?: string[];
    customTools?: string[];
    customShop?: { n: string; c: number; room?: string; trade?: string }[];
    removedGuideShop?: string[];
  }) => {
    if (!activeJob) return;
    const targetId = activeJob.id;
    enqueueRoomsWrite(async () => {
      const fresh = useStore.getState().jobs.find((j) => j.id === targetId);
      if (!fresh) return;
      let freshData: Record<string, unknown> = {};
      try {
        freshData = typeof fresh.rooms === "string" ? JSON.parse(fresh.rooms) : (fresh.rooms || {});
      } catch { return; }
      const merged = { ...freshData, ...updates };
      await db.patch("jobs", targetId, { rooms: JSON.stringify(merged) });
      await loadAll();
    });
  };

  // Today's schedule
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const todaySchedule = schedule.filter((s) => s.sched_date === todayStr);

  // Clock in: create an in-progress time_entries row so admins can see who's
  // clocked in right now (same pattern Timer.tsx uses). When the caller knows
  // exactly which job they meant (they tapped a row in the All-Jobs list),
  // pass jobId so we don't have to disambiguate by address.
  const clockIn = async (job: string, jobId?: string) => {
    const startedAt = Date.now();
    const resolvedJobId = jobId || resolveActiveJobId(jobs, job);
    setSj(job);
    setSt(startedAt);
    setOn(true);
    setEl(0);
    setActiveJobId(resolvedJobId || null);
    const result = await db.post<{ id: string }>("time_entries", {
      job: job || "General",
      job_id: resolvedJobId,
      entry_date: new Date().toLocaleDateString("en-US"),
      hours: 0,
      amount: 0,
      user_id: user.id,
      user_name: user.name,
      start_time: fmtTime(startedAt),
    });
    if (result && result[0]?.id) {
      setActiveId(result[0].id);
      await loadAll();
    } else {
      setActiveId(null);
    }
    // Auto-promote the matching job from "scheduled" to "active" so the
    // workload view reflects what's actually happening. Don't flip jobs
    // already in "complete"/"paid" backwards.
    if (resolvedJobId) {
      const matched = jobs.find((j) => j.id === resolvedJobId && j.status === "scheduled");
      if (matched) await db.patch("jobs", matched.id, { status: "active" });
    } else if (job) {
      const matched = jobs.find((j) => j.property === job && j.status === "scheduled");
      if (matched) await db.patch("jobs", matched.id, { status: "active" });
    }
  };

  // Clock out + save — patches the existing active row instead of inserting
  // a new entry, so "Currently Clocked In" updates correctly. Falls back to
  // patching whatever open row this user has if activeId got lost.
  const clockOut = async () => {
    if (!st) return;
    const hrs = (Date.now() - st) / (1000 * 60 * 60);
    const rounded = Math.round(hrs * 100) / 100;
    const amount = Math.round(hrs * rate * 100) / 100;
    if (hrs > 0.01) {
      if (activeId) {
        await db.patch("time_entries", activeId, {
          hours: rounded,
          amount,
          end_time: fmtTime(Date.now()),
          job: sj || "General",
        });
      } else {
        // Fallback: find this user's most-recent open active row and close it.
        const open = useStore.getState().timeEntries
          .filter((e) => e.user_id === user.id && e.start_time && !e.end_time)
          .sort((a, b) => (a.start_time || "").localeCompare(b.start_time || ""));
        const target = open[open.length - 1];
        if (target) {
          await db.patch("time_entries", target.id, {
            hours: rounded,
            amount,
            end_time: fmtTime(Date.now()),
            job: sj || "General",
          });
        } else {
          // No open row at all — last-resort: post a completed entry.
          await db.post("time_entries", {
            job: sj || "General",
            job_id: resolveActiveJobId(jobs, sj),
            entry_date: new Date().toLocaleDateString("en-US"),
            hours: rounded,
            amount,
            user_id: user.id,
            user_name: user.name,
            start_time: fmtTime(st),
            end_time: fmtTime(Date.now()),
          });
        }
      }
    } else if (activeId) {
      // Brief in-and-out — delete the in-progress row instead of leaving a
      // zero-hour ghost entry.
      await db.del("time_entries", activeId);
    }
    setOn(false);
    setSt(null);
    setEl(0);
    setSj("");
    setActiveId(null);
    setActiveJobId(null);
    await loadAll();
    useStore.getState().showToast(`Clocked out — ${hrs.toFixed(1)} hours logged`, "success");
  };

  // Toggle work order item. Match by `(room, detail)` against the latest
  // store snapshot read at save-time so we never write a stale workOrder
  // array — that's the bug Bernard hit where two quick taps wiped each
  // other's `done` flags. The roomsQueue serializes concurrent toggles so
  // each one reads state that includes the prior toggle's commit.
  const toggleWO = (idx: number) => {
    if (!activeJob) return;
    const clicked = workOrder[idx];
    if (!clicked) return;
    const targetKey = woStableKey(clicked);
    const nextDone = !clicked.done;
    enqueueRoomsWrite(async () => {
      const fresh = useStore.getState().jobs.find((j) => j.id === activeJob.id);
      if (!fresh) return;
      let freshData: Record<string, unknown> = {};
      try {
        freshData = typeof fresh.rooms === "string" ? JSON.parse(fresh.rooms) : (fresh.rooms || {});
      } catch { return; }
      const freshWO = Array.isArray(freshData.workOrder)
        ? (freshData.workOrder as { room: string; detail: string; action: string; pri: string; hrs: number; done: boolean }[])
        : [];
      const matchIdx = freshWO.findIndex((w) => woStableKey(w) === targetKey);
      if (matchIdx < 0) return; // task no longer exists in current blob — drop the toggle
      const updatedWO = [...freshWO];
      updatedWO[matchIdx] = { ...updatedWO[matchIdx], done: nextDone };
      await db.patch("jobs", activeJob.id, {
        rooms: JSON.stringify({ ...freshData, workOrder: updatedWO }),
      });
      await loadAll();
    });
  };

  // Upload work photo. Same fresh-read + queue pattern so a photo upload
  // can't race with checkbox toggles or note edits and clobber the blob.
  // Type defaults to whatever is currently selected on the segmented
  // control above (state-driven), but a caller can pin a specific type
  // — e.g. when we ever wire up a "Before / Working / After" radio set.
  const uploadWorkPhoto = async (file: File, typeOverride?: "before" | "work" | "after") => {
    if (!activeJob) return;
    const ext = file.name.split(".").pop() || "jpg";
    const path = `gallery/${activeJob.id}/${Date.now()}_${Math.random().toString(36).slice(2, 6)}.${ext}`;
    const { error } = await supabase.storage.from("receipts").upload(path, file);
    if (error) { useStore.getState().showToast("Photo upload failed: " + error.message, "error"); return; }
    const { data: urlData } = supabase.storage.from("receipts").getPublicUrl(path);
    if (!urlData?.publicUrl) return;
    const publicUrl = urlData.publicUrl;
    const tag = typeOverride ?? photoType;
    await enqueueRoomsWrite(async () => {
      const freshJob = useStore.getState().jobs.find((j) => j.id === activeJob.id);
      let freshData: Record<string, unknown> = {};
      try {
        freshData = freshJob ? (typeof freshJob.rooms === "string" ? JSON.parse(freshJob.rooms) : freshJob.rooms) || {} : {};
      } catch { /* */ }
      if (!Array.isArray(freshData.photos)) freshData.photos = [];
      (freshData.photos as JobPhoto[]).push({ url: publicUrl, label: "", type: tag });
      await db.patch("jobs", activeJob.id, { rooms: JSON.stringify(freshData) });
      await loadAll();
    });
    const tagLabel = tag === "after" ? "Completion" : tag === "before" ? "Before" : "Work";
    useStore.getState().showToast(`${tagLabel} photo saved`, "success");
  };

  // ── Receipt upload (matches Jobs.tsx flow) ──────────────────────
  // Crew on site at Home Depot can snap a receipt and have it scanned
  // server-side. We default amount=0 and note="Receipt"; the AI scan in
  // the background fills in vendor + items in the note, sums item prices
  // to set the amount, and writes per-item rows into price_corrections so
  // the quoting AI learns real supply costs.
  const [uploadingReceipt, setUploadingReceipt] = useState(false);
  const uploadReceipt = async (file: File) => {
    if (!activeJob) {
      useStore.getState().showToast("Clock into a job first to attach a receipt", "warning");
      return;
    }
    setUploadingReceipt(true);
    try {
      const ext = file.name.split(".").pop() || "jpg";
      const path = `${activeJob.id}/${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from("receipts").upload(path, file);
      if (error) {
        useStore.getState().showToast("Receipt upload failed: " + error.message, "error");
        return;
      }
      const { data: urlData } = supabase.storage.from("receipts").getPublicUrl(path);
      const photo_url = urlData?.publicUrl || "";

      // Pass org_id explicitly — same belt-and-suspenders pattern Jobs.tsx
      // uses so the row isn't filtered out by org-scoped reads on refresh.
      const result = await db.post<{ id: string }>("receipts", {
        job_id: activeJob.id,
        org_id: user.org_id,
        note: "Receipt",
        amount: 0,
        receipt_date: new Date().toLocaleDateString(),
        photo_url,
      });
      if (!result) return; // db.post toasted the underlying error
      const newReceiptId = result[0]?.id;
      await loadAll();
      useStore.getState().showToast("Receipt added — scanning…", "success");

      // Background scan; failures don't block the receipt save.
      if (photo_url && newReceiptId) {
        scanReceiptAndLearn(newReceiptId, photo_url, activeJob.id).catch((err) => {
          console.error("receipt scan failed:", err);
        });
      }
    } catch (err) {
      useStore.getState().showToast(
        "Error saving receipt: " + (err instanceof Error ? err.message : String(err)),
        "error",
      );
    } finally {
      setUploadingReceipt(false);
    }
  };

  // Scan a receipt photo with AI: enrich note, set amount from item sum,
  // and feed line items into price_corrections (ZIP-tagged for the quoter).
  // Mirrors Jobs.tsx scanAndLearn — same shape, plus an amount update on
  // the receipt row since WorkVision uploads default to amount=0.
  const scanReceiptAndLearn = async (receiptId: string, photoUrl: string, jobId: string) => {
    const res = await apiFetch("/api/ai/receipt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageUrl: photoUrl }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      useStore.getState().showToast("Receipt scan failed: " + (err?.error || res.statusText), "warning");
      return;
    }
    const { data } = await res.json();
    if (!data || !Array.isArray(data.items) || data.items.length === 0) return;

    const vendor = (data.vendor as string | undefined)?.trim() || "";
    const items = data.items as { name?: string; qty?: number; price?: number }[];

    const itemSummary = items
      .filter((it) => it?.name)
      .slice(0, 5)
      .map((it) => `${it.name}${it.price ? ` $${Number(it.price).toFixed(2)}` : ""}`)
      .join(", ");
    const more = items.length > 5 ? ` (+${items.length - 5} more)` : "";
    const newNote = vendor
      ? `Receipt — ${vendor}: ${itemSummary}${more}`
      : `Receipt: ${itemSummary}${more}`;
    const amountFromItems = items.reduce(
      (sum, it) => sum + (typeof it.price === "number" && it.price > 0 ? Number(it.price) : 0),
      0,
    );
    const patch: Record<string, unknown> = { note: newNote };
    if (amountFromItems > 0) patch.amount = parseFloat(amountFromItems.toFixed(2));
    await db.patch("receipts", receiptId, patch);

    const job = jobs.find((j) => j.id === jobId);
    const trade = job?.trade || "General";
    const zip = extractZip(job?.property || "");
    const logs = items
      .filter((it) => it?.name && typeof it.price === "number" && it.price > 0)
      .map((it) => ({
        item_name: it.name!.slice(0, 120),
        material_name: vendor ? `${vendor}: ${it.name}`.slice(0, 160) : it.name!.slice(0, 160),
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
    await loadAll();
    useStore.getState().showToast(
      `Scanned: ${logs.length} item${logs.length !== 1 ? "s" : ""} logged for AI learning`,
      "success",
    );
  };

  // ── AI render (finished-look preview) ──
  // Modal is open when renderTarget is set. The flow is:
  //  1) tap ✨ on a photo → renderTarget = source url, prompt prefilled
  //  2) tap Generate → POST /api/render → renderResult = generated url
  //  3) tap Save → append to job.photos with type "rendered"
  // The rendering is uploaded to storage server-side regardless of whether
  // the user saves. Discarding leaves an orphan in the bucket — fine for V1.
  // renderTarget = the source photo url the modal opens preselected with;
  // null = closed. The shared RenderModal owns prompt / generate / result.
  const [renderTarget, setRenderTarget] = useState<string | null>(null);
  const openRenderModal = (sourceUrl: string) => setRenderTarget(sourceUrl);
  const closeRenderModal = () => setRenderTarget(null);

  // Attach a finished render to the job's photos (type "rendered"). Passed to
  // the shared RenderModal as onSaved.
  const saveRenderedPhoto = async (url: string, source: string) => {
    if (!activeJob) return;
    await enqueueRoomsWrite(async () => {
      const freshJob = useStore.getState().jobs.find((j) => j.id === activeJob.id);
      let freshData: Record<string, unknown> = {};
      try {
        freshData = freshJob
          ? (typeof freshJob.rooms === "string" ? JSON.parse(freshJob.rooms) : freshJob.rooms) || {}
          : {};
      } catch { /* */ }
      if (!Array.isArray(freshData.photos)) freshData.photos = [];
      (freshData.photos as JobPhoto[]).push({
        url,
        label: "AI render",
        type: "rendered",
        sourceUrl: source,
        createdAt: new Date().toISOString(),
      });
      await db.patch("jobs", activeJob.id, { rooms: JSON.stringify(freshData) });
      await loadAll();
    });
    useStore.getState().showToast(t("wv.renderSaved"), "success");
  };

  // Complete job
  const completeJob = async () => {
    if (!activeJob) return;
    const unchecked = workOrder.filter((w) => !w.done).length;
    if (unchecked > 0) {
      if (!await useStore.getState().showConfirm("Incomplete Items", `${unchecked} item${unchecked !== 1 ? "s" : ""} unchecked. Complete anyway?`)) return;
    }
    // Remind to take after photos
    const photoCount = jobData?.photos?.filter((p: { type: string }) => p.type === "after").length || 0;
    if (photoCount === 0) {
      if (!await useStore.getState().showConfirm("No Completion Photos", "You haven't uploaded any after photos. Take photos of your completed work before finishing?")) {
        setSection("photos");
        return;
      }
    }
    // Drain any in-flight blob writes (debounced note save, photo upload,
    // toggle) so the rooms blob is fully committed before the status flip.
    // Avoids a window where Complete fires, then a stale queued patch
    // overwrites the just-committed blob with state from a pre-complete read.
    await roomsQueue.current;
    await db.patch("jobs", activeJob.id, { status: "complete" });
    // Clock out
    await clockOut();
    // Teach the AI quoter from this job's real hours. clockOut() refreshed the
    // store, so the final session is now counted. Best-effort — never block
    // completion on a learning write.
    try {
      const fresh = useStore.getState().jobs.find((j) => j.id === activeJob.id) || activeJob;
      await recordJobOutcome(fresh, jobActualHours(fresh, useStore.getState().timeEntries));
    } catch { /* */ }
    useStore.getState().showToast("Job completed! Great work.", "success");
    // Pop the review-request modal before navigating away — last chance to
    // capture the client's goodwill while the work is fresh in their mind.
    if (!activeJob.review_requested_at) {
      setReviewJob({ ...activeJob, status: "complete" });
      // Don't navigate immediately; the modal's onClose will handle that.
      return;
    }
    setPage("dash");
  };

  // Drives the review-request modal — populated by completeJob when a fresh
  // completion happens, cleared on close (which also navigates to dashboard).
  const [reviewJob, setReviewJob] = useState<Job | null>(null);

  const border = darkMode ? "#1e1e2e" : "#eee";
  const [section, setSection] = useState<"tasks" | "guide" | "notes" | "photos">("tasks");
  // Shared in-app camera target — which upload handler the next shot feeds.
  const [wvCam, setWvCam] = useState<
    null | { title: string; multiple: boolean; onFiles: (files: File[]) => void }
  >(null);

  // Swipe between tabs. The original implementation only tracked X and
  // fired on >60px horizontal drift, which meant a casual scroll or a
  // tap with a drift would randomly switch tabs (especially on the
  // Guide tab where the user is reading and tapping checkboxes). We
  // now require a clear horizontal-dominant gesture: ≥80px X drift,
  // X drift ≥ 1.6× Y drift, started outside an interactive element,
  // and finished within ~600ms so a slow page-scroll doesn't count.
  const sections: ("tasks" | "guide" | "notes" | "photos")[] = ["tasks", "guide", "notes", "photos"];
  const touchStart = useRef<{ x: number; y: number; t: number; ok: boolean }>({ x: 0, y: 0, t: 0, ok: false });
  const swipeTab = (dir: number) => {
    const idx = sections.indexOf(section);
    const next = idx + dir;
    if (next >= 0 && next < sections.length) setSection(sections[next]);
  };
  const SWIPE_THRESHOLD_X = 80;
  const SWIPE_AXIS_RATIO = 1.6;
  const SWIPE_MAX_MS = 600;
  // Skip swipe handling if the touch started on an interactive
  // element — prevents tapping a checkbox / button / textarea from
  // ever getting interpreted as the start of a swipe.
  const isInteractiveTarget = (el: EventTarget | null): boolean => {
    let n = el as HTMLElement | null;
    while (n) {
      const tag = n.tagName;
      if (tag === "BUTTON" || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || tag === "A" || tag === "LABEL") return true;
      if (n.getAttribute && n.getAttribute("role") === "button") return true;
      n = n.parentElement;
    }
    return false;
  };

  // Sort work orders: HIGH first, then MED, then LOW, completed at bottom.
  // `?? 2` (not `|| 2`) — priOrder.HIGH is 0, which `||` treats as falsy, so
  // HIGH items were silently demoted to the same rank as LOW.
  const priOrder: Record<string, number> = { HIGH: 0, MED: 1, LOW: 2 };
  const sortedWO = [...workOrder]
    .map((w, i) => ({ ...w, _idx: i }))
    .sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1;
      return (priOrder[a.pri] ?? 2) - (priOrder[b.pri] ?? 2);
    });

  const priColor = (pri: string) => pri === "HIGH" ? "var(--color-accent-red)" : pri === "MED" ? "var(--color-warning)" : "var(--color-success)";
  const priLabel = (pri: string) => pri === "HIGH" ? t("wv.urgent") : pri === "MED" ? t("wv.needed") : t("wv.minor");

  // Group tasks by trade/area for the Tasks tab (the work-order `room` field is
  // QuoteForge's "Trade / Area"), so the list reads like the mockup: a colored
  // trade header with its items beneath. Stable sort by room preserves the
  // done-last / priority-first order from sortedWO within each group.
  const groupedWO = [...sortedWO].sort((a, b) => (a.room || "").localeCompare(b.room || ""));
  const TRADE_DOT: Record<string, string> = {
    plumbing: "#3aa0ff", electrical: "#ffcc00", carpentry: "#ff8800", hvac: "#9d4edd",
    painting: "#00cc66", flooring: "#ff5b5b", general: "#8a8a99", drywall: "#06b6d4",
  };
  const tradeDot = (room: string) => TRADE_DOT[(room || "").toLowerCase().trim()] || "var(--color-primary)";

  // Pull the rich detail for a work-order task: matching quote item (so we
  // can show its materials and original inspection comment), plus any
  // inspection photos that captured the area before work started. Crews on
  // site need this context — the Tasks tab was previously just a checklist.
  type Material = { n: string; c: number };
  type QuoteItem = { detail: string; comment?: string; materials?: Material[]; laborHrs?: number };
  type Room = { name: string; items: QuoteItem[] };
  type InspectionItem = { name: string; condition?: string; comment?: string; photos?: string[] };
  type InspectionRoom = { name: string; items: InspectionItem[] };
  const enrichTask = (task: { room: string; detail: string }) => {
    const rooms: Room[] = jobData?.rooms || [];
    const room = rooms.find((r) => r.name === task.room);
    const tDetail = (task.detail || "").toLowerCase();
    const item = room?.items?.find(
      (i) => (i.detail || "").toLowerCase() === tDetail || tDetail.includes((i.detail || "").toLowerCase()) || (i.detail || "").toLowerCase().includes(tDetail),
    );
    const inspRooms: InspectionRoom[] = jobData?.inspection?.rooms || [];
    const inspRoom = inspRooms.find((r) => r.name === task.room);
    const inspItem = inspRoom?.items?.find(
      (i) => (i.name || "").toLowerCase() === tDetail || tDetail.includes((i.name || "").toLowerCase()),
    );
    return {
      materials: item?.materials || [],
      comment: item?.comment || inspItem?.comment || "",
      photos: inspItem?.photos || [],
      laborHrs: item?.laborHrs,
      condition: inspItem?.condition,
    };
  };

  // ── NOT CLOCKED IN ──
  if (!on) {
    return (
      <div className="fi">
        <div className="row mb" style={{ justifyContent: "space-between" }}>
          <h2 style={{ fontSize: 24, color: "var(--color-primary)", display: "inline-flex", alignItems: "center", gap: 8 }}>
            <Icon name="worker" size={22} color="var(--color-primary)" />
            {t("wv.title")}
          </h2>
          <button className="bo" onClick={() => setPage("dash")} style={{ fontSize: 14, padding: "4px 10px" }}>← Dashboard</button>
        </div>

        <div className="dim" style={{ fontSize: 15, margin: "0 2px 14px" }}>{t("wv.selectJob")}</div>

        {/* Today's schedule — tap a card to clock in */}
        {todaySchedule.length > 0 && (
          <>
            <div className="sl" style={{ margin: "0 2px 7px" }}>{t("wv.todaySchedule")}</div>
            {todaySchedule.map((s) => (
              <div key={s.id} onClick={() => clockIn(s.job)} className="cd" style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 13px", marginBottom: 8, cursor: "pointer" }}>
                <div style={{ width: 38, height: 38, borderRadius: 11, background: "rgba(0,204,102,.12)", border: "1px solid rgba(0,204,102,.4)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <Icon name="start" size={17} color="var(--color-success)" />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 16 }}>{s.job}</div>
                  <div className="dim" style={{ fontSize: 13.5, marginTop: 2 }}>{s.note || "Scheduled today"}</div>
                </div>
                <Icon name="next" size={16} color="var(--color-success)" />
              </div>
            ))}
          </>
        )}

        {/* All active jobs — tap a card to clock in */}
        <div className="sl" style={{ margin: todaySchedule.length > 0 ? "12px 2px 7px" : "0 2px 7px" }}>{t("wv.allActive")}</div>
        {(() => {
          // Inspections are pre-quote walkthroughs, not billable work — keep
          // them out of the clock-in picker so techs can't clock into one.
          const active = jobs.filter((j) => !j.archived && !["complete", "invoiced", "paid", "inspection"].includes(j.status));
          if (active.length === 0) return <div className="cd" style={{ textAlign: "center", padding: 20 }}><p className="dim" style={{ fontSize: 14 }}>{t("wv.noActive")}</p></div>;
          // Pink dot flags addresses with more than one open job so Bernard
          // notices the ones that need care before clocking in.
          const propCount: Record<string, number> = {};
          active.forEach((j) => { propCount[j.property] = (propCount[j.property] || 0) + 1; });
          return active.map((j) => (
            <div key={j.id} onClick={() => clockIn(j.property, j.id)} className="cd" style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 13px", marginBottom: 8, cursor: "pointer" }}>
              <div style={{ width: 38, height: 38, borderRadius: 11, background: "rgba(46,139,255,.12)", border: "1px solid rgba(46,139,255,.4)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <Icon name="start" size={17} color="var(--color-primary)" />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontWeight: 600, fontSize: 16, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{j.property}</span>
                  {propCount[j.property] > 1 && <span title="Multiple jobs at this address" style={{ width: 6, height: 6, borderRadius: 3, background: "#ff4d8d", flexShrink: 0 }} />}
                </div>
                <div className="dim" style={{ fontSize: 13.5, marginTop: 2, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                  <span>{j.client} · ${(j.total || 0).toFixed(0)}</span>
                  <span style={{ fontSize: 12, padding: "1px 6px", borderRadius: 99, background: statusColor(j.status) + "22", color: statusColor(j.status), fontFamily: "Oswald", letterSpacing: ".06em", textTransform: "uppercase" }}>{j.status}</span>
                  <span style={{ fontFamily: "Oswald", fontSize: 13 }}>#{j.id.slice(-6).toUpperCase()}</span>
                </div>
              </div>
              <Icon name="next" size={16} color="var(--color-primary)" />
            </div>
          ));
        })()}
      </div>
    );
  }

  // ── CLOCKED IN — WORK MODE ──
  return (
    <div className="fi">
      {/* Topbar — back + title + live timer chip */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button className="iconbtn" onClick={() => setPage("dash")} aria-label="Back"><Icon name="back" size={18} /></button>
          <span style={{ fontFamily: "Oswald", fontWeight: 700, fontSize: 20, letterSpacing: ".5px", textTransform: "uppercase" }}>{t("wv.title")}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button onClick={clockOut} aria-label="Clock out" style={{ fontSize: 12, fontWeight: 600, color: "#ff9d9d", background: "rgba(255,91,91,.1)", border: "1px solid rgba(255,91,91,.4)", borderRadius: 99, padding: "5px 9px", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}>
            <Icon name="stop" size={11} color="#ff9d9d" /> {t("wv.clockOut")}
          </button>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontFamily: "Oswald", fontWeight: 600, fontSize: 14.5, color: "#3ee08f", background: "rgba(0,204,102,.12)", border: "1px solid rgba(0,204,102,.4)", padding: "5px 10px", borderRadius: 99 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--color-success)", boxShadow: "0 0 8px var(--color-success)" }} /> {fmt(el)}
          </span>
        </div>
      </div>
      {/* Job row + Map */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 12 }}>
        <div className="dim" style={{ fontSize: 14, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          <span style={{ fontWeight: 600 }}>{sj || "General"}</span>
          {activeJob?.client ? ` · ${activeJob.client}` : ""}{activeJob ? ` · #${activeJob.id.slice(-6).toUpperCase()}` : ""}
        </div>
        {activeJob && (
          <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(activeJob.property)}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, fontWeight: 600, color: "#7fb6ff", background: "rgba(46,139,255,.12)", border: "1px solid rgba(46,139,255,.38)", padding: "5px 9px", borderRadius: 99, display: "inline-flex", alignItems: "center", gap: 5, whiteSpace: "nowrap", flexShrink: 0, textDecoration: "none" }}>
            <Icon name="mapPin" size={12} color="#7fb6ff" /> Map
          </a>
        )}
      </div>

      {/* Drive mileage — simple GPS start/stop, logs to the Mileage screen */}
      <div style={{ marginBottom: 12 }}>
        <MileageQuickTrack job={sj || activeJob?.property} />
      </div>

      {/* Section tabs — text segmented control (matches the mockup) */}
      <div style={{ display: "flex", gap: 5, marginBottom: 11 }}>
        {([
          { id: "tasks" as const, label: t("wv.tasks") },
          { id: "guide" as const, label: t("wv.guide") },
          { id: "notes" as const, label: t("common.notes") },
          { id: "photos" as const, label: t("common.photos") },
        ]).map((s) => {
          const on = section === s.id;
          return (
            <button
              key={s.id}
              onClick={() => setSection(s.id)}
              style={{
                flex: 1, textAlign: "center", padding: "8px 2px", borderRadius: 10, fontSize: 12.5,
                fontFamily: "Oswald", fontWeight: 600, letterSpacing: ".04em",
                background: on ? "var(--color-primary)" : "var(--color-card-dark-2)",
                color: on ? "#fff" : "var(--color-dim)",
                border: `1px solid ${on ? "var(--color-primary)" : "var(--color-border-dark-2)"}`,
              }}
            >
              {s.label}
            </button>
          );
        })}
      </div>

      {/* Swipeable content area — see swipe constants above for the
          axis-lock + threshold rules that prevent stray taps from
          switching tabs. */}
      <div
        onTouchStart={(e) => {
          if (e.touches.length !== 1) { touchStart.current.ok = false; return; }
          const t = e.touches[0];
          touchStart.current = {
            x: t.clientX,
            y: t.clientY,
            t: Date.now(),
            ok: !isInteractiveTarget(e.target),
          };
        }}
        onTouchEnd={(e) => {
          const start = touchStart.current;
          if (!start.ok) return;
          const t = e.changedTouches[0];
          const dx = t.clientX - start.x;
          const dy = t.clientY - start.y;
          const dt = Date.now() - start.t;
          if (dt > SWIPE_MAX_MS) return;
          if (Math.abs(dx) < SWIPE_THRESHOLD_X) return;
          if (Math.abs(dx) < Math.abs(dy) * SWIPE_AXIS_RATIO) return;
          swipeTab(dx < 0 ? 1 : -1);
        }}
      >

      {/* ── TASKS TAB ── */}
      {section === "tasks" && (
        <div>
          {workOrder.length > 0 && (
            <>
              {/* Progress — bar + "Work order · X / Y done" row */}
              <div style={{ height: 7, borderRadius: 5, background: "var(--color-card-dark-2)", overflow: "hidden", margin: "2px 0" }}>
                <div style={{ height: "100%", borderRadius: 5, background: "var(--color-success)", width: `${(workOrder.filter((w) => w.done).length / workOrder.length) * 100}%`, boxShadow: "0 0 12px -2px var(--color-success)", transition: "width .3s" }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--color-dim)", margin: "5px 1px 10px" }}>
                <span>Work order</span>
                <span>{workOrder.filter((w) => w.done).length} / {workOrder.length} done</span>
              </div>

              {/* Priority sorted work order — tap body to expand for materials,
                  inspection comment, and before-photos. Tap the box to mark done. */}
              {groupedWO.map((w, gi) => {
                const isOpen = expandedTask === w._idx;
                const enriched = enrichTask(w);
                const matTotal = enriched.materials.reduce((s, m) => s + (m.c || 0), 0);
                const conditionLabel =
                  enriched.condition === "D" ? t("wv.damaged") :
                  enriched.condition === "P" ? t("wv.poor") :
                  enriched.condition === "F" ? t("wv.fair") : "";
                const showHeader = gi === 0 || groupedWO[gi - 1].room !== w.room;
                return (
                  <Fragment key={w._idx}>
                  {showHeader && (
                    <div style={{ display: "flex", alignItems: "center", gap: 6, margin: "10px 2px 6px", fontFamily: "Oswald", fontWeight: 600, fontSize: 12.5, letterSpacing: ".1em", color: "var(--color-dim)", textTransform: "uppercase" }}>
                      <span style={{ width: 7, height: 7, borderRadius: "50%", background: tradeDot(w.room), flexShrink: 0 }} />
                      {w.room || "General"}
                    </div>
                  )}
                  <div
                    style={{
                      marginBottom: 6,
                      borderRadius: 11,
                      background: w.done ? "transparent" : darkMode ? "#12121a" : "#fff",
                      border: `1px solid ${border}`,
                      opacity: w.done ? 0.55 : 1,
                      overflow: "hidden",
                      transition: "opacity 200ms cubic-bezier(0.22, 1, 0.36, 1)",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 8px" }}>
                      {/* Checkbox — tap to toggle done. Stops propagation so it
                          doesn't also expand the task. */}
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleWO(w._idx); }}
                        aria-label={w.done ? "Mark not done" : "Mark done"}
                        style={{
                          width: 22, height: 22, borderRadius: "50%", flexShrink: 0, marginTop: 1,
                          border: `2px solid ${w.done ? "var(--color-success)" : "var(--color-dim)"}`,
                          background: w.done ? "var(--color-success)" : "transparent",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          color: "#fff", padding: 0, cursor: "pointer",
                        }}
                      >
                        {w.done && <Icon name="check" size={13} color="#fff" strokeWidth={3} />}
                      </button>
                      {/* Task body — tap to expand */}
                      <div
                        onClick={() => setExpandedTask(isOpen ? null : w._idx)}
                        style={{ flex: 1, cursor: "pointer" }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
                          <div style={{ fontSize: 16, fontWeight: 600, textDecoration: w.done ? "line-through" : "none" }}>{w.detail}</div>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                            {!w.done && (
                              <span style={{ fontSize: 12, padding: "1px 6px", borderRadius: 4, background: priColor(w.pri) + "22", color: priColor(w.pri), fontFamily: "Oswald", letterSpacing: ".06em" }}>
                                {priLabel(w.pri)}
                              </span>
                            )}
                            <button onClick={(e) => { e.stopPropagation(); setWvCam({ title: "Work photo", multiple: true, onFiles: (fs) => fs.forEach((f) => uploadWorkPhoto(f, "work")) }); }} title="Add photo" style={{ width: 26, height: 26, borderRadius: 7, background: "var(--color-card-dark-2)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0, border: "none" }}>
                              <Icon name="camera" size={13} color="#7fb6ff" />
                            </button>
                            <Icon name={isOpen ? "collapse" : "expand"} size={14} color="#888" />
                          </div>
                        </div>
                        <div className="dim" style={{ fontSize: 15, marginTop: 3, lineHeight: 1.4 }}>{w.action}</div>
                        <div style={{ fontSize: 14, marginTop: 4, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                          <span style={{ color: "var(--color-primary)", fontFamily: "Oswald" }}>{w.hrs}h</span>
                          <span className="dim">{w.room}</span>
                          {matTotal > 0 && (
                            <span style={{ color: "var(--color-warning)", fontFamily: "Oswald" }}>
                              ${matTotal.toFixed(0)} mat
                            </span>
                          )}
                          {conditionLabel && (
                            <span
                              style={{
                                fontSize: 11,
                                padding: "1px 5px",
                                borderRadius: 3,
                                background: enriched.condition === "D" ? "var(--color-accent-red)22" : enriched.condition === "P" ? "var(--color-warning)22" : "var(--color-highlight)22",
                                color: enriched.condition === "D" ? "var(--color-accent-red)" : enriched.condition === "P" ? "var(--color-warning)" : "var(--color-highlight)",
                                fontFamily: "Oswald",
                                letterSpacing: ".06em",
                              }}
                            >
                              {conditionLabel}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    {/* Expanded detail panel */}
                    {isOpen && (
                      <div
                        style={{
                          padding: "10px 12px 12px 44px",
                          background: darkMode ? "#0d0d14" : "#f8f8fb",
                          borderTop: `1px solid ${border}`,
                        }}
                      >
                        {enriched.comment && (
                          <div style={{ marginBottom: 10 }}>
                            <div className="sl" style={{ fontSize: 12, marginBottom: 4 }}>{t("wv.inspectionNote")}</div>
                            <div style={{ fontSize: 15, color: darkMode ? "#cfd4dc" : "#333", lineHeight: 1.5 }}>
                              {enriched.comment}
                            </div>
                          </div>
                        )}
                        {enriched.materials.length > 0 && (
                          <div style={{ marginBottom: 10 }}>
                            <div className="sl" style={{ fontSize: 12, marginBottom: 4 }}>
                              {t("wv.materials")} ({matTotal > 0 ? `$${matTotal.toFixed(0)}` : "—"})
                            </div>
                            {enriched.materials.map((m, mi) => (
                              <div key={mi} style={{ display: "flex", justifyContent: "space-between", fontSize: 14, padding: "2px 0" }}>
                                <span>{m.n}</span>
                                <span style={{ color: "var(--color-success)", fontFamily: "Oswald", flexShrink: 0, marginLeft: 8 }}>
                                  ${(m.c || 0).toFixed(0)}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                        {enriched.photos.length > 0 && (
                          <div>
                            <div className="sl" style={{ fontSize: 12, marginBottom: 4 }}>
                              {t("wv.beforePhotos")} ({enriched.photos.length})
                            </div>
                            <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 2 }}>
                              {enriched.photos.map((url, pi) => (
                                <a
                                  key={pi}
                                  href={url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  style={{ flexShrink: 0 }}
                                >
                                  <img
                                    src={url}
                                    alt=""
                                    style={{ width: 72, height: 72, objectFit: "cover", borderRadius: 6, border: `1px solid ${border}`, display: "block" }}
                                  />
                                </a>
                              ))}
                            </div>
                          </div>
                        )}
                        {!enriched.comment && enriched.materials.length === 0 && enriched.photos.length === 0 && (
                          <div className="dim" style={{ fontSize: 14, fontStyle: "italic" }}>
                            {t("wv.noContext")}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  </Fragment>
                );
              })}
            </>
          )}
          {workOrder.length === 0 && (
            <div className="cd" style={{ textAlign: "center", padding: 24 }}>
              <p className="dim">{t("wv.noWorkOrder")}</p>
            </div>
          )}
          {/* Complete job — full-width green CTA at the bottom of Tasks (mock) */}
          <button onClick={completeJob} className="bg" style={{ width: "100%", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, fontFamily: "Oswald", fontWeight: 600, fontSize: 15.5, letterSpacing: ".4px", textTransform: "uppercase", padding: 12, borderRadius: 13, marginTop: 10, boxShadow: "0 0 26px -6px rgba(0,204,102,.6)" }}>
            <Icon name="check" size={15} color="#fff" strokeWidth={2.5} /> {t("wv.completeJob")}
          </button>
        </div>
      )}

      {/* ── GUIDE TAB — interactive Tools + Shopping checklist (matches
            the QuoteForge Guide tab depth so the crew on site sees the
            same structure the estimator built). ── */}
      {section === "guide" && activeJob && (() => {
        try {
          const roomsData = jobData?.rooms || [];
          const guide = makeGuide(roomsData);
          const allTools = [...guide.tools, ...extraTools];
          const allShop: { n: string; c: number; room?: string; trade?: string }[] = [
            ...guide.shop.filter((gs) => !removedGuideShop.includes(shopKey(gs))),
            ...extraShop,
          ];
          const shopTotal = allShop.reduce((s, i) => s + (i.c || 0), 0);
          const shopRemaining = allShop.reduce(
            (s, i) => s + (checkedShop.includes(shopKey(i)) ? 0 : i.c || 0),
            0,
          );
          // Toggle helpers — optimistic local update + persist into the
          // job's rooms blob so the state survives remounts and the Jobs
          // tab can read the same source of truth.
          const toggleTool = (tool: string) => {
            const next = checkedTools.includes(tool)
              ? checkedTools.filter((x) => x !== tool)
              : [...checkedTools, tool];
            setCheckedTools(next);
            persistGuide({ checkedTools: next });
          };
          const toggleShop = (item: { n: string; c: number; room?: string; trade?: string }) => {
            const key = shopKey(item);
            const next = checkedShop.includes(key)
              ? checkedShop.filter((k) => k !== key)
              : [...checkedShop, key];
            setCheckedShop(next);
            persistGuide({ checkedShop: next });
          };
          const addCustomTool = (tool: string) => {
            if (!tool || extraTools.includes(tool)) return;
            const next = [...extraTools, tool];
            setExtraTools(next);
            persistGuide({ customTools: next });
          };
          const addCustomShop = (item: { n: string; c: number; room?: string; trade?: string }) => {
            const next = [...extraShop, item];
            setExtraShop(next);
            persistGuide({ customShop: next });
          };
          // Edit-in-place. Custom items update their extraShop entry; quote-
          // derived items are "adopted" into customShop and their original key
          // hidden via removedGuideShop. Checked state migrates if the name
          // (and thus shopKey) changed.
          type ShopItem = { n: string; c: number; room?: string; trade?: string };
          const isCustomShop = (item: ShopItem) => extraShop.some((x) => shopKey(x) === shopKey(item));
          const startEditShop = (item: ShopItem) => {
            setEditShopKey(shopKey(item));
            setEditShopName(item.n);
            setEditShopCost(item.c != null ? String(item.c) : "");
          };
          const cancelEditShop = () => { setEditShopKey(null); setEditShopName(""); setEditShopCost(""); };
          const saveEditShop = (item: ShopItem) => {
            const key = shopKey(item);
            const updated: ShopItem = { n: editShopName.trim() || item.n, c: parseFloat(editShopCost) || 0, room: item.room, trade: item.trade };
            const newKey = shopKey(updated);
            const nextChecked = checkedShop.includes(key) && newKey !== key
              ? [...checkedShop.filter((k) => k !== key), newKey]
              : checkedShop;
            if (isCustomShop(item)) {
              const nextExtra = extraShop.map((x) => (shopKey(x) === key ? updated : x));
              setExtraShop(nextExtra); setCheckedShop(nextChecked);
              persistGuide({ customShop: nextExtra, checkedShop: nextChecked });
            } else {
              const nextRemoved = [...removedGuideShop, key];
              const nextExtra = [...extraShop, updated];
              setRemovedGuideShop(nextRemoved); setExtraShop(nextExtra); setCheckedShop(nextChecked);
              persistGuide({ removedGuideShop: nextRemoved, customShop: nextExtra, checkedShop: nextChecked });
            }
            cancelEditShop();
          };
          const deleteShop = (item: ShopItem) => {
            const key = shopKey(item);
            const nextChecked = checkedShop.filter((k) => k !== key);
            if (isCustomShop(item)) {
              const nextExtra = extraShop.filter((x) => shopKey(x) !== key);
              setExtraShop(nextExtra); setCheckedShop(nextChecked);
              persistGuide({ customShop: nextExtra, checkedShop: nextChecked });
            } else {
              const nextRemoved = [...removedGuideShop, key];
              setRemovedGuideShop(nextRemoved); setCheckedShop(nextChecked);
              persistGuide({ removedGuideShop: nextRemoved, checkedShop: nextChecked });
            }
            cancelEditShop();
          };

          return (
            <div>
              {/* Tools */}
              <div className="cd mb">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <h4 style={{ fontSize: 15, color: "var(--color-primary)", display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <Icon name="hammer" size={14} color="var(--color-primary)" />
                    {t("wv.toolsNeeded")} ({allTools.length})
                  </h4>
                  <span className="dim" style={{ fontSize: 13, fontFamily: "Oswald", letterSpacing: ".06em" }}>
                    {checkedTools.length}/{allTools.length} packed
                  </span>
                </div>
                {allTools.length === 0 && (
                  <div className="dim" style={{ fontSize: 14, padding: "4px 0" }}>No tools listed.</div>
                )}
                {allTools.map((tool, i) => {
                  const done = checkedTools.includes(tool);
                  return (
                    <div
                      key={i}
                      onClick={() => toggleTool(tool)}
                      style={{
                        display: "flex", alignItems: "center", gap: 8,
                        fontSize: 15, padding: "6px 0",
                        borderBottom: `1px solid ${border}`,
                        cursor: "pointer",
                        textDecoration: done ? "line-through" : "none",
                        opacity: done ? 0.5 : 1,
                        transition: "opacity 200ms cubic-bezier(0.22, 1, 0.36, 1)",
                      }}
                    >
                      <span style={{
                        width: 18, height: 18, borderRadius: 4,
                        border: `2px solid ${done ? "var(--color-success)" : "#666"}`,
                        background: done ? "var(--color-success)" : "transparent",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        flexShrink: 0,
                      }}>
                        {done && <Icon name="check" size={12} color="#fff" strokeWidth={3} />}
                      </span>
                      {tool}
                    </div>
                  );
                })}
                {/* Add custom tool */}
                <div className="row" style={{ marginTop: 8 }}>
                  <input
                    value={newTool}
                    onChange={(e) => setNewTool(e.target.value)}
                    placeholder="Add tool…"
                    style={{ flex: 1, fontSize: 15, padding: "6px 10px" }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && newTool.trim()) {
                        addCustomTool(newTool.trim());
                        setNewTool("");
                      }
                    }}
                  />
                  <button
                    onClick={() => {
                      if (newTool.trim()) {
                        addCustomTool(newTool.trim());
                        setNewTool("");
                      }
                    }}
                    aria-label="Add tool"
                    style={{ background: "none", color: "var(--color-primary)", padding: "0 6px", display: "inline-flex" }}
                  >
                    <Icon name="add" size={18} />
                  </button>
                </div>
              </div>

              {/* Shopping */}
              <div className="cd">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <h4 style={{ fontSize: 15, color: "var(--color-warning)", display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <Icon name="cart" size={14} color="var(--color-warning)" />
                    {t("wv.shoppingList")} (${shopTotal.toFixed(0)})
                  </h4>
                  <span className="dim" style={{ fontSize: 13, fontFamily: "Oswald", letterSpacing: ".06em" }}>
                    ${shopRemaining.toFixed(0)} left
                  </span>
                </div>
                {allShop.length === 0 && (
                  <div className="dim" style={{ fontSize: 14, padding: "4px 0" }}>No shopping items.</div>
                )}
                {allShop.map((s, i) => {
                  const done = checkedShop.includes(shopKey(s));
                  const prevTrade = i > 0 ? allShop[i - 1].trade : null;
                  const curTrade = s.trade || "";
                  const showHeader = curTrade && curTrade !== prevTrade;
                  return (
                    <div key={i}>
                      {showHeader && (
                        <div
                          style={{
                            fontSize: 13,
                            fontWeight: 600,
                            color: "var(--color-primary)",
                            marginTop: i > 0 ? 12 : 0,
                            marginBottom: 4,
                            fontFamily: "Oswald",
                            textTransform: "uppercase",
                            letterSpacing: ".08em",
                          }}
                        >
                          {curTrade}
                        </div>
                      )}
                      {editShopKey === shopKey(s) ? (
                        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 0 6px 4px", borderBottom: `1px solid ${border}` }}>
                          <input value={editShopName} onChange={(e) => setEditShopName(e.target.value)} autoFocus style={{ flex: 1, fontSize: 15, padding: "5px 8px", minWidth: 0 }} />
                          <input type="number" value={editShopCost} onChange={(e) => setEditShopCost(e.target.value)} placeholder="$" style={{ width: 58, fontSize: 15, padding: "5px 6px" }} />
                          <button onClick={() => saveEditShop(s)} aria-label="Save" style={{ background: "none", border: "none", color: "var(--color-success)", padding: "0 3px", display: "inline-flex", cursor: "pointer" }}><Icon name="check" size={18} /></button>
                          <button onClick={() => deleteShop(s)} aria-label="Delete" style={{ background: "none", border: "none", color: "var(--color-accent-red)", padding: "0 3px", display: "inline-flex", cursor: "pointer" }}><Icon name="delete" size={16} /></button>
                          <button onClick={cancelEditShop} aria-label="Cancel" style={{ background: "none", border: "none", color: "var(--color-dim)", padding: "0 3px", display: "inline-flex", cursor: "pointer" }}><Icon name="close" size={16} /></button>
                        </div>
                      ) : (
                        <div
                          style={{
                            display: "flex", justifyContent: "space-between", alignItems: "center",
                            fontSize: 15, padding: "6px 0 6px 4px",
                            borderBottom: `1px solid ${border}`,
                            textDecoration: done ? "line-through" : "none",
                            opacity: done ? 0.5 : 1,
                            transition: "opacity 200ms cubic-bezier(0.22, 1, 0.36, 1)",
                          }}
                        >
                          <span style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
                            <button
                              onClick={() => toggleShop(s)}
                              aria-label={done ? "Uncheck item" : "Check off item"}
                              style={{
                                width: 18, height: 18, borderRadius: 4, padding: 0,
                                border: `2px solid ${done ? "var(--color-success)" : "#666"}`,
                                background: done ? "var(--color-success)" : "transparent",
                                display: "flex", alignItems: "center", justifyContent: "center",
                                flexShrink: 0, cursor: "pointer",
                              }}
                            >
                              {done && <Icon name="check" size={12} color="#fff" strokeWidth={3} />}
                            </button>
                            <span onClick={() => startEditShop(s)} style={{ flex: 1, minWidth: 0, cursor: "pointer", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.n}</span>
                          </span>
                          <span onClick={() => startEditShop(s)} style={{ color: done ? "#888" : "var(--color-success)", fontFamily: "Oswald", cursor: "pointer", flexShrink: 0, marginLeft: 8 }}>
                            ${(s.c || 0).toFixed(0)}
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })}
                {/* Add custom shop item */}
                <div className="row" style={{ marginTop: 8 }}>
                  <input
                    value={newShopName}
                    onChange={(e) => setNewShopName(e.target.value)}
                    placeholder="Item name…"
                    style={{ flex: 1, fontSize: 15, padding: "6px 10px" }}
                  />
                  <input
                    type="number"
                    value={newShopCost}
                    onChange={(e) => setNewShopCost(e.target.value)}
                    placeholder="$"
                    style={{ width: 64, fontSize: 15, padding: "6px 8px" }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && newShopName.trim()) {
                        addCustomShop({
                          n: newShopName.trim(),
                          c: parseFloat(newShopCost) || 0,
                          room: "Custom",
                          trade: "Added on site",
                        });
                        setNewShopName("");
                        setNewShopCost("");
                      }
                    }}
                  />
                  <button
                    onClick={() => {
                      if (newShopName.trim()) {
                        addCustomShop({
                          n: newShopName.trim(),
                          c: parseFloat(newShopCost) || 0,
                          room: "Custom",
                          trade: "Added on site",
                        });
                        setNewShopName("");
                        setNewShopCost("");
                      }
                    }}
                    aria-label="Add shopping item"
                    style={{ background: "none", color: "var(--color-warning)", padding: "0 6px", display: "inline-flex" }}
                  >
                    <Icon name="add" size={18} />
                  </button>
                </div>
              </div>
            </div>
          );
        } catch { return <div className="cd dim" style={{ padding: 20, textAlign: "center" }}>Guide unavailable</div>; }
      })()}

      {/* ── NOTES TAB ── */}
      {section === "notes" && activeJob && (
        <div className="cd">
          <h4 style={{ fontSize: 15, marginBottom: 8 }}>📝 {t("wv.jobNotes")}</h4>
          {/* Keyed on activeJob.id so switching jobs remounts with the new
              job's notes (and flushes any pending save for the prior job). */}
          <JobNotesEditor key={activeJob.id} jobId={activeJob.id} />
        </div>
      )}

      {/* ── PHOTOS TAB ── */}
      {section === "photos" && (
        <div>
          {/* Before / Work / After tag toggle — sets the type the next
              photo is saved as (matches the mock's .ptoggle). */}
          <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
            {([
              { key: "before" as const, label: "Before", bg: "rgba(255,136,0,.16)", bd: "rgba(255,136,0,.5)", fg: "#ffb15e" },
              { key: "work" as const, label: "Work", bg: "rgba(46,139,255,.16)", bd: "rgba(46,139,255,.5)", fg: "#9fc4ff" },
              { key: "after" as const, label: "After", bg: "rgba(0,204,102,.16)", bd: "rgba(0,204,102,.5)", fg: "#3ee08f" },
            ]).map((opt) => {
              const active = photoType === opt.key;
              return (
                <button
                  key={opt.key}
                  onClick={() => setPhotoType(opt.key)}
                  aria-pressed={active}
                  style={{
                    flex: 1, textAlign: "center", fontFamily: "Oswald", fontWeight: 600, fontSize: 10.5, letterSpacing: ".04em",
                    padding: 7, borderRadius: 9,
                    background: active ? opt.bg : "var(--color-card-dark-3)",
                    border: `1px solid ${active ? opt.bd : "var(--color-border-dark-2)"}`,
                    color: active ? opt.fg : "var(--color-dim)",
                    cursor: "pointer",
                  }}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>

          {(() => {
            const allPhotos: JobPhoto[] = jobData?.photos || [];
            // Renderings live in their own section below — keep the main
            // grid focused on real before/after/work shots.
            const regular = allPhotos.filter((p) => p.type !== "rendered");
            const rendered = allPhotos.filter((p) => p.type === "rendered");
            const latest = regular[regular.length - 1];
            const tagTint = (type?: string) =>
              type === "before" ? { bg: "rgba(255,136,0,.3)", fg: "#ffb15e" }
              : type === "after" ? { bg: "rgba(0,204,102,.3)", fg: "#3ee08f" }
              : { bg: "rgba(46,139,255,.3)", fg: "#9fc4ff" };
            const pactTile: React.CSSProperties = {
              flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
              fontSize: 10.5, fontWeight: 600, padding: "9px 4px", borderRadius: 10,
              border: "1px solid var(--color-border-dark-2)", background: "var(--color-card-dark-2)",
              color: "inherit", cursor: "pointer",
            };
            const camTitle = photoType === "after" ? "Completion photo" : photoType === "before" ? "Before photo" : "Work photo";
            return (
              <>
                {/* Photo grid + Add tile */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6, marginBottom: 10 }}>
                  {regular.map((p, i) => {
                    const tint = tagTint(p.type);
                    return (
                      <div key={i} style={{ position: "relative" }}>
                        <img src={p.url} alt="" style={{ width: "100%", aspectRatio: "1", objectFit: "cover", borderRadius: 10, border: `1px solid ${border}` }} />
                        {p.type && (
                          <span style={{ position: "absolute", bottom: 3, left: 3, fontSize: 8, fontWeight: 700, padding: "1px 5px", borderRadius: 4, background: tint.bg, color: tint.fg, textTransform: "capitalize" }}>
                            {p.type}
                          </span>
                        )}
                        {/* Per-photo AI render — tap to render the finished look. */}
                        <button
                          onClick={() => openRenderModal(p.url)}
                          title={t("wv.renderFinished")}
                          aria-label={t("wv.renderFinished")}
                          style={{ position: "absolute", top: 4, right: 4, width: 24, height: 24, borderRadius: "50%", background: "rgba(0,0,0,.6)", border: "1px solid rgba(255,255,255,.25)", cursor: "pointer", padding: 0, display: "flex", alignItems: "center", justifyContent: "center" }}
                        >
                          <Icon name="sparkle" size={12} color="#fff" />
                        </button>
                      </div>
                    );
                  })}
                  {/* Add tile → camera with the current tag */}
                  <button
                    onClick={() => setWvCam({ title: camTitle, multiple: true, onFiles: (fs) => fs.forEach((f) => uploadWorkPhoto(f)) })}
                    style={{ aspectRatio: "1", borderRadius: 10, border: `1.5px dashed ${border}`, background: "none", color: "var(--color-dim)", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3, fontSize: 9, fontWeight: 600 }}
                  >
                    <Icon name="add" size={18} color="var(--color-dim)" /> Add
                  </button>
                </div>

                {/* Action row — Camera / Upload / Scan receipt */}
                <div style={{ display: "flex", gap: 7, marginBottom: 9 }}>
                  <button
                    onClick={() => setWvCam({ title: camTitle, multiple: true, onFiles: (fs) => fs.forEach((f) => uploadWorkPhoto(f)) })}
                    style={pactTile}
                    title={`Saved as a ${photoType === "after" ? "completion" : photoType} photo`}
                  >
                    <Icon name="camera" size={15} color="#7fb6ff" /> Camera
                  </button>
                  <button
                    onClick={() => {
                      const input = document.createElement("input");
                      input.type = "file"; input.accept = "image/*"; input.multiple = true;
                      input.onchange = async () => {
                        if (!input.files?.length) return;
                        for (const file of Array.from(input.files)) {
                          await uploadWorkPhoto(file);
                        }
                      };
                      input.click();
                    }}
                    style={pactTile}
                  >
                    <Icon name="upload" size={15} color="#7fb6ff" /> {t("common.upload")}
                  </button>
                  {/* Receipt scan — AI extracts vendor, items, total; enriches
                      the note + feeds price_corrections for the quoter. */}
                  <button
                    onClick={() => setWvCam({ title: "Receipt", multiple: false, onFiles: (fs) => { const f = fs[0]; if (f) uploadReceipt(f); } })}
                    disabled={uploadingReceipt}
                    style={{ ...pactTile, opacity: uploadingReceipt ? 0.5 : 1 }}
                    title="Snap a receipt photo — AI extracts vendor, items, and total"
                  >
                    <Icon name="receipt" size={15} color="#7fb6ff" /> {uploadingReceipt ? "…" : "Scan receipt"}
                  </button>
                </div>

                {/* AI after-render card */}
                <div style={{ background: "linear-gradient(135deg,#231a3a,#15101f)", border: "1px solid #3a2c5a", borderRadius: 13, padding: 11, display: "flex", alignItems: "center", gap: 11 }}>
                  <div style={{ width: 36, height: 36, borderRadius: 10, background: "rgba(157,78,221,.18)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
                    <Icon name="sparkle" size={18} color="#9d4edd" />
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <b style={{ fontSize: 12 }}>AI after-render</b>
                    <span style={{ fontSize: 10, color: "var(--color-dim)", display: "block" }}>See the finished room</span>
                  </div>
                  <button
                    onClick={() => {
                      if (latest) openRenderModal(latest.url);
                      else useStore.getState().showToast("Add a photo first to generate a render", "info");
                    }}
                    style={{ marginLeft: "auto", fontFamily: "Oswald", fontWeight: 600, fontSize: 10.5, color: "#c9a6ff", background: "rgba(157,78,221,.18)", border: "1px solid rgba(157,78,221,.45)", padding: "6px 10px", borderRadius: 9, whiteSpace: "nowrap", cursor: "pointer" }}
                  >
                    Generate
                  </button>
                </div>

                {regular.length === 0 && (
                  <p className="dim" style={{ textAlign: "center", padding: 12, fontSize: 12 }}>{t("wv.noPhotos")}</p>
                )}

                {/* ── Renderings section ── */}
                <div style={{ marginTop: 18, paddingTop: 14, borderTop: `1px solid ${border}` }}>
                  <h4 style={{ fontSize: 14, marginBottom: 8, display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <Icon name="sparkle" size={14} color="#9d4edd" /> {t("wv.renderingsHeader")} ({rendered.length})
                  </h4>
                  {rendered.length === 0 ? (
                    <p className="dim" style={{ fontSize: 14, textAlign: "center", padding: 12 }}>
                      {t("wv.renderingsEmpty")}
                    </p>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                      {rendered.map((p, i) => (
                        <div
                          key={i}
                          style={{
                            display: "grid",
                            gridTemplateColumns: "1fr 1fr",
                            gap: 6,
                            border: `1px solid ${border}`,
                            borderRadius: 10,
                            padding: 6,
                          }}
                        >
                          <div>
                            <div style={{ fontSize: 11, textTransform: "uppercase", color: "#888", marginBottom: 3, letterSpacing: ".05em" }}>
                              {t("wv.renderSource")}
                            </div>
                            {p.sourceUrl ? (
                              <img
                                src={p.sourceUrl}
                                alt=""
                                style={{ width: "100%", aspectRatio: "1", objectFit: "cover", borderRadius: 6 }}
                              />
                            ) : (
                              <div style={{ aspectRatio: "1", background: darkMode ? "#222" : "#eee", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", color: "#888", fontSize: 12 }}>
                                —
                              </div>
                            )}
                          </div>
                          <div>
                            <div style={{ fontSize: 11, textTransform: "uppercase", color: "#9b59b6", marginBottom: 3, letterSpacing: ".05em" }}>
                              {t("wv.renderResult")}
                            </div>
                            <a href={p.url} target="_blank" rel="noopener noreferrer">
                              <img
                                src={p.url}
                                alt=""
                                style={{ width: "100%", aspectRatio: "1", objectFit: "cover", borderRadius: 6, cursor: "zoom-in" }}
                              />
                            </a>
                          </div>
                          {p.prompt && (
                            <div style={{ gridColumn: "1 / -1", fontSize: 13, color: "#888", fontStyle: "italic", lineHeight: 1.4 }}>
                              “{p.prompt}”
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            );
          })()}
        </div>
      )}
      </div>{/* end swipeable */}

      {/* AI Render modal — finished-look preview */}
      {/* Shared AI render modal — seeded from the job's line items */}
      <RenderModal
        open={!!renderTarget}
        onClose={closeRenderModal}
        sourcePhotos={(jobData?.photos || []).filter((p: JobPhoto) => p.type !== "rendered")}
        initialSourceUrl={renderTarget ?? undefined}
        initialPrompt={buildRenderPrompt(jobData?.rooms || []).prompt}
        promptMeta={buildRenderPrompt(jobData?.rooms || [])}
        jobId={activeJob?.id}
        onSaved={saveRenderedPhoto}
      />

      {/* Review-request modal — pops after a successful completeJob to
          capture the client's goodwill before we navigate away. Closing
          the modal (any path) finishes the navigation to dashboard. */}
      <ReviewRequestModal
        job={reviewJob}
        onClose={() => { setReviewJob(null); setPage("dash"); }}
        onSent={() => loadAll()}
      />
      <CameraModal
        open={!!wvCam}
        onClose={() => setWvCam(null)}
        onCapture={(fs) => wvCam?.onFiles(fs)}
        multiple={wvCam?.multiple ?? false}
        title={wvCam?.title}
      />
    </div>
  );
}

// Self-contained notes editor for the active job. Loads jobNotes from the
// store, autosaves on idle (600ms debounce), and flushes on unmount so the
// last keystrokes survive a tab-switch or app-close. Each save reads a fresh
// `rooms` blob and merges in the new note so it can't accidentally wipe a
// concurrent toggle/photo write. Mirrors the pattern in Jobs.tsx
// JobNotesInput — kept in sync with that component.
function JobNotesEditor({ jobId }: { jobId: string }) {
  const initial = (() => {
    try {
      const job = useStore.getState().jobs.find((j) => j.id === jobId);
      if (!job) return "";
      const d = typeof job.rooms === "string" ? JSON.parse(job.rooms) : (job.rooms || {});
      return d?.jobNotes || "";
    } catch { return ""; }
  })();
  const [value, setValue] = useState(initial);
  const lastSaved = useRef(initial);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const valueRef = useRef(value);
  valueRef.current = value;

  const save = async (note: string) => {
    if (note === lastSaved.current) return;
    lastSaved.current = note;
    try {
      const fresh = useStore.getState().jobs.find((x) => x.id === jobId);
      if (!fresh) return;
      const d = typeof fresh.rooms === "string"
        ? (JSON.parse(fresh.rooms) || {})
        : (fresh.rooms || {});
      d.jobNotes = note;
      await db.patch("jobs", jobId, { rooms: JSON.stringify(d) });
    } catch { /* swallow — db helper toasts the error */ }
  };

  useEffect(() => {
    return () => {
      if (timer.current) {
        clearTimeout(timer.current);
        // Fire-and-forget flush. We don't await on unmount because React
        // unmount handlers can't be async and we don't want to block.
        save(valueRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <textarea
      value={value}
      onChange={(e) => {
        const v = e.target.value;
        setValue(v);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => save(v), 600);
      }}
      onBlur={() => {
        if (timer.current) {
          clearTimeout(timer.current);
          timer.current = null;
        }
        save(valueRef.current);
      }}
      placeholder={t("wv.notesPlaceholder")}
      style={{ height: 120, fontSize: 16, resize: "vertical", width: "100%" }}
    />
  );
}
