"use client";
import { useState, useEffect, useRef } from "react";
import { useStore } from "@/lib/store";
import { db, supabase } from "@/lib/supabase";
import { t } from "@/lib/i18n";
import { makeGuide, extractZip } from "@/lib/parser";
import type { Job } from "@/lib/types";
import { Icon } from "../Icon";
import ReviewRequestModal from "../ReviewRequestModal";

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

// Default prompt shown in the Render modal. Bernard can edit per-render;
// this is the "standard turnover finish" he's optimizing for.
const DEFAULT_RENDER_PROMPT =
  "Photorealistic interior rendering. Same room, same camera angle, same fixtures and layout. Replace flooring with light gray luxury vinyl plank in a wide-plank format. Repaint walls in clean off-white. Show as freshly renovated, professionally cleaned, bright natural light, real-estate photography style.";

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
      setCheckedTools([]); setCheckedShop([]); setExtraTools([]); setExtraShop([]);
      return;
    }
    setCheckedTools(Array.isArray(jobData.checkedTools) ? jobData.checkedTools : []);
    setCheckedShop(Array.isArray(jobData.checkedShop) ? jobData.checkedShop : []);
    setExtraTools(Array.isArray(jobData.customTools) ? jobData.customTools : []);
    setExtraShop(Array.isArray(jobData.customShop) ? jobData.customShop : []);
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
  const uploadWorkPhoto = async (file: File) => {
    if (!activeJob) return;
    const ext = file.name.split(".").pop() || "jpg";
    const path = `gallery/${activeJob.id}/${Date.now()}_${Math.random().toString(36).slice(2, 6)}.${ext}`;
    const { error } = await supabase.storage.from("receipts").upload(path, file);
    if (error) { useStore.getState().showToast("Photo upload failed: " + error.message, "error"); return; }
    const { data: urlData } = supabase.storage.from("receipts").getPublicUrl(path);
    if (!urlData?.publicUrl) return;
    const publicUrl = urlData.publicUrl;
    await enqueueRoomsWrite(async () => {
      const freshJob = useStore.getState().jobs.find((j) => j.id === activeJob.id);
      let freshData: Record<string, unknown> = {};
      try {
        freshData = freshJob ? (typeof freshJob.rooms === "string" ? JSON.parse(freshJob.rooms) : freshJob.rooms) || {} : {};
      } catch { /* */ }
      if (!Array.isArray(freshData.photos)) freshData.photos = [];
      (freshData.photos as JobPhoto[]).push({ url: publicUrl, label: "", type: "work" });
      await db.patch("jobs", activeJob.id, { rooms: JSON.stringify(freshData) });
      await loadAll();
    });
    useStore.getState().showToast("Photo added", "success");
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
    const res = await fetch("/api/ai/receipt", {
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
  const [renderTarget, setRenderTarget] = useState<string | null>(null);
  const [renderPrompt, setRenderPrompt] = useState<string>(DEFAULT_RENDER_PROMPT);
  const [rendering, setRendering] = useState(false);
  const [renderResult, setRenderResult] = useState<string | null>(null);

  const openRenderModal = (sourceUrl: string) => {
    setRenderTarget(sourceUrl);
    setRenderPrompt(DEFAULT_RENDER_PROMPT);
    setRenderResult(null);
    setRendering(false);
  };

  const closeRenderModal = () => {
    setRenderTarget(null);
    setRenderResult(null);
    setRendering(false);
  };

  const generateRender = async () => {
    if (!activeJob || !renderTarget || !renderPrompt.trim()) return;
    setRendering(true);
    setRenderResult(null);
    try {
      const res = await fetch("/api/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          photoUrl: renderTarget,
          prompt: renderPrompt.trim(),
          jobId: activeJob.id,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.url) {
        useStore.getState().showToast(
          `${t("wv.renderFailed")}: ${data.error || res.status}`,
          "error"
        );
        setRendering(false);
        return;
      }
      setRenderResult(data.url);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Network error";
      useStore.getState().showToast(`${t("wv.renderFailed")}: ${msg}`, "error");
    }
    setRendering(false);
  };

  const saveRender = async () => {
    if (!activeJob || !renderResult || !renderTarget) return;
    const url = renderResult;
    const source = renderTarget;
    const prompt = renderPrompt.trim();
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
        label: prompt,
        type: "rendered",
        sourceUrl: source,
        prompt,
        createdAt: new Date().toISOString(),
      });
      await db.patch("jobs", activeJob.id, { rooms: JSON.stringify(freshData) });
      await loadAll();
    });
    useStore.getState().showToast(t("wv.renderSaved"), "success");
    closeRenderModal();
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

  // Swipe between tabs
  const sections: ("tasks" | "guide" | "notes" | "photos")[] = ["tasks", "guide", "notes", "photos"];
  const touchStart = useRef<number>(0);
  const swipeTab = (dir: number) => {
    const idx = sections.indexOf(section);
    const next = idx + dir;
    if (next >= 0 && next < sections.length) setSection(sections[next]);
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
          <h2 style={{ fontSize: 22, color: "var(--color-primary)", display: "inline-flex", alignItems: "center", gap: 8 }}>
            <Icon name="worker" size={22} color="var(--color-primary)" />
            {t("wv.title")}
          </h2>
          <button className="bo" onClick={() => setPage("dash")} style={{ fontSize: 12, padding: "4px 10px" }}>← Dashboard</button>
        </div>

        <div className="cd mb" style={{ textAlign: "center", padding: 24 }}>
          <div style={{ fontSize: 48, marginBottom: 8 }}>👷</div>
          <h3 style={{ fontSize: 16, color: "var(--color-primary)", marginBottom: 8 }}>{t("wv.readyToWork")}</h3>
          <p className="dim" style={{ fontSize: 13, marginBottom: 16 }}>{t("wv.selectJob")}</p>
        </div>

        {/* Today's Schedule */}
        {todaySchedule.length > 0 && (
          <div className="cd mb">
            <h4 style={{ fontSize: 13, marginBottom: 8 }}>{t("wv.todaySchedule")}</h4>
            {todaySchedule.map((s) => (
              <div key={s.id} className="sep" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13 }}>
                <div>
                  <b style={{ color: "var(--color-primary)" }}>{s.job}</b>
                  {s.note && <div className="dim" style={{ fontSize: 12 }}>{s.note}</div>}
                </div>
                <button className="bb" onClick={() => clockIn(s.job)} style={{ fontSize: 12, padding: "5px 12px" }}>
                  ▶ Clock In
                </button>
              </div>
            ))}
          </div>
        )}

        {/* All Jobs */}
        <div className="cd">
          <h4 style={{ fontSize: 13, marginBottom: 8 }}>{t("wv.allActive")}</h4>
          {(() => {
            const active = jobs.filter((j) => !["complete", "invoiced", "paid"].includes(j.status));
            if (active.length === 0) return <p className="dim" style={{ fontSize: 12 }}>{t("wv.noActive")}</p>;
            // Count properties so we can show a "duplicate address" hint when
            // two jobs share one — the status pill + short ref are always on,
            // but the pink dot draws Bernard's eye to the rows that need care.
            const propCount: Record<string, number> = {};
            active.forEach((j) => { propCount[j.property] = (propCount[j.property] || 0) + 1; });
            const statusColor = (s: string) =>
              s === "active" ? "var(--color-success)" :
              s === "scheduled" ? "var(--color-warning)" :
              s === "accepted" ? "#ff8800" :
              s === "lead" ? "#ff4d8d" :
              "var(--color-accent-red)";
            return active.map((j) => {
              const dupe = propCount[j.property] > 1;
              return (
                <div key={j.id} className="sep" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13 }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <b>{j.property}</b>
                      {dupe && <span title="Multiple jobs at this address" style={{ width: 6, height: 6, borderRadius: 3, background: "#ff4d8d", flexShrink: 0 }} />}
                    </div>
                    <div className="dim" style={{ fontSize: 12, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                      <span>{j.client} · ${(j.total || 0).toFixed(0)}</span>
                      <span style={{ fontSize: 10, padding: "1px 5px", borderRadius: 3, background: statusColor(j.status) + "22", color: statusColor(j.status), fontFamily: "Oswald", letterSpacing: ".06em", textTransform: "uppercase" }}>
                        {j.status}
                      </span>
                      <span style={{ fontFamily: "Oswald", fontSize: 11 }}>#{j.id.slice(-6).toUpperCase()}</span>
                    </div>
                  </div>
                  <button className="bb" onClick={() => clockIn(j.property, j.id)} style={{ fontSize: 12, padding: "5px 12px", flexShrink: 0, marginLeft: 8 }}>
                    ▶ Clock In
                  </button>
                </div>
              );
            });
          })()}
        </div>
      </div>
    );
  }

  // ── CLOCKED IN — WORK MODE ──
  return (
    <div className="fi">
      {/* Timer header — compact, always visible */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14, padding: "10px 14px", borderRadius: 12, background: darkMode ? "#0a1a0a" : "#f0fff0", border: "1px solid var(--color-success)" }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11, color: "var(--color-success)", fontFamily: "Oswald", textTransform: "uppercase", letterSpacing: ".08em" }}>
            🟢 {t("wv.clockedIn")}
          </div>
          <div style={{ fontSize: 14, fontWeight: 600, marginTop: 2 }}>{sj || "General"}</div>
          {activeJob && (
            <div className="dim" style={{ fontSize: 12, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              <span>{activeJob.client}</span>
              <span style={{ fontFamily: "Oswald", fontSize: 11 }}>#{activeJob.id.slice(-6).toUpperCase()}</span>
            </div>
          )}
        </div>
        <div style={{ fontSize: 28, fontFamily: "Oswald", fontWeight: 700, color: "var(--color-success)" }}>
          {fmt(el)}
        </div>
      </div>

      {/* Action buttons */}
      <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
        <button className="br" onClick={clockOut} style={{ flex: 1, fontSize: 14, padding: "10px" }}>⏹ {t("wv.clockOut")}</button>
        <button className="bg" onClick={completeJob} style={{ flex: 1, fontSize: 14, padding: "10px" }}>✅ {t("wv.completeJob")}</button>
      </div>

      {/* Job info bar */}
      {activeJob && (
        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          <div className="cd" style={{ flex: 1, padding: 10, textAlign: "center" }}>
            <div className="sl">Total</div>
            <div style={{ fontSize: 18, fontFamily: "Oswald", color: "var(--color-success)" }}>${(activeJob.total || 0).toFixed(0)}</div>
          </div>
          <div className="cd" style={{ flex: 1, padding: 10, textAlign: "center" }}>
            <div className="sl">Hours</div>
            <div style={{ fontSize: 18, fontFamily: "Oswald", color: "var(--color-primary)" }}>{(activeJob.total_hrs || 0).toFixed(1)}</div>
          </div>
          <a
            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(activeJob.property)}`}
            target="_blank" rel="noopener noreferrer"
            className="cd"
            style={{ flex: 1, padding: 10, textAlign: "center", textDecoration: "none", color: "var(--color-primary)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2 }}
          >
            <Icon name="mapPin" size={20} color="var(--color-primary)" />
            <div style={{ fontSize: 11, fontFamily: "Oswald", letterSpacing: ".04em", lineHeight: 1.1, textAlign: "center" }}>View on Map</div>
          </a>
          <div className="cd" onClick={() => setPage("troubleshoot")} style={{ flex: 1, padding: 10, textAlign: "center", cursor: "pointer" }}>
            <div style={{ fontSize: 20 }}>🔧</div>
            <div style={{ fontSize: 12 }}>Help</div>
          </div>
        </div>
      )}

      {/* Section tabs */}
      <div style={{ display: "flex", gap: 3, marginBottom: 12 }}>
        {[
          { id: "tasks" as const, label: `✅ ${t("wv.tasks")} (${workOrder.filter((w) => !w.done).length})`, count: workOrder.length },
          { id: "guide" as const, label: `🛒 ${t("wv.guide")}`, count: 0 },
          { id: "notes" as const, label: `📝 ${t("common.notes")}`, count: 0 },
          { id: "photos" as const, label: `📸 ${t("common.photos")} (${jobData?.photos?.length || 0})`, count: 0 },
        ].map((s) => (
          <button
            key={s.id}
            onClick={() => setSection(s.id)}
            style={{
              flex: 1, padding: "6px 4px", borderRadius: 6, fontSize: 12,
              background: section === s.id ? "var(--color-primary)" : "transparent",
              color: section === s.id ? "#fff" : "#888", fontFamily: "Oswald",
            }}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Swipeable content area */}
      <div
        onTouchStart={(e) => { touchStart.current = e.touches[0].clientX; }}
        onTouchEnd={(e) => {
          const diff = e.changedTouches[0].clientX - touchStart.current;
          if (Math.abs(diff) > 60) swipeTab(diff < 0 ? 1 : -1);
        }}
      >

      {/* ── TASKS TAB ── */}
      {section === "tasks" && (
        <div>
          {workOrder.length > 0 && (
            <>
              {/* Progress */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <div style={{ flex: 1, height: 8, borderRadius: 4, background: border }}>
                  <div style={{ height: "100%", borderRadius: 4, background: "var(--color-success)", width: `${(workOrder.filter((w) => w.done).length / workOrder.length) * 100}%`, transition: "width .3s" }} />
                </div>
                <span style={{ fontSize: 13, fontFamily: "Oswald", color: "var(--color-success)" }}>{workOrder.filter((w) => w.done).length}/{workOrder.length}</span>
              </div>

              {/* Priority sorted work order — tap body to expand for materials,
                  inspection comment, and before-photos. Tap the box to mark done. */}
              {sortedWO.map((w) => {
                const isOpen = expandedTask === w._idx;
                const enriched = enrichTask(w);
                const matTotal = enriched.materials.reduce((s, m) => s + (m.c || 0), 0);
                const conditionLabel =
                  enriched.condition === "D" ? t("wv.damaged") :
                  enriched.condition === "P" ? t("wv.poor") :
                  enriched.condition === "F" ? t("wv.fair") : "";
                return (
                  <div
                    key={w._idx}
                    style={{
                      marginBottom: 6,
                      borderRadius: 10,
                      background: w.done ? "transparent" : darkMode ? "#12121a" : "#fff",
                      border: w.done ? `1px solid ${border}` : `1px solid ${priColor(w.pri)}33`,
                      borderLeft: w.done ? `1px solid ${border}` : `3px solid ${priColor(w.pri)}`,
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
                          width: 24, height: 24, borderRadius: 6, flexShrink: 0, marginTop: 1,
                          border: `2px solid ${w.done ? "var(--color-success)" : priColor(w.pri)}`,
                          background: w.done ? "var(--color-success)" : "transparent",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          color: "#fff", padding: 0, cursor: "pointer",
                        }}
                      >
                        {w.done && <Icon name="check" size={14} color="#fff" strokeWidth={3} />}
                      </button>
                      {/* Task body — tap to expand */}
                      <div
                        onClick={() => setExpandedTask(isOpen ? null : w._idx)}
                        style={{ flex: 1, cursor: "pointer" }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
                          <div style={{ fontSize: 14, fontWeight: 600, textDecoration: w.done ? "line-through" : "none" }}>{w.detail}</div>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                            {!w.done && (
                              <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 4, background: priColor(w.pri) + "22", color: priColor(w.pri), fontFamily: "Oswald", letterSpacing: ".06em" }}>
                                {priLabel(w.pri)}
                              </span>
                            )}
                            <Icon name={isOpen ? "collapse" : "expand"} size={14} color="#888" />
                          </div>
                        </div>
                        <div className="dim" style={{ fontSize: 13, marginTop: 3, lineHeight: 1.4 }}>{w.action}</div>
                        <div style={{ fontSize: 12, marginTop: 4, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
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
                                fontSize: 9,
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
                            <div className="sl" style={{ fontSize: 10, marginBottom: 4 }}>{t("wv.inspectionNote")}</div>
                            <div style={{ fontSize: 13, color: darkMode ? "#cfd4dc" : "#333", lineHeight: 1.5 }}>
                              {enriched.comment}
                            </div>
                          </div>
                        )}
                        {enriched.materials.length > 0 && (
                          <div style={{ marginBottom: 10 }}>
                            <div className="sl" style={{ fontSize: 10, marginBottom: 4 }}>
                              {t("wv.materials")} ({matTotal > 0 ? `$${matTotal.toFixed(0)}` : "—"})
                            </div>
                            {enriched.materials.map((m, mi) => (
                              <div key={mi} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "2px 0" }}>
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
                            <div className="sl" style={{ fontSize: 10, marginBottom: 4 }}>
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
                          <div className="dim" style={{ fontSize: 12, fontStyle: "italic" }}>
                            {t("wv.noContext")}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          )}
          {workOrder.length === 0 && (
            <div className="cd" style={{ textAlign: "center", padding: 24 }}>
              <p className="dim">{t("wv.noWorkOrder")}</p>
            </div>
          )}
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
            ...guide.shop,
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

          return (
            <div>
              {/* Tools */}
              <div className="cd mb">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <h4 style={{ fontSize: 13, color: "var(--color-primary)", display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <Icon name="hammer" size={14} color="var(--color-primary)" />
                    {t("wv.toolsNeeded")} ({allTools.length})
                  </h4>
                  <span className="dim" style={{ fontSize: 11, fontFamily: "Oswald", letterSpacing: ".06em" }}>
                    {checkedTools.length}/{allTools.length} packed
                  </span>
                </div>
                {allTools.length === 0 && (
                  <div className="dim" style={{ fontSize: 12, padding: "4px 0" }}>No tools listed.</div>
                )}
                {allTools.map((tool, i) => {
                  const done = checkedTools.includes(tool);
                  return (
                    <div
                      key={i}
                      onClick={() => toggleTool(tool)}
                      style={{
                        display: "flex", alignItems: "center", gap: 8,
                        fontSize: 13, padding: "6px 0",
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
                    style={{ flex: 1, fontSize: 13, padding: "6px 10px" }}
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
                  <h4 style={{ fontSize: 13, color: "var(--color-warning)", display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <Icon name="cart" size={14} color="var(--color-warning)" />
                    {t("wv.shoppingList")} (${shopTotal.toFixed(0)})
                  </h4>
                  <span className="dim" style={{ fontSize: 11, fontFamily: "Oswald", letterSpacing: ".06em" }}>
                    ${shopRemaining.toFixed(0)} left
                  </span>
                </div>
                {allShop.length === 0 && (
                  <div className="dim" style={{ fontSize: 12, padding: "4px 0" }}>No shopping items.</div>
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
                            fontSize: 11,
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
                      <div
                        onClick={() => toggleShop(s)}
                        style={{
                          display: "flex", justifyContent: "space-between", alignItems: "center",
                          fontSize: 13, padding: "6px 0 6px 4px",
                          borderBottom: `1px solid ${border}`,
                          cursor: "pointer",
                          textDecoration: done ? "line-through" : "none",
                          opacity: done ? 0.5 : 1,
                          transition: "opacity 200ms cubic-bezier(0.22, 1, 0.36, 1)",
                        }}
                      >
                        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{
                            width: 18, height: 18, borderRadius: 4,
                            border: `2px solid ${done ? "var(--color-success)" : "#666"}`,
                            background: done ? "var(--color-success)" : "transparent",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            flexShrink: 0,
                          }}>
                            {done && <Icon name="check" size={12} color="#fff" strokeWidth={3} />}
                          </span>
                          {s.n}
                        </span>
                        <span style={{ color: done ? "#888" : "var(--color-success)", fontFamily: "Oswald" }}>
                          ${(s.c || 0).toFixed(0)}
                        </span>
                      </div>
                    </div>
                  );
                })}
                {/* Add custom shop item */}
                <div className="row" style={{ marginTop: 8 }}>
                  <input
                    value={newShopName}
                    onChange={(e) => setNewShopName(e.target.value)}
                    placeholder="Item name…"
                    style={{ flex: 1, fontSize: 13, padding: "6px 10px" }}
                  />
                  <input
                    type="number"
                    value={newShopCost}
                    onChange={(e) => setNewShopCost(e.target.value)}
                    placeholder="$"
                    style={{ width: 64, fontSize: 13, padding: "6px 8px" }}
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
          <h4 style={{ fontSize: 13, marginBottom: 8 }}>📝 {t("wv.jobNotes")}</h4>
          {/* Keyed on activeJob.id so switching jobs remounts with the new
              job's notes (and flushes any pending save for the prior job). */}
          <JobNotesEditor key={activeJob.id} jobId={activeJob.id} />
        </div>
      )}

      {/* ── PHOTOS TAB ── */}
      {section === "photos" && (
        <div className="cd">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <h4 style={{ fontSize: 13 }}>📸 {t("wv.jobPhotos")}</h4>
            <div className="row" style={{ gap: 4 }}>
              <button
                className="bb"
                onClick={() => {
                  const input = document.createElement("input");
                  input.type = "file"; input.accept = "image/*"; input.capture = "environment";
                  input.onchange = () => { if (input.files?.[0]) uploadWorkPhoto(input.files[0]); };
                  input.click();
                }}
                style={{ fontSize: 12, padding: "5px 10px" }}
              >
                📷 {t("common.takePhoto")}
              </button>
              <button
                className="bo"
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
                style={{ fontSize: 12, padding: "5px 10px" }}
              >
                📁 {t("common.upload")}
              </button>
              {/* Receipt upload — snap a receipt at the supply store and the
                  AI scans vendor + line items, enriches the note, sets the
                  amount, and feeds price_corrections for the quoter. */}
              <button
                className="bo"
                onClick={() => {
                  const input = document.createElement("input");
                  input.type = "file"; input.accept = "image/*"; input.capture = "environment";
                  input.onchange = () => { if (input.files?.[0]) uploadReceipt(input.files[0]); };
                  input.click();
                }}
                disabled={uploadingReceipt}
                style={{ fontSize: 12, padding: "5px 10px", display: "inline-flex", alignItems: "center", gap: 4, opacity: uploadingReceipt ? 0.5 : 1 }}
                title="Snap a receipt photo — AI extracts vendor, items, and total"
              >
                <Icon name="receipt" size={13} />
                {uploadingReceipt ? "…" : "Receipt"}
              </button>
            </div>
          </div>

          {/* After photos prompt */}
          <div style={{ marginBottom: 10, padding: 8, borderRadius: 6, background: darkMode ? "#1a1a0a" : "#fffbe6", border: "1px solid var(--color-warning)", fontSize: 12 }}>
            💡 {t("wv.photosTip")}
          </div>

          {(() => {
            const allPhotos: JobPhoto[] = jobData?.photos || [];
            // Renderings live in their own section below — keep the main
            // grid focused on real before/after/work shots.
            const regular = allPhotos.filter((p) => p.type !== "rendered");
            const rendered = allPhotos.filter((p) => p.type === "rendered");
            return (
              <>
                {regular.length > 0 ? (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
                    {regular.map((p, i) => (
                      <div key={i} style={{ position: "relative" }}>
                        <img src={p.url} alt="" style={{ width: "100%", aspectRatio: "1", objectFit: "cover", borderRadius: 8, border: `1px solid ${border}` }} />
                        {p.type && (
                          <span style={{ position: "absolute", bottom: 2, left: 2, fontSize: 9, padding: "1px 4px", borderRadius: 3, background: p.type === "before" ? "#ff8800" : p.type === "after" ? "#00cc66" : "#2E75B6", color: "#fff" }}>
                            {p.type}
                          </span>
                        )}
                        {/* Render-finished button — overlays each photo. Tap to
                            open the AI render modal seeded with this photo. */}
                        <button
                          onClick={() => openRenderModal(p.url)}
                          title={t("wv.renderFinished")}
                          aria-label={t("wv.renderFinished")}
                          style={{
                            position: "absolute",
                            top: 4,
                            right: 4,
                            width: 26,
                            height: 26,
                            borderRadius: "50%",
                            background: "rgba(0, 0, 0, 0.6)",
                            color: "#fff",
                            border: "1px solid rgba(255,255,255,0.25)",
                            cursor: "pointer",
                            fontSize: 13,
                            lineHeight: "24px",
                            padding: 0,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          ✨
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="dim" style={{ textAlign: "center", padding: 16 }}>{t("wv.noPhotos")}</p>
                )}

                {/* ── Renderings section ── */}
                <div style={{ marginTop: 18, paddingTop: 14, borderTop: `1px solid ${border}` }}>
                  <h4 style={{ fontSize: 13, marginBottom: 8 }}>
                    ✨ {t("wv.renderingsHeader")} ({rendered.length})
                  </h4>
                  {rendered.length === 0 ? (
                    <p className="dim" style={{ fontSize: 12, textAlign: "center", padding: 12 }}>
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
                            <div style={{ fontSize: 9, textTransform: "uppercase", color: "#888", marginBottom: 3, letterSpacing: ".05em" }}>
                              {t("wv.renderSource")}
                            </div>
                            {p.sourceUrl ? (
                              <img
                                src={p.sourceUrl}
                                alt=""
                                style={{ width: "100%", aspectRatio: "1", objectFit: "cover", borderRadius: 6 }}
                              />
                            ) : (
                              <div style={{ aspectRatio: "1", background: darkMode ? "#222" : "#eee", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", color: "#888", fontSize: 10 }}>
                                —
                              </div>
                            )}
                          </div>
                          <div>
                            <div style={{ fontSize: 9, textTransform: "uppercase", color: "#9b59b6", marginBottom: 3, letterSpacing: ".05em" }}>
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
                            <div style={{ gridColumn: "1 / -1", fontSize: 11, color: "#888", fontStyle: "italic", lineHeight: 1.4 }}>
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
      {renderTarget && (
        <div
          onClick={() => { if (!rendering) closeRenderModal(); }}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9998,
            background: "rgba(5, 5, 12, 0.78)",
            backdropFilter: "blur(8px) saturate(120%)",
            WebkitBackdropFilter: "blur(8px) saturate(120%)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
            animation: "fadeIn 0.22s cubic-bezier(0.22, 1, 0.36, 1)",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "linear-gradient(180deg, #14141e 0%, #12121a 100%)",
              border: "1px solid #9b59b622",
              borderTop: "3px solid #9b59b6",
              borderRadius: 16,
              padding: "20px 22px 18px",
              width: "100%",
              maxWidth: 520,
              maxHeight: "92vh",
              overflowY: "auto",
              boxShadow: "0 24px 64px rgba(0,0,0,0.6), 0 0 32px #9b59b622",
              animation: "modalIn 0.28s cubic-bezier(0.34, 1.56, 0.64, 1)",
            }}
          >
            <h3
              style={{
                fontFamily: "Oswald, sans-serif",
                fontSize: 17,
                textTransform: "uppercase",
                color: "#9b59b6",
                marginBottom: 14,
                letterSpacing: ".05em",
                fontWeight: 600,
              }}
            >
              ✨ {t("wv.renderTitle")}
            </h3>

            {/* Source / Result preview */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
              <div>
                <div style={{ fontSize: 9, textTransform: "uppercase", color: "#888", marginBottom: 4, letterSpacing: ".05em" }}>
                  {t("wv.renderSource")}
                </div>
                <img
                  src={renderTarget}
                  alt=""
                  style={{ width: "100%", aspectRatio: "1", objectFit: "cover", borderRadius: 8, border: "1px solid #2a2a3a" }}
                />
              </div>
              <div>
                <div style={{ fontSize: 9, textTransform: "uppercase", color: "#9b59b6", marginBottom: 4, letterSpacing: ".05em" }}>
                  {t("wv.renderResult")}
                </div>
                {rendering ? (
                  <div
                    style={{
                      width: "100%",
                      aspectRatio: "1",
                      borderRadius: 8,
                      border: "1px dashed #9b59b655",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "#9b59b6",
                      fontSize: 11,
                      textAlign: "center",
                      padding: 8,
                      animation: "pulse 1.6s ease-in-out infinite",
                    }}
                  >
                    {t("wv.renderGenerating")}
                  </div>
                ) : renderResult ? (
                  <img
                    src={renderResult}
                    alt=""
                    style={{ width: "100%", aspectRatio: "1", objectFit: "cover", borderRadius: 8, border: "1px solid #9b59b655" }}
                  />
                ) : (
                  <div
                    style={{
                      width: "100%",
                      aspectRatio: "1",
                      borderRadius: 8,
                      border: "1px dashed #2a2a3a",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "#555",
                      fontSize: 28,
                    }}
                  >
                    ✨
                  </div>
                )}
              </div>
            </div>

            {/* Prompt textarea */}
            <label
              style={{
                display: "block",
                fontSize: 11,
                textTransform: "uppercase",
                color: "#aaa",
                marginBottom: 6,
                letterSpacing: ".05em",
                fontFamily: "Oswald, sans-serif",
              }}
            >
              {t("wv.renderPromptLabel")}
            </label>
            <textarea
              value={renderPrompt}
              onChange={(e) => setRenderPrompt(e.target.value)}
              disabled={rendering}
              rows={5}
              style={{
                width: "100%",
                fontSize: 13,
                padding: 10,
                borderRadius: 8,
                border: "1px solid #2a2a3a",
                background: "#0e0e16",
                color: "#ddd",
                fontFamily: "Source Sans 3, sans-serif",
                lineHeight: 1.45,
                resize: "vertical",
                marginBottom: 14,
              }}
            />

            {/* Actions */}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
              <button
                onClick={closeRenderModal}
                disabled={rendering}
                style={{
                  padding: "9px 18px",
                  borderRadius: 10,
                  fontSize: 13,
                  fontFamily: "Oswald, sans-serif",
                  textTransform: "uppercase",
                  letterSpacing: ".06em",
                  background: "transparent",
                  border: "1px solid #2a2a3a",
                  color: "#aaa",
                  cursor: rendering ? "not-allowed" : "pointer",
                  opacity: rendering ? 0.5 : 1,
                }}
              >
                {t("wv.renderDiscard")}
              </button>
              {!renderResult ? (
                <button
                  onClick={generateRender}
                  disabled={rendering || !renderPrompt.trim()}
                  style={{
                    padding: "9px 22px",
                    borderRadius: 10,
                    fontSize: 13,
                    fontFamily: "Oswald, sans-serif",
                    textTransform: "uppercase",
                    letterSpacing: ".06em",
                    background: "linear-gradient(135deg, #9b59b6 0%, #6c3a87 100%)",
                    color: "#fff",
                    border: "none",
                    cursor: rendering || !renderPrompt.trim() ? "not-allowed" : "pointer",
                    boxShadow: "0 4px 16px #9b59b655",
                    opacity: rendering || !renderPrompt.trim() ? 0.6 : 1,
                  }}
                >
                  {rendering ? "…" : t("wv.renderGenerate")}
                </button>
              ) : (
                <button
                  onClick={saveRender}
                  style={{
                    padding: "9px 22px",
                    borderRadius: 10,
                    fontSize: 13,
                    fontFamily: "Oswald, sans-serif",
                    textTransform: "uppercase",
                    letterSpacing: ".06em",
                    background: "linear-gradient(135deg, #00cc66 0%, #009947 100%)",
                    color: "#fff",
                    border: "none",
                    cursor: "pointer",
                    boxShadow: "0 4px 16px #00cc6655",
                  }}
                >
                  {t("wv.renderSave")}
                </button>
              )}
            </div>
          </div>
          <style>{`
            @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
            @keyframes modalIn {
              from { opacity: 0; transform: scale(0.94) translateY(-12px); }
              to   { opacity: 1; transform: scale(1) translateY(0); }
            }
            @keyframes pulse {
              0%, 100% { opacity: 0.7; }
              50%      { opacity: 1; }
            }
          `}</style>
        </div>
      )}

      {/* Review-request modal — pops after a successful completeJob to
          capture the client's goodwill before we navigate away. Closing
          the modal (any path) finishes the navigation to dashboard. */}
      <ReviewRequestModal
        job={reviewJob}
        onClose={() => { setReviewJob(null); setPage("dash"); }}
        onSent={() => loadAll()}
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
      style={{ height: 120, fontSize: 14, resize: "vertical", width: "100%" }}
    />
  );
}
