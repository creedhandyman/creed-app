"use client";
import { apiFetch, getStatusLink } from "@/lib/api";
import CountUp from "@/components/CountUp";
import { useState, useRef, useEffect, useMemo } from "react";
import type { CSSProperties } from "react";
import RenderModal from "../RenderModal";
import Coachmark from "../Coachmark";
import { buildRenderPrompt } from "@/lib/render-prompt";
import { useStore } from "@/lib/store";
import { supabase, db } from "@/lib/supabase";
import type { Room, RoomItem, Material, JobDiscount, Job } from "@/lib/types";
import { itemInTier, itemTiers, sharedSuppliesLines, type TierKey } from "@/lib/tiers";
import { buildAssistJobContext, type AssistInspection } from "@/lib/assist-context";
import { applyAssistOps, optionDiffSummary, type AssistAdd, type AssistPatch } from "@/lib/assist-ops";
import {
  readPdf,
  renderPdfPages,
  parseZI,
  aiParsePdf,
  aiParseInspection,
  classify,
  makeGuide,
  calculateCost,
  validateQuote,
  extractZip,
  uploadDataUriToBucket,
  TRADE_CATEGORY_LIST,
  AI_SYSTEM_PROMPT_BASE,
  getLastAiError,
  aiText,
} from "@/lib/parser";
import type { InspectionInput, GuideStep } from "@/lib/parser";
import { syncWorkOrder, quoteItemIds } from "@/lib/work-order-sync";
import { tradeConfig, resolvePrimaryTrade, primaryTradeToRateCategory } from "@/lib/trades";
import { exportQuotePdf } from "@/lib/export-pdf";
import { quoteApprovalFromJob } from "@/lib/approval";
import { resolveTaxMode, type TaxMode } from "@/lib/tax";
import { priceCascade, rateForRoom, billedMaterial, pricingInputs } from "@/lib/pricing";
import { readQuoteSettings, readEstDays } from "@/lib/quote-blob";
import { buildQuoteSave, dominantTrade } from "@/lib/quote-save";
import { materialTaxFor, zipTaxMap } from "@/lib/material-tax";
import Inspector from "./Inspector";
import { useBackLayer } from "@/lib/back-layer";
import type { InspectionData } from "./Inspector";
import CustomerPicker from "../CustomerPicker";
import { t } from "@/lib/i18n";
import { setNavIntent } from "@/lib/nav-intent";
import { Icon } from "../Icon";
import TopBar from "@/components/TopBar";
import AiNote from "../AiNote";
import MaterialsSheet from "../MaterialsSheet";
import CameraModal from "../CameraModal";
import { logCorrection } from "@/lib/learning";
import { wrapPrint, openPrint } from "@/lib/print-template";
import { getUsage, incrementUsage } from "@/lib/inspection-usage";
import { stripAiHrs } from "@/lib/ai-hours";
import SendSheet from "../SendSheet";
import { markQuoteSent } from "@/lib/quote-send";
import { estimateDays, planningCrew } from "@/lib/job-duration";
import { isPlatformAdmin } from "@/lib/platform-admin";
import GuideShopTools, { type ShopItem as GuideShopItem } from "../GuideShopTools";
import VoiceWalk, { type VoiceWalkResult } from "../VoiceWalk";
import ServiceTemplates, { CategoryField } from "../ServiceTemplates";
import { appendTemplateRooms, canonCategory, nextSortOrder, templateCategories, type ServiceTemplate } from "@/lib/service-templates";
import { readBlob, jobBlob } from "@/lib/job-blob";
import { evaluateLine, matchingRuleIds, uniqueSuggestionDetail, type ScopeRule, type LineScope, type ScopeState } from "@/lib/scope-rules";
import { loadScopeRules } from "@/lib/scope-rules-client";
import { isPdfFile } from "@/lib/pdf-detect";
import { GrizzFace } from "../Grizz";


/** Sub-screen header colours = the hub card that opens them (Quick Quote gold,
 *  Full Inspection green, Upload Report blue, From Template violet). */
const QF_HUE = { gold: "#f5b400", green: "#3ee08f", blue: "#2e8bff", violet: "#9d4edd" } as const;

// Compress image for AI processing — aggressive for mobile (S23 Ultra = 200MP)
async function compressImage(file: File, maxSize = 800): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      let w = img.width, h = img.height;
      if (w > maxSize || h > maxSize) {
        if (w > h) { h = Math.round(h * maxSize / w); w = maxSize; }
        else { w = Math.round(w * maxSize / h); h = maxSize; }
      }
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL("image/jpeg", 0.5));
    };
    img.src = URL.createObjectURL(file);
  });
}

function AiLoadingDisplay({ status }: { status: string }) {
  const steps = [
    { label: "Reading document", icon: "doc", match: /reading|rendering|render(ed|ing)/i },
    { label: "Analyzing content", icon: "search", match: /analyz|sending|text|batch|upload/i },
    { label: "Identifying repairs", icon: "troubleshoot", match: /identify|photo|vision/i },
    { label: "Estimating costs", icon: "calc", match: /estimat|pric|cost/i },
    { label: "Building quote", icon: "list", match: /build|generat|compil|merg/i },
  ];

  // Pull "X of Y" out of the status when present. Status messages look like
  // "Rendering PDF pages 4 of 30..." or "Batch 3 of 7: analyzing 8 images..."
  // — we use the ratio to drive a real percentage so the user sees the bar
  // advance as each page renders or each batch finishes.
  const stepMatch = status.match(/(\d+)\s+of\s+(\d+)/);
  const stepCur = stepMatch ? parseInt(stepMatch[1]) : 0;
  const stepTotal = stepMatch ? parseInt(stepMatch[2]) : 0;
  const stepRatio = stepTotal > 0 ? stepCur / stepTotal : 0;
  const isBatch = /batch/i.test(status);
  const isRender = /render/i.test(status);
  const isMerging = /merg/i.test(status);
  // The AI is the long, silent phase — the call's gone out and we won't
  // hear back for tens of seconds (potentially minutes for big PDFs). We
  // detect it by elimination: there's a status, but it's not one of the
  // streaming-progress phases.
  const isAiWait = !!status && !isRender && !isBatch && !isMerging;

  const activeIdx = steps.findIndex((s) => s.match.test(status));
  const currentStep = activeIdx >= 0 ? activeIdx : status ? 1 : 0;

  // Remember the largest count we've seen this session — typically the PDF
  // page count (or the Quick Quote photo count). After rendering wraps,
  // the AI-wait phase gets no progress events; we use this number to size
  // the time-based crawler so a 40-page PDF paces over ~2 min instead of
  // racing to 99% in 20s.
  //
  // We pick up two shapes:
  //   • "X of Y"   — the explicit progress format (PDF render, batch loops)
  //   • "N page/photo(s)" — the post-render "Sending 40 pages…" / Quick Quote
  //     "Preparing 12 photos…" cases where the total is announced once.
  const countMatch = status.match(/(\d+)\s+(?:page|photo)/i);
  const announcedCount = countMatch ? parseInt(countMatch[1]) : 0;
  const [seenTotal, setSeenTotal] = useState(0);
  useEffect(() => {
    const candidate = Math.max(stepTotal, announcedCount);
    if (candidate > seenTotal) setSeenTotal(candidate);
  }, [stepTotal, announcedCount, seenTotal]);

  // Mark the moment the AI-wait phase started so the crawler knows where
  // to anchor. Reset whenever we drop back into a streaming-progress phase
  // (e.g. inspection re-batches) so each AI call gets its own timer.
  const aiStartRef = useRef<number | null>(null);
  useEffect(() => {
    if (isAiWait && aiStartRef.current === null) {
      aiStartRef.current = Date.now();
    } else if ((isRender || isBatch) && aiStartRef.current !== null) {
      aiStartRef.current = null;
    }
  }, [isAiWait, isRender, isBatch]);

  // Tick every 200ms so time-derived calculations re-render.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(id);
  }, []);

  // Estimated AI-wait duration. Tuned from observation: ~3s per page on
  // Anthropic's vision pipeline + ~15s baseline for the text-only call.
  // 40 pages → ~135s, matching the ~2 min Bernard sees on real PDFs.
  // Cap so a 100-page edge case doesn't stretch into stalled-feeling territory.
  const expectedAiMs = Math.min(300_000, 15_000 + seenTotal * 3_000);
  const aiElapsed = aiStartRef.current ? now - aiStartRef.current : 0;
  const aiRatio = Math.min(1, aiElapsed / expectedAiMs);

  // Map progress to a meaningful range: rendering owns 0-30%, batching owns
  // 30-90%, merging fills the rest. The AI wait covers the 30→92 gap, paced
  // over expectedAiMs so the bar reflects actual job size.
  let barPct: number;
  if (isMerging) {
    barPct = 95;
  } else if (isRender && stepTotal > 0) {
    barPct = stepRatio * 30;
  } else if (isBatch && stepTotal > 0) {
    barPct = 30 + stepRatio * 60;
  } else if (isAiWait) {
    // Time-paced from when the AI wait began. We stop at 92 (not 95) so
    // the merging-step jump still feels like progress when results land.
    barPct = 30 + aiRatio * 62;
  } else {
    barPct = ((currentStep + 1) / steps.length) * 100;
  }
  barPct = Math.max(5, Math.min(100, barPct));

  // Safety crawler — guarantees the bar nudges forward even if status
  // events stall entirely. Targets 90% over 4 min as a conservative ceiling
  // so it never overtakes the real bar on normal jobs but keeps motion on
  // the screen if something weird happens.
  const startedRef = useRef(now);
  const safetyCrawl = Math.min(90, ((now - startedRef.current) / 240_000) * 90);
  // Ratchet — the bar must NEVER rewind. barPct can legitimately drop when the
  // status jumps between phases (an AI-wait % giving way to a fresh "Batch 1 of
  // N" that resets stepRatio, or a momentarily-empty status snapping to the 20%
  // step-fallback). That read as the bar sliding backward mid-parse. Clamp to
  // the max seen this mount; the component remounts fresh per parse (parsing
  // gates it), so a new quote starts the bar over at 0.
  const maxPctRef = useRef(0);
  const rawPct = Math.min(99, Math.max(barPct, safetyCrawl));
  if (rawPct > maxPctRef.current) maxPctRef.current = rawPct;
  const displayPct = maxPctRef.current;

  return (
    <div style={{ padding: 20, textAlign: "center" }}>
      <div style={{ width: 60, height: 60, borderRadius: 18, background: "rgba(245,180,0,.14)", border: "1px solid rgba(245,180,0,.4)", display: "flex", alignItems: "center", justifyContent: "center", margin: "6px auto 12px", boxShadow: "0 0 36px -10px rgba(245,180,0,.6)", animation: "pulse 1.6s ease-in-out infinite" }}>
        <Icon name="sparkle" size={30} color="#f5b400" />
      </div>
      <style>{`@keyframes pulse { 0%,100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.06); opacity: 0.85; } } @keyframes shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }`}</style>
      <div style={{ fontFamily: "Oswald", fontWeight: 600, fontSize: 18, letterSpacing: ".3px", marginBottom: 16 }}>
        AI is building your quote
      </div>

      {/* Progress steps */}
      <div style={{ maxWidth: 260, margin: "0 auto", textAlign: "left" }}>
        {steps.map((step, i) => {
          const isDone = i < currentStep;
          const isActive = i === currentStep;
          return (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, opacity: i > currentStep + 1 ? 0.3 : 1, transition: "opacity 0.3s" }}>
              <div style={{
                width: 24, height: 24, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                background: isDone ? "rgba(0,204,102,.18)" : isActive ? "rgba(245,180,0,.18)" : "var(--color-card-dark-2)",
              }}>
                <Icon name={isDone ? "check" : step.icon} size={13} color={isDone ? "#3ee08f" : isActive ? "#f5b400" : "var(--color-dim)"} strokeWidth={isDone ? 3 : 2} />
              </div>
              <span style={{ fontSize: 14.5, color: isDone || isActive ? "inherit" : "var(--color-dim)", fontWeight: isActive ? 600 : 400 }}>
                {step.label}{isActive ? "…" : ""}
              </span>
              {/* Inline counter on the active row when we know X/Y */}
              {isActive && stepTotal > 0 && (
                <span style={{ fontSize: 13, marginLeft: "auto", color: "#f5b400", fontFamily: "Oswald" }}>
                  {stepCur}/{stepTotal}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Progress bar */}
      <div style={{ marginTop: 16, height: 8, background: "var(--color-card-dark-2)", borderRadius: 5, overflow: "hidden" }}>
        <div style={{
          height: 8, borderRadius: 5,
          background: "#f5b400",
          boxShadow: "0 0 12px -1px #f5b400",
          width: `${displayPct}%`,
          transition: "width 0.5s",
        }} />
      </div>

      {/* Numeric percent + batch counter beneath the bar */}
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginTop: 5, color: "var(--color-dim)", fontFamily: "Oswald" }}>
        <span>{Math.round(displayPct)}%</span>
        {stepTotal > 0 ? (
          <span>{isBatch ? "Batch" : isRender ? "Page" : "Step"} {stepCur} of {stepTotal}</span>
        ) : isAiWait && seenTotal > 0 ? (
          <span>
            {seenTotal} pages · ~{Math.max(1, Math.round((expectedAiMs - aiElapsed) / 1000))}s
          </span>
        ) : null}
      </div>

      <div className="dim" style={{ fontSize: 14, marginTop: 8 }}>
        {status || "This usually takes 15-30 seconds"}
      </div>

      {/* Backgrounding the app / letting the phone sleep aborts the in-flight
          AI request, so warn the user right where the risk is. */}
      <div style={{ marginTop: 16, display: "inline-flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 10, background: "rgba(245,180,0,.12)", border: "1px solid rgba(245,180,0,.35)", fontSize: 12.5, color: "#f5b400", lineHeight: 1.35, maxWidth: 300, textAlign: "left" }}>
        <Icon name="phone" size={16} color="#f5b400" />
        <span>Keep your phone on and this app open — leaving mid-quote can interrupt it.</span>
      </div>
    </div>
  );
}

interface Props {
  setPage: (p: string) => void;
  editJobId?: string | null;
  clearEditJob?: () => void;
}

export default function QuoteForge({ setPage, editJobId, clearEditJob }: Props) {
  const user = useStore((s) => s.user)!;
  const profiles = useStore((s) => s.profiles);
  const jobs = useStore((s) => s.jobs);
  const loadAll = useStore((s) => s.loadAll);
  const darkMode = useStore((s) => s.darkMode);
  // Light-mode CTA fix: dark keeps the neon glow on a translucent fill; light
  // switches to a SOLID fill so white text never washes out on white (the CSS
  // .light .glow-* fix can't reach these inline-styled buttons). Gold uses dark
  // text on its light fill; blue/green keep white.
  const ctaHue = (rgba: string, solid: string, darkIcon: string, gold = false) => ({
    card: darkMode
      ? { background: `rgba(${rgba},.13)`, border: `1.5px solid rgba(${rgba},.75)`, boxShadow: `0 0 24px -3px rgba(${rgba},.5), inset 0 0 22px -8px rgba(${rgba},.4)` }
      : { background: solid, border: `1.5px solid ${solid}`, boxShadow: `0 0 17px -2px rgba(${rgba},.6), 0 4px 12px -7px rgba(0,0,0,.22)` },
    text: darkMode ? "#fff" : gold ? "#3a2a00" : "#fff",
    sub: darkMode ? "#ffffffb0" : gold ? "rgba(58,42,0,.72)" : "rgba(255,255,255,.9)",
    icon: darkMode ? darkIcon : gold ? "#3a2a00" : "#fff",
    tag: darkMode
      ? { background: `rgba(${rgba},.2)`, color: darkIcon }
      : gold ? { background: "rgba(0,0,0,.14)", color: "#3a2a00" } : { background: "rgba(255,255,255,.22)", color: "#fff" },
  });
  const cGold = ctaHue("245,180,0", "#f5b400", "#f5b400", true);
  const cGreen = ctaHue("0,204,102", "#00b85c", "#3ee08f");
  const cBlue = ctaHue("46,139,255", "var(--color-primary)", "#8cc0ff");
  const cViolet = ctaHue("157,78,221", "#9d4edd", "#d8b6ff");

  const [mode, setMode] = useState<null | "paste" | "manual" | "edit" | "inspect" | "inspect-edit" | "quick" | "template">(null);
  // Set when the user taps ✏️ Edit on a saved inspection in
  // SavedInspections. Hydrates the Inspector's `editing` prop so it
  // opens with the saved record's rooms/items/photos already in place
  // and saves back via db.patch instead of creating a duplicate.
  const [editingInspection, setEditingInspection] = useState<{
    id: string;
    initialData: InspectionData;
    linkedQuoteCount: number;
  } | null>(null);
  const [text, setText] = useState("");
  const [prop, setProp] = useState("");
  const [client, setClient] = useState("");
  // Optional FKs into the new Customer/Address entities. When set, the
  // job is linked structurally; the legacy free-text `prop`/`client`
  // strings stay populated alongside for back-compat.
  const [customerId, setCustomerId] = useState<string | undefined>(undefined);
  const [addressId, setAddressId] = useState<string | undefined>(undefined);
  const [rooms, setRooms] = useState<Room[]>([]);
  // Scope-check rules (finish work, trim-out, cleanup a quote tends to forget).
  const [scopeRules, setScopeRules] = useState<ScopeRule[]>([]);
  useEffect(() => {
    let live = true;
    loadScopeRules().then((r) => { if (live) setScopeRules(r); });
    return () => { live = false; };
  }, []);
  const [tab, setTab] = useState("quote");
  const [workers, setWorkers] = useState<string[]>([]);
  const [parsing, setParsing] = useState(false);
  const [parseStatus, setParseStatus] = useState("");
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [quickPhotos, setQuickPhotos] = useState<string[]>([]);
  const [quickDesc, setQuickDesc] = useState("");
  // Set when "Build Quote" on a lead seeds quickDesc/quickPhotos — the effect
  // below fires the AI build once those have committed to state.
  const [leadBuildPending, setLeadBuildPending] = useState(false);
  // A lead whose AI-built quote is still waiting as an edit draft opens the
  // Resume / Discard card instead of re-running the AI. Its request is kept
  // here so Discard can seed Quick Quote the original way.
  const leadSeedRef = useRef<{ desc: string; photos: string[] } | null>(null);
  const [quickUploading, setQuickUploading] = useState(false);
  const quickPhotoRef = useRef<HTMLInputElement>(null);
  const [quickCam, setQuickCam] = useState(false);
  // Quick Quote voice input: stop (and transcribe) before the camera opens —
  // iOS often refuses the camera while the mic is still recording.
  // Quick Quote Voice Walk: the live camera + mic together (the Inspection's
  // VoiceWalk screen) — "tip" = the short how-to first, "walk" = recording.
  // What's said lands in the description, the photos in Photos.
  const [qqWalk, setQqWalk] = useState<null | "tip" | "walk">(null);
  const [qqTranscribing, setQqTranscribing] = useState(false);
  const QQ_TIP_KEY = `c_qq_vw_tip_off_${user?.id || "anon"}`;
  const [qqTipOff, setQqTipOff] = useState(false);
  const openQuickWalk = async () => {
    let off = false;
    try { off = localStorage.getItem(QQ_TIP_KEY) === "1"; } catch { /* */ }
    setQqTipOff(off);
    setQqWalk(off ? "walk" : "tip");
  };
  const startQuickWalk = () => {
    try { if (qqTipOff) localStorage.setItem(QQ_TIP_KEY, "1"); else localStorage.removeItem(QQ_TIP_KEY); } catch { /* */ }
    setQqWalk("walk");
  };
  const finishQuickWalk = async (result: VoiceWalkResult) => {
    setQqWalk(null);
    if (result.photos.length) setQuickPhotos((prev) => [...prev, ...result.photos.map((p) => p.url).filter((u) => !prev.includes(u))]);
    let text = result.partialTranscript;
    if (result.audioBlob && result.audioBlob.size > 1024) {
      setQqTranscribing(true);
      try {
        const fd = new FormData();
        fd.append("audio", result.audioBlob, "quick-quote.webm");
        const res = await apiFetch("/api/transcribe", { method: "POST", body: fd });
        if (res.ok) {
          const data = await res.json();
          if (typeof data.text === "string" && data.text.trim()) text = data.text.trim();
        } else if (!text) {
          useStore.getState().showToast("Couldn't turn the recording into text — type what you saw, the photos are saved", "warning");
        }
      } catch { /* keep the live preview text */ }
      setQqTranscribing(false);
    }
    if (text.trim()) setQuickDesc((d) => (d.trim() ? `${d.trim()}\n${text.trim()}` : text.trim()));
    const n = result.photos.length;
    if (text.trim() || n) {
      useStore.getState().showToast(`Added ${text.trim() ? "your notes" : ""}${text.trim() && n ? " and " : ""}${n ? `${n} photo${n === 1 ? "" : "s"}` : ""} — check them, then Generate`, "success");
    }
  };

  // Compress + upload one Quick Quote photo, then keep its URL. Shared by the
  // in-app camera and the library picker below.
  const handleQuickPhotoFile = async (file: File) => {
    setQuickUploading(true);
    try {
      const canvas = document.createElement("canvas");
      const img = new Image();
      await new Promise<void>((res) => { img.onload = () => res(); img.src = URL.createObjectURL(file); });
      let w = img.width, h = img.height;
      const max = 800;
      if (w > max || h > max) { if (w > h) { h = Math.round(h * max / w); w = max; } else { w = Math.round(w * max / h); h = max; } }
      canvas.width = w; canvas.height = h;
      canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
      const blob = await new Promise<Blob>((res) => canvas.toBlob((b) => res(b || file), "image/jpeg", 0.5));
      const path = `quickquote/${Date.now()}_${Math.random().toString(36).slice(2, 6)}.jpg`;
      const { error } = await supabase.storage.from("receipts").upload(path, blob);
      if (!error) {
        const { data } = supabase.storage.from("receipts").getPublicUrl(path);
        if (data?.publicUrl) setQuickPhotos((prev) => [...prev, data.publicUrl]);
      }
    } catch (err) { console.error(err); }
    setQuickUploading(false);
  };
  const [jobPhotos, setJobPhotos] = useState<{ url: string; label: string; type: "before" | "after" | "work" }[]>([]);
  const [showRender, setShowRender] = useState(false);
  // Send sheet (Text / Email / Copy / Share) for the saved quote.
  const [sendSheet, setSendSheet] = useState<{ jobId: string; phone: string; email: string; subject: string; message: string } | null>(null);
  // Auto-built "after" render prompt from this quote's line items (visible
  // scope only — paint/floors/fixtures; hidden/plumbing work is skipped).
  const renderSeed = useMemo(() => buildRenderPrompt(rooms), [rooms]);
  const [inspectionData, setInspectionData] = useState<InspectionData | null>(null);
  // True when an inspection's AI parse failed — drives the in-place Retry card
  // (no silent skeleton fallback). Cleared on retry, on a new parse, or on back.
  const [inspParseFailed, setInspParseFailed] = useState(false);
  // Editable work order — null means "use auto-generated from guide.steps"
  const [customWorkOrder, setCustomWorkOrder] = useState<GuideStep[] | null>(null);
  // Quote-line ids already accounted for by the work order — lines that were in
  // the quote when the work order was loaded, plus tasks removed in the Guide
  // tab. A line NOT in here and with no task is new → syncWorkOrder adds one.
  const woKnownIdsRef = useRef<Set<string>>(new Set());
  // Per-quote discount. Lives on the rooms JSON blob (no schema change).
  // null = no discount; on save, persisted as `data.discount` so reloads
  // round-trip.
  const [discount, setDiscount] = useState<JobDiscount | null>(null);
  // Per-quote labor-rate override (Feature 2). null = use the org/user
  // default; a positive number overrides for THIS quote only. Lives on
  // the rooms JSON blob as `data.laborRate` (no schema change).
  const [laborRate, setLaborRate] = useState<number | null>(null);
  // Per-quote minimum-labor-hours override. null = use the org default
  // (organizations.min_labor_hours, falling back to 1). Persisted on the
  // rooms JSON blob as `data.minLaborHours`. 0 is a valid value (disables
  // the minimum for this quote); only `null` means "inherit".
  const [minLaborHours, setMinLaborHours] = useState<number | null>(null);
  // Per-quote tax-mode override. null = inherit org default
  // (organizations.tax_mode, falling back to "total" for legacy rows).
  // Persisted on the rooms JSON blob as `data.taxMode`.
  const [taxMode, setTaxMode] = useState<TaxMode | null>(null);
  // Sales tax paid BUYING materials, as saved on this quote
  // (data.materialTaxPct + materialTaxZip). null = a new quote or one saved
  // before this existed → the rate for the job's ZIP (lib/material-tax.ts).
  // A saved quote keeps its rate unless its address moved to another ZIP.
  const [quoteMatTax, setQuoteMatTax] = useState<{ pct: number; zip: string } | null>(null);
  // Good-Better-Best tiered quote (per-quote, on the rooms JSON blob). When
  // on, each line item can be tagged base/better/best (cumulative) and the
  // customer picks an option on the approval page. `data.tieredQuote` +
  // `data.tierNames`; the per-item tier rides on each RoomItem (data.rooms).
  const [tieredQuote, setTieredQuote] = useState(false);
  const [tierNames, setTierNames] = useState<{ better: string; best: string }>({ better: "Better", best: "Best" });
  // Crew size for this quote (rooms blob `data.crewSize`). null = Auto (the
  // PDF's per-section guess: 2 people when a trade section is over 8 hrs,
  // else 1). It does NOT change the price — labor hours are TOTAL work hours
  // — only how they split on site: the PDF's "Xh × N crew" line and the
  // "≈ N days on site" hint.
  const [crewSize, setCrewSize] = useState<number | null>(null);
  // The AI parse's own day estimate (rooms blob `data.estDays`) — it counts
  // dry/cure waits that add days but no labor hours. Feeds estimateDays().
  const [aiEstDays, setAiEstDays] = useState<number | null>(null);
  // Which tier you're currently organizing in the editor (UI-only, not saved).
  // The 3 total tiles double as this switch; each line item then shows ONE
  // include checkbox for the active tier, so tagging an item never overwrites
  // another tier's selection. Tiers stack (cumulative), so lower tiers show as
  // inherited + locked when you're editing a higher one.
  const [editTier, setEditTier] = useState<"base" | "better" | "best">("base");
  // Options a manually added line goes into (Add tab). null = follow the
  // option being organized; reset whenever the owner switches options.
  const [nTiers, setNTiers] = useState<TierKey[] | null>(null);
  useEffect(() => { setNTiers(null); }, [editTier]);
  const addTiers: TierKey[] = nTiers && nTiers.length ? nTiers : [editTier];
  // An Undo snapshot belongs to the quote it was taken on.
  useEffect(() => { setAssistUndo(null); }, [editingId, editJobId]);
  // AI Assist option scope: "all", or one option — then only that option can
  // change (enforced in lib/assist-ops.ts, not left to the model).
  const [assistScope, setAssistScope] = useState<"all" | TierKey>("all");
  // State before the last AI Assist apply, for the Undo button.
  const [assistUndo, setAssistUndo] = useState<{
    rooms: Room[]; tieredQuote: boolean; tierNames: { better: string; best: string };
    laborRate: number | null; discount: JobDiscount | null; minLaborHours: number | null; taxMode: TaxMode | null;
  } | null>(null);
  // Guide-tab persistent state — lifted out of GuideTab so adds survive
  // save+reload. Bernard hit the bug where new shopping-list items
  // disappeared on save: GuideTab held them in local component state that
  // never made it into the job's rooms JSON. These four arrays are now
  // sourced from / persisted to data.customTools / data.customShop /
  // data.checkedTools / data.checkedShop, matching the keys WorkVision
  // already writes — so adds and checks round-trip between the two views.
  const [customTools, setCustomTools] = useState<string[]>([]);
  const [customShop, setCustomShop] = useState<GuideShopItem[]>([]);
  const [checkedTools, setCheckedTools] = useState<string[]>([]);
  const [checkedShop, setCheckedShop] = useState<string[]>([]);
  const [removedGuideShop, setRemovedGuideShop] = useState<string[]>([]);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const galleryRef = useRef<HTMLInputElement>(null);

  /* ── Quick-quote draft autosave ───────────────────────────────────────
     A quote in progress (description, photos, customer, and any built/edited
     line items) used to vanish if the app was backgrounded or navigated away
     before Save. Persist a per-user draft to localStorage while creating a NEW
     quote (never while editing an existing job — that already lives in the DB
     — and never for the Inspector flow, which persists itself). Offer to resume
     it from the hub; cleared on Save or explicit Discard. */
  const DRAFT_KEY = `c_qf_draft_${user?.id || "anon"}`;
  const DRAFTABLE_MODES = ["quick", "manual", "paste", "edit", "template"];
  const [draftAvailable, setDraftAvailable] = useState(false);
  // True for the duration of a saveJob run. saveJob clears the draft, then
  // `await loadAll()`, then resets mode — so during that async window mode is
  // still "editable" and a background/pagehide flush would otherwise re-write
  // the draft we just cleared. This blocks that resurrection.
  const savingRef = useRef(false);

  const collectDraft = () => ({
    v: 1, savedAt: Date.now(),
    mode, prop, client, customerId, addressId, text, quickDesc, quickPhotos,
    rooms, workers, jobPhotos, customWorkOrder,
    discount, laborRate, minLaborHours, taxMode, tieredQuote, tierNames, crewSize, aiEstDays,
    customTools, customShop, checkedTools, checkedShop, removedGuideShop, tab,
    templateEdit,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const draftHasContent = (d: any) =>
    !!(d && (d.quickDesc?.trim() || d.quickPhotos?.length || d.rooms?.length || d.prop || d.client || d.customerId || d.text?.trim()));
  const draftIsSaveable = () =>
    !savingRef.current && !editJobId && !editingId && !!mode && DRAFTABLE_MODES.includes(mode) && draftHasContent(collectDraft());

  const clearDraft = () => { try { localStorage.removeItem(DRAFT_KEY); } catch { /* */ } setDraftAvailable(false); };

  const restoreDraft = () => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const d = JSON.parse(raw);
      setProp(d.prop || ""); setClient(d.client || "");
      setCustomerId(d.customerId || undefined); setAddressId(d.addressId || undefined);
      setText(d.text || ""); setQuickDesc(d.quickDesc || ""); setQuickPhotos(d.quickPhotos || []);
      setRooms(d.rooms || []); setWorkers(d.workers || []); setJobPhotos(d.jobPhotos || []);
      woKnownIdsRef.current = quoteItemIds(d.rooms || []);
      setCustomWorkOrder(d.customWorkOrder ?? null);
      setDiscount(d.discount ?? null); setLaborRate(d.laborRate ?? null);
      setMinLaborHours(d.minLaborHours ?? null); setTaxMode(d.taxMode ?? null);
      setTieredQuote(!!d.tieredQuote); setTierNames(d.tierNames || { better: "Better", best: "Best" });
      setCrewSize(typeof d.crewSize === "number" && d.crewSize > 0 ? d.crewSize : null);
      setAiEstDays(typeof d.aiEstDays === "number" && d.aiEstDays > 0 ? d.aiEstDays : null);
      setCustomTools(d.customTools || []); setCustomShop(d.customShop || []);
      setCheckedTools(d.checkedTools || []); setCheckedShop(d.checkedShop || []);
      setRemovedGuideShop(d.removedGuideShop || []);
      setTab(d.tab || "quote");
      setTemplateEdit(d.templateEdit ?? null);
      setMode(DRAFTABLE_MODES.includes(d.mode) ? d.mode : (d.rooms?.length ? "edit" : "quick"));
      setDraftAvailable(false);
      useStore.getState().showToast("Resumed your unsaved quote", "success");
    } catch { /* */ }
  };

  /* ── Edit-draft autosave (existing quotes) ────────────────────────────
     Editing a SAVED quote used to live only on screen until Update/Send — the
     back arrow, a closed app or the phone killing it in the background lost
     everything. Each saved quote now gets its own phone-only draft, written as
     you edit; reopening that quote offers Resume / Discard. Nothing reaches
     the job (or the customer's page) until Update/Send, and a successful save
     clears the draft. */
  const EDIT_DRAFT_TTL = 14 * 24 * 3600 * 1000;
  const editDraftKey = (id: string) => `c_qf_edit_${user?.id || "anon"}_${id}`;
  // The saved state the editor loaded (or last saved) — a draft is only kept
  // while the screen differs from it.
  const editBaselineRef = useRef<{ id: string; snap: string } | null>(null);
  // Fingerprint of the job's saved blob at load, to flag a draft made against
  // an older version (someone saved the quote elsewhere since).
  const editLoadedHashRef = useRef<string>("");
  const [editDraftOffer, setEditDraftOffer] = useState<{ id: string; savedAt: number; stale: boolean } | null>(null);
  const hashText = (s: string) => {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return `${s.length}:${h}`;
  };
  const editSnapshot = () => JSON.stringify({
    prop, client, customerId, addressId, rooms, workers, jobPhotos,
    // `src` is the sync's session-only baseline, not an edit.
    customWorkOrder: customWorkOrder ? customWorkOrder.map(({ src: _src, ...s }) => s) : null,
    discount, laborRate, minLaborHours, taxMode, tieredQuote, tierNames, crewSize, aiEstDays,
    customTools, customShop, checkedTools, checkedShop, removedGuideShop,
  });
  const writeEditDraft = (id: string, snap: string) => {
    try { localStorage.setItem(editDraftKey(id), JSON.stringify({ v: 1, savedAt: Date.now(), base: editLoadedHashRef.current, state: JSON.parse(snap) })); } catch { /* */ }
  };
  const dropEditDraft = (id: string) => { try { localStorage.removeItem(editDraftKey(id)); } catch { /* */ } };
  const resumeEditDraft = () => {
    if (!editDraftOffer) return;
    try {
      const raw = localStorage.getItem(editDraftKey(editDraftOffer.id));
      const d = raw ? JSON.parse(raw)?.state : null;
      if (d) {
        setProp(d.prop || ""); setClient(d.client || "");
        setCustomerId(d.customerId || undefined); setAddressId(d.addressId || undefined);
        setRooms(d.rooms || []); setWorkers(d.workers || []); setJobPhotos(d.jobPhotos || []);
        woKnownIdsRef.current = quoteItemIds(d.rooms || []);
        setCustomWorkOrder(d.customWorkOrder ?? null);
        setDiscount(d.discount ?? null); setLaborRate(d.laborRate ?? null);
        setMinLaborHours(d.minLaborHours ?? null); setTaxMode(d.taxMode ?? null);
        setTieredQuote(!!d.tieredQuote); setTierNames(d.tierNames || { better: "Better", best: "Best" });
        setCrewSize(typeof d.crewSize === "number" && d.crewSize > 0 ? d.crewSize : null);
        setAiEstDays(typeof d.aiEstDays === "number" && d.aiEstDays > 0 ? d.aiEstDays : null);
        setCustomTools(d.customTools || []); setCustomShop(d.customShop || []);
        setCheckedTools(d.checkedTools || []); setCheckedShop(d.checkedShop || []);
        setRemovedGuideShop(d.removedGuideShop || []);
        useStore.getState().showToast("Unsaved changes restored — tap Update to save them", "success");
      }
    } catch { /* */ }
    leadSeedRef.current = null;
    setEditDraftOffer(null);
  };
  const discardEditDraft = () => {
    if (editDraftOffer) dropEditDraft(editDraftOffer.id);
    setEditDraftOffer(null);
    // A lead's draft thrown away → build from the customer's request again,
    // exactly as a lead with no draft does.
    const seed = leadSeedRef.current;
    if (seed) {
      leadSeedRef.current = null;
      setQuickDesc(seed.desc);
      setQuickPhotos(seed.photos);
      setMode("quick");
      setLeadBuildPending(true);
    }
  };
  // Write the draft as you edit (debounced). Paused while a Resume/Discard
  // choice is pending so the older draft isn't overwritten before you pick.
  useEffect(() => {
    if (!editingId || !mode || !DRAFTABLE_MODES.includes(mode) || savingRef.current) return;
    const snap = editSnapshot();
    const base = editBaselineRef.current;
    // First render after a load = the saved version. Captured even while the
    // Resume/Discard choice is open, so a resumed draft still counts as unsaved.
    if (!base || base.id !== editingId) { editBaselineRef.current = { id: editingId, snap }; return; }
    if (editDraftOffer) return;
    if (snap === base.snap) { dropEditDraft(editingId); return; } // back to the saved version
    const id = editingId;
    const t = setTimeout(() => writeEditDraft(id, snap), 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, prop, client, customerId, addressId, rooms, workers, jobPhotos, customWorkOrder, discount, laborRate, minLaborHours, taxMode, tieredQuote, tierNames, crewSize, aiEstDays, customTools, customShop, checkedTools, checkedShop, removedGuideShop, editingId, editDraftOffer]);

  // Show the "resume" card whenever we land on the hub with a saved draft.
  useEffect(() => {
    if (mode !== null || editJobId) return;
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      setDraftAvailable(!!(raw && draftHasContent(JSON.parse(raw))));
    } catch { setDraftAvailable(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, editJobId]);

  // Debounced autosave while building a NEW quote.
  useEffect(() => {
    if (!draftIsSaveable()) return;
    const snapshot = JSON.stringify(collectDraft());
    const t = setTimeout(() => { try { localStorage.setItem(DRAFT_KEY, snapshot); } catch { /* */ } }, 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, prop, client, customerId, addressId, text, quickDesc, quickPhotos, rooms, workers, jobPhotos, customWorkOrder, discount, laborRate, minLaborHours, taxMode, tieredQuote, tierNames, crewSize, aiEstDays, customTools, customShop, checkedTools, checkedShop, removedGuideShop, tab, editJobId, editingId]);

  // Flush immediately when the app is backgrounded/closed — the 600ms debounce
  // may not fire if the user leaves right after typing. Ref keeps the latest
  // closure so the once-registered listeners always see current state.
  const draftFlushRef = useRef<() => void>(() => {});
  draftFlushRef.current = () => {
    // Saved quote being edited: write its draft now (the debounce may not fire).
    if (editingId && mode && DRAFTABLE_MODES.includes(mode) && !savingRef.current && !editDraftOffer) {
      const snap = editSnapshot();
      const base = editBaselineRef.current;
      if (base && base.id === editingId && snap !== base.snap) writeEditDraft(editingId, snap);
    }
    if (!draftIsSaveable()) return;
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(collectDraft())); } catch { /* */ }
  };
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === "hidden") draftFlushRef.current(); };
    const onHide = () => draftFlushRef.current();
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pagehide", onHide);
    return () => { document.removeEventListener("visibilitychange", onVis); window.removeEventListener("pagehide", onHide); };
  }, []);

  // Pre-load job data when editing
  useEffect(() => {
    if (!editJobId) return;
    const job = jobs.find((j) => j.id === editJobId);
    if (!job) return;

    setProp(job.property || "");
    setClient(job.client || "");
    setCustomerId(job.customer_id || undefined);
    setAddressId(job.address_id || undefined);
    setEditingId(job.id);
    leadSeedRef.current = null;

    try {
      const data = readBlob(job.rooms);
      // A new lead (public intake form) stores work-order details as
      // { leadDescription, leadPhotos } with no quote rooms yet. "Build Quote"
      // lands here — instead of a blank editor, seed the Quick Quote flow with
      // those details and auto-run the AI build (deferred to the effect below so
      // quickPhotos commits before doAiParse reads it). editingId stays this
      // job, so saving promotes the same lead row to a quote.
      const leadPhotos = Array.isArray(data?.leadPhotos) ? data.leadPhotos : [];
      // The server already drafted a quote from the request (lib/lead-draft.ts)
      // → open it in the editor right away instead of running the AI again.
      const leadDraftRooms: Room[] | null =
        !data?.rooms?.length && Array.isArray(data?.leadDraft?.rooms) && data.leadDraft.rooms.length ? data.leadDraft.rooms : null;
      if (!data?.rooms?.length && !leadDraftRooms && (data?.leadDescription || leadPhotos.length)) {
        // The AI already built this lead once and that quote is still in its
        // edit draft (left before Save) → don't re-run the AI. Take the normal
        // edit path below so Resume / Discard is offered; Discard falls back
        // to the auto-build via leadSeedRef.
        let leadDraft = false;
        try {
          const raw = localStorage.getItem(editDraftKey(job.id));
          const d = raw ? JSON.parse(raw) : null;
          leadDraft = !!(d && typeof d.savedAt === "number" && Date.now() - d.savedAt < EDIT_DRAFT_TTL && d.state?.rooms?.length > 0);
        } catch { /* */ }
        if (leadDraft) {
          leadSeedRef.current = { desc: data.leadDescription || "", photos: leadPhotos };
          setRooms([]);
        } else {
          setQuickDesc(data.leadDescription || "");
          setQuickPhotos(leadPhotos);
          setMode("quick");
          setLeadBuildPending(true);
          clearEditJob?.();
          return;
        }
      }
      let loadedRooms: Room[] = [];
      if (data?.rooms?.length) {
        // skipCaps on reload: the user has already reviewed and saved
        // these items. The material/labor caps in validateQuote are an
        // AI-defense layer; re-applying them here would scale a Bernard-
        // edited material price back down to the cap (the bug Bernard
        // hit where the materials list edit "didn't save").
        loadedRooms = validateQuote(data.rooms, { skipCaps: true });
        setRooms(loadedRooms);
      } else if (leadDraftRooms) {
        loadedRooms = validateQuote(leadDraftRooms, { skipCaps: true });
        setRooms(loadedRooms);
        useStore.getState().showToast("AI draft from the customer's request — check it, then Send", "info");
      }
      if (data?.workers?.length) {
        setWorkers(data.workers.map((w: { id: string }) => w.id));
      }
      if (data?.workOrder?.length) {
        // Preserve any prior edits (incl. `done` checkboxes from Jobs/WorkVision).
        // Keep the quote-line link (itemId) so later quote edits follow the
        // task; every line already in the quote counts as accounted for, so a
        // task removed on purpose isn't re-added (see work-order-sync).
        woKnownIdsRef.current = quoteItemIds(loadedRooms);
        setCustomWorkOrder(data.workOrder.map((s: GuideStep) => ({
          room: s.room, detail: s.detail, action: s.action, pri: s.pri, hrs: s.hrs,
          ...(s.itemId ? { itemId: s.itemId } : {}),
          ...(s.custom ? { custom: true } : {}),
        })));
      } else {
        // No saved tasks: rebuild from the quote (null = guide.steps). Never
        // keep the previous quote's work order, and don't treat this quote's
        // lines as "removed on purpose" — that's what left a job with lines
        // but an empty work order forever.
        woKnownIdsRef.current = new Set();
        setCustomWorkOrder(null);
      }
      // Guide-tab persistent state — same keys WorkVision uses, so
      // shopping-list adds and checks survive across views.
      setCustomTools(Array.isArray(data?.customTools) ? data.customTools : []);
      setCustomShop(Array.isArray(data?.customShop) ? data.customShop : []);
      setCheckedTools(Array.isArray(data?.checkedTools) ? data.checkedTools : []);
      setCheckedShop(Array.isArray(data?.checkedShop) ? data.checkedShop : []);
      setRemovedGuideShop(Array.isArray(data?.removedGuideShop) ? data.removedGuideShop : []);
      // Per-quote settings — discount, labor-rate / min-hours / tax-mode
      // overrides (absent or invalid = inherit the org's), the materials tax it
      // was priced with, Good-Better-Best (absent = off; legacy quotes load
      // non-tiered), crew size, est. days. One shared reader (lib/quote-blob.ts)
      // so this load, the printed quote, the invoice and /status can't drift.
      const q = readQuoteSettings(data);
      setDiscount(q.discount);
      setLaborRate(q.laborRate);
      setMinLaborHours(q.minLaborHours);
      setTaxMode(q.taxMode);
      setQuoteMatTax(q.materialTax);
      setTieredQuote(q.tieredQuote);
      setCrewSize(q.crewSize);
      // A lead's AI draft carries its own estimate until the first save.
      setAiEstDays(q.estDays ?? readEstDays(data?.leadDraft?.estDays));
      setTierNames(q.tierNames);
      // Restore the photo gallery so the Photos tab + AI Render get the quote's
      // photos back — including the inspection photos collected when the quote
      // was first built. Without this, re-opening a saved quote dropped them and
      // Render reported "add an inspection photo to preview the finish".
      if (Array.isArray(data?.photos)) {
        setJobPhotos(
          (data.photos as { url?: string; label?: string; type?: string }[])
            .filter((p) => p && typeof p.url === "string")
            .map((p) => ({
              url: p.url as string,
              label: typeof p.label === "string" ? p.label : "",
              type: p.type === "after" || p.type === "work" ? p.type : "before",
            })),
        );
      } else if (leadDraftRooms && leadPhotos.length) {
        // The customer's photos ride along as "before" photos (Quick Quote does the same).
        setJobPhotos((leadPhotos as unknown[]).filter((u): u is string => typeof u === "string").map((url) => ({ url, label: "Customer photo", type: "before" as const })));
      } else {
        setJobPhotos([]);
      }
    } catch {
      // rooms parse failed, start empty
    }

    // Edit-draft: this load is the new baseline; offer any unsaved draft.
    editBaselineRef.current = null;
    editLoadedHashRef.current = hashText(typeof job.rooms === "string" ? job.rooms : JSON.stringify(job.rooms ?? ""));
    setEditDraftOffer(null);
    try {
      const raw = localStorage.getItem(editDraftKey(job.id));
      const d = raw ? JSON.parse(raw) : null;
      if (d && typeof d.savedAt === "number" && Date.now() - d.savedAt < EDIT_DRAFT_TTL && d.state) {
        setEditDraftOffer({ id: job.id, savedAt: d.savedAt, stale: !!d.base && d.base !== editLoadedHashRef.current });
      } else if (raw) {
        dropEditDraft(job.id); // expired or unreadable
      }
    } catch { /* */ }

    setMode("edit");
    clearEditJob?.();
  }, [editJobId, jobs, clearEditJob]);

  // Auto-run the AI build for a "Build Quote" off a lead, once the seeded
  // quickDesc/quickPhotos have committed (so doAiParse reads the right photos).
  useEffect(() => {
    if (!leadBuildPending) return;
    setLeadBuildPending(false);
    doAiParse(quickDesc || "Analyze these photos and quote all repairs needed.", null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadBuildPending]);

  // Add-item form state
  // nr  = trade bucket (Painting, Carpentry, Plumbing…) — picks the parent
  //       Room object the item lands in
  // na  = area / room location (Bedroom 1, Kitchen, Bathroom 2…) — gets
  //       prefixed onto the detail so the QuoteTab + PDF show "Bedroom 1 —
  //       Caulk and paint baseboards" the same way AI-generated items do
  // nd  = item description (the actual scope)
  // nc  = optional longer description / comment
  // nh  = labor hours
  // nm  = material cost (lump sum — additional materials editable per-item)
  // nsq = sqft (optional, surfaces in the QuoteTab SQFT column)
  // ncn = condition (D / P / F / -). Defaults to "-" (project-scope).
  const [nr, setNr] = useState("");
  const [na, setNa] = useState("");
  const [nd, setNd] = useState("");
  const [nc, setNc] = useState("");
  const [nh, setNh] = useState("1");
  const [nm, setNm] = useState("20");
  const [nsq, setNsq] = useState("");
  const [ncn, setNcn] = useState<"D" | "P" | "F" | "-">("-");

  const fileRef = useRef<HTMLInputElement>(null);
  const org = useStore((s) => s.org);

  // ── Service templates: save a finished quote and reuse its line items as a
  //    one-tap starter (the "From Template" hub CTA). Org-scoped; template_rooms
  //    is a stringified Room[] — the same shape as jobs.rooms. ──
  const [templates, setTemplates] = useState<ServiceTemplate[]>([]);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [templateCategory, setTemplateCategory] = useState("");
  // Set while the editor is building / editing a SERVICE instead of a quote
  // (From Template → New service, or a service's "Edit lines"). id null = new.
  const [templateEdit, setTemplateEdit] = useState<{ id: string | null; name: string; category: string } | null>(null);
  // "Add a service" sheet in the editor: drop a service's lines into this quote.
  const [addingService, setAddingService] = useState(false);
  const reloadTemplates = async () => {
    const orgId = org?.id;
    if (!orgId) return;
    // Raw query (not db.get) so a missing table pre-migration degrades SILENTLY
    // — no error toast on every QuoteForge open until the migration is run. An
    // actual Save (db.post below) surfaces the real error so the user knows.
    // NB: deliberately NO `.order("created_at")` — if that column is absent the
    // ordered query errors and silently yields zero templates; sort client-side.
    try {
      const { data, error } = await supabase
        .from("service_templates").select("*").eq("org_id", orgId);
      if (error) return;
      const list = (data as (ServiceTemplate & { created_at?: string })[]) || [];
      list.sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
      setTemplates(list);
    } catch { /* table may not exist yet — stay quiet */ }
  };
  useEffect(() => {
    reloadTemplates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org?.id]);
  const saveAsTemplate = async () => {
    const name = templateName.trim();
    if (!name) { useStore.getState().showToast("Name the template", "warning"); return; }
    if (!rooms.length) { useStore.getState().showToast("Add line items first", "warning"); return; }
    const category = canonCategory(templates, templateCategory);
    const template_rooms = JSON.stringify(stripAiHrs(rooms));
    const editId = templateEdit?.id;
    const prev = editId ? templates.find((x) => x.id === editId) : undefined;
    let ok: boolean;
    if (editId) {
      const patch: Record<string, unknown> = { name, category: category || null, template_rooms };
      if ((category || "") !== (canonCategory(templates, prev?.category || ""))) patch.sort_order = nextSortOrder(templates, category, editId);
      ok = await db.patch("service_templates", editId, patch);
    } else {
      ok = !!(await db.post("service_templates", {
        org_id: org?.id, name, template_rooms,
        category: category || null, sort_order: nextSortOrder(templates, category),
      }));
    }
    // db.* already toasted the real Supabase error (missing table / RLS /
    // column). Don't claim success or close the form so the user can retry.
    if (!ok) return;
    setSavingTemplate(false);
    setTemplateName(""); setTemplateCategory("");
    await reloadTemplates();
    if (templateEdit) {
      // Done building the service — back to the service list.
      useStore.getState().showToast(`Saved "${name}"`, "success");
      exitEditor();
      clearDraft();
      setMode("template");
      return;
    }
    useStore.getState().showToast(`Saved "${name}" as a template`, "success");
  };
  const openSaveTemplate = () => {
    if (!rooms.length) { useStore.getState().showToast("Add line items first", "warning"); return; }
    setTemplateName(templateEdit ? templateEdit.name : prop || "");
    setTemplateCategory(templateEdit ? templateEdit.category : "");
    setSavingTemplate(true);
  };
  // Drop a service's lines into the quote on screen (fresh line ids).
  const addServiceToQuote = (tpl: ServiceTemplate) => {
    let parsed: Room[] = [];
    try { parsed = stripAiHrs(JSON.parse(tpl.template_rooms) as Room[]); } catch { /* */ }
    let add = validateQuote(parsed);
    if (!add.length) { useStore.getState().showToast("That service has no lines", "warning"); return; }
    // Options on: the service goes into the option being organized, like the
    // Add tab — never silently into all three.
    if (tieredQuote) add = add.map((r) => ({ ...r, items: r.items.map((it) => ({ ...it, tiers: [editTier] })) }));
    setRooms((cur) => appendTemplateRooms(cur, add, () => crypto.randomUUID().slice(0, 8)));
    setAddingService(false);
    setTab("quote");
    const n = add.reduce((a, r) => a + r.items.length, 0);
    useStore.getState().showToast(`Added "${tpl.name}" · ${n} line${n === 1 ? "" : "s"}`, "success");
  };
  // Seed a fresh quote from a template's line items (clear any prior edit state).
  const seedFromTemplate = (tpl: Pick<ServiceTemplate, "template_rooms">) => {
    let parsed: Room[] = [];
    // stripAiHrs: a template's lines aren't this job's AI estimate (templates
    // saved before the strip may still carry the stamp).
    try { parsed = stripAiHrs(JSON.parse(tpl.template_rooms) as Room[]); } catch { /* */ }
    setEditingId(null);
    setProp(""); setClient(""); setCustomerId(undefined); setAddressId(undefined);
    setCustomWorkOrder(null); setDiscount(null); setLaborRate(null); setMinLaborHours(null); setTaxMode(null); setQuoteMatTax(null);
    setTieredQuote(false); setTierNames({ better: "Better", best: "Best" }); setCrewSize(null); setAiEstDays(null);
    setCustomTools([]); setCustomShop([]); setCheckedTools([]); setCheckedShop([]);
    setJobPhotos([]); setWorkers([]);
    setRooms(validateQuote(parsed));
    setTemplateEdit(null);
    setTab("quote");
    setMode("edit");
  };
  // Open a service's lines in the editor to change them (Save = update it).
  const editTemplateLines = (tpl: ServiceTemplate) => {
    seedFromTemplate(tpl);
    setTemplateEdit({ id: tpl.id, name: tpl.name, category: tpl.category || "" });
  };
  // Set up a service from scratch: the empty editor, saved as a service.
  const newService = () => {
    seedFromTemplate({ template_rooms: "[]" });
    setTemplateEdit({ id: null, name: "", category: "" });
    setMode("manual");
  };
  // Org's published labor rate is the authoritative default for quotes.
  // Previously this read `user.rate` (the logged-in tech's payroll rate),
  // which meant changing the rate in Ops → Settings never reached the
  // quote — Settings writes `organizations.default_rate`, not the user's
  // profile. Resolution order: per-quote override → org default → $55.
  // Every price-driving org setting (+ the per-quote overrides) resolves in ONE
  // place — lib/pricing.ts pricingInputs — shared with the printed quote and
  // the AI lead draft, so they can't drift from this preview.
  const priceIn = pricingInputs(org, { laborRate, minLaborHours, taxMode });
  const { defaultRate, taxPct, tripFee, markupPct } = priceIn;
  const effectiveMinHrs = priceIn.minHrs;
  const effectiveTaxMode: TaxMode = priceIn.taxMode;

  // Get trade-specific rate or fall back to user rate
  const tradeRates: Record<string, number> = priceIn.tradeRates ?? {};
  // Shared resolver (lib/pricing.ts) — the same function export-pdf uses,
  // so the printed section rates can't drift from the preview's. Override
  // wins over trade rates wins over the org default.
  const getRateForRoom = (roomName: string): number =>
    rateForRoom(roomName, { defaultRate, override: laborRate, tradeRates });
  // Effective non-trade rate. Used for the PDF labor line + the
  // "Labor rate: $X.00/hour" line in the AI Assist system prompt.
  const rate = priceIn.rate;

  /* ── Inspection edit: open + save handlers ── */
  // Open the Inspector in edit mode for an already-saved inspection job.
  // Reads the saved JSON blob, normalizes the legacy `comment` field back
  // to InspectionData's `notes`, counts how many quotes were generated
  // from this inspection (heuristic: same property + has data.inspection),
  // and switches the screen into the inspect-edit mode.
  const openInspectionEdit = (insp: { id: string; property?: string; client?: string; customer_id?: string; address_id?: string; rooms?: string | unknown }) => {
    const parsed: Record<string, unknown> = readBlob(insp.rooms);
    const inspBlob = (parsed as { inspection?: { type?: string; rooms?: { name: string; sqft?: number; width?: number; length?: number; items: { name: string; condition: string; comment?: string; notes?: string; photos?: string[] }[] }[] } }).inspection;
    const initialData: InspectionData = {
      rooms: (inspBlob?.rooms || []).map((r) => ({
        name: r.name || "",
        sqft: typeof r.sqft === "number" ? r.sqft : 0,
        width: r.width,
        length: r.length,
        items: (r.items || []).map((it) => ({
          name: it.name || "",
          condition: it.condition || "S",
          notes: it.notes ?? it.comment ?? "",
          photos: it.photos || [],
        })),
      })),
      property: insp.property || "",
      client: insp.client || "",
      customer_id: insp.customer_id,
      address_id: insp.address_id,
      // Without this an edited Painting/Flooring inspection reopened as Move Out.
      inspection_type: (inspBlob?.type as InspectionData["inspection_type"]) || undefined,
    };
    // Heuristic linked-quote count: jobs at the same property that aren't
    // themselves an inspection AND carry an inspection blob in their data.
    // We don't have a hard FK from quote→inspection, so property-match +
    // has-inspection-blob is the practical signal.
    const linkedQuoteCount = jobs.filter((j) => {
      if (j.id === insp.id) return false;
      if (j.status === "inspection") return false;
      if ((j.property || "") !== (insp.property || "")) return false;
      return !!readBlob(j.rooms).inspection;
    }).length;
    setEditingInspection({ id: insp.id, initialData, linkedQuoteCount });
    setMode("inspect-edit");
  };

  // Persist an inspection edit back to the original record. Updates only
  // the inspection blob inside the rooms JSON; preserves any other top-
  // level fields the saveJob path stamps on a quote (workOrder, photos,
  // etc.) — though for an "inspection" status job those are typically
  // empty. Stamps a `last_edited_at` inside the JSON so we don't depend
  // on a schema change for the timestamp.
  const handleInspectionEditSave = async (data: InspectionData) => {
    if (!editingInspection) return;
    const prevJob = jobs.find((j) => j.id === editingInspection.id);
    const prevBlob: Record<string, unknown> = jobBlob(prevJob);
    const prevInsp = (prevBlob.inspection as Record<string, unknown> | undefined) || {};
    const merged = {
      ...prevBlob,
      inspection: {
        ...prevInsp,
        type: data.inspection_type || prevInsp.type,
        rooms: data.rooms.map((r) => ({
          name: r.name,
          sqft: r.sqft,
          width: r.width,
          length: r.length,
          items: r.items.map((it) => ({ name: it.name, condition: it.condition, comment: it.notes, photos: it.photos })),
        })),
        property: data.property,
        client: data.client,
        last_edited_at: new Date().toISOString(),
      },
    };
    await db.patch("jobs", editingInspection.id, {
      property: data.property,
      client: data.client,
      ...(data.customer_id ? { customer_id: data.customer_id } : {}),
      ...(data.address_id ? { address_id: data.address_id } : {}),
      rooms: JSON.stringify(merged),
    });
    useStore.getState().showToast("Inspection updated", "success");
    await loadAll();
    setEditingInspection(null);
    setMode(null);
  };

  // Runs ONLY the AI parse of an inspection into a priced quote — extracted so
  // it can be retried without re-saving the inspection or re-loading its photos.
  // On failure it does NOT build a silent skeleton (every item 1h / $0 read as a
  // real quote but was wildly off). It stops, preserves the inspection, and arms
  // the Retry card — the usual cause is the AI call being interrupted by the app
  // being backgrounded or the phone sleeping mid-parse.
  const runInspectionAiParse = async (data: InspectionData) => {
    setInspParseFailed(false);
    setParsing(true);
    setParseStatus("Identifying repairs from findings...");
    try {
      const input: InspectionInput = {
        rooms: data.rooms,
        property: data.property,
        client: data.client,
        inspectionType: data.inspection_type,
      };
      let licensedTradesInsp: string[] = [];
      try { licensedTradesInsp = org?.licensed_trades ? JSON.parse(org.licensed_trades) : []; } catch { /* */ }
      const result = await aiParseInspection(input, rate, licensedTradesInsp, setParseStatus);
      if (result && result.rooms.length > 0) {
        setParseStatus("Building quote...");
        // Already validated (caps + floors) and labor-calibrated inside the
        // parse — skipCaps so a second cap pass can't clamp calibrated hours.
        setRooms(validateQuote(result.rooms, { skipCaps: true }));
        setAiEstDays(result.estDays > 0 ? result.estDays : null);
        setParsing(false);
        setParseStatus("");
        return;
      }
    } catch (e) {
      console.error("AI inspection parse failed:", e);
    }
    setParsing(false);
    setParseStatus("");
    setInspParseFailed(true);
    const aiErr = getLastAiError();
    const interrupted = /failed to fetch|networkerror|network request failed|aborted|load failed|timeout|timed out/i.test(aiErr);
    // Plain words for the crew; the raw API text only for platform operators.
    if (aiErr) console.error("AI inspection parse error:", aiErr);
    useStore.getState().showToast(
      t("qf.aiRetryInspection") + (!interrupted && aiErr && isPlatformAdmin(user.email) ? ` (${aiErr.slice(0, 140)})` : ""),
      "error",
    );
  };

  /* ── Inspection complete handler ── */
  // existingInspectionId: when called from "Quote This" on an already-saved
  // inspection, pass the inspection job's id so we DON'T create a duplicate
  // standalone inspection record. Without this, every Quote This click
  // appended a new copy to the saved-inspections list.
  const handleInspectionComplete = async (data: InspectionData, existingInspectionId?: string) => {
    setParsing(true);
    setParseStatus("Reading inspection report...");
    setMode("edit");

    setProp(data.property);
    setClient(data.client);
    setCustomerId(data.customer_id);
    setAddressId(data.address_id);
    setInspectionData(data);

    // Save inspection as standalone record only on first completion. When
    // re-quoting an already-saved inspection, the record already exists.
    if (!existingInspectionId) {
      try {
        await db.post("jobs", {
          property: data.property,
          client: data.client,
          ...(data.customer_id ? { customer_id: data.customer_id } : {}),
          ...(data.address_id ? { address_id: data.address_id } : {}),
          job_date: new Date().toISOString().split("T")[0],
          rooms: JSON.stringify({
            inspection: {
              type: data.inspection_type || "move-out",
              inspected_by: user.name,
              inspected_at: new Date().toISOString(),
              rooms: data.rooms.map((r) => ({
                name: r.name,
                sqft: r.sqft,
                width: r.width,
                length: r.length,
                items: r.items.map((it) => ({ name: it.name, condition: it.condition, comment: it.notes, photos: it.photos })),
              })),
              property: data.property,
              client: data.client,
            },
          }),
          total: 0,
          total_labor: 0,
          total_mat: 0,
          total_hrs: 0,
          status: "inspection",
          created_by: user.name,
        });
      } catch { /* non-critical */ }
      // Bump the monthly usage counter. Non-blocking — the inspection
      // itself was already saved above. Counter failure just means the
      // org's "X left this month" toast will under-count; the start-
      // gate check still runs on every new inspection.
      if (org?.id) {
        try {
          const plan = org.subscription_plan || org.plan || "solo";
          await incrementUsage(org.id, plan);
        } catch { /* logged inside the helper */ }
      }
    }

    // Collect all inspection photos and REPLACE the job gallery — appending
    // here meant re-loading the same inspection (or quoting it twice in a
    // session) doubled the gallery. Any in-progress photos from a previous
    // unrelated quote shouldn't bleed in.
    const inspectionPhotos: { url: string; label: string; type: "before" | "after" | "work" }[] = [];
    (data.rooms || []).forEach((room) => {
      (room.items || []).forEach((item) => {
        (item.photos || []).forEach((url) => {
          inspectionPhotos.push({ url, label: `${room.name} — ${item.name}`, type: "before" });
        });
      });
    });
    setJobPhotos(inspectionPhotos);

    // Turn the findings into a priced quote via AI. On failure this arms the
    // in-place Retry card instead of silently building an inaccurate skeleton.
    await runInspectionAiParse(data);
  };

  const doAiParse = async (rawText: string, file: File | null) => {
    setParsing(true);
    setParseStatus("Analyzing with AI...");

    try {
      // Render every PDF page / send every photo. We upload each PDF render
      // to Supabase first and pass URLs to the AI — that dodges Vercel's
      // 4.5 MB serverless body limit, so we can ship every page (up to
      // Anthropic's per-call image cap) instead of dropping pages past 20.
      let images: string[] = [];
      if (file && (await isPdfFile(file))) {
        setParseStatus("Rendering PDF pages...");
        try {
          const renders = await renderPdfPages(file, Number.MAX_SAFE_INTEGER, 1.0,
            (rendered, total) => setParseStatus(`Rendering PDF pages ${rendered} of ${total}...`));
          setParseStatus(`Uploading ${renders.length} page${renders.length === 1 ? "" : "s"} for AI...`);
          // Parallel upload — one HTTP RTT instead of N. Each upload that
          // fails falls back to inline base64 (the original budget-limited
          // path still works, it just caps at ~20 pages).
          const uploaded = await Promise.all(renders.map((r) => uploadDataUriToBucket(r)));
          images = uploaded.map((url, i) => url || renders[i]);
          const urlCount = uploaded.filter(Boolean).length;
          setParseStatus(`Rendered ${images.length} page${images.length === 1 ? "" : "s"} (${urlCount} via URL), sending to AI...`);
        } catch (e) {
          console.warn("Failed to render PDF pages:", e);
          setParseStatus("Sending text only to AI...");
        }
      } else if (quickPhotos.length > 0) {
        // Quick Quote photos are already public Supabase URLs — pass them
        // straight through. Inlined data URIs (rare) get uploaded so they
        // don't bloat the request body.
        setParseStatus(`Preparing ${quickPhotos.length} photo${quickPhotos.length === 1 ? "" : "s"} for AI...`);
        for (const url of quickPhotos) {
          if (url.startsWith("http")) { images.push(url); continue; }
          if (url.startsWith("data:")) {
            const uploaded = await uploadDataUriToBucket(url);
            images.push(uploaded || url); // fall back to base64 path on upload fail
            continue;
          }
        }
        setParseStatus(`Sending text + ${images.length} photo${images.length === 1 ? "" : "s"} to AI...`);
      } else {
        setParseStatus("Sending text to AI...");
      }

      let licensedTrades: string[] = [];
      try { licensedTrades = org?.licensed_trades ? JSON.parse(org.licensed_trades) : []; } catch { /* */ }
      const result = await aiParsePdf(rawText, images, rate, licensedTrades, extractZip(prop), setParseStatus);

      if (result && result.rooms.length > 0) {
        if (result.property && !prop) setProp(result.property);
        // Repeat upload with an address already set (e.g. quoting the other
        // unit of a duplex right after the first): the existing prop wins so
        // a deliberate customer/address pick is never stomped — but warn when
        // the report disagrees so the job doesn't get saved under the wrong
        // unit silently.
        else if (
          result.property && prop &&
          // Punctuation/spacing-insensitive compare — "Wichita KS" vs
          // "Wichita, KS" is the SAME address and must not warn. Only a
          // real difference (other unit number, other street) should.
          result.property.toLowerCase().replace(/[^a-z0-9]/g, "") !==
            prop.toLowerCase().replace(/[^a-z0-9]/g, "")
        ) {
          useStore.getState().showToast(
            `Report reads "${result.property}" but the address is set to "${prop}" — tap the address to change it if this is a different unit.`,
            "warning"
          );
        }
        if (result.client && !client) setClient(result.client);
        // Carry Quick Quote photos into the job's gallery as "before" photos
        // so they save with the job when the user hits Save (previously the
        // photos only existed transiently for the AI call).
        if (quickPhotos.length > 0) {
          const beforePhotos = quickPhotos.map((url) => ({
            url,
            label: "Quick Quote",
            type: "before" as const,
          }));
          setJobPhotos((prev) => {
            const existing = new Set(prev.map((p) => p.url));
            return [...prev, ...beforePhotos.filter((p) => !existing.has(p.url))];
          });
        }
        // aiParsePdf already validated (caps + floors) and labor-calibrated
        // these rooms — skipCaps so the 10h/8h cap can't re-clamp calibrated
        // hours (the real-world test saw a 10.4h line reset to 8h).
        setRooms(validateQuote(result.rooms, { skipCaps: true }));
        setAiEstDays(result.estDays > 0 ? result.estDays : null);
        setParsing(false);
        setParseStatus("");
        setMode("edit");
        return;
      }
    } catch (e) {
      console.error("AI parse error:", e);
      // Fall through to the unified failure handler below.
    }

    // AI parse didn't complete (returned nothing or threw). Do NOT silently
    // fall back to the crude regex parser — it built wildly inaccurate quotes,
    // especially for Quick Quote photos, which carry no structured text for it
    // to parse. The usual trigger is the in-flight AI request being interrupted
    // by leaving the app or the phone sleeping mid-parse. Keep the user's
    // inputs, stop the spinner, and prompt a retry instead of a bogus quote.
    setParsing(false);
    setParseStatus("");
    const aiErr = getLastAiError();
    const interrupted = /failed to fetch|networkerror|network request failed|aborted|load failed|timeout|timed out/i.test(aiErr);
    // Plain words for the crew; the raw API text only for platform operators.
    if (aiErr) console.error("AI parse error:", aiErr);
    useStore.getState().showToast(
      interrupted
        ? t("qf.aiRetry")
        : t("qf.aiFailed") + (aiErr && isPlatformAdmin(user.email) ? ` (${aiErr.slice(0, 140)})` : ""),
      "error",
    );
  };

  /* ── Regex fallback parse ── */
  const doRegexParse = (rawText: string) => {
    const p = parseZI(rawText);
    setParsing(false);
    setParseStatus("");
    if (!p.length) {
      const c = (rawText.match(/Maintenance/gi) || []).length;
      useStore.getState().showToast(
        `Found ${c} "Maintenance" refs but couldn't parse. Try Upload PDF or Manual.`,
        "info"
      );
      return;
    }
    const pm = rawText.match(
      /([\d]+\s+[\w\s]+(?:Ave|St|Blvd|Ln|Dr|Rd|Ct|Way|Circle|Place))/i
    );
    if (pm && !prop) setProp(pm[1].trim());
    // Validate and re-group by trade
    setRooms(validateQuote(p));
    setMode("edit");
  };

  /* ── Parse button handler ── */
  const doParse = () => {
    if (!text.trim()) return;
    doAiParse(text, pdfFile);
  };

  /* ── File upload ── */
  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    // Clear the input so picking the SAME file again (after a failed try) still
    // fires onChange — otherwise the second attempt does nothing at all.
    e.target.value = "";
    if (!f) return;
    setParsing(true);
    setParseStatus("Reading file...");
    try {
      if (await isPdfFile(f)) {
        setPdfFile(f);
        setParseStatus(`Reading PDF (${(f.size / 1024 / 1024).toFixed(1)}MB)...`);
        const t = await readPdf(f);
        if (!t.trim()) {
          // A scanned or image-only report has no text layer. The AI reads the
          // rendered pages, so run it on those instead of stopping on a toast.
          useStore.getState().showToast("No text in this PDF — reading the pages as images", "info");
          setMode("paste");
          setParsing(false);
          setParseStatus("");
          setTimeout(() => doAiParse("Analyze these report pages and quote all repairs needed.", f), 100);
          return;
        }
        setText(t);
        // Auto-parse with AI immediately
        setMode("paste");
        setParsing(false);
        setParseStatus("");
        setTimeout(() => doAiParse(t, f), 100);
      } else {
        setPdfFile(null);
        const t = await f.text();
        setText(t);
        setParsing(false);
        setParseStatus("");
        setMode("paste");
      }
    } catch (err) {
      console.error("File read error:", err);
      useStore.getState().showToast("Error reading file: " + (err instanceof Error ? err.message : "unknown"), "error");
      setParsing(false);
      setParseStatus("");
      setMode("paste");
    }
  };

  /* ── customWorkOrder sync ──
     A `customWorkOrder` (loaded from the prior save, or started by a Guide-tab
     edit) shadows guide.steps in the Guide tab and is what saveJob writes to
     `rooms.workOrder` — the list WorkVision's Tasks tab and the Jobs
     work-order screen show. It used to be a detached copy: only NEW lines were
     appended (by text key), so editing a line's text/hours/notes/condition in
     the Quote tab, or deleting it, never reached the work order (and an AI
     Assist rewrite of a line's text appended a duplicate task). Every task is
     now linked to its quote line by id and re-synced whenever the quote or the
     work order changes — see src/lib/work-order-sync.ts for the merge rules.
     null = "use guide.steps", which is already derived live from rooms. */
  // customWorkOrder is a dep (not just rooms) so a work order freshly started
  // from guide.steps gets its sync baseline right away — otherwise the NEXT
  // quote edit would only set the baseline and never reach the task. Settles
  // in one pass: syncWorkOrder returns null when nothing changed, and
  // returning `curr` lets React bail out.
  useEffect(() => {
    setCustomWorkOrder((curr) => {
      if (curr === null) return null;
      return syncWorkOrder(curr, rooms, woKnownIdsRef.current) ?? curr;
    });
  }, [rooms, customWorkOrder]);

  /* ── Add item ── */
  const addItem = () => {
    // Surface a toast instead of silently bailing — Bernard hit "the form
    // does nothing when I click Add Item" because Trade or Item was empty
    // and the prior return-without-feedback hid the reason.
    if (!nr) {
      useStore.getState().showToast("Pick a trade category", "warning");
      return;
    }
    if (!nd.trim()) {
      useStore.getState().showToast("Describe the item", "warning");
      return;
    }
    // Build "Area — Item" detail when an area is provided, mirroring the
    // AI-output convention ("Bedroom 1 — Caulk and paint baseboards").
    // Without this, manually-added items showed up as bare "Caulk and
    // paint baseboards" with no room context anywhere in the quote.
    const areaPrefix = na.trim();
    const itemText = nd.trim();
    const detail = areaPrefix ? `${areaPrefix} — ${itemText}` : itemText;
    // Default the comment to the item description when the user leaves the
    // optional Description blank. The prior default of "Per scope" caused
    // validateQuote's (room|comment) dedup to collapse multiple manual
    // items in the same trade — they all hashed to "<trade>|per scope" and
    // every item past the first got dropped on reload.
    const comment = nc.trim() || itemText;
    const it: RoomItem = {
      id: crypto.randomUUID().slice(0, 8),
      detail,
      condition: ncn,
      comment,
      laborHrs: parseFloat(nh) || 1,
      materials: [{ n: "Materials", c: parseFloat(nm) || 0 }],
      // Sticky flag — validateQuote's classifier (and the deterministic
      // override pass) MUST leave this item in the user-picked trade
      // bucket. Without this, "Laminate countertop" lands in Flooring
      // because the keyword scorer sees "laminate" → Flooring +11
      // even though the user explicitly chose Carpentry.
      userClassified: true,
      // Options on: new work goes in the picked option(s) — never silently
      // into all three (the old "no tiers = every option" default).
      ...(tieredQuote ? { tiers: addTiers } : {}),
    };
    const sqftNum = parseFloat(nsq);
    if (!Number.isNaN(sqftNum) && sqftNum > 0) it.sqft = sqftNum;
    const ex = rooms.find((r) => r.name === nr);
    const merged = ex
      ? rooms.map((r) =>
          r.name === nr ? { ...r, items: [...r.items, it] } : r
        )
      : [...rooms, { name: nr, items: [it] }];
    // Run validateQuote so manual additions go through the same dedup
    // pipeline as the AI flows. skipCaps because the existing items in
    // `merged` are already user-reviewed and re-capping would scale
    // their materials down (the materials-edit-not-saving bug). The
    // newly-added item is freshly minted by the user — they typed the
    // numbers, no need to second-guess them.
    const newRooms = validateQuote(merged, { skipCaps: true });
    // The work-order sync effect gives this new line a task automatically.
    setRooms(newRooms);
    // Track custom material for AI learning. Tag with the property's ZIP so
    // future quotes in the same area weight these prices over out-of-region.
    db.post("price_corrections", {
      item_name: itemText,
      original_hours: 0,
      corrected_hours: parseFloat(nh) || 1,
      original_mat_cost: 0,
      corrected_mat_cost: parseFloat(nm) || 0,
      material_name: "Custom item",
      trade: nr,
      zip: extractZip(prop),
    });
    setNa("");
    setNd("");
    setNc("");
    setNh("1");
    setNm("20");
    setNsq("");
    setNcn("-");
    useStore.getState().showToast(`Added: ${detail}`, "success");
    if (mode !== "edit") setMode("edit");
  };

  /* ── Scope check ── */
  // What the rules say about each line. Lines a rule added never trigger rules,
  // and a once-per-job rule shows on the first line it matches.
  const scopeView = useMemo(() => {
    if (!scopeRules.length) return [] as { room: string; item: RoomItem; ev: LineScope }[];
    const skipOnce = new Set<string>();
    const out: { room: string; item: RoomItem; ev: LineScope }[] = [];
    for (const r of rooms) {
      for (const it of r.items) {
        if (it.scope?.from) continue;
        for (const id of it.scope?.dismissed || []) skipOnce.add(id);
        const ev = evaluateLine(scopeRules, it.detail || "", it.scope, { skipOnce });
        if (!ev.questions.length && !ev.suggestions.length && !ev.warnings.length) continue;
        out.push({ room: r.name, item: it, ev });
        for (const q of ev.questions) { if (q.ruleId) skipOnce.add(q.ruleId); }
        for (const s of [...ev.suggestions, ...ev.warnings]) skipOnce.add(s.id);
      }
    }
    return out;
  }, [rooms, scopeRules]);

  const patchScope = (itemId: string, fn: (s: ScopeState) => ScopeState, everyLine = false) =>
    setRooms((cur) => cur.map((r) => ({
      ...r,
      items: r.items.map((it) => (everyLine || it.id === itemId ? { ...it, scope: fn(it.scope || {}) } : it)),
    })));
  // A yes/no that no rule asks for (e.g. "built before 1978?") describes the
  // house, so it answers every line, and so does a once-per-job question (it is
  // shown on one line only, so the others would never get an answer); a rule's
  // own per-line question answers just its line.
  const answerScope = (itemId: string, key: string, value: string, ruleId: string | null) => {
    const jobWide = ruleId === null || scopeRules.some((r) => r.id === ruleId && r.qty_basis === "once_per_job");
    patchScope(itemId, (s) => ({ ...s, answers: { ...s.answers, [key]: value } }), jobWide);
  };
  const skipScope = (itemId: string, ruleId: string) =>
    patchScope(itemId, (s) => ({ ...s, dismissed: [...(s.dismissed || []), ruleId] }));
  // "Not needed" — the line isn't what the rules think (no door is being
  // replaced): dismiss every rule on it at once.
  const skipAllScope = (item: RoomItem) => {
    const ids = matchingRuleIds(scopeRules, item.detail || "");
    patchScope(item.id, (s) => ({ ...s, dismissed: [...new Set([...(s.dismissed || []), ...ids])] }));
  };
  const addScopeLine = (roomName: string, trigger: RoomItem, rule: ScopeRule) => {
    const taken = new Set(rooms.flatMap((r) => r.items.map((x) => (x.detail || "").toLowerCase().replace(/\s+/g, " ").trim())));
    const detail = uniqueSuggestionDetail(rule, trigger.detail || "", taken);
    const newId = crypto.randomUUID().slice(0, 8);
    const it: RoomItem = {
      id: newId,
      detail,
      condition: "-",
      comment: detail,
      laborHrs: rule.labor_hours,
      // Cost is unknown until the shelf price is typed in — the hint names what to price.
      materials: [{ n: rule.mat_hint ? rule.mat_hint.charAt(0).toUpperCase() + rule.mat_hint.slice(1) : "Materials", c: 0 }],
      userClassified: true,
      scope: { from: rule.id },
      // Same options as the line it goes with (no tiers = every option).
      ...(trigger.tiers ? { tiers: [...trigger.tiers] } : {}),
    };
    const merged = rooms.map((r) =>
      r.name === roomName
        ? { ...r, items: [...r.items.map((x) => (x.id === trigger.id ? { ...x, scope: { ...x.scope, added: [...(x.scope?.added || []), rule.id] } } : x)), it] }
        : r
    );
    const next = validateQuote(merged, { skipCaps: true });
    if (!next.some((r) => r.items.some((x) => x.id === newId))) {
      useStore.getState().showToast("That line is already on the quote", "info");
      return;
    }
    setRooms(next);
    useStore.getState().showToast(`Added: ${detail}${rule.mat_hint ? " — price the materials" : ""}`, "success");
  };

  /* ── Item ops ── */
  const rmItem = (rn: string, id: string) => {
    if (!id) {
      console.warn("rmItem called without an item id — refusing to delete");
      return;
    }
    setRooms(
      rooms
        .map((r) =>
          r.name === rn ? { ...r, items: r.items.filter((i) => i.id !== id) } : r
        )
        .filter((r) => r.items.length > 0)
    );
  };

  // Keep a live ref to rooms so the on-blur edit logger reads the FINAL value,
  // not a stale render closure.
  const roomsRef = useRef(rooms);
  roomsRef.current = rooms;
  // Snapshot of an item's pre-edit hrs+materials, captured when editing starts
  // (hrs focus / material modal open). We log ONE clean AI-vs-final correction
  // on finalize instead of the old per-keystroke chain — which logged every
  // mid-typing value (e.g. $55→$7→$75) and polluted the self-learning data.
  const editOrigRef = useRef<Record<string, { hrs: number; mat: number }>>({});
  const snapItemEdit = (rn: string, id: string) => {
    if (id in editOrigRef.current) return;
    const item = roomsRef.current.find((r) => r.name === rn)?.items.find((i) => i.id === id);
    if (item) editOrigRef.current[id] = { hrs: item.laborHrs, mat: item.materials.reduce((s, m) => s + (m.c || 0), 0) };
  };
  const logItemEdit = (rn: string, id: string) => {
    const snap = editOrigRef.current[id];
    if (!snap) return;
    delete editOrigRef.current[id];
    const item = roomsRef.current.find((r) => r.name === rn)?.items.find((i) => i.id === id);
    if (!item) return;
    const finalHrs = item.laborHrs;
    const finalMat = item.materials.reduce((s, m) => s + (m.c || 0), 0);
    if (Math.abs(finalHrs - snap.hrs) > 0.1 || Math.abs(finalMat - snap.mat) > 2) {
      logCorrection({
        item_name: item.detail,
        original_hours: snap.hrs,
        corrected_hours: finalHrs,
        original_mat_cost: snap.mat,
        corrected_mat_cost: finalMat,
        material_name: item.materials.map((m) => m.n).join(", "),
        trade: rn,
        zip: extractZip(prop),
        source: "quote_edit",
        job_id: editingId || null,
      });
    }
  };

  const upItem = (rn: string, id: string, field: string, value: number | string | string[] | Material[]) => {
    // Defensive: refuse to operate on a falsy id. Without this guard,
    // `i.id === id` would match every other item whose id is also undefined
    // and the patch would update them all at once.
    if (!id) {
      console.warn("upItem called without an item id — refusing to update");
      return;
    }
    setRooms(
      rooms.map((r) =>
        r.name === rn
          ? {
              ...r,
              items: r.items.map((i) =>
                i.id === id ? { ...i, [field]: value } : i
              ),
            }
          : r
      )
    );
  };

  const toggleWorker = (id: string) =>
    setWorkers((w) =>
      w.includes(id) ? w.filter((x) => x !== id) : [...w, id]
    );

  /* ── Calculations ── (org settings: priceIn above — markupPct, taxPct, tripFee, minHrs, tax mode) */
  // Sales tax paid buying the materials — built into material cost.
  const jobZip = extractZip(prop);
  const zipTax = materialTaxFor(org, jobZip);
  const materialTaxPct = quoteMatTax && quoteMatTax.zip === jobZip ? quoteMatTax.pct : zipTax.rate;
  // A ZIP we don't have a rate for yet → look it up once (cached on the org
  // for everyone). Until it lands, the org default prices the materials.
  const taxLookupRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!jobZip || zipTax.known || taxLookupRef.current.has(jobZip)) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    taxLookupRef.current.add(jobZip);
    const t = setTimeout(async () => {
      try {
        const res = await apiFetch("/api/tax/material-rate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ zip: jobZip }),
        });
        const d = await res.json().catch(() => null);
        const cur = useStore.getState().org;
        if (!res.ok || !d || typeof d.rate !== "number" || !cur) return;
        const map = { ...zipTaxMap(cur.material_tax_by_zip), [jobZip]: { rate: d.rate, place: d.place, source: d.source || "lookup", at: d.at || new Date().toISOString() } };
        useStore.getState().setOrg({ ...cur, material_tax_by_zip: map });
      } catch { /* best effort — the default rate stays */ }
    }, 800); // let a ZIP being typed settle
    return () => { clearTimeout(t); taxLookupRef.current.delete(jobZip); };
  }, [jobZip, zipTax.known]);
  const all = rooms.flatMap((r) =>
    r.items.map((i) => {
      const roomRate = getRateForRoom(r.name);
      const cost = calculateCost(i, roomRate);
      // Materials: + the sales tax paid buying them, then markup
      cost.mc = billedMaterial(cost.mc, { materialTaxPct, markupPct });
      cost.tot = Math.round((cost.lc + cost.mc) * 100) / 100;
      return { room: r.name, ...i, ...cost };
    })
  );
  // F5 — T&M / assessment-first lines. These roll into the headline
  // subtotal (the assessment visit itself is billable), but we surface
  // the count + dollar amount on its own stat tile so the owner sees
  // how much of the headline is "inspect first, then quote real scope"
  // vs fixed-bid. Important when the customer asks "is this the final
  // price?" — anything T&M is explicitly not.
  // (The Optional/upsell bucket from F4 was removed at Bernard's
  // request — every emitted line now rolls into the base subtotal.
  // The RoomItem.optional field stays on the schema for backward
  // compat but is no longer filtered or surfaced anywhere.)
  const tnmItems = all.filter((i) => i.tnm);
  const tnmSubtotal = Math.round(tnmItems.reduce((s, i) => s + i.tot, 0) * 100) / 100;
  const subtotalRaw = all.reduce((s, i) => s + i.tot, 0);
  const tlRaw = all.reduce((s, i) => s + i.lc, 0);
  const tm = all.reduce((s, i) => s + i.mc, 0);
  const thRaw = all.reduce((s, i) => s + i.laborHrs, 0);

  // Minimum-labor-hours floor (effectiveMinHrs, from pricingInputs): per-quote
  // override → org default → 1 hour; an override of 0 is honored (turns the
  // minimum off for this quote). It only kicks in for quotes that already
  // have some labor — a pure materials quote (0 hrs) never gets a phantom
  // service charge. Tax mode (effectiveTaxMode): per-quote → org → "total".
  // Min-labor floor → trip fee → discount → tax → grand total, all via the
  // SHARED cascade (lib/pricing.ts) — the same function export-pdf prints
  // with, so the preview and the signed PDF can't drift. LINE mode
  // (subtotalRaw passed) keeps this byte-identical to the historical
  // inline math. `tl`/`th` are the billed values; `tlRaw`/`thRaw` stay
  // around for the "actually X hr of work" debug line.
  const cascade = priceCascade({
    laborRaw: tlRaw,
    hoursRaw: thRaw,
    materials: tm,
    rate,
    minHrs: effectiveMinHrs,
    tripFee,
    discount,
    taxPct,
    taxMode: effectiveTaxMode,
    subtotalRaw,
  });
  const { minApplies, tl, th, subtotal, discountAmount, taxAmount } = cascade;
  const gt = cascade.grandTotal;

  // ── Good-Better-Best tier totals (only meaningful when tieredQuote is on).
  // Each option re-runs the SAME pricing cascade (min-labor floor, discount,
  // tax) over ITS OWN item set — membership-based, so options can be mutually
  // exclusive (a line can be in any combination of options). itemInTier falls
  // back to the legacy cumulative reading for pre-membership quotes.
  const itemsForTier = (t: TierKey) => all.filter((i) => itemInTier(i, t));
  const tierBreakdownOf = (items: typeof all): { total: number; labor: number; mat: number; hrs: number } => {
    const c = priceCascade({
      laborRaw: items.reduce((s, i) => s + i.lc, 0),
      hoursRaw: items.reduce((s, i) => s + i.laborHrs, 0),
      materials: items.reduce((s, i) => s + i.mc, 0),
      rate,
      minHrs: effectiveMinHrs,
      tripFee,
      discount,
      taxPct,
      taxMode: effectiveTaxMode,
      subtotalRaw: items.reduce((s, i) => s + i.tot, 0),
    });
    return { total: c.grandTotal, labor: c.tl, mat: Math.round(items.reduce((s, i) => s + i.mc, 0) * 100) / 100, hrs: c.th };
  };
  const tierBk = {
    base: tierBreakdownOf(itemsForTier("base")),
    better: tierBreakdownOf(itemsForTier("better")),
    best: tierBreakdownOf(itemsForTier("best")),
  };
  const tierTotals = { base: tierBk.base.total, better: tierBk.better.total, best: tierBk.best.total };
  // Per-tier labor/materials/hours — stored so /api/jobs/approve can lock the
  // job's total_labor/total_mat/total_hrs to the accepted option (matches the
  // gt/tl/tm/th the non-tiered save writes).
  const tierBreakdown = {
    base: { labor: tierBk.base.labor, mat: tierBk.base.mat, hrs: tierBk.base.hrs },
    better: { labor: tierBk.better.labor, mat: tierBk.better.mat, hrs: tierBk.better.hrs },
    best: { labor: tierBk.best.labor, mat: tierBk.best.mat, hrs: tierBk.best.hrs },
  };
  // For a tiered quote there's no single "all items" total — summing every
  // line double-counts mutually-exclusive options. The headline (total card,
  // saved job.total, send message) uses the most expensive real option.
  const headlineKey: TierKey = tieredQuote
    ? (["base", "better", "best"] as TierKey[]).reduce((a, b) => (tierTotals[b] > tierTotals[a] ? b : a), "base" as TierKey)
    : "best";
  const headlineTotal = tieredQuote ? tierTotals[headlineKey] : gt;
  const headlineLabor = tieredQuote ? tierBreakdown[headlineKey].labor : tl;
  const headlineMat = tieredQuote ? tierBreakdown[headlineKey].mat : tm;
  const headlineHrs = tieredQuote ? tierBreakdown[headlineKey].hrs : th;
  // "Has the user differentiated the options yet" — true once any line is not
  // in all three options (membership set ≠ {base,better,best}).
  const hasSplit = all.some((i) => itemTiers(i).length !== 3);

  const issues = classify(rooms);
  const guide = makeGuide(rooms);

  // (The job's trade label — dominantTrade(rooms) — lives in lib/quote-save.ts.)

  /* ── Save job ── */
  // stay: keep the editor open on the saved job (Save & Send) instead of
  // resetting and jumping to Jobs. Resolves the saved job's id, or null if it
  // didn't save (validation, cancelled confirm, or a failed write).
  const saveJob = async (opts?: { stay?: boolean }): Promise<string | null> => {
    if (!prop.trim()) {
      useStore.getState().showToast("Enter a property address", "warning");
      return null;
    }
    if (rooms.length === 0) {
      useStore.getState().showToast("Add at least one item to the quote", "warning");
      return null;
    }
    if (gt <= 0 && !await useStore.getState().showConfirm("Empty Quote", "Quote total is $0. Save anyway?")) {
      return null;
    }
    // Everything that gets saved — the work-order merge (field checkmarks survive
    // an edit), the photo merge, the prior blob's keys we don't own, the status
    // rule and the accepted-option lock — is assembled by the pure
    // lib/quote-save.ts, where each rule is tested on its own. This function
    // feeds it, then writes the result and resets the screen.
    const prevJob = editingId ? useStore.getState().jobs.find((j) => j.id === editingId) : null;
    // Re-sync the work order against the quote right here too (not only via the
    // effect) so a save fired in the same tick as a line edit can't write a work
    // order that's one edit behind.
    const syncedSteps = customWorkOrder
      ? (syncWorkOrder(customWorkOrder, rooms, woKnownIdsRef.current) ?? customWorkOrder)
      : guide.steps;
    const { row: jobData, droppedDone } = buildQuoteSave({
      rooms,
      workers: workers.map((wid) => ({ id: wid, name: profiles.find((x) => x.id === wid)?.name || "" })),
      jobPhotos,
      steps: syncedSteps,
      guideSteps: guide.steps,
      guideState: { customTools, customShop, checkedTools, checkedShop, removedGuideShop },
      settings: { discount, laborRate, minLaborHours, taxMode, materialTaxPct, materialTaxZip: jobZip, tieredQuote, tierNames, crewSize, estDays: aiEstDays },
      pricing: { gt, tl, tm, th, tierTotals, tierBreakdown, headlineKey, hasSplit },
      inspection: inspectionData,
      prev: prevJob ? { blob: jobBlob(prevJob), status: prevJob.status } : null,
      identity: {
        editing: !!editingId, property: prop, client, customerId, addressId,
        createdBy: user.name, trade: dominantTrade(rooms),
        today: new Date().toISOString().split("T")[0],
      },
    });
    // A save that drops finished work-order tasks is worth a console trace.
    if (droppedDone.length) {
      console.warn(
        `[QuoteForge.saveJob] Dropping ${droppedDone.length} previously-checked work-order item(s) that are no longer in the quote:`,
        droppedDone,
      );
    }

    // A failed write must NOT fall through to the reset below — that clears
    // the draft and the editor, and an unsaved (often AI-built) quote is gone
    // for good. db already toasted why; stay put so Save can be tapped again.
    let savedId: string | null = editingId;
    if (editingId) {
      if (!await db.patch("jobs", editingId, jobData)) return null;
    } else {
      const rows = await db.post<{ id: string }>("jobs", jobData);
      if (rows === null) return null;
      savedId = rows[0]?.id ?? null;
    }
    // Put the saved job in the store right away, so Jobs shows it even if
    // the refresh below comes back late or a table read blips.
    if (savedId) {
      const st = useStore.getState();
      const prev = st.jobs.find((j) => j.id === savedId);
      const merged = { ...(prev || { id: savedId, org_id: user.org_id, created_at: new Date().toISOString() }), ...jobData } as Job;
      useStore.setState({ jobs: prev ? st.jobs.map((j) => (j.id === savedId ? merged : j)) : [merged, ...st.jobs] });
    }
    useStore.getState().showToast(t(editingId ? "qf.jobUpdated" : "qf.jobCreated") + ": " + prop, "success");

    // Saved: the screen IS the saved version now — drop its edit draft and
    // make this the new baseline.
    if (savedId) {
      dropEditDraft(savedId);
      leadSeedRef.current = null;
      setEditDraftOffer(null);
      editBaselineRef.current = { id: savedId, snap: editSnapshot() };
      editLoadedHashRef.current = hashText(jobData.rooms);
    }
    if (opts?.stay && savedId) {
      // Saved — now it's an existing quote; keep editing it in place.
      clearDraft();
      setEditingId(savedId);
      await loadAll();
      return savedId;
    }

    savingRef.current = true;
    clearDraft();
    await loadAll();
    setMode(null);
    setRooms([]);
    setText("");
    setProp("");
    setClient("");
    setCustomerId(undefined);
    setAddressId(undefined);
    setWorkers([]);
    setCustomWorkOrder(null);
    setEditingId(null);
    // Clear inspection-driven state so the next quote starts clean and
    // photos/inspection don't bleed forward into an unrelated session.
    setJobPhotos([]);
    setInspectionData(null);
    // Clear Guide-tab state too — without this, a previous job's custom
    // tools / shop items would bleed into the next quote opened.
    setCustomTools([]);
    setCustomShop([]);
    setCheckedTools([]);
    setCheckedShop([]);
    setDiscount(null);
    setLaborRate(null);
    setMinLaborHours(null);
    setTieredQuote(false);
    setTierNames({ better: "Better", best: "Best" }); setCrewSize(null); setAiEstDays(null);
    savingRef.current = false;
    // Land on the job just saved (Jobs opens its detail from this intent).
    if (savedId) setNavIntent({ page: "jobs", jobId: savedId });
    setPage("jobs");
    return savedId;
  };

  /* ══════════════════════════════════════════
     START SCREEN
     ══════════════════════════════════════════ */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const printInspection = (insp: any, inspData: any, roomCount: number, _findingsCount: number) => {
    const esc = (s: string) =>
      String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const orgN = org?.name || "Service Provider";
    const blob = inspData?.inspection || {};
    // The date the unit was WALKED, not the day the PDF was printed — a
    // move-out report is evidence of condition on that day.
    const walkedRaw = blob.inspected_at || insp.job_date || insp.created_at;
    const walked = walkedRaw ? new Date(String(walkedRaw).length === 10 ? walkedRaw + "T12:00:00" : walkedRaw) : new Date();
    const today = (isNaN(walked.getTime()) ? new Date() : walked).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    const reportNum = "INS-" + String(insp.id ?? "").slice(0, 6).toUpperCase();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rms: any[] = blob.rooms || [];
    const TYPE_LABEL: Record<string, string> = {
      "move-out": "Move-Out / Vacant Turn", "move-in": "Move-In Condition", flooring: "Flooring Survey",
      painting: "Painting Survey", yard: "Yard / Grounds", fence: "Fence Inspection", initial: "Initial Walkthrough",
    };
    // Fence walks read the same S/F/P/D codes as Good / Worn / Repair / Replace.
    const isFence = blob.type === "fence";
    const typeLabel = TYPE_LABEL[blob.type] || "Property Inspection";
    const inspector = blob.inspected_by || insp.created_by || "";

    const COND: Record<string, { c: string; l: string; rank: number }> = {
      D: { c: "#C00000", l: isFence ? "REPLACE" : "DAMAGED", rank: 0 },
      P: { c: "#e07000", l: isFence ? "REPAIR" : "POOR", rank: 1 },
      F: { c: "#b38f00", l: isFence ? "WORN" : "FAIR", rank: 2 },
      S: { c: "#00a352", l: isFence ? "GOOD" : "OK", rank: 3 },
    };
    const cond = (c: string) => COND[String(c || "S").toUpperCase()] || COND.S;
    const chip = (c: string) => {
      const k = cond(c);
      return `<span style="font-family:Oswald,sans-serif;font-size:10px;padding:2px 8px;border-radius:3px;background:${k.c}1f;color:${k.c};letter-spacing:.06em;white-space:nowrap">${k.l}</span>`;
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const noteOf = (it: any) => String(it.comment ?? it.notes ?? "").trim();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const photosOf = (it: any, size: number, max: number) => (it.photos?.length
      ? it.photos.slice(0, max).map((u: string) => `<img src="${esc(u)}" alt="" style="width:${size}px;height:${size}px;object-fit:cover;border-radius:4px;margin:0 3px 3px 0;border:1px solid #ddd" />`).join("")
        + (it.photos.length > max ? `<span class="dim" style="font-size:10px">+${it.photos.length - max}</span>` : "")
      : "");
    // Work needed = anything rated below OK, or an OK item with a note
    // ("OK — needs cleaning") — the same rule the AI quote uses.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const needsWork = (it: any) => cond(it.condition).rank < 3 || !!noteOf(it);

    // ── Punch list: every finding, worst first, grouped by area, with a
    // checkbox so the crew can work the turn straight off this page.
    const counts = { D: 0, P: 0, F: 0, N: 0 };
    let punchHtml = "";
    rms.forEach((r) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const found = (r.items || []).filter(needsWork).sort((a: any, b: any) => cond(a.condition).rank - cond(b.condition).rank);
      if (!found.length) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows = found.map((it: any) => {
        const k = String(it.condition || "S").toUpperCase();
        if (k === "D" || k === "P" || k === "F") counts[k]++; else counts.N++;
        return `<tr style="page-break-inside:avoid"><td style="width:22px;text-align:center"><span style="display:inline-block;width:13px;height:13px;border:1.5px solid #555;border-radius:2px"></span></td><td><b>${esc(it.name)}</b>${noteOf(it) ? `<div style="font-size:11.5px;color:#333;margin-top:2px">${esc(noteOf(it))}</div>` : ""}</td><td class="r" style="width:80px">${k === "D" || k === "P" || k === "F" ? chip(k) : `<span style="font-family:Oswald,sans-serif;font-size:10px;padding:2px 8px;border-radius:3px;background:#2E75B61f;color:#2E75B6;letter-spacing:.06em">NOTED</span>`}</td><td style="width:190px">${photosOf(it, 56, 3)}</td></tr>`;
      }).join("");
      punchHtml += `<h3 style="margin-top:12px">${esc(r.name)} <span style="font-family:Source Sans 3,sans-serif;font-size:11px;color:#888;font-weight:400">· ${found.length} item${found.length > 1 ? "s" : ""}</span></h3>
<table><thead><tr><th></th><th>Work needed</th><th class="r">Condition</th><th>Photos</th></tr></thead><tbody>${rows}</tbody></table>`;
    });
    const totalFindings = counts.D + counts.P + counts.F + counts.N;

    // ── Full condition record: every item checked, OK ones included — the
    // move-out evidence (deposit disputes) and the baseline for next time.
    let areasHtml = "";
    let totalSqft = 0;
    rms.forEach((r) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows = (r.items || []).map((it: any) => {
        const ok = !needsWork(it);
        return `<tr style="page-break-inside:avoid${ok ? ";color:#666" : ""}"><td>${ok ? esc(it.name) : `<b>${esc(it.name)}</b>`}</td><td class="r" style="width:80px">${chip(it.condition)}</td><td class="dim">${esc(noteOf(it))}</td><td style="width:130px">${photosOf(it, 40, 3)}</td></tr>`;
      }).join("");
      // Room dimensions inline next to the heading, so the PDF doubles as a
      // takeoff sheet for flooring/painting.
      const sqft = r.sqft && r.sqft > 0 ? r.sqft : 0;
      const w = r.width && r.width > 0 ? r.width : 0;
      const l = r.length && r.length > 0 ? r.length : 0;
      if (sqft > 0) totalSqft += sqft;
      const dimsLabel = isFence
        ? (l > 0 ? `<span style="font-family:Oswald,sans-serif;font-size:11px;color:#2E75B6;font-weight:400;letter-spacing:.04em;margin-left:8px">${l} ft run${w ? ` × ${w} ft tall · ${Math.round(l * w).toLocaleString()} sq ft face` : ""}</span>` : "")
        : sqft > 0
        ? `<span style="font-family:Oswald,sans-serif;font-size:11px;color:#2E75B6;font-weight:400;letter-spacing:.04em;margin-left:8px">${w && l ? `${w}&prime; × ${l}&prime; · ` : ""}${sqft.toLocaleString()} sqft</span>`
        : "";
      areasHtml += `<h3>${esc(r.name)}${dimsLabel}</h3>
<table>
  <thead><tr><th>Item</th><th class="r">Condition</th><th>Notes</th><th>Photos</th></tr></thead>
  <tbody>${rows}</tbody>
</table>`;
    });

    const stat = (n: number, label: string, color: string) => `<div class="box" style="flex:1;text-align:center;padding:12px 6px">
    <div style="font-family:Oswald,sans-serif;font-size:26px;font-weight:700;color:${color};line-height:1">${n}</div>
    <div class="label" style="margin-top:5px">${label}</div>
  </div>`;
    const body = `
<section class="grid-2" style="margin-bottom:12px">
  <div class="box"><div class="label">Property</div><div class="value">${esc(insp.property || "—")}</div></div>
  <div class="box"><div class="label">Client</div><div class="value">${esc(insp.client || "—")}</div></div>
  <div class="box"><div class="label">Inspection</div><div class="value">${esc(typeLabel)}</div></div>
  <div class="box"><div class="label">Inspected</div><div class="value">${esc(today)}${inspector ? ` · ${esc(inspector)}` : ""}</div></div>
</section>

<section style="display:flex;gap:8px;margin-bottom:16px">
  ${stat(roomCount, "Areas", "#2E75B6")}
  ${stat(counts.D, isFence ? "Replace" : "Damaged", COND.D.c)}
  ${stat(counts.P, isFence ? "Repair" : "Poor", COND.P.c)}
  ${stat(counts.F + counts.N, isFence ? "Worn / Noted" : "Fair / Noted", COND.F.c)}
  ${isFence
    ? (rms.reduce((t: number, r: { length?: number }) => t + (Number(r.length) || 0), 0) > 0 ? stat(rms.reduce((t: number, r: { length?: number }) => t + (Number(r.length) || 0), 0), "Linear Ft", "#00a352") : "")
    : totalSqft > 0 ? stat(totalSqft, "Total Sqft", "#00a352") : ""}
</section>

<h2>Work Needed — Punch List${totalFindings ? ` (${totalFindings})` : ""}</h2>
${punchHtml || '<div class="dim" style="text-align:center;padding:14px">No work needed — every item checked OK.</div>'}

<h2 style="page-break-before:always">Full Condition Record</h2>
<div class="dim" style="font-size:11px;margin:-4px 0 8px">Every item checked, by area. Items in bold need work; grey items were checked and found OK.</div>
${areasHtml || '<div class="dim" style="text-align:center;padding:18px">No areas recorded.</div>'}

<section class="grid-2" style="margin-top:22px;page-break-inside:avoid">
  <div style="border-top:1px solid #999;padding-top:4px;font-size:11px;color:#555">Inspected by${inspector ? `: ${esc(inspector)}` : ""}</div>
  <div style="border-top:1px solid #999;padding-top:4px;font-size:11px;color:#555">Reviewed by / date</div>
</section>
`;

    const html = wrapPrint(
      {
        orgName: orgN,
        orgPhone: org?.phone,
        orgEmail: org?.email,
        orgAddress: org?.address,
        orgLicense: org?.license_num,
        orgLogo: org?.logo_url,
        accent: org?.brand_color,
        accent2: org?.brand_color_2,
        docTitle: "Inspection Report",
        docNumber: reportNum,
        docDate: today,
        docSubtitle: insp.property,
      },
      body,
    );
    if (!openPrint(html)) {
      useStore.getState().showToast("Allow popups to print inspection", "error");
    }
  };

  // ── Leaving a mode (the ← buttons AND the phone's back button) ──────────
  const exitQuick = () => {
    setMode(null); setQuickPhotos([]); setQuickDesc("");
    // Leaving a lead's Quick Quote: detach from the lead like a fresh
    // start, so the next quote doesn't patch the lead's row.
    if (editingId) {
      setEditingId(null); setProp(""); setClient("");
      setCustomerId(undefined); setAddressId(undefined); setJobPhotos([]);
    }
  };
  const exitBuilding = () => { setMode(null); setParsing(false); setParseStatus(""); setInspParseFailed(false); };
  const exitEditor = () => {
    // Leaving a service being edited returns to the service list.
    setMode(templateEdit ? "template" : null);
    setTemplateEdit(null);
    setRooms([]);
    setCustomWorkOrder(null);
    woKnownIdsRef.current = new Set();
    setJobPhotos([]);
    setInspectionData(null);
    setEditingId(null);
    setCustomTools([]);
    setCustomShop([]);
    setCheckedTools([]);
    setCheckedShop([]);
    setDiscount(null);
    setLaborRate(null);
    setMinLaborHours(null);
    setTieredQuote(false);
    setTierNames({ better: "Better", best: "Best" }); setCrewSize(null); setAiEstDays(null);
  };
  // Inspector registers its own "leave the walkthrough" (keeps findings in the
  // Resume slot) so back from its room list behaves like its ← button.
  const inspectorExitRef = useRef<(() => void) | null>(null);
  // Phone back inside a mode = that screen's ← (Android PWA). It used to skip
  // every mode and leave QuoteForge. Unsaved work is still kept by the drafts
  // (c_qf_draft / c_qf_edit), exactly as with the ← buttons.
  const [backRearm, setBackRearm] = useState(false);
  useEffect(() => { if (backRearm) setBackRearm(false); }, [backRearm]);
  useBackLayer(!!mode && !backRearm, () => {
    // Mid AI build: leaving now would let the finishing parse land on a
    // reset screen — stay put (re-arm the layer so back keeps working).
    if (parsing) {
      useStore.getState().showToast(t("qf.backWhileBuilding"), "info");
      setBackRearm(true);
      return;
    }
    if (mode === "inspect" || mode === "inspect-edit") {
      if (inspectorExitRef.current) inspectorExitRef.current();
      else { setEditingInspection(null); setMode(null); }
      return;
    }
    if (mode === "quick" && qqWalk) { setQqWalk(null); setBackRearm(true); return; }
    if (mode === "quick") return exitQuick();
    if (inspParseFailed && rooms.length === 0) return exitBuilding();
    if (templateEdit) return exitEditor();
    if (mode === "edit" || (mode === "manual" && rooms.length > 0)) return exitEditor();
    setMode(null); // paste · empty manual · template
  });

  // Shown while the editor is building / editing a service instead of a quote.
  const templateBanner = templateEdit && (
    <div className="cd mb" style={{ border: "1px solid rgba(157,78,221,.55)", background: "rgba(157,78,221,.08)", display: "flex", alignItems: "center", gap: 10 }}>
      <Icon name="briefcase" size={18} color="var(--color-violet)" />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>{templateEdit.id ? `Editing service: ${templateEdit.name}` : "New service"}</div>
        <div className="dim" style={{ fontSize: 12 }}>Add the lines this service always needs, then save it to your list.</div>
      </div>
      {rooms.length > 0 && <button className="bb" onClick={openSaveTemplate} style={{ fontSize: 13, padding: "6px 12px", flexShrink: 0 }}>Save service</button>}
    </div>
  );

  if (!mode) {
    return (
      <div className="fi">
        {/* One-time Grizz tip — scoped to the hub only so it never floats over
            the editor / inspection / Voice Walk sub-screens (it's fixed-position). */}
        <Coachmark id="quote" text={<>Start here — tap <b>Quick Quote</b>, snap a couple photos, and I&apos;ll price the job for you.</>} />
        {/* Topbar — title + eyebrow */}
        <TopBar title="QuoteForge" icon="quote" color="#f5b400"
          right={<span style={{ fontSize: 12, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--color-dim)", fontWeight: 600 }}>New quote</span>} />
        {draftAvailable && (
          <div className="cd mb" style={{ display: "flex", alignItems: "center", gap: 10, border: "1px solid var(--color-primary)" }}>
            <Icon name="edit" size={18} color="var(--color-primary)" />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>Unsaved quote in progress</div>
              <div className="dim" style={{ fontSize: 12.5 }}>Pick up where you left off.</div>
            </div>
            <button className="bb" style={{ width: "auto", padding: "7px 14px", fontSize: 13 }} onClick={restoreDraft}>Resume</button>
            <button className="bo" style={{ width: "auto", padding: "7px 12px", fontSize: 13 }} onClick={clearDraft}>Discard</button>
          </div>
        )}
        {parsing && (
          <div className="cd mb">
            <AiLoadingDisplay status={parseStatus} />
          </div>
        )}

        {/* Quick Quote — gold glow */}
        <div
          onClick={() => setMode("quick")}
          style={{ display: "flex", alignItems: "center", gap: 13, padding: 17, borderRadius: 20, marginBottom: 12, cursor: "pointer", ...cGold.card }}
        >
          <div style={{ width: 50, height: 50, borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Icon name="quote" size={26} color={cGold.icon} strokeWidth={2} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: "Oswald", fontWeight: 600, fontSize: 18.5, letterSpacing: ".3px", color: cGold.text }}>QUICK QUOTE</div>
            <div style={{ fontSize: 13, color: cGold.sub }}>Describe it, add photos → AI prices it</div>
          </div>
          <span style={{ fontSize: 10.5, fontWeight: 700, padding: "3px 8px", borderRadius: 99, whiteSpace: "nowrap", ...cGold.tag }}>SMALL JOBS</span>
        </div>

        {/* Full Inspection — green glow. Every plan can run inspections; the
            cap controls included vs. overage (toast nudges, never blocks). */}
        <div
          onClick={async () => {
            const plan = org?.subscription_plan || org?.plan || "solo";
            if (!org?.id) { setMode("inspect"); return; }
            const usage = await getUsage(org.id, plan);
            if (usage.blocked) {
              useStore.getState().showToast(
                `You've used all ${usage.cap} included inspections this month — upgrade in Ops → Billing for a larger pool.`,
                "warning",
              );
            } else if (usage.warning) {
              useStore.getState().showToast(
                `${usage.remaining} inspection${usage.remaining === 1 ? "" : "s"} left this month`,
                "info",
              );
            }
            setMode("inspect");
          }}
          style={{ display: "flex", alignItems: "center", gap: 13, padding: 17, borderRadius: 20, marginBottom: 12, cursor: "pointer", ...cGreen.card }}
        >
          <div style={{ width: 50, height: 50, borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Icon name="search" size={26} color={cGreen.icon} strokeWidth={2} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: "Oswald", fontWeight: 600, fontSize: 18.5, letterSpacing: ".3px", color: cGreen.text }}>FULL INSPECTION</div>
            <div style={{ fontSize: 13, color: cGreen.sub }}>Area-by-area walkthrough · voice</div>
          </div>
          <span style={{ fontSize: 10.5, fontWeight: 700, padding: "3px 8px", borderRadius: 99, whiteSpace: "nowrap", ...cGreen.tag }}>MOST ACCURATE</span>
        </div>

        {/* Upload Report — blue glow */}
        <div
          onClick={() => fileRef.current?.click()}
          style={{ display: "flex", alignItems: "center", gap: 13, padding: 17, borderRadius: 20, marginBottom: 12, cursor: "pointer", ...cBlue.card }}
        >
          <div style={{ width: 50, height: 50, borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Icon name="doc" size={26} color={cBlue.icon} strokeWidth={2} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: "Oswald", fontWeight: 600, fontSize: 18.5, letterSpacing: ".3px", color: cBlue.text }}>UPLOAD REPORT</div>
            <div style={{ fontSize: 13, color: cBlue.sub }}>PDF inspection → AI analysis</div>
          </div>
          <span style={{ fontSize: 10.5, fontWeight: 700, padding: "3px 8px", borderRadius: 99, whiteSpace: "nowrap", ...cBlue.tag }}>PDF</span>
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.txt"
            style={{ display: "none" }}
            onChange={handleFile}
          />
        </div>

        {/* From Template — violet glow */}
        <div
          onClick={() => setMode("template")}
          style={{ display: "flex", alignItems: "center", gap: 13, padding: 17, borderRadius: 20, marginBottom: 12, cursor: "pointer", ...cViolet.card }}
        >
          <div style={{ width: 50, height: 50, borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Icon name="briefcase" size={26} color={cViolet.icon} strokeWidth={2} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: "Oswald", fontWeight: 600, fontSize: 18.5, letterSpacing: ".3px", color: cViolet.text }}>FROM TEMPLATE</div>
            <div style={{ fontSize: 13, color: cViolet.sub }}>{templates.length ? `Your services, ready to quote · ${templates.length}` : "Set up the services you offer"}</div>
          </div>
          <span style={{ fontSize: 10.5, fontWeight: 700, padding: "3px 8px", borderRadius: 99, whiteSpace: "nowrap", ...cViolet.tag }}>FAST</span>
        </div>

      <SavedInspections jobs={jobs} onQuote={handleInspectionComplete} onEdit={openInspectionEdit} onPrint={printInspection} onDelete={async (id) => { await db.del("jobs", id); loadAll(); }} />
    </div>
    );
  }

  /* ══════════════════════════════════════════
     FROM TEMPLATE — pick a saved service to seed a quote
     ══════════════════════════════════════════ */
  if (mode === "template")
    return (
      <div className="fi">
        <TopBar title="From Template" icon="briefcase" color={QF_HUE.violet} onBack={() => setMode(null)} />
        <p className="dim" style={{ fontSize: 12.5, margin: "-4px 2px 10px" }}>
          The services you offer. Tap one to start a quote — star the ones you use most, sort them into categories, and add more services from inside any quote.
        </p>
        <ServiceTemplates templates={templates} reload={reloadTemplates} onPick={seedFromTemplate} onEditLines={editTemplateLines} onNew={newService} />
      </div>
    );

  /* ══════════════════════════════════════════
     INSPECT MODE
     ══════════════════════════════════════════ */
  if (mode === "inspect")
    return (
      <Inspector
        darkMode={darkMode}
        onCancel={() => setMode(null)}
        onComplete={handleInspectionComplete}
        exitRef={inspectorExitRef}
      />
    );

  if (mode === "inspect-edit" && editingInspection)
    return (
      <Inspector
        darkMode={darkMode}
        onCancel={() => { setEditingInspection(null); setMode(null); }}
        onComplete={handleInspectionEditSave}
        editing={editingInspection}
        exitRef={inspectorExitRef}
      />
    );

  /* ══════════════════════════════════════════
     QUICK QUOTE MODE
     ══════════════════════════════════════════ */
  if (mode === "quick" && qqWalk === "walk")
    return (
      <VoiceWalk
        property={prop}
        client={client}
        rooms={["Walk & talk"]}
        singleRoom
        itemsForRoom={() => []}
        darkMode={darkMode}
        autoStart
        doneLabel="Add to quote"
        doneHint="Your words go into the description and your photos into Photos — check them, then Generate."
        onCancel={() => setQqWalk(null)}
        onComplete={(r) => { void finishQuickWalk(r); }}
      />
    );

  if (mode === "quick")
    return (
      <div className="fi">
        {/* Back is ignored mid-build: a running AI parse would still land on this screen. */}
        <TopBar title={t("qf.quickQuote")} icon="quote" color={QF_HUE.gold} onBack={() => { if (!parsing) exitQuick(); }} />

        {/* Property + Client */}
        <div className="cd mb">
          <CustomerPicker
            prop={prop}
            setProp={setProp}
            client={client}
            setClient={setClient}
            customerId={customerId}
            setCustomerId={setCustomerId}
            addressId={addressId}
            setAddressId={setAddressId}
          />
        </div>

        {/* Voice Walk — camera + mic together, same green as Full Inspection */}
        <div
          role="button"
          onClick={() => { if (!parsing && !qqTranscribing) void openQuickWalk(); }}
          style={{ display: "flex", alignItems: "center", gap: 13, padding: 15, borderRadius: 18, marginBottom: 12, cursor: "pointer", opacity: parsing ? 0.5 : 1, ...cGreen.card }}
        >
          <div style={{ width: 46, height: 46, borderRadius: 13, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Icon name="mic" size={26} color={cGreen.icon} strokeWidth={2} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: "Oswald", fontWeight: 600, fontSize: 18, letterSpacing: ".3px", color: cGreen.text }}>VOICE WALK</div>
            <div style={{ fontSize: 13, color: cGreen.sub }}>
              {qqTranscribing ? "Writing up what you said…" : "Camera + mic together — snap photos and talk it through"}
            </div>
          </div>
          <span style={{ fontSize: 10.5, fontWeight: 700, padding: "3px 8px", borderRadius: 99, whiteSpace: "nowrap", ...cGreen.tag }}>FASTEST</span>
        </div>

        {qqWalk === "tip" && (
          <div className="sheet-overlay" onClick={() => setQqWalk(null)}>
            <div className="sheet cd" onClick={(e) => e.stopPropagation()}>
              <h3 style={{ fontFamily: "Oswald", fontSize: 19, display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <Icon name="mic" size={19} color="#3ee08f" /> Voice Walk — how it works
              </h3>
              {[
                ["camera", "Your camera and mic turn on together — no extra buttons."],
                ["mic", "Walk the job and talk: what's wrong, where, and sizes (\"bathroom is 5 by 8\")."],
                ["photo", "Tap the shutter on each problem while you talk about it."],
                ["check", "Tap Stop, then Add to quote — your words and photos fill in. Check them, then Generate."],
              ].map(([icon, line], i) => (
                <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 9 }}>
                  <span style={{ width: 26, height: 26, borderRadius: 8, background: "rgba(0,204,102,.15)", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <Icon name={icon} size={14} color="#3ee08f" />
                  </span>
                  <span style={{ fontSize: 14, lineHeight: 1.45 }}>{line}</span>
                </div>
              ))}
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--color-dim)", margin: "6px 0 12px", cursor: "pointer" }}>
                <input type="checkbox" checked={qqTipOff} onChange={(e) => setQqTipOff(e.target.checked)} style={{ width: 16, height: 16 }} />
                Don&apos;t show this again
              </label>
              <div className="row" style={{ gap: 8 }}>
                <button className="bo" onClick={startQuickWalk} style={{ flex: 1 }}>Skip</button>
                <button className="bg" onClick={startQuickWalk} style={{ flex: 2, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                  <Icon name="mic" size={15} /> Start recording
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Description */}
        <div className="cd mb">
          <label style={{ fontSize: 14, color: "#888", fontFamily: "Oswald", textTransform: "uppercase", letterSpacing: ".08em" }}>
            Describe the issue
          </label>
          <textarea
            value={quickDesc}
            onChange={(e) => setQuickDesc(e.target.value)}
            placeholder="e.g. Kitchen faucet leaking from base, bathroom door won't close properly, 3 outlet covers missing..."
            style={{ height: 100, marginTop: 4 }}
          />
        </div>

        {/* Photos */}
        <div className="cd mb">
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
            <label style={{ fontSize: 14, color: "#888", fontFamily: "Oswald", textTransform: "uppercase", letterSpacing: ".08em" }}>
              Photos ({quickPhotos.length})
            </label>
            <div className="row" style={{ gap: 4 }}>
              <button
                className="bb"
                onClick={() => setQuickCam(true)}
                disabled={quickUploading}
                style={{ fontSize: 14, padding: "4px 10px" }}
              >
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6, justifyContent: "center" }}>
                  <Icon name="camera" size={16} />Take Photo
                </span>
              </button>
              <button
                className="bo"
                onClick={() => quickPhotoRef.current?.click()}
                disabled={quickUploading}
                style={{ fontSize: 14, padding: "4px 10px" }}
              >
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6, justifyContent: "center" }}>
                  <Icon name="upload" size={16} />Upload
                </span>
              </button>
            </div>
          </div>

          {quickUploading && <div className="dim" style={{ fontSize: 15, textAlign: "center", marginBottom: 6 }}>Processing photos...</div>}

          <CameraModal
            open={quickCam}
            onClose={() => setQuickCam(false)}
            onCapture={(fs) => fs.forEach(handleQuickPhotoFile)}
            multiple
            title="Quick Quote photo"
          />
          <input
            ref={quickPhotoRef}
            type="file"
            accept="image/*"
            multiple
            style={{ display: "none" }}
            onChange={async (e) => {
              const files = e.target.files;
              if (!files?.length) return;
              for (const file of Array.from(files)) await handleQuickPhotoFile(file);
              if (quickPhotoRef.current) quickPhotoRef.current.value = "";
            }}
          />

          {quickPhotos.length > 0 ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(80px, 1fr))", gap: 6 }}>
              {quickPhotos.map((photo, i) => (
                <div key={i} style={{ position: "relative" }}>
                  <img
                    src={photo}
                    alt=""
                    style={{ width: "100%", height: 80, objectFit: "cover", borderRadius: 6, border: "1px solid #1e1e2e" }}
                  />
                  <button
                    onClick={() => setQuickPhotos((prev) => prev.filter((_, j) => j !== i))}
                    style={{
                      position: "absolute", top: 2, right: 2,
                      background: "rgba(0,0,0,0.7)", color: "#fff", border: "none",
                      borderRadius: "50%", width: 16, height: 16, fontSize: 15,
                      cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                    }}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ textAlign: "center", padding: 20, color: "#555" }}>
              <div style={{ fontSize: 28, marginBottom: 4 }}>📷</div>
              <div style={{ fontSize: 13 }}>Add photos of the issue for better accuracy</div>
            </div>
          )}
        </div>

        {/* Generate */}
        {parsing ? (
          <div className="cd">
            <AiLoadingDisplay status={parseStatus} />
          </div>
        ) : (
          <button
            className="bb"
            onClick={() => {
              if (!quickDesc.trim() && !quickPhotos.length) {
                useStore.getState().showToast("Add a description or photos", "warning");
                return;
              }
              doAiParse(quickDesc || "Analyze these photos and quote all repairs needed.", null);
            }}
            disabled={!quickDesc.trim() && !quickPhotos.length}
            style={{
              width: "100%", padding: 14, fontSize: 18,
              opacity: !quickDesc.trim() && !quickPhotos.length ? 0.5 : 1,
            }}
          >
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8, justifyContent: "center" }}>
              <Icon name="ai" size={18} />{t("qf.generateQuote")}
            </span>
          </button>
        )}

        {/* Manual add option */}
        <div style={{ textAlign: "center", marginTop: 12 }}>
          <button
            className="bo"
            onClick={() => { setMode("manual"); }}
            style={{ fontSize: 15, padding: "6px 14px", display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            <Icon name="edit" size={15} /> {t("qf.buildManually")}
          </button>
        </div>
      </div>
    );

  /* ══════════════════════════════════════════
     PASTE MODE
     ══════════════════════════════════════════ */
  if (mode === "paste")
    return (
      <div className="fi">
        <TopBar title="Upload Report" icon="doc" color={QF_HUE.blue} onBack={() => setMode(null)} />
        <div className="cd">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste report text here..."
            style={{ height: 200, fontFamily: "monospace", fontSize: 13 }}
          />
          <div className="mt">
            <CustomerPicker
              prop={prop}
              setProp={setProp}
              client={client}
              setClient={setClient}
              customerId={customerId}
              setCustomerId={setCustomerId}
              addressId={addressId}
              setAddressId={setAddressId}
            />
          </div>
          {parsing ? (
            <AiLoadingDisplay status={parseStatus} />
          ) : (
            <div className="row mt">
              <button className="bb" onClick={doParse} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <Icon name="ai" size={14} />AI Parse →
              </button>
              <button className="bo" onClick={() => doRegexParse(text)}>Quick Parse</button>
              <button className="bo" onClick={() => fileRef.current?.click()}>
                Upload PDF
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".pdf,.txt"
                style={{ display: "none" }}
                onChange={handleFile}
              />
            </div>
          )}
        </div>
      </div>
    );

  /* ══════════════════════════════════════════
     MANUAL MODE (empty — no items yet)
     ══════════════════════════════════════════ */
  if (mode === "manual" && !rooms.length)
    return (
      <div className="fi">
        <TopBar
          title={templateEdit ? "New Service" : "Manual Quote"}
          icon={templateEdit ? "briefcase" : "edit"}
          color={templateEdit ? QF_HUE.violet : QF_HUE.gold}
          onBack={() => templateEdit ? exitEditor() : setMode(null)}
        />
        {templateBanner}
        {!templateEdit && <div className="cd mb">
          <CustomerPicker
            prop={prop}
            setProp={setProp}
            client={client}
            setClient={setClient}
            customerId={customerId}
            setCustomerId={setCustomerId}
            addressId={addressId}
            setAddressId={setAddressId}
          />
        </div>}
        <AddItemForm
          nr={nr} setNr={setNr} na={na} setNa={setNa} nd={nd} setNd={setNd}
          nc={nc} setNc={setNc} nh={nh} setNh={setNh} nm={nm} setNm={setNm}
          nsq={nsq} setNsq={setNsq} ncn={ncn} setNcn={setNcn}
          addItem={addItem} rooms={rooms}
        />
      </div>
    );

  /* ══════════════════════════════════════════
     EDIT MODE
     ══════════════════════════════════════════ */
  if ((parsing || inspParseFailed) && rooms.length === 0) {
    return (
      <div className="fi">
        <TopBar title="Building Quote" icon="sparkle" color={QF_HUE.gold} onBack={exitBuilding} />
        <div className="cd">
          {parsing ? (
            <AiLoadingDisplay status={parseStatus || "Processing inspection..."} />
          ) : (
            <div style={{ textAlign: "center", padding: "20px 14px" }}>
              <div style={{ width: 56, height: 56, borderRadius: 16, background: "rgba(245,180,0,.14)", border: "1px solid rgba(245,180,0,.4)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 12px" }}>
                <Icon name="alert" size={26} color="#f5b400" />
              </div>
              <div style={{ fontFamily: "Oswald", fontWeight: 600, fontSize: 18 }}>Quote didn&apos;t finish</div>
              <p className="dim" style={{ fontSize: 14, margin: "8px auto 16px", maxWidth: 320, lineHeight: 1.45 }}>
                The AI didn&apos;t finish reading the inspection — usually because the app was backgrounded or the phone slept mid-quote. Your inspection is safe. Keep this app open and try again.
              </p>
              <button className="bb" onClick={() => { if (inspectionData) runInspectionAiParse(inspectionData); }} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                <Icon name="refresh" size={16} /> Retry
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="fi">
      {/* Header */}
      <TopBar
        title={templateEdit ? "Service" : t("qf.quoteTitle")}
        icon={templateEdit ? "briefcase" : "quote"}
        color={templateEdit ? QF_HUE.violet : QF_HUE.gold}
        onBack={exitEditor}
        right={<span style={{ fontSize: 12 }} className="dim">${rate}/hr{laborRate && laborRate > 0 ? " (override)" : ""}</span>}
      />

      {editDraftOffer && editDraftOffer.id === editingId && (
        <div className="cd mb" style={{ border: "1px solid rgba(245,180,0,.55)", background: "rgba(245,180,0,.08)" }}>
          <div style={{ fontSize: 14, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
            <Icon name="alert" size={15} color="#f5b400" />
            Unsaved changes from {new Date(editDraftOffer.savedAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
          </div>
          <div className="dim" style={{ fontSize: 12, marginTop: 4 }}>
            {editDraftOffer.stale
              ? "This quote was saved again since then (maybe on another device). Resuming replaces that version on screen — nothing is saved until you tap Update."
              : "You left this quote without saving. Resume to pick up where you left off — nothing is saved until you tap Update."}
            {" "}New edits aren&apos;t kept as a draft until you choose.
          </div>
          <div className="row" style={{ gap: 8, marginTop: 10 }}>
            <button className="bb" style={{ fontSize: 13, padding: "6px 14px" }} onClick={resumeEditDraft}>Resume</button>
            <button className="bo" style={{ fontSize: 13, padding: "6px 14px" }} onClick={discardEditDraft}>Discard</button>
          </div>
        </div>
      )}

      {templateBanner}

      {/* Customer / property — pulled above the total so the glow card holds
          just the totals (render look). A service has no customer. */}
      {!templateEdit && <div className="cd mb">
        <CustomerPicker
          prop={prop}
          setProp={setProp}
          client={client}
          setClient={setClient}
          customerId={customerId}
          setCustomerId={setCustomerId}
          addressId={addressId}
          setAddressId={setAddressId}
          compact
        />
      </div>}

      {/* Totals — gold glow; figures sit next to each other, not stacked. */}
      <div
        className="cd mb"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          background: "rgba(245,180,0,.13)",
          border: "1.5px solid rgba(245,180,0,.6)",
          boxShadow: "0 0 26px -4px rgba(245,180,0,.5), inset 0 0 26px -10px rgba(245,180,0,.4)",
        }}
      >
        {[
          { l: "Labor", v: "$" + tl.toFixed(0) },
          { l: "Mat'l" + (materialTaxPct > 0 ? ` +${materialTaxPct}% tax` : "") + (markupPct > 0 ? ` +${markupPct}%` : ""), v: "$" + tm.toFixed(0) },
          { l: "Hours", v: th.toFixed(1) },
        ].map((x) => (
          <div key={x.l} style={{ flex: 1, textAlign: "center" }}>
            <div style={{ fontSize: 9, letterSpacing: ".1em", textTransform: "uppercase", color: "#e9c879", fontWeight: 600 }}>{x.l}</div>
            <div style={{ fontSize: 15, fontFamily: "Oswald", fontWeight: 600, color: "#fff", marginTop: 2 }}>{x.v}</div>
          </div>
        ))}
        <div style={{ flex: 1.1, textAlign: "center", borderLeft: "1px solid rgba(245,180,0,.35)" }}>
          <div style={{ fontSize: 9, letterSpacing: ".1em", textTransform: "uppercase", color: "#ffce3a", fontWeight: 700 }}>Total</div>
          <div style={{ fontSize: 24, fontFamily: "Oswald", fontWeight: 700, color: "#ffce3a", lineHeight: 1.05, marginTop: 1 }}><CountUp value={headlineTotal} prefix="$" decimals={2} /></div>
        </div>
      </div>

      {/* Good-Better-Best options (per-quote, on the rooms JSON blob). When
          on, each line item gets a Base/Better/Best tag below; the three
          cumulative totals preview here and the customer picks one on the
          approval page. */}
      <div style={{ marginTop: 8 }}>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <span style={{ fontSize: 12, color: "#888", fontFamily: "Oswald", textTransform: "uppercase", letterSpacing: ".06em" }}>
            Options · Good-Better-Best
          </span>
          <button
            onClick={() => setTieredQuote((v) => !v)}
            className={tieredQuote ? "bb" : "bo"}
            style={{ fontSize: 12, padding: "3px 12px" }}
          >
            {tieredQuote ? "On" : "Off"}
          </button>
        </div>
        {tieredQuote && (
          <>
            <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 12 }} className="dim">Tier names:</span>
              <input value={tierNames.better} onChange={(e) => setTierNames((n) => ({ ...n, better: e.target.value }))} onBlur={(e) => { if (!e.target.value.trim()) setTierNames((n) => ({ ...n, better: "Better" })); }} placeholder="Better" style={{ flex: "1 1 90px", minWidth: 80, padding: "4px 8px", fontSize: 14 }} />
              <input value={tierNames.best} onChange={(e) => setTierNames((n) => ({ ...n, best: e.target.value }))} onBlur={(e) => { if (!e.target.value.trim()) setTierNames((n) => ({ ...n, best: "Best" })); }} placeholder="Best" style={{ flex: "1 1 90px", minWidth: 80, padding: "4px 8px", fontSize: 14 }} />
            </div>
            <div style={{ fontSize: 11, color: "#888", marginTop: 10, marginBottom: 4, fontFamily: "Oswald", textTransform: "uppercase", letterSpacing: ".06em" }}>
              Tap a tier to organize it
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              {([
                { key: "base", name: "Base", total: tierTotals.base, hue: "#8a8a99" },
                { key: "better", name: tierNames.better, total: tierTotals.better, hue: "#2E75B6" },
                { key: "best", name: tierNames.best, total: tierTotals.best, hue: "#9d4edd" },
              ] as const).map((t) => {
                const on = editTier === t.key;
                return (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setEditTier(t.key)}
                    style={{
                      flex: 1, textAlign: "center", borderRadius: 8, padding: "7px 4px", cursor: "pointer",
                      border: on ? `2px solid ${t.hue}` : `1px solid ${t.hue}55`,
                      background: on ? `${t.hue}2e` : `${t.hue}12`,
                      boxShadow: on ? `0 0 12px -3px ${t.hue}` : "none",
                    }}
                  >
                    <div style={{ fontSize: 9, letterSpacing: ".06em", textTransform: "uppercase", color: t.hue, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.name}</div>
                    <div style={{ fontSize: 16, fontFamily: "Oswald", fontWeight: 700, color: "#fff", marginTop: 1 }}>${t.total.toFixed(0)}</div>
                  </button>
                );
              })}
            </div>
            <div className="dim" style={{ fontSize: 11, marginTop: 7, lineHeight: 1.45 }}>
              {editTier === "base"
                ? <>Organizing <b style={{ color: "#bbb" }}>Base</b>. Check the lines included in this option.</>
                : editTier === "better"
                ? <>Organizing <b style={{ color: "#7fb6ff" }}>{tierNames.better}</b>. Check the lines included in this option.</>
                : <>Organizing <b style={{ color: "#c79bff" }}>{tierNames.best}</b>. Check the lines included in this option.</>}
              {" "}Each option is independent — a line can be in any combination (or its own scope).
              {!hasSplit && <> Nothing split yet — all three options are identical until you differentiate them.</>}
            </div>
          </>
        )}
      </div>

      {/* Pricing adjustments — per-quote labor-rate override + discount.
          Both live on the rooms JSON blob (no schema change). Empty
          labor-rate input falls back to the org default; empty discount
          value means "no discount applied". */}
      <div className="cd mb" style={{ padding: 10 }}>
        <div
          className="row"
          style={{ gap: 10, alignItems: "center", flexWrap: "wrap", fontSize: 14 }}
        >
          <span
            style={{
              fontSize: 12,
              color: "#888",
              fontFamily: "Oswald",
              textTransform: "uppercase",
              letterSpacing: ".06em",
            }}
          >
            Labor $/hr
          </span>
          <input
            type="number"
            min="0"
            step="1"
            placeholder={`${org?.default_rate || defaultRate || 55}`}
            value={laborRate ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              setLaborRate(v === "" ? null : parseFloat(v) || null);
            }}
            style={{ width: 64, padding: "4px 6px", fontSize: 15, textAlign: "center" }}
            title="Override the labor rate for THIS quote only. Leave empty to use the org default."
          />
          {laborRate && laborRate > 0 ? (
            <button
              onClick={() => setLaborRate(null)}
              className="bo"
              style={{ fontSize: 12, padding: "2px 8px" }}
              title="Clear labor-rate override"
            >
              ×
            </button>
          ) : null}

          <span style={{ width: 1, height: 18, background: "#444", margin: "0 4px" }} />

          <span
            style={{
              fontSize: 12,
              color: "#888",
              fontFamily: "Oswald",
              textTransform: "uppercase",
              letterSpacing: ".06em",
            }}
          >
            Discount
          </span>
          <div style={{ display: "inline-flex", borderRadius: 6, overflow: "hidden", border: "1px solid #2E75B655" }}>
            {([
              { key: "off", label: "None" },
              { key: "percent", label: "%" },
              { key: "fixed", label: "$" },
            ] as const).map((opt) => {
              const active =
                (opt.key === "off" && !discount) ||
                (opt.key !== "off" && discount?.type === opt.key);
              return (
                <button
                  key={opt.key}
                  onClick={() => {
                    if (opt.key === "off") setDiscount(null);
                    else setDiscount({
                      type: opt.key,
                      value: discount?.value || 0,
                      label: discount?.label,
                    });
                  }}
                  style={{
                    padding: "4px 10px",
                    fontSize: 13,
                    fontFamily: "Oswald",
                    background: active ? "var(--color-primary)" : "transparent",
                    color: active ? "#fff" : "#888",
                    border: "none",
                    cursor: "pointer",
                  }}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
          {discount ? (
            <>
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder={discount.type === "percent" ? "10" : "200"}
                value={discount.value || ""}
                onChange={(e) =>
                  setDiscount({
                    ...discount,
                    value: parseFloat(e.target.value) || 0,
                  })
                }
                style={{ width: 70, padding: "4px 6px", fontSize: 15, textAlign: "center" }}
              />
              <span style={{ fontSize: 13, color: "#888" }}>
                {discount.type === "percent" ? "%" : "off"}
              </span>
              <input
                type="text"
                placeholder="Label (optional)"
                value={discount.label || ""}
                onChange={(e) =>
                  setDiscount({ ...discount, label: e.target.value || undefined })
                }
                style={{ flex: "1 1 140px", minWidth: 100, padding: "4px 8px", fontSize: 14 }}
              />
              {discountAmount > 0 && (
                <span
                  style={{
                    fontSize: 14,
                    fontFamily: "Oswald",
                    color: "var(--color-accent-red)",
                    fontWeight: 600,
                  }}
                >
                  −${discountAmount.toFixed(2)}
                </span>
              )}
            </>
          ) : null}

          <span style={{ width: 1, height: 18, background: "#444", margin: "0 4px" }} />

          <span
            style={{
              fontSize: 12,
              color: "#888",
              fontFamily: "Oswald",
              textTransform: "uppercase",
              letterSpacing: ".06em",
            }}
            title="How tax applies on this quote. Default inherits from org settings."
          >
            Tax
          </span>
          <div style={{ display: "inline-flex", borderRadius: 6, overflow: "hidden", border: "1px solid #2E75B655" }}>
            {([
              { key: null, label: "Default" },
              { key: "materials" as const, label: "Mat only" },
              { key: "total" as const, label: "L + M" },
              { key: "none" as const, label: "None" },
            ]).map((opt) => {
              const active = taxMode === opt.key;
              return (
                <button
                  key={String(opt.key)}
                  onClick={() => setTaxMode(opt.key)}
                  style={{
                    padding: "4px 10px",
                    fontSize: 13,
                    fontFamily: "Oswald",
                    background: active ? "var(--color-primary)" : "transparent",
                    color: active ? "#fff" : "#888",
                    border: "none",
                    cursor: "pointer",
                  }}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
          {taxMode === null && (
            <span style={{ fontSize: 12, color: "#888", fontFamily: "Oswald" }}>
              → {effectiveTaxMode === "materials" ? "mat only" : effectiveTaxMode === "none" ? "no tax" : "L + M"}
            </span>
          )}

          <span style={{ width: 1, height: 18, background: "#444", margin: "0 4px" }} />

          <span
            style={{ fontSize: 12, color: "#888", fontFamily: "Oswald", textTransform: "uppercase", letterSpacing: ".06em" }}
            title="How many people work this job. Doesn't change the price (labor hours are total work hours) — it sets the crew line on the quote and the days on site."
          >
            Crew
          </span>
          <div style={{ display: "inline-flex", borderRadius: 6, overflow: "hidden", border: "1px solid #2E75B655" }}>
            {([null, 1, 2, 3, 4] as const).map((n) => {
              const active = crewSize === n;
              return (
                <button
                  key={String(n)}
                  onClick={() => setCrewSize(n)}
                  aria-label={n === null ? "Crew size: auto" : `Crew size: ${n}`}
                  style={{
                    padding: "4px 10px",
                    fontSize: 13,
                    fontFamily: "Oswald",
                    background: active ? "var(--color-primary)" : "transparent",
                    color: active ? "#fff" : "#888",
                    border: "none",
                    cursor: "pointer",
                  }}
                >
                  {n === null ? "Auto" : n}
                </button>
              );
            })}
          </div>
          {thRaw > 0 && (() => {
            const days = estimateDays(thRaw, crewSize, aiEstDays);
            return (
              <span style={{ fontSize: 12, color: "#888", fontFamily: "Oswald" }}>
                ≈ {days} day{days > 1 ? "s" : ""} on site{crewSize === null ? ` · crew of ${planningCrew(thRaw, null)}` : ""}
              </span>
            );
          })()}
        </div>
      </div>

      {/* Adjustments — trip fee / T&M / discount / tax. The headline totals
          (Labor / Mat'l / Hours / Total) now live in the glow card above. */}
      {(tripFee > 0 || tnmItems.length > 0 || discountAmount > 0 || (taxPct > 0 && effectiveTaxMode !== "none")) && (
      <div className="g4 mb">
        {[
          ...(tripFee > 0 ? [{ l: "Trip Fee", v: "$" + tripFee.toFixed(0), c: "var(--color-success)" }] : []),
          // F5 — T&M / Assessment-first stat tile. The fee IS in the
          // base subtotal (assessment visit is billable), but we flag
          // count + amount so the owner can clearly tell the customer
          // "$X of this quote is a diagnostic visit; the actual repair
          // is quoted after we see it." Orange because it's a yellow-
          // flag scope, not an upsell.
          ...(tnmItems.length > 0 ? [{
            l: `T&M (${tnmItems.length})`,
            v: "$" + tnmSubtotal.toFixed(0),
            c: "var(--color-warning)",
          }] : []),
          ...(discountAmount > 0 ? [{
            l: discount?.type === "percent" ? `Discount ${discount.value}%` : "Discount",
            v: "-$" + discountAmount.toFixed(0),
            c: "var(--color-accent-red)",
          }] : []),
          ...(taxPct > 0 && effectiveTaxMode !== "none" ? [{
            l: effectiveTaxMode === "materials" ? `Tax ${taxPct}% (mat)` : `Tax ${taxPct}%`,
            v: "$" + taxAmount.toFixed(0),
            c: "var(--color-accent-red)",
          }] : []),
        ].map((x, i) => (
          <div key={i} className="cd" style={{ textAlign: "center", padding: 8 }}>
            <div className="sl">{x.l}</div>
            <div style={{ fontSize: 18, fontFamily: "Oswald", color: x.c }}>{x.v}</div>
          </div>
        ))}
      </div>
      )}

      {/* Minimum service-charge note. Only renders when the floor
          actually kicked in — i.e. the quote had < min hours of labor
          and was billed up to the minimum. Pure-materials quotes don't
          trigger this. */}
      {minApplies && (
        <div
          className="cd mb"
          style={{
            padding: "8px 12px",
            fontSize: 14,
            color: "var(--color-warning)",
            background: "var(--color-warning)15",
            border: "1px solid var(--color-warning)55",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <Icon name="info" size={14} />
          <span>
            Minimum service charge applied — {effectiveMinHrs} hr min
            (actual labor: {thRaw.toFixed(2)} hr).
          </span>
        </div>
      )}

      {/* Scope check — finish work and trim-out the quote tends to leave off */}
      {scopeView.length > 0 && (
        <div className="cd mb">
          <h4 style={{ fontSize: 15, display: "inline-flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
            <GrizzFace size={20} />{t("qf.scopeTitle")}
          </h4>
          <p className="dim" style={{ fontSize: 12.5, marginBottom: 8 }}>
            {t("qf.scopeSub")}
          </p>
          {scopeView.map(({ room, item, ev }) => (
            <div key={item.id} style={{ borderTop: "1px solid var(--color-border, rgba(128,128,128,.25))", paddingTop: 8, marginTop: 8 }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600 }}>{item.detail}</div>
                <button className="bo" style={{ fontSize: 12, padding: "4px 9px", flexShrink: 0 }} onClick={() => skipAllScope(item)}>
                  {t("qf.scopeNotNeeded")}
                </button>
              </div>
              {ev.questions.map((q) => (
                <div key={(q.ruleId || q.key || q.text)} style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 13.5, marginBottom: 4 }}>
                    {q.severity === "required" && <span style={{ color: "var(--color-danger, #e5484d)", fontWeight: 700 }}>Needed · </span>}
                    {q.text}
                  </div>
                  {q.reason && <div className="dim" style={{ fontSize: 12, marginBottom: 4 }}>{q.reason}</div>}
                  <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
                    {q.key && q.options.map((o) => (
                      <button key={o} className="bo" style={{ fontSize: 13, padding: "6px 10px" }} onClick={() => answerScope(item.id, q.key as string, o, q.ruleId)}>
                        {o}
                      </button>
                    ))}
                    {!q.key && q.ruleId && (
                      <button className="bo" style={{ fontSize: 13, padding: "6px 10px" }} onClick={() => skipScope(item.id, q.ruleId as string)}>
                        Got it
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {ev.warnings.map((w) => (
                <div key={w.id} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13, marginBottom: 8, color: "var(--color-warning, #f5b400)" }}>
                  <Icon name="warn" size={14} />
                  <span style={{ flex: 1 }}>{w.suggestion}</span>
                  <button className="bo" style={{ fontSize: 12, padding: "4px 8px" }} onClick={() => skipScope(item.id, w.id)}>OK</button>
                </div>
              ))}
              {ev.suggestions.map((s) => (
                <div key={s.id} style={{ display: "flex", gap: 8, alignItems: "flex-start", marginBottom: 8 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5 }}>
                      {s.severity === "required" && <span style={{ color: "var(--color-danger, #e5484d)", fontWeight: 700 }}>Needed · </span>}
                      {s.suggestion}
                    </div>
                    <div className="dim" style={{ fontSize: 12 }}>
                      +{s.labor_hours.toFixed(2)} h{s.reason ? ` · ${s.reason}` : ""}
                    </div>
                  </div>
                  <button className="bb" style={{ fontSize: 13, padding: "6px 12px" }} onClick={() => addScopeLine(room, item, s)}>Add</button>
                  <button className="bo" style={{ fontSize: 13, padding: "6px 10px" }} onClick={() => skipScope(item.id, s.id)}>Skip</button>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* AI Re-quote */}
      <div className="cd mb">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <h4 style={{ fontSize: 15, display: "inline-flex", alignItems: "center", gap: 6 }}>
            <GrizzFace size={20} />{t("qf.aiAssist")}
          </h4>
        </div>
        <AiNote text={t("ai.noteAssist")} style={{ marginBottom: 6 }} />
        <div className="row">
          <input
            value={quickDesc}
            onChange={(e) => setQuickDesc(e.target.value)}
            placeholder={tieredQuote ? "Edit items or describe each option (Base / Better / Best)..." : "Add/edit/remove items, set labor rate, apply a discount..."}
            style={{ flex: 1, fontSize: 15 }}
          />
          <button
            className="bb"
            disabled={parsing || !quickDesc.trim()}
            onClick={async () => {
              if (!quickDesc.trim()) return;
              setParsing(true);
              setParseStatus("AI is analyzing...");
              try {
                const o = useStore.getState().org;
                const licensedTrades = (() => { try { return o?.licensed_trades ? JSON.parse(o.licensed_trades) : []; } catch { return []; } })();
                // Build an existing-items snapshot so the AI can reference
                // current line items by stable key (item.id) for update /
                // remove operations. Detail strings could change in a patch,
                // so keying by id is more reliable than by detail.
                const existingItemsContext = rooms.flatMap((r) => r.items.map((it) => ({
                  key: it.id,
                  trade: r.name,
                  detail: it.detail,
                  condition: it.condition,
                  comment: it.comment,
                  laborHrs: it.laborHrs,
                  materials: it.materials,
                  ...((it as RoomItem & { sqft?: number }).sqft ? { sqft: (it as RoomItem & { sqft?: number }).sqft } : {}),
                  // Which Good-Better-Best options the line is in (only
                  // meaningful while options are on).
                  ...(tieredQuote ? { tiers: itemTiers(it) } : {}),
                })));
                // Use the canonical AI_SYSTEM_PROMPT_BASE so AI Assist
                // inherits all the calibrated rules. Append an EDIT MODE
                // addendum that overrides the OUTPUT FORMAT to a structured
                // add/update/remove response shape — the model knows it's
                // extending an existing quote, not parsing a fresh one.
                // Snapshot of the current pricing meta so the model can
                // see what's already set and only echo deltas. Helps it
                // distinguish "clear the discount" from "leave it alone".
                const currentMetaContext = {
                  laborRate: laborRate || null,
                  discount: discount || null,
                  minLaborHours: minLaborHours,
                  taxMode: taxMode,
                  orgTaxMode: resolveTaxMode(org?.tax_mode),
                  options: { on: tieredQuote, names: { base: "Base", better: tierNames.better, best: tierNames.best } },
                };
                const editModeAddendum = `\n\n## AI ASSIST EDIT MODE — OUTPUT FORMAT OVERRIDE\n\nThe user is editing an EXISTING quote. The user message includes the current line items with their stable \`key\` field (the item id), plus a CURRENT PRICING META snapshot. Decide which combination of add / update / remove / pricing-meta operations satisfies the request.\n\nReturn ONLY this JSON shape (NO other top-level fields, NO rooms array, NO property/client/notes/crewSize/estDays):\n\n{\n  "add": [\n    { "trade": "Carpentry", "detail": "Kitchen — Replace counter tops (quartz)", "condition": "-", "comment": "...", "laborHrs": 10, "materials": [{ "n": "Quartz countertop 25 sqft", "c": 1500 }] }\n  ],\n  "update": [\n    { "key": "abcd1234", "patch": { "laborHrs": 12 } },\n    { "key": "efgh5678", "patch": { "detail": "Bedroom 2 — Replace flooring (110 sqft, tile)", "materials": [{ "n": "Tile 110 sqft (10% waste)", "c": 484 }, { "n": "Thinset / grout", "c": 83 }] } },\n    { "key": "ijkl9012", "patch": { "trade": "Plumbing" } }\n  ],\n  "remove": [\n    { "key": "mnop3456" }\n  ],\n  "setLaborRate": 65,\n  "setDiscount": { "type": "percent", "value": 10, "label": "Return customer discount" },\n  "setMinLaborHours": 2,\n  "setTaxMode": "materials"\n}\n\nADD entries must include "trade" (one of the canonical trade categories from §I) and the standard item fields. Default condition to "-" unless the user clearly describes urgent damage.\n\nUPDATE entries use the existing key and a "patch" object with ONLY the fields that change. Valid patch fields: detail, comment, condition, laborHrs, materials, trade, sqft. To MOVE an item to a different trade bucket, set patch.trade. Don't echo unchanged fields.\n\nREMOVE entries are just { "key": "..." }. Use this for "delete X" / "remove X" / "drop the X line".\n\nPRICING META (\`setLaborRate\`, \`setDiscount\`, \`setMinLaborHours\`, \`setTaxMode\`) are top-level fields, not arrays. Include them ONLY when the user explicitly asks to change them.\n  - "setLaborRate": <number> — set the per-quote labor rate (e.g. "raise the labor rate to $65/hr" → setLaborRate: 65). Use null to clear (e.g. "reset to the default rate" / "remove the rate override").\n  - "setDiscount": { "type": "percent"|"fixed", "value": <number>, "label": <string?> } — apply a discount. Examples:\n      "apply a 10% discount" → { "type": "percent", "value": 10 }\n      "take $200 off the total" → { "type": "fixed", "value": 200 }\n      "10% return customer discount" → { "type": "percent", "value": 10, "label": "Return customer discount" }\n    Use null to clear (e.g. "remove the discount" / "drop the discount").\n  - "setMinLaborHours": <number> — per-quote override of the minimum-billable-labor-hours floor. The org has an org-wide default (shown in CURRENT PRICING META as minLaborHours when set on this quote, otherwise the floor is inherited from org settings). Examples:\n      "set the minimum to 2 hours for this job" → setMinLaborHours: 2\n      "drop the minimum to 0.5 hours" → setMinLaborHours: 0.5\n      "remove the minimum on this quote" / "no minimum on this job" → setMinLaborHours: 0\n      "reset minimum to the org default" / "inherit the org minimum" → setMinLaborHours: null\n    Numeric value 0 means "disable the floor for THIS quote" (still recorded as an override). null means "inherit the org default again".\n  - "setTaxMode": "total" | "materials" | "none" — per-quote override of how tax applies. CURRENT PRICING META exposes both the per-quote override (taxMode, null when inheriting) and the org default (orgTaxMode). Examples:\n      "tax materials only" / "only tax the materials" → setTaxMode: "materials"\n      "tax everything" / "tax labor and materials" → setTaxMode: "total"\n      "no tax on this one" / "tax-exempt" / "skip the tax" → setTaxMode: "none"\n      "reset tax mode to default" / "inherit the org tax setting" → setTaxMode: null\n    null clears the per-quote override (inherits the org default).\n  OMIT these fields entirely if the user did not mention rate, discount, minimum hours, or tax mode. Do NOT echo the current values — leaving the field out means "no change".\n\nIf the user's request only adds, return empty update[] and remove[]. Same in the other directions. NEVER return both an update and a remove for the same key — pick one.\n\nGOOD-BETTER-BEST OPTIONS. A quote can offer the customer three options (keys "base", "better", "best"; CURRENT PRICING META.options gives whether they're on and their display names — the user may call an option by its display name). Every line belongs to a SET of options via "tiers" (e.g. ["base","better","best"] = in every option, ["best"] = Best only). Options are MEMBERSHIP sets, NOT cumulative: each option's price is exactly the lines in its set, so each option must be a complete, standalone scope.\n  - add[] entries may include "tiers": [...]. To change a line's options use DELTAS in its update patch: "tiersAdd": ["best"] / "tiersRemove": ["base"] — never restate the whole set.\n  - MINIMAL CHANGES: touch ONLY the lines the request is about. Every other line keeps its options, hours, materials and wording exactly — do not return update/remove entries for them. On a big quote an unrequested change to another option is a serious error.\n  - OPTION SCOPE (when the user message names one): describe what that option needs with normal add/update/remove. Edit a line's content directly even if it's shared — the app splits it so only the scoped option gets the change; "remove" takes the line out of that option only. Alternates for the scoped option (e.g. LVP instead of patching tile, a full repaint instead of touch-ups) = add the new line + remove the line it replaces.\n  - "setOptions": true | false — turn options on/off. Include true whenever the user describes different options and they're off.\n  - "setTierNames": { "better": "...", "best": "..." } — rename the Better/Best options (Base can't be renamed). Only when asked.\n  - When the user describes what each option includes, restructure with tiers: shared work goes in all three; an upgrade that REPLACES lower-option work goes only in the higher option(s) and the replaced line is removed from those options. Example: "Base repairs the screen door, Better adds new hardware, Best replaces the door" → repair line tiers ["base","better"], hardware line ["better"], new-door line ["best"].\n  - Two lines for the same task in different options (standard vs premium) must have distinguishable details, e.g. "Living Room — Paint walls (premium paint)".\n  - SUPPLIES PER OPTION: when options are on and a trade's work differs between options, a materials-only supplies line (paint, primer, caulk, tape, rollers…) must NOT be shared across those options. Give EACH option its own supplies line sized to that option's own scope (a full repaint needs far more paint/primer than touch-ups), with the option in the detail — e.g. "Whole Property — Painting Supplies & Paint (Best)" tiers ["best"]. Replace (remove, or narrow the tiers of) any existing shared supplies line instead of leaving it in place. Do this automatically whenever you restructure options — the user shouldn't have to ask.\n  - Never leave an option with no lines. NEW work: give "tiers" for the option(s) the request names. If the request doesn't say which option it's for, OMIT "tiers" — the app puts it in the option the owner is organizing (ORGANIZING in the user message). Use ["base","better","best"] only when the user says the work is needed in every option. Don't change tiers when the request isn't about options. Omit "tiers" entirely when options stay off.\n\nJOB CONTEXT (when present in the user message) is read-only background: the saved INSPECTION (room sizes + what the tech found), WORK ORDER state, JOB NOTES and the CUSTOMER'S ORIGINAL REQUEST. Use it to do the edit right:\n  - Size area-based work (paint, flooring, drywall) from the inspection's room dimensions/sqft instead of guessing; only say "confirm on site" when the inspection has no size for that room.\n  - Keep rewritten lines faithful to what the inspection found (condition, location, notes).\n  - A work-order task the crew already FINISHED is done work: don't remove, rescope or move that line out of an option unless the user explicitly asks.\n  - Don't add lines for inspection findings, hand-added tasks or notes unless the user's request calls for them — they are context, not instructions.\n\nApply ALL pricing/material/labor rules from §I-§N above when building add[] items and update[] patches. TYPE B rules apply (condition: "-" by default).`;
                // Read-only job context: the inspection (this session's, the
                // quote's saved copy, or the newest inspection at this
                // address), work-order state, job notes, original request.
                const blobOf = (j?: { rooms?: unknown } | null): Record<string, unknown> => jobBlob(j);
                const allJobs = useStore.getState().jobs;
                const savedBlob = editingId ? blobOf(allJobs.find((j) => j.id === editingId)) : {};
                const propKey = (prop || "").trim().toLowerCase();
                const inspJob = propKey
                  ? allJobs
                      .filter((j) => j.status === "inspection" && (j.property || "").trim().toLowerCase() === propKey && !!blobOf(j).inspection)
                      .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")))[0]
                  : undefined;
                const assistInspection: AssistInspection = inspectionData
                  ? {
                      type: inspectionData.inspection_type,
                      rooms: inspectionData.rooms.map((r) => ({ name: r.name, sqft: r.sqft, width: r.width, length: r.length, items: r.items })),
                    }
                  : ((savedBlob.inspection || (inspJob ? blobOf(inspJob).inspection : undefined)) as AssistInspection);
                const savedWO = (Array.isArray(savedBlob.workOrder) ? savedBlob.workOrder : []) as { detail?: string; done?: boolean; custom?: boolean }[];
                const jobContext = buildAssistJobContext({
                  inspection: assistInspection,
                  workOrder: [
                    // done state lives on the saved copy; hand-added tasks may be newer in the editor
                    ...savedWO.filter((w) => w.done && !w.custom),
                    ...((customWorkOrder ?? savedWO) as { custom?: boolean }[]).filter((w) => w.custom),
                  ],
                  jobNotes: typeof savedBlob.jobNotes === "string" ? savedBlob.jobNotes : null,
                  leadDescription: typeof savedBlob.leadDescription === "string" ? savedBlob.leadDescription : null,
                });
                const activeScope: TierKey | null = tieredQuote && assistScope !== "all" ? assistScope : null;
                const scopeName = activeScope ? (activeScope === "base" ? "Base" : tierNames[activeScope]) : "";
                const userMsg =
                  `Property: ${prop || "this property"}\n\n` +
                  (tieredQuote && !activeScope
                    ? `ORGANIZING: the owner is working on the "${editTier === "base" ? "Base" : tierNames[editTier]}" option.\n\n`
                    : "") +
                  (activeScope
                    ? `OPTION SCOPE: this request is ONLY about the "${scopeName}" option (key "${activeScope}"). Change only what that option needs; the app will keep every other option exactly as it is.\n\n`
                    : "") +
                  (jobContext ? `JOB CONTEXT (reference only — not quote lines):\n${jobContext}\n\n` : "") +
                  `EXISTING QUOTE LINE ITEMS (${existingItemsContext.length}):\n` +
                  (existingItemsContext.length
                    ? existingItemsContext.map((it) => `- ${JSON.stringify(it)}`).join("\n")
                    : "(none yet)") +
                  `\n\nCURRENT PRICING META: ${JSON.stringify(currentMetaContext)}\n\n` +
                  `USER REQUEST: ${quickDesc}\n\n` +
                  `Return the structured add/update/remove/setLaborRate/setDiscount/setOptions JSON described in the AI ASSIST EDIT MODE section.`;
                const res = await apiFetch("/api/ai", {
                  method: "POST",
                  headers: { "Content-Type": "application/json", "x-creed-call-type": "assist" },
                  body: JSON.stringify({
                    // Sonnet 5.5 — consolidated with the parse (no Haiku 5
                    // exists). Assist edits touch quote money; the calls are
                    // small, so the smarter model costs ~a cent more each.
                    model: "claude-sonnet-5-5",
                    // No thinking: between_tools is the 5.5 equivalent of
                    // disabled on a no-tools request (pure JSON text back).
                    thinking: { type: "between_tools" },
                    output_config: { effort: "high" },
                    // Sized for Sonnet's tokenizer (~30% more tokens than
                    // Haiku's for the same JSON).
                    // Big tiered quotes (100 lines, 3 options) need room.
                    max_tokens: 16000,
                    messages: [{ role: "user", content: [{ type: "text", text: userMsg }] }],
                    // Cache the big static blocks (engine rules + edit-mode
                    // spec) first; volatile per-quote header last so it can't
                    // bust the cached prefix. Reordered from volatile-first.
                    system: [
                      { type: "text", text: AI_SYSTEM_PROMPT_BASE + editModeAddendum, cache_control: { type: "ephemeral" } },
                      {
                        type: "text",
                        text:
                          `Labor rate: $${rate || 55}.00/hour.\n\n` +
                          (licensedTrades.length
                            ? `This business holds licenses for: ${licensedTrades.join(", ")}. FULLY QUOTE work in these trades — do NOT flag them for subcontractors.\n\n`
                            : ""),
                      },
                    ],
                  }),
                });
                const data = await res.json();
                const text = data.stop_reason === "refusal" || data.stop_reason === "max_tokens" ? "" : aiText(data.content);
                const match = text.match(/\{[\s\S]*\}/);
                if (data.stop_reason === "refusal") {
                  useStore.getState().showToast("The AI declined this request — edit the lines by hand", "warning");
                } else if (data.stop_reason === "max_tokens") {
                  useStore.getState().showToast("That request was too big for one pass — split it into smaller asks", "warning");
                } else if (!match) {
                  useStore.getState().showToast("AI returned no actions", "warning");
                } else {
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  const parsed = JSON.parse(match[0]) as {
                    add?: AssistAdd[];
                    update?: Array<{ key: string; patch: AssistPatch }>;
                    remove?: Array<{ key: string }>;
                    setLaborRate?: number | null;
                    setDiscount?: { type?: string; value?: number; label?: string } | null;
                    setMinLaborHours?: number | null;
                    setTaxMode?: TaxMode | null;
                    setOptions?: boolean;
                    setTierNames?: { better?: unknown; best?: unknown };
                  };
                  const adds = parsed.add ?? [];
                  const updates = parsed.update ?? [];
                  const removes = parsed.remove ?? [];
                  // Undo snapshot (rooms + everything an Assist call can set).
                  setAssistUndo({ rooms, tieredQuote, tierNames, laborRate, discount, minLaborHours, taxMode });
                  // Apply in REMOVE → UPDATE → ADD order; with a scoped option
                  // only that option can change (lib/assist-ops.ts enforces it).
                  const applied = applyAssistOps(rooms, { add: adds, update: updates, remove: removes }, {
                    scope: activeScope,
                    newId: () => crypto.randomUUID().slice(0, 8),
                    // New work with no option named goes in the option being
                    // organized — never silently into all three.
                    defaultAddTiers: tieredQuote ? [editTier] : null,
                  });
                  const working = applied.rooms;
                  const tiersTouched = applied.tiersTouched;

                  // skipCaps: existing items in `working` were already
                  // user-reviewed (loaded from save). Re-applying the
                  // AI-defense caps here would scale Bernard-edited
                  // material prices back down on every AI Assist call.
                  const validated = validateQuote(working, { skipCaps: true });
                  // Added / rewritten / removed lines reach the work order via
                  // the work-order sync effect (linked by line id).
                  setRooms(validated);

                  // Pricing meta ops (Feature 2b). Only apply when the
                  // field is PRESENT in the response — `undefined` means
                  // "no change", `null` means "clear the override".
                  const summary: string[] = [];
                  if (Object.prototype.hasOwnProperty.call(parsed, "setLaborRate")) {
                    const nr = parsed.setLaborRate;
                    if (nr === null || nr === 0) {
                      setLaborRate(null);
                      summary.push("rate cleared");
                    } else if (typeof nr === "number" && nr > 0) {
                      setLaborRate(nr);
                      summary.push(`rate → $${nr}/hr`);
                    }
                  }
                  if (Object.prototype.hasOwnProperty.call(parsed, "setDiscount")) {
                    const sd = parsed.setDiscount;
                    if (sd === null) {
                      setDiscount(null);
                      summary.push("discount cleared");
                    } else if (sd && (sd.type === "percent" || sd.type === "fixed") && typeof sd.value === "number" && sd.value > 0) {
                      setDiscount({
                        type: sd.type,
                        value: sd.value,
                        label: typeof sd.label === "string" && sd.label.trim() ? sd.label.trim() : undefined,
                      });
                      summary.push(sd.type === "percent" ? `discount ${sd.value}%` : `discount $${sd.value} off`);
                    }
                  }
                  if (Object.prototype.hasOwnProperty.call(parsed, "setMinLaborHours")) {
                    const mh = parsed.setMinLaborHours;
                    if (mh === null) {
                      // Inherit org default
                      setMinLaborHours(null);
                      summary.push("min hrs → org default");
                    } else if (typeof mh === "number" && mh >= 0) {
                      // Numeric override (0 disables the floor for THIS quote)
                      setMinLaborHours(mh);
                      summary.push(mh === 0 ? "min hrs disabled" : `min hrs → ${mh}`);
                    }
                  }
                  if (Object.prototype.hasOwnProperty.call(parsed, "setTaxMode")) {
                    const tmRaw = parsed.setTaxMode;
                    if (tmRaw === null) {
                      setTaxMode(null);
                      summary.push("tax → org default");
                    } else if (tmRaw === "total" || tmRaw === "materials" || tmRaw === "none") {
                      setTaxMode(tmRaw);
                      summary.push(
                        tmRaw === "materials" ? "tax → materials only"
                        : tmRaw === "none" ? "tax → none"
                        : "tax → labor + materials",
                      );
                    }
                  }

                  // Good-Better-Best. Lines given an option set while options
                  // are off would silently do nothing, so that turns them on.
                  const optsOn = parsed.setOptions === true || (parsed.setOptions === false && !activeScope)
                    ? parsed.setOptions
                    : (tiersTouched > 0 && !tieredQuote ? true : undefined);
                  if (optsOn !== undefined && optsOn !== tieredQuote) {
                    setTieredQuote(optsOn);
                    summary.push(optsOn ? "options on" : "options off");
                  }
                  const tn = parsed.setTierNames;
                  if (tn && typeof tn === "object") {
                    const nb = typeof tn.better === "string" ? tn.better.trim().slice(0, 30) : "";
                    const ns = typeof tn.best === "string" ? tn.best.trim().slice(0, 30) : "";
                    if (nb || ns) {
                      setTierNames((n) => ({ better: nb || n.better, best: ns || n.best }));
                      summary.push("options renamed");
                    }
                  }
                  if (tiersTouched) summary.push(`${tiersTouched} line${tiersTouched === 1 ? "" : "s"} sorted into options`);
                  // Backstop for the per-option supplies rule: flag a supplies
                  // line the AI left shared across options whose work differs.
                  const sharedSupplies = (optsOn ?? tieredQuote) ? sharedSuppliesLines(validated) : [];

                  if (adds.length) summary.push(`+${adds.length} added`);
                  if (updates.length) summary.push(`${updates.length} updated`);
                  if (removes.length) summary.push(`-${removes.length} removed`);
                  if (applied.forked) summary.push(`${applied.forked} split off for ${scopeName}`);
                  if (applied.blocked) summary.push(`${applied.blocked} change${applied.blocked === 1 ? "" : "s"} to other options blocked`);
                  // Per-option line changes, so an unexpected change to an
                  // option the owner didn't mean to touch is visible at once.
                  const optDiff = (optsOn ?? tieredQuote) ? optionDiffSummary(rooms, validated, tierNames) : "";
                  if (optDiff) summary.push(optDiff);
                  // eslint-disable-next-line no-console
                  console.log(`[QuoteForge.AIAssist] ${summary.join(", ") || "no changes"}; rooms now ${validated.length}/${validated.reduce((n, r) => n + r.items.length, 0)}.`);
                  if (summary.length === 0) {
                    useStore.getState().showToast("AI returned no actionable changes", "warning");
                  } else {
                    useStore.getState().showToast(`AI Assist: ${summary.join(", ")}`, "success");
                  }
                  if (sharedSupplies.length) {
                    useStore.getState().showToast(
                      `"${sharedSupplies[0].detail}" is shared by options with different work — ask AI Assist to give each option its own supplies line`,
                      "warning",
                    );
                  }
                }
              } catch (e) { console.error(e); useStore.getState().showToast("AI failed — try again", "error"); }
              setParsing(false);
              setParseStatus("");
              setQuickDesc("");
            }}
            style={{ fontSize: 14, padding: "6px 12px" }}
          >
            {parsing ? "..." : "Apply"}
          </button>
        </div>
        {tieredQuote && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
            <span className="dim" style={{ fontSize: 12 }}>Change:</span>
            {([
              { key: "all", name: "All options", hue: "#8a8a99" },
              { key: "base", name: "Base", hue: "#8a8a99" },
              { key: "better", name: tierNames.better, hue: "#2E75B6" },
              { key: "best", name: tierNames.best, hue: "#9d4edd" },
            ] as const).map((o) => {
              const on = assistScope === o.key;
              return (
                <button
                  key={o.key}
                  type="button"
                  onClick={() => setAssistScope(o.key)}
                  style={{
                    fontSize: 12, padding: "3px 10px", borderRadius: 999, cursor: "pointer",
                    border: on ? `2px solid ${o.hue}` : `1px solid ${o.hue}55`,
                    background: on ? `${o.hue}2e` : "transparent", color: on ? "#fff" : "var(--color-text-muted, #aaa)",
                  }}
                >
                  {o.name}
                </button>
              );
            })}
            <span className="dim" style={{ fontSize: 11, flexBasis: "100%" }}>
              {assistScope === "all"
                ? "AI may change any option."
                : `Only ${assistScope === "base" ? "Base" : tierNames[assistScope]} will change — other options stay exactly as they are.`}
            </span>
          </div>
        )}
        {assistUndo && !parsing && (
          <button
            type="button"
            className="bo"
            style={{ fontSize: 12, padding: "3px 10px", marginTop: 8, display: "inline-flex", alignItems: "center", gap: 6 }}
            onClick={() => {
              const u = assistUndo;
              setRooms(u.rooms); setTieredQuote(u.tieredQuote); setTierNames(u.tierNames);
              setLaborRate(u.laborRate); setDiscount(u.discount); setMinLaborHours(u.minLaborHours); setTaxMode(u.taxMode);
              setAssistUndo(null);
              useStore.getState().showToast("Undid the last AI Assist change", "success");
            }}
          >
            <Icon name="undo" size={12} /> Undo last AI change
          </button>
        )}
        {parseStatus && <div className="dim" style={{ fontSize: 14, marginTop: 4 }}>{parseStatus}</div>}
      </div>

      {/* Assign Workers */}
      <div className="cd mb">
        <h4 style={{ fontSize: 15, marginBottom: 6, display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Icon name="worker" size={14} color="var(--color-primary)" />
          Assign Workers
        </h4>
        <div className="row">
          {profiles.map((u) => (
            <button
              key={u.id}
              onClick={() => toggleWorker(u.id)}
              style={{
                padding: "5px 12px",
                borderRadius: 20,
                fontSize: 14,
                background: workers.includes(u.id)
                  ? "var(--color-primary)" + "33"
                  : "transparent",
                color: workers.includes(u.id)
                  ? "var(--color-primary)"
                  : darkMode
                  ? "#888"
                  : "#666",
                border: `1px solid ${
                  workers.includes(u.id)
                    ? "var(--color-primary)"
                    : darkMode
                    ? "#1e1e2e"
                    : "#ddd"
                }`,
              }}
            >
              {u.name}
            </button>
          ))}
        </div>
      </div>

      {/* Tabs — clean segmented (gold active) */}
      <div style={{ display: "flex", gap: 5, marginBottom: 10 }}>
        {[
          { id: "quote", l: t("qf.tabQuote") },
          { id: "guide", l: t("qf.tabGuide") },
          { id: "issues", l: t("qf.tabIssues") },
          { id: "photos", l: t("qf.tabPhotos") },
          { id: "add", l: "Add" },
        ].map((x) => {
          const on = tab === x.id;
          return (
            <button
              key={x.id}
              onClick={() => setTab(x.id)}
              style={{
                flex: 1, textAlign: "center", padding: "7px 2px", borderRadius: 9, fontSize: 12.5,
                fontFamily: "Oswald", fontWeight: 600, letterSpacing: ".04em",
                background: on ? "#f5b400" : "var(--color-card-dark-2)",
                color: on ? "#1a1305" : "var(--color-dim)",
                border: `1px solid ${on ? "#f5b400" : "var(--color-border-dark-2)"}`,
              }}
            >
              {x.l}
            </button>
          );
        })}
      </div>

      <AiNote text={t("ai.noteQuote")} style={{ marginBottom: 6 }} />

      {/* Action bar — PDF / Send / Save (Save = green primary). Hidden while
          editing a service: that saves through "Save service", not as a job. */}
      {!templateEdit && <div style={{ display: "flex", gap: 7, marginBottom: 12 }}>
        <button
          onClick={() =>
            (() => {
              const o = useStore.getState().org;
              // Pull contact info from the linked Customer entity if one is
              // set on this quote. Free-text-only quotes (no customer_id)
              // simply ship the PDF without contact info.
              const customerData = customerId
                ? useStore.getState().customers.find((c) => c.id === customerId)
                : undefined;
              // Pull saved AI renders flagged for the quote (Now → Done pairs).
              const savedJob = editingId ? useStore.getState().jobs.find((j) => j.id === editingId) : null;
              let renders: { sourceUrl?: string; url: string }[] = [];
              if (savedJob) {
                const d = readBlob(savedJob.rooms);
                const ph: Record<string, unknown>[] = Array.isArray(d.photos) ? d.photos : [];
                renders = ph
                  .filter((p) => p.type === "rendered" && p.includeInQuote)
                  .map((p) => ({ sourceUrl: p.sourceUrl as string | undefined, url: p.url as string }));
              }
              exportQuotePdf({
                property: prop,
                client,
                clientPhone: customerData?.phone,
                clientEmail: customerData?.email,
                rooms,
                rate,
                // Per-trade rates only when no per-quote override — the
                // override already IS the rate for every section.
                tradeRates: laborRate && laborRate > 0 ? undefined : tradeRates,
                workers: workers.map((wid) => {
                  const u = profiles.find((x) => x.id === wid);
                  return { id: wid, name: u?.name || "" };
                }),
                grandTotal: gt,
                totalLabor: tl,
                totalMat: tm,
                totalHrs: th,
                orgName: o?.name,
                accent: o?.brand_color,
                accent2: o?.brand_color_2,
                depositPct: o?.deposit_pct,
                quoteValidDays: o?.quote_valid_days,
                quoteTerms: o?.quote_terms,
                orgPhone: o?.phone,
                orgEmail: o?.email,
                orgLicense: o?.license_num,
                orgAddress: o?.address,
                orgLogo: o?.logo_url,
                photos: jobPhotos,
                renders,
                markupPct,
                materialTaxPct,
                taxPct,
                taxAmount,
                tripFee,
                discount,
                minLaborHours: effectiveMinHrs,
                taxMode: effectiveTaxMode,
                tieredQuote,
                tierNames,
                crewSize,
                estDays: aiEstDays,
                // Same reference number the customer's copy prints (was a
                // random one per export for saved quotes).
                jobId: editingId || undefined,
                // Signed quote → the customer's signature prints, unless
                // the items on screen differ from what they signed.
                approval: quoteApprovalFromJob(savedJob),
              });
            })()
          }
          style={{ flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5, fontSize: 13, fontWeight: 600, padding: "11px 4px", borderRadius: 11, border: darkMode ? "1px solid var(--color-border-dark-2)" : "1px solid var(--color-border-light)", background: darkMode ? "var(--color-card-dark-2)" : "var(--color-card-light-2)", color: "inherit", cursor: "pointer" }}
        >
          <Icon name="doc" size={14} /> {t("qf.pdf")}
        </button>
        <button
          onClick={() => {
            if (!editingId) { useStore.getState().showToast("Save the quote once, then render its photos.", "info"); return; }
            if (jobPhotos.length === 0) { useStore.getState().showToast("Add an inspection photo to preview the finish.", "info"); return; }
            setShowRender(true);
          }}
          title="AI-render the finished look from this quote's photos"
          style={{ flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5, fontSize: 13, fontWeight: 600, padding: "11px 4px", borderRadius: 11, cursor: "pointer", opacity: editingId && jobPhotos.length ? 1 : 0.55, ...(darkMode ? { border: "1px solid rgba(157,78,221,.6)", background: "rgba(157,78,221,.16)", color: "#d8b6ff", boxShadow: "0 0 20px -6px rgba(157,78,221,.6)" } : { border: "1.5px solid #9d4edd", background: "#9d4edd", color: "#fff", boxShadow: "0 0 17px -2px rgba(157,78,221,.6), 0 4px 12px -7px rgba(0,0,0,.22)" }) }}
        >
          <Icon name="sparkle" size={14} color={darkMode ? "#d8b6ff" : "#fff"} /> {t("qf.render")}
        </button>
        <button
          onClick={async () => {
            // Save first (creates the job on a new quote, or saves pending
            // edits on an existing one) so the customer's link shows exactly
            // what's on screen — then pick Text / Email / Copy / Share.
            const id = await saveJob({ stay: true });
            if (!id) return;
            const customerData = customerId
              ? useStore.getState().customers.find((c) => c.id === customerId)
              : undefined;
            const o = useStore.getState().org;
            const statusUrl = await getStatusLink(id);
            const validDays = Number(o?.quote_valid_days) > 0 ? Number(o?.quote_valid_days) : 30;
            const totalLine = tieredQuote
              ? `Options from $${Math.min(tierTotals.base, tierTotals.better, tierTotals.best).toFixed(2)} — pick the one you want on the page.`
              : `Total: $${headlineTotal.toFixed(2)}`;
            setSendSheet({
              jobId: id,
              phone: customerData?.phone || "",
              email: customerData?.email || "",
              subject: `Quote — ${prop}`,
              message:
                `Hi ${client || "there"}! Here's your quote from ${o?.name || "us"} for ${prop}.\n\n` +
                `${totalLine}\n\n` +
                `Review, approve & sign here:\n${statusUrl}\n\n` +
                `This quote is good for ${validDays} days. Thank you!`,
            });
          }}
          style={{ flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5, fontSize: 13, fontWeight: 600, padding: "11px 4px", borderRadius: 11, border: darkMode ? "1px solid var(--color-border-dark-2)" : "1px solid var(--color-border-light)", background: darkMode ? "var(--color-card-dark-2)" : "var(--color-card-light-2)", color: "inherit", cursor: "pointer" }}
        >
          <Icon name="send" size={14} /> {t("qf.send")}
        </button>
        <button
          onClick={() => { void saveJob(); }}
          style={{ flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5, fontSize: 13, fontWeight: 600, padding: "11px 4px", borderRadius: 11, border: "1px solid var(--color-success)", background: "var(--color-success)", color: "#06371f", boxShadow: "0 0 22px -6px rgba(0,204,102,.6)", cursor: "pointer" }}
        >
          <Icon name="briefcase" size={14} color="#06371f" /> {editingId ? t("qf.update") : t("qf.saveJob")}
        </button>
      </div>}

      {sendSheet && (
        <SendSheet
          title={t("jobs.sendQuote")}
          phone={sendSheet.phone}
          email={sendSheet.email}
          subject={sendSheet.subject}
          message={sendSheet.message}
          onClose={() => setSendSheet(null)}
          onSent={(via) => {
            const jobId = sendSheet.jobId;
            void markQuoteSent(jobId).then(async (ok) => {
              await loadAll();
              // Copy keeps its own "Copied — paste it" toast (nothing is sent yet).
              if (!ok || via === "copy") return;
              // "Waiting on customer" only lists quoted jobs — a re-sent
              // accepted/scheduled/etc. quote stays in its own column.
              const st = useStore.getState();
              const isQuoted = st.jobs.find((j) => j.id === jobId)?.status === "quoted";
              st.showToast(isQuoted ? t("jobs.quoteMarkedSent") : t("qf.quoteSent"), "success");
            });
          }}
        />
      )}

      {/* Services: add one of the shop's saved services to this quote, or
          save the current lines as a service. */}
      <div style={{ display: "flex", gap: 7, marginBottom: 12 }}>
        {!templateEdit && templates.length > 0 && (
          <button
            onClick={() => setAddingService(true)}
            style={{ flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, fontSize: 12.5, fontWeight: 600, padding: 9, borderRadius: 11, color: "#c9a6ff", background: "rgba(157,78,221,.1)", border: "1px solid rgba(157,78,221,.4)", cursor: "pointer" }}
          >
            <Icon name="add" size={13} color="#c9a6ff" /> Add a service
          </button>
        )}
        <button
          onClick={openSaveTemplate}
          style={{ flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, fontSize: 12.5, fontWeight: 600, padding: 9, borderRadius: 11, color: "#c9a6ff", background: "rgba(157,78,221,.1)", border: "1px solid rgba(157,78,221,.4)", cursor: "pointer" }}
        >
          <Icon name="briefcase" size={13} color="#c9a6ff" /> {templateEdit ? "Save service" : "Save as template"}
        </button>
      </div>
      {addingService && (
        <div onClick={() => setAddingService(false)} className="sheet-overlay">
          <div onClick={(e) => e.stopPropagation()} className="cd sheet" style={{ maxHeight: "88vh", overflowY: "auto" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
              <h4 style={{ fontSize: 16, display: "inline-flex", alignItems: "center", gap: 7 }}><Icon name="briefcase" size={16} color="var(--color-violet)" /> Add a service</h4>
              <button className="bo" onClick={() => setAddingService(false)} style={{ padding: "4px 10px" }} aria-label="Close"><Icon name="close" size={14} /></button>
            </div>
            <p className="dim" style={{ fontSize: 12.5, marginBottom: 10 }}>Its lines are added to this quote{tieredQuote ? ` (to the ${editTier === "base" ? "Base" : tierNames[editTier]} option)` : ""}.</p>
            <ServiceTemplates mode="add" templates={templates} reload={reloadTemplates} onPick={addServiceToQuote} />
          </div>
        </div>
      )}
      {savingTemplate && (
        <div onClick={() => setSavingTemplate(false)} className="sheet-overlay">
          <div onClick={(e) => e.stopPropagation()} className="cd sheet" style={{ maxWidth: 420 }}>
            <h4 style={{ fontSize: 16, marginBottom: 8 }}>{templateEdit ? "Save service" : "Save as template"}</h4>
            <input autoFocus value={templateName} onChange={(e) => setTemplateName(e.target.value)} placeholder="Service name (e.g. Water heater swap)" style={{ width: "100%", marginBottom: 10 }} />
            <div style={{ marginBottom: 12 }}>
              <CategoryField value={templateCategory} onChange={setTemplateCategory} categories={templateCategories(templates)} />
            </div>
            <div className="row" style={{ gap: 6 }}>
              <button className="bo" onClick={() => setSavingTemplate(false)} style={{ flex: 1 }}>Cancel</button>
              <button className="bb" onClick={saveAsTemplate} style={{ flex: 1 }}>Save</button>
            </div>
          </div>
        </div>
      )}

      <RenderModal
        open={showRender}
        onClose={() => setShowRender(false)}
        sourcePhotos={jobPhotos}
        initialPrompt={renderSeed.prompt}
        promptMeta={renderSeed}
        jobId={editingId ?? undefined}
        showQuoteToggle
        onSaved={async (url, sourceUrl, includeInQuote) => {
          if (!editingId) return;
          const freshJob = useStore.getState().jobs.find((j) => j.id === editingId);
          const data: Record<string, unknown> = jobBlob(freshJob);
          if (!Array.isArray(data.photos)) data.photos = [];
          (data.photos as Record<string, unknown>[]).push({
            url, label: "Proposed finish", type: "rendered", sourceUrl,
            includeInQuote, createdAt: new Date().toISOString(),
          });
          await db.patch("jobs", editingId, { rooms: JSON.stringify(data) });
          await loadAll();
          useStore.getState().showToast("Render saved to the quote", "success");
        }}
      />

      {/* QUOTE TAB */}
      {tab === "quote" && <QuoteTab rooms={rooms} rate={rate} darkMode={darkMode} upItem={upItem} rmItem={rmItem} getRateForRoom={getRateForRoom} matCost={(raw: number) => billedMaterial(raw, { materialTaxPct, markupPct })} snapItemEdit={snapItemEdit} logItemEdit={logItemEdit} tieredQuote={tieredQuote} tierNames={tierNames} editTier={editTier} />}

      {/* GUIDE TAB */}
      {tab === "guide" && (
        <GuideTab
          guide={guide}
          workOrder={customWorkOrder ?? guide.steps}
          isCustomized={customWorkOrder !== null}
          onEditStep={(i, patch) => {
            setCustomWorkOrder((curr) => {
              const base = curr ?? guide.steps.map((s) => ({ ...s }));
              return base.map((s, idx) => (idx === i ? { ...s, ...patch } : s));
            });
          }}
          onRemoveStep={(i) => {
            setCustomWorkOrder((curr) => {
              const base = curr ?? guide.steps.map((s) => ({ ...s }));
              // Removed on purpose — mark its quote line accounted for so the
              // work-order sync doesn't re-add a task for it.
              const gone = base[i]?.itemId;
              if (gone) woKnownIdsRef.current.add(gone);
              return base.filter((_, idx) => idx !== i);
            });
          }}
          onAddStep={(step) => {
            setCustomWorkOrder((curr) => {
              const base = curr ?? guide.steps.map((s) => ({ ...s }));
              // Hand-added task, not from a quote line — never re-linked.
              return [...base, { ...step, custom: true }];
            });
          }}
          onReset={() => setCustomWorkOrder(null)}
          darkMode={darkMode}
          customTools={customTools}
          setCustomTools={setCustomTools}
          customShop={customShop}
          setCustomShop={setCustomShop}
          checkedTools={checkedTools}
          setCheckedTools={setCheckedTools}
          checkedShop={checkedShop}
          setCheckedShop={setCheckedShop}
          removedGuideShop={removedGuideShop}
          setRemovedGuideShop={setRemovedGuideShop}
        />
      )}

      {/* ISSUES TAB */}
      {tab === "issues" && <IssuesTab issues={issues} darkMode={darkMode} />}

      {/* PHOTOS TAB */}
      {tab === "photos" && (
        <div>
          <input
            ref={galleryRef}
            type="file"
            accept="image/*"
            multiple
            style={{ display: "none" }}
            onChange={async (e) => {
              const files = e.target.files;
              if (!files?.length) return;
              setUploadingPhoto(true);
              for (const file of Array.from(files)) {
                try {
                  const ext = file.name.split(".").pop() || "jpg";
                  const path = `gallery/${Date.now()}_${Math.random().toString(36).slice(2, 6)}.${ext}`;
                  const { error } = await supabase.storage.from("receipts").upload(path, file);
                  if (error) { console.error(error); continue; }
                  const { data: urlData } = supabase.storage.from("receipts").getPublicUrl(path);
                  setJobPhotos((prev) => [...prev, { url: urlData.publicUrl, label: "", type: "work" }]);
                } catch (err) { console.error(err); }
              }
              setUploadingPhoto(false);
              if (galleryRef.current) galleryRef.current.value = "";
            }}
          />

          {/* Upload buttons */}
          <div className="row mb">
            <button className="bb" onClick={() => galleryRef.current?.click()} disabled={uploadingPhoto} style={{ fontSize: 15, padding: "6px 12px" }}>
              {uploadingPhoto ? "Uploading..." : (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6, justifyContent: "center" }}>
                  <Icon name="camera" size={14} />Add Photos
                </span>
              )}
            </button>
            <span className="dim" style={{ fontSize: 13 }}>{jobPhotos.length} photo{jobPhotos.length !== 1 ? "s" : ""}</span>
          </div>

          {/* Type filter */}
          {jobPhotos.length > 0 && (
            <>
              <div className="row mb">
                {["before", "work", "after"].map((t) => {
                  const count = jobPhotos.filter((p) => p.type === t).length;
                  return (
                    <span key={t} style={{ fontSize: 14, color: "#888" }}>
                      {t === "before" ? "📋" : t === "after" ? "✅" : "🔨"} {t}: {count}
                    </span>
                  );
                })}
              </div>

              {/* Photo grid */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(100px, 1fr))", gap: 8 }}>
                {jobPhotos.map((photo, i) => (
                  <div key={i} style={{ position: "relative" }}>
                    <img
                      src={photo.url}
                      alt=""
                      style={{
                        width: "100%",
                        height: 100,
                        objectFit: "cover",
                        borderRadius: 6,
                        border: `2px solid ${photo.type === "before" ? "var(--color-warning)" : photo.type === "after" ? "var(--color-success)" : "var(--color-primary)"}`,
                      }}
                    />
                    {/* Type selector */}
                    <select
                      value={photo.type}
                      onChange={(e) => {
                        setJobPhotos((prev) => prev.map((p, j) => j === i ? { ...p, type: e.target.value as "before" | "after" | "work" } : p));
                      }}
                      style={{
                        position: "absolute",
                        bottom: 2,
                        left: 2,
                        fontSize: 15,
                        padding: "1px 4px",
                        width: "auto",
                        background: "rgba(0,0,0,0.7)",
                        color: "#fff",
                        border: "none",
                        borderRadius: 3,
                      }}
                    >
                      <option value="before">Before</option>
                      <option value="work">Work</option>
                      <option value="after">After</option>
                    </select>
                    {/* Delete */}
                    <button
                      onClick={() => setJobPhotos((prev) => prev.filter((_, j) => j !== i))}
                      style={{
                        position: "absolute",
                        top: 2,
                        right: 2,
                        background: "rgba(0,0,0,0.7)",
                        color: "#fff",
                        border: "none",
                        borderRadius: "50%",
                        width: 18,
                        height: 18,
                        fontSize: 14,
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}

          {!jobPhotos.length && (
            <div className="cd" style={{ textAlign: "center", padding: 24 }}>
              <div style={{ fontSize: 36, marginBottom: 8 }}>📸</div>
              <p className="dim" style={{ fontSize: 14 }}>Add before, during, and after photos of the work</p>
            </div>
          )}
        </div>
      )}

      {/* ADD TAB */}
      {tab === "add" && (
        <AddItemForm
          nr={nr} setNr={setNr} na={na} setNa={setNa} nd={nd} setNd={setNd}
          nc={nc} setNc={setNc} nh={nh} setNh={setNh} nm={nm} setNm={setNm}
          nsq={nsq} setNsq={setNsq} ncn={ncn} setNcn={setNcn}
          addItem={addItem} rooms={rooms}
          starterItems={tradeConfig(resolvePrimaryTrade(org?.primary_trade)).starterItems}
          unitsHint={tradeConfig(resolvePrimaryTrade(org?.primary_trade)).units}
          primaryBucket={primaryTradeToRateCategory(org?.primary_trade) || "General"}
          tierPick={tieredQuote ? { names: tierNames, selected: addTiers, onChange: setNTiers } : undefined}
        />
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════
   SUB-COMPONENTS
   ═══════════════════════════════════════════ */

/** Auto-growing textarea for the editable quote-line description + note.
 *  Grows to fit its content so long scopes (e.g. T&M paragraphs) show in full
 *  while still reading as inline text. Controlled — value flows from `rooms`. */
function AutoTextarea({
  value,
  onChange,
  className,
  placeholder,
  ariaLabel,
  style,
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
  placeholder?: string;
  ariaLabel?: string;
  style?: CSSProperties;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      className={className}
      value={value}
      placeholder={placeholder}
      aria-label={ariaLabel}
      rows={1}
      onChange={(e) => onChange(e.target.value)}
      style={style}
    />
  );
}

function QuoteTab({
  rooms,
  rate,
  darkMode,
  upItem,
  rmItem,
  getRateForRoom,
  matCost,
  snapItemEdit,
  logItemEdit,
  tieredQuote,
  tierNames,
  editTier,
}: {
  rooms: Room[];
  rate: number;
  darkMode: boolean;
  upItem: (rn: string, id: string, field: string, value: number | string | string[] | Material[]) => void;
  rmItem: (rn: string, id: string) => void;
  getRateForRoom?: (roomName: string) => number;
  /** shelf materials $ → billed (purchase tax + markup), so line totals add up */
  matCost?: (raw: number) => number;
  snapItemEdit: (rn: string, id: string) => void;
  logItemEdit: (rn: string, id: string) => void;
  tieredQuote?: boolean;
  tierNames?: { better: string; best: string };
  editTier?: "base" | "better" | "best";
}) {
  const [expandedMat, setExpandedMat] = useState<string | null>(null);
  // Colored trade dot for each room/area header (matches the mock's tradehdr).
  const TRADE_DOT: Record<string, string> = { plumbing: "#3aa0ff", electrical: "#ffcc00", carpentry: "#ff8800", hvac: "#9d4edd", painting: "#00cc66", flooring: "#ff5b5b", general: "#8a8a99", drywall: "#06b6d4" };
  const dotFor = (n: string) => TRADE_DOT[(n || "").toLowerCase().trim()] || "var(--color-primary)";
  return (
    <>
      {rooms.map((rm) => (
        <div key={rm.name} style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, margin: "8px 1px 7px", fontFamily: "Oswald", fontWeight: 600, fontSize: 13, letterSpacing: ".1em", color: "var(--color-dim)", textTransform: "uppercase" }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: dotFor(rm.name), flexShrink: 0 }} />
            {rm.name}
          </div>
          {rm.items.map((it) => {
            const roomRate = getRateForRoom ? getRateForRoom(rm.name) : rate;
            const { lc, mc } = calculateCost(it, roomRate);
            const tot = Math.round((lc + (matCost ? matCost(mc) : mc)) * 100) / 100;
            return (
              <div key={it.id} className="cd" style={{ marginBottom: 4, padding: 10 }}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                    gap: 6,
                    flexWrap: "wrap",
                  }}
                >
                  <div style={{ flex: "1 1 180px" }}>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
                      <AutoTextarea
                        className="qedit qtitle"
                        value={it.detail || ""}
                        placeholder="Describe the work…"
                        ariaLabel="Work description"
                        onChange={(v) => upItem(rm.name, it.id, "detail", v)}
                        style={{ flex: 1, minWidth: 0 }}
                      />
                      <ConditionBadge condition={it.condition} />
                    </div>
                    <AutoTextarea
                      className="qedit"
                      value={it.comment || ""}
                      placeholder="Add detail / notes…"
                      ariaLabel="Work notes"
                      onChange={(v) => upItem(rm.name, it.id, "comment", v)}
                      style={{ marginTop: 3, color: "var(--color-dim)" }}
                    />
                    {tieredQuote && (() => {
                      const et = (editTier || "base") as TierKey;
                      const cur = itemTiers(it);                 // options this line is in
                      const inActive = cur.includes(et);
                      const hue = et === "base" ? "#8a8a99" : et === "better" ? "#2E75B6" : "#9d4edd";
                      const tierLabel = (k: TierKey) => k === "base" ? "Base" : k === "better" ? (tierNames?.better || "Better") : (tierNames?.best || "Best");
                      const note = cur.length === 0
                        ? "in no option"
                        : cur.length === 3
                          ? "in all options"
                          : `in ${cur.map((k) => tierLabel(k)).join(" + ")}`;
                      return (
                        <div
                          onClick={(e) => {
                            e.stopPropagation();
                            // Toggle THIS line's membership of the active option only —
                            // independent per tier (no cumulative stacking).
                            const next = inActive ? cur.filter((k) => k !== et) : [...cur, et];
                            upItem(rm.name, it.id, "tiers", next);
                          }}
                          style={{ display: "inline-flex", alignItems: "center", gap: 7, marginTop: 7, cursor: "pointer" }}
                        >
                          <span style={{ width: 18, height: 18, borderRadius: 5, flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: "#fff", border: `1.5px solid ${inActive ? hue : "#555"}`, background: inActive ? hue : "transparent" }}>
                            {inActive ? "✓" : ""}
                          </span>
                          <span style={{ fontSize: 11, fontFamily: "Oswald", textTransform: "uppercase", letterSpacing: ".03em", color: inActive ? "#cfd2da" : "#888" }}>
                            {inActive ? `in ${tierLabel(et)}` : `add to ${tierLabel(et)}`} · <span style={{ opacity: 0.7 }}>{note}</span>
                          </span>
                        </div>
                      );
                    })()}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    <div style={{ textAlign: "center" }}>
                      <div style={{ fontSize: 10 }} className="dim">SQFT</div>
                      <input
                        type="number"
                        defaultValue={(it as unknown as Record<string, unknown>).sqft as number || ""}
                        min="0"
                        placeholder="—"
                        onBlur={(e) => {
                          const sqft = parseFloat(e.target.value) || 0;
                          // eslint-disable-next-line @typescript-eslint/no-explicit-any
                          upItem(rm.name, it.id, "sqft" as any, sqft as any);
                        }}
                        style={{ width: 40, textAlign: "center", padding: "2px", fontSize: 13 }}
                      />
                    </div>
                    <div style={{ textAlign: "center" }}>
                      <div style={{ fontSize: 10 }} className="dim">HRS</div>
                      <input
                        type="number"
                        value={it.laborHrs === 0 ? "" : it.laborHrs}
                        placeholder="0"
                        step=".25"
                        min="0"
                        onFocus={(e) => { e.target.select(); snapItemEdit(rm.name, it.id); }}
                        onChange={(e) => {
                          const raw = e.target.value;
                          const v = raw === "" ? 0 : (parseFloat(raw) || 0);
                          upItem(rm.name, it.id, "laborHrs", v);
                        }}
                        onBlur={() => logItemEdit(rm.name, it.id)}
                        style={{ width: 45, textAlign: "center", padding: "2px", fontSize: 13 }}
                      />
                    </div>
                    <div style={{ textAlign: "center", position: "relative" }}>
                      <div style={{ fontSize: 10 }} className="dim">MAT</div>
                      <div
                        onClick={(e) => {
                          e.stopPropagation();
                          if (expandedMat === it.id) { logItemEdit(rm.name, it.id); setExpandedMat(null); }
                          else { snapItemEdit(rm.name, it.id); setExpandedMat(it.id); }
                        }}
                        style={{ width: 50, textAlign: "center", padding: "2px", fontSize: 13, cursor: "pointer", color: "var(--color-warning)", fontFamily: "Oswald", border: `1px solid ${darkMode ? "#1e1e2e" : "#ddd"}`, borderRadius: 4 }}
                      >
                        ${it.materials.reduce((s, m) => s + (m.c || 0), 0).toFixed(0)}
                      </div>
                      {/* Bottom-sheet materials editor for this line (MaterialsSheet:
                          name type-ahead from the materials list, qty stepper,
                          unit price → total). Portaled to <body> inside the sheet. */}
                      {expandedMat === it.id && (
                        <MaterialsSheet
                          title={it.detail}
                          materials={it.materials}
                          darkMode={darkMode}
                          onChange={(mats) => upItem(rm.name, it.id, "materials", mats)}
                          onClose={() => { logItemEdit(rm.name, it.id); setExpandedMat(null); }}
                        />
                      )}
                    </div>
                    <div style={{ minWidth: 50, textAlign: "right" }}>
                      <div style={{ fontSize: 10 }} className="dim">TOT</div>
                      <div
                        style={{
                          fontSize: 15,
                          fontFamily: "Oswald",
                          color: "var(--color-success)",
                        }}
                      >
                        ${tot.toFixed(0)}
                      </div>
                    </div>
                    <button
                      onClick={() => rmItem(rm.name, it.id)}
                      style={{ background: "none", color: "var(--color-accent-red)", fontSize: 15, padding: 1 }}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </>
  );
}

function GuideTab({
  guide,
  workOrder,
  isCustomized,
  onEditStep,
  onRemoveStep,
  onAddStep,
  onReset,
  darkMode,
  customTools,
  setCustomTools,
  customShop,
  setCustomShop,
  checkedTools,
  setCheckedTools,
  checkedShop,
  setCheckedShop,
  removedGuideShop,
  setRemovedGuideShop,
}: {
  guide: ReturnType<typeof makeGuide>;
  workOrder: GuideStep[];
  isCustomized: boolean;
  onEditStep: (i: number, patch: Partial<GuideStep>) => void;
  onRemoveStep: (i: number) => void;
  onAddStep: (step: GuideStep) => void;
  onReset: () => void;
  darkMode: boolean;
  // Lifted state — owned by QuoteForge so it survives save+reload.
  // checkedShop is keyed by `n|||room|||trade` (matches WorkVision's
  // shopKey) instead of by index, so reorders don't drift the checks.
  customTools: string[];
  setCustomTools: React.Dispatch<React.SetStateAction<string[]>>;
  customShop: GuideShopItem[];
  setCustomShop: React.Dispatch<React.SetStateAction<GuideShopItem[]>>;
  checkedTools: string[];
  setCheckedTools: React.Dispatch<React.SetStateAction<string[]>>;
  checkedShop: string[];
  setCheckedShop: React.Dispatch<React.SetStateAction<string[]>>;
  removedGuideShop: string[];
  setRemovedGuideShop: React.Dispatch<React.SetStateAction<string[]>>;
}) {
  const border = darkMode ? "#1e1e2e" : "#eee";
  // New-task form state
  const [taskRoom, setTaskRoom] = useState("");
  const [taskDetail, setTaskDetail] = useState("");
  const [taskAction, setTaskAction] = useState("");
  const [taskPri, setTaskPri] = useState<"HIGH" | "MED" | "LOW">("MED");
  const [taskHrs, setTaskHrs] = useState("1");
  const workOrderHrs = workOrder.reduce((s, x) => s + (x.hrs || 0), 0);

  return (
    <div>
      <div className="mb">
        <GuideShopTools
          guide={guide}
          customShop={customShop}
          removedGuideShop={removedGuideShop}
          checkedShop={checkedShop}
          customTools={customTools}
          checkedTools={checkedTools}
          darkMode={darkMode}
          addTrade="Added"
          onChange={(patch) => {
            if (patch.customShop) setCustomShop(patch.customShop);
            if (patch.removedGuideShop) setRemovedGuideShop(patch.removedGuideShop);
            if (patch.checkedShop) setCheckedShop(patch.checkedShop);
            if (patch.customTools) setCustomTools(patch.customTools);
            if (patch.checkedTools) setCheckedTools(patch.checkedTools);
          }}
        />
      </div>
      <div className="cd">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <h4 style={{ color: "var(--color-success)", fontSize: 15, margin: 0 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <Icon name="list" size={14} color="var(--color-success)" />
              Work Order ({workOrder.length} tasks · {workOrderHrs.toFixed(1)}h)
            </span>
          </h4>
          {isCustomized && (
            <button
              onClick={onReset}
              title="Discard edits and rebuild from quote items"
              style={{ background: "none", color: "var(--color-primary)", fontSize: 13, padding: "2px 6px" }}
            >
              ↺ Regenerate
            </button>
          )}
        </div>
        {workOrder.length === 0 && (
          <div className="dim" style={{ fontSize: 13, padding: "4px 0" }}>
            No tasks yet. Add items to the quote or create one below.
          </div>
        )}
        {workOrder.map((s, i) => {
          // Render a small trade header above the first step of each new trade
          // group (the array is pre-sorted by trade in makeGuide). Helps the
          // user see at a glance what's in each trade's bucket.
          const prevTrade = i > 0 ? workOrder[i - 1].room : null;
          const showHeader = s.room !== prevTrade;
          const tradeHrs = workOrder
            .filter((w) => w.room === s.room)
            .reduce((sum, w) => sum + (w.hrs || 0), 0);
          const tradeCount = workOrder.filter((w) => w.room === s.room).length;
          return (
          <div key={`group-${i}`}>
          {showHeader && (
            <div
              style={{
                marginTop: i === 0 ? 0 : 8,
                marginBottom: 2,
                fontSize: 13,
                fontFamily: "Oswald",
                textTransform: "uppercase",
                letterSpacing: ".08em",
                color: "var(--color-primary)",
                display: "flex",
                justifyContent: "space-between",
                paddingBottom: 2,
                borderBottom: `2px solid var(--color-primary)`,
              }}
            >
              <span>{s.room}</span>
              <span className="dim" style={{ fontSize: 12 }}>
                {tradeCount} task{tradeCount === 1 ? "" : "s"} · {tradeHrs.toFixed(1)}h
              </span>
            </div>
          )}
          <div
            style={{
              padding: "4px 0",
              borderBottom: `1px solid ${border}`,
              fontSize: 14,
              display: "flex",
              alignItems: "flex-start",
              gap: 4,
            }}
          >
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
                <select
                  value={s.pri}
                  onChange={(e) => onEditStep(i, { pri: e.target.value as "HIGH" | "MED" | "LOW" })}
                  style={{ fontSize: 12, padding: "1px 4px", width: "auto", fontFamily: "Oswald" }}
                >
                  <option value="HIGH">HIGH</option>
                  <option value="MED">MED</option>
                  <option value="LOW">LOW</option>
                </select>
                <input
                  value={s.room}
                  onChange={(e) => onEditStep(i, { room: e.target.value })}
                  style={{ fontSize: 14, padding: "1px 4px", width: 100, color: "var(--color-primary)", fontWeight: 600 }}
                />
                <span>→</span>
                <input
                  value={s.detail}
                  onChange={(e) => onEditStep(i, { detail: e.target.value })}
                  style={{ fontSize: 14, padding: "1px 4px", flex: 1, minWidth: 80 }}
                />
                <input
                  type="number"
                  value={s.hrs === 0 ? "" : s.hrs}
                  placeholder="0"
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => {
                    const raw = e.target.value;
                    const v = raw === "" ? 0 : (parseFloat(raw) || 0);
                    onEditStep(i, { hrs: v });
                  }}
                  step=".25"
                  min="0"
                  style={{ fontSize: 13, padding: "1px 4px", width: 50, textAlign: "center" }}
                />
                <span className="dim" style={{ fontSize: 13 }}>h</span>
              </div>
              <input
                value={s.action}
                onChange={(e) => onEditStep(i, { action: e.target.value })}
                placeholder="Action / method"
                style={{ fontSize: 14, padding: "1px 4px", marginTop: 2, width: "100%", color: "#aaa" }}
              />
            </div>
            <button
              onClick={() => onRemoveStep(i)}
              title="Remove task"
              style={{ background: "none", color: "var(--color-accent-red)", fontSize: 14, padding: "0 4px" }}
            >
              ✕
            </button>
          </div>
          </div>
          );
        })}

        {/* Add new task */}
        <div style={{ marginTop: 8, padding: 6, border: `1px dashed ${border}`, borderRadius: 4 }}>
          <div className="dim" style={{ fontSize: 12, marginBottom: 4, fontFamily: "Oswald", textTransform: "uppercase", letterSpacing: ".08em" }}>
            + Add task
          </div>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 4 }}>
            <select
              value={taskPri}
              onChange={(e) => setTaskPri(e.target.value as "HIGH" | "MED" | "LOW")}
              style={{ fontSize: 12, padding: "2px 4px", width: "auto" }}
            >
              <option value="HIGH">HIGH</option>
              <option value="MED">MED</option>
              <option value="LOW">LOW</option>
            </select>
            <input
              value={taskRoom}
              onChange={(e) => setTaskRoom(e.target.value)}
              placeholder="Trade / area"
              style={{ fontSize: 14, padding: "2px 4px", width: 110 }}
            />
            <input
              value={taskDetail}
              onChange={(e) => setTaskDetail(e.target.value)}
              placeholder="Task"
              style={{ fontSize: 14, padding: "2px 4px", flex: 1, minWidth: 90 }}
            />
            <input
              type="number"
              value={taskHrs}
              onChange={(e) => setTaskHrs(e.target.value)}
              step=".25"
              min="0"
              style={{ fontSize: 13, padding: "2px 4px", width: 50, textAlign: "center" }}
            />
          </div>
          <div style={{ display: "flex", gap: 4 }}>
            <input
              value={taskAction}
              onChange={(e) => setTaskAction(e.target.value)}
              placeholder="Action / method (optional)"
              style={{ fontSize: 14, padding: "2px 4px", flex: 1 }}
            />
            <button
              onClick={() => {
                if (!taskDetail.trim()) return;
                onAddStep({
                  room: taskRoom.trim() || "General",
                  detail: taskDetail.trim(),
                  action: taskAction.trim(),
                  pri: taskPri,
                  hrs: parseFloat(taskHrs) || 1,
                });
                setTaskRoom("");
                setTaskDetail("");
                setTaskAction("");
                setTaskPri("MED");
                setTaskHrs("1");
              }}
              disabled={!taskDetail.trim()}
              style={{ background: "var(--color-primary)", color: "#fff", padding: "2px 10px", fontSize: 14, borderRadius: 4, opacity: taskDetail.trim() ? 1 : 0.5 }}
            >
              Add
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function IssuesTab({
  issues,
  darkMode,
}: {
  issues: ReturnType<typeof classify>;
  darkMode: boolean;
}) {
  const sections = [
    { t: "🚨 Critical", it: issues.critical, c: "var(--color-accent-red)" },
    { t: "⚠️ Important", it: issues.important, c: "var(--color-warning)" },
    { t: "💡 Minor", it: issues.minor, c: "var(--color-highlight)" },
  ];
  const border = darkMode ? "#1e1e2e" : "#eee";
  return (
    <>
      {sections.map((s, i) => (
        <div key={i} className="cd mb statusstrip" style={{ ["--c" as any]: s.c }}>
          <h4 style={{ color: s.c, fontSize: 15, marginBottom: 4 }}>
            {s.t} ({s.it.length})
          </h4>
          {!s.it.length ? (
            <span className="dim" style={{ fontSize: 13 }}>None</span>
          ) : (
            s.it.map((x, j) => (
              <div
                key={j}
                style={{
                  fontSize: 14,
                  padding: "3px 0",
                  borderBottom: `1px solid ${border}`,
                }}
              >
                <b>{x.room}</b> — {x.detail}: {x.comment}
              </div>
            ))
          )}
        </div>
      ))}
    </>
  );
}

function AddItemForm({
  nr, setNr, na, setNa, nd, setNd, nc, setNc, nh, setNh, nm, setNm,
  nsq, setNsq, ncn, setNcn, addItem, rooms,
  starterItems, unitsHint, primaryBucket, tierPick,
}: {
  nr: string; setNr: (v: string) => void;
  na: string; setNa: (v: string) => void;
  nd: string; setNd: (v: string) => void;
  nc: string; setNc: (v: string) => void;
  nh: string; setNh: (v: string) => void;
  nm: string; setNm: (v: string) => void;
  nsq: string; setNsq: (v: string) => void;
  ncn: "D" | "P" | "F" | "-"; setNcn: (v: "D" | "P" | "F" | "-") => void;
  addItem: () => void;
  rooms: Room[];
  // Trade-tailored quick-adds + unit hint (from the org's primary_trade).
  starterItems?: string[];
  unitsHint?: string;
  primaryBucket?: string;
  // Good-Better-Best: which options the new line goes into (options on only).
  tierPick?: { names: { better: string; best: string }; selected: TierKey[]; onChange: (t: TierKey[]) => void };
}) {
  // Suggest area names from the current quote: pull any "Bedroom 1 — …" or
  // "Kitchen — …" prefixes from existing detail strings so the user can
  // pick the same area they've used elsewhere instead of re-typing.
  const areaSuggestions = Array.from(new Set(
    rooms.flatMap((r) =>
      r.items
        .map((it) => it.detail.match(/^([^—\-:]+?)\s+—\s+/)?.[1]?.trim())
        .filter((x): x is string => Boolean(x)),
    ),
  )).sort();
  return (
    <div className="cd">
      {/* Trade-tailored starter items — only on a fresh quote (no rooms yet).
          Tapping prefills the item + its trade bucket; the user sets hrs/mat. */}
      {rooms.length === 0 && starterItems && starterItems.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 12 }} className="dim">
            Starter items{unitsHint ? ` · measured in ${unitsHint}` : ""}
          </label>
          <div className="row" style={{ flexWrap: "wrap", gap: 6, marginTop: 4 }}>
            {starterItems.map((s) => (
              <button
                key={s}
                type="button"
                className="bo"
                style={{ fontSize: 12.5, padding: "5px 10px", width: "auto" }}
                onClick={() => { setNd(s); if (primaryBucket && !nr) setNr(primaryBucket); }}
              >
                + {s}
              </button>
            ))}
          </div>
          <div className="dim" style={{ fontSize: 11, marginTop: 5 }}>
            Tap to prefill, then set hours &amp; materials.
          </div>
        </div>
      )}
      <div className="g2 mb">
        <div>
          <label style={{ fontSize: 12 }} className="dim">Trade *</label>
          <select value={nr} onChange={(e) => setNr(e.target.value)} style={{ fontSize: 15 }}>
            <option value="">— pick a trade —</option>
            {TRADE_CATEGORY_LIST.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
        <div>
          <label style={{ fontSize: 12 }} className="dim">Area / Room (optional)</label>
          <input
            value={na}
            onChange={(e) => setNa(e.target.value)}
            placeholder="e.g. Bedroom 1, Kitchen"
            list="area-suggest"
          />
          <datalist id="area-suggest">
            {areaSuggestions.map((a) => (
              <option key={a} value={a} />
            ))}
          </datalist>
        </div>
      </div>
      <div style={{ marginBottom: 8 }}>
        <label style={{ fontSize: 12 }} className="dim">Item *</label>
        <input
          value={nd}
          onChange={(e) => setNd(e.target.value)}
          placeholder="e.g. Caulk and paint baseboards"
        />
      </div>
      <div style={{ marginBottom: 8 }}>
        <label style={{ fontSize: 12 }} className="dim">Description (optional)</label>
        <input
          value={nc}
          onChange={(e) => setNc(e.target.value)}
          placeholder="Defaults to the item text — only override if you need more detail"
        />
      </div>
      <div className="g2 mb">
        <div>
          <label style={{ fontSize: 12 }} className="dim">Hours</label>
          <input
            type="number"
            value={nh}
            onChange={(e) => setNh(e.target.value)}
            min="0"
            step=".25"
          />
        </div>
        <div>
          <label style={{ fontSize: 12 }} className="dim">Mat $</label>
          <input
            type="number"
            value={nm}
            onChange={(e) => setNm(e.target.value)}
            min="0"
          />
        </div>
      </div>
      <div className="g2 mb">
        <div>
          <label style={{ fontSize: 12 }} className="dim">SQFT (optional)</label>
          <input
            type="number"
            value={nsq}
            onChange={(e) => setNsq(e.target.value)}
            min="0"
            step="1"
            placeholder="—"
          />
        </div>
        <div>
          <label style={{ fontSize: 12 }} className="dim">Condition</label>
          <select
            value={ncn}
            onChange={(e) => setNcn(e.target.value as "D" | "P" | "F" | "-")}
            style={{ fontSize: 15 }}
          >
            <option value="-">— project scope</option>
            <option value="D">D — Damaged / urgent</option>
            <option value="P">P — Poor / needed</option>
            <option value="F">F — Fair / minor</option>
          </select>
        </div>
      </div>
      {tierPick && (
        <div className="mb">
          <label style={{ fontSize: 12 }} className="dim">Add to option</label>
          <div className="row" style={{ gap: 6, marginTop: 4, flexWrap: "wrap" }}>
            {(["base", "better", "best"] as TierKey[]).map((k) => {
              const on = tierPick.selected.includes(k);
              const hue = k === "base" ? "#8a8a99" : k === "better" ? "#2E75B6" : "#9d4edd";
              const name = k === "base" ? "Base" : tierPick.names[k];
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => {
                    const next = on ? tierPick.selected.filter((x) => x !== k) : [...tierPick.selected, k];
                    if (next.length) tierPick.onChange((["base", "better", "best"] as TierKey[]).filter((x) => next.includes(x)));
                  }}
                  style={{
                    fontSize: 13, padding: "4px 12px", borderRadius: 999, cursor: "pointer",
                    border: on ? `2px solid ${hue}` : `1px solid ${hue}55`,
                    background: on ? `${hue}2e` : "transparent", color: on ? "#fff" : "#999",
                  }}
                >
                  {on ? "✓ " : ""}{name}
                </button>
              );
            })}
          </div>
        </div>
      )}
      <button className="bg" onClick={addItem}>Add Item</button>
    </div>
  );
}

/* ── Small UI pieces ── */

function ConditionBadge({ condition }: { condition: string }) {
  const map: Record<string, { label: string; bg: string; fg: string }> = {
    D: { label: "DMG", bg: "#C0000033", fg: "var(--color-accent-red)" },
    P: { label: "POOR", bg: "#ff880033", fg: "var(--color-warning)" },
    F: { label: "FAIR", bg: "#ffcc0033", fg: "var(--color-highlight)" },
  };
  const d = map[condition] || { label: "OK", bg: "#00cc6633", fg: "var(--color-success)" };
  return (
    <span
      style={{
        fontSize: 15,
        padding: "1px 5px",
        borderRadius: 3,
        background: d.bg,
        color: d.fg,
      }}
    >
      {d.label}
    </span>
  );
}

function PriorityBadge({ pri }: { pri: "HIGH" | "MED" | "LOW" }) {
  const map = {
    HIGH: { bg: "#C0000033", fg: "var(--color-accent-red)" },
    MED: { bg: "#ff880033", fg: "var(--color-warning)" },
    LOW: { bg: "#00cc6633", fg: "var(--color-success)" },
  };
  const d = map[pri];
  return (
    <span
      style={{
        fontSize: 15,
        padding: "1px 5px",
        borderRadius: 3,
        marginRight: 6,
        background: d.bg,
        color: d.fg,
      }}
    >
      {pri}
    </span>
  );
}

/* ── Saved Inspections File Cabinet ── */
// Collapsed into a single toggle so saved inspections don't clutter the Start
// screen; tap to expand and browse/quote/print/delete each one.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function SavedInspections({ jobs, onQuote, onEdit, onPrint, onDelete }: { jobs: any[]; onQuote: (data: any, existingId?: string) => void; onEdit: (insp: any) => void; onPrint: (insp: any, data: any, rooms: number, findings: number) => void; onDelete: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const inspections = jobs.filter((j) => j.status === "inspection");
  if (!inspections.length) return null;

  return (
    <div style={{ marginTop: 14 }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
          background: "none", border: "none", padding: "9px 2px",
          fontFamily: "Oswald", fontWeight: 600, fontSize: 14.5, letterSpacing: ".06em",
          color: "var(--color-dim)", cursor: "pointer",
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
          <Icon name="folder" size={15} color="var(--color-dim)" /> {t("qf.savedInspections")} · {inspections.length}
        </span>
        <Icon name={open ? "collapse" : "expand"} size={15} color="var(--color-dim)" />
      </button>
      {open && (
        <div style={{ marginTop: 6 }}>
          {inspections.map((insp) => {
            const inspData: Record<string, unknown> = readBlob(insp.rooms);
            const inspection = inspData.inspection as { rooms?: { name: string; items: { name: string; condition: string; comment: string; photos?: string[] }[] }[] } | undefined;
            const roomCount = inspection?.rooms?.length || 0;
            const findingsCount = inspection?.rooms?.reduce((s, r) => s + r.items.filter((it) => it.condition !== "S").length, 0) || 0;
            const mini: React.CSSProperties = { width: 28, height: 28, borderRadius: 8, background: "var(--color-card-dark-2)", border: "1px solid var(--color-border-dark-2)", color: "var(--color-dim)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 };

            return (
              <div key={insp.id} className="cd mb" style={{ padding: "11px 12px" }}>
                <div style={{ fontFamily: "Oswald", fontWeight: 600, fontSize: 15 }}>{insp.property || "Untitled"}</div>
                <div className="dim" style={{ fontSize: 12, margin: "2px 0 8px" }}>
                  {insp.client || "No client"} · {insp.job_date} · {roomCount} areas · {findingsCount} findings
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  <button onClick={() => {
                    if (!inspection) return;
                    // Normalize the saved-inspection shape (which uses
                    // `comment`) back into InspectionData (which uses
                    // `notes`) — otherwise the AI sees blank notes and
                    // every Quote This re-saves a duplicate inspection
                    // record. Carry the existing id so the handler skips
                    // the duplicate db.post.
                    const normalized = {
                      rooms: (inspection.rooms || []).map((r: any) => ({
                        name: r.name || "",
                        sqft: typeof r.sqft === "number" ? r.sqft : 0,
                        items: (r.items || []).map((it: any) => ({
                          name: it.name || "",
                          condition: it.condition || "S",
                          notes: it.notes ?? it.comment ?? "",
                          photos: it.photos || [],
                        })),
                      })),
                      property: insp.property || "",
                      client: insp.client || "",
                      customer_id: insp.customer_id || undefined,
                      address_id: insp.address_id || undefined,
                    };
                    onQuote(normalized, insp.id);
                  }} style={{ fontSize: 12.5, fontWeight: 600, color: "#1a1305", background: "#f5b400", border: "none", borderRadius: 8, padding: "6px 12px", cursor: "pointer", marginRight: "auto" }}>
                    {t("qf.quoteThis")}
                  </button>
                  <button onClick={() => onEdit(insp)} aria-label="Edit" style={mini}><Icon name="edit" size={14} /></button>
                  <button onClick={() => onPrint(insp, inspData, roomCount, findingsCount)} aria-label="Print" style={mini}><Icon name="print" size={14} /></button>
                  <button onClick={async () => {
                    if (await useStore.getState().showConfirm("Delete Inspection", "Delete this saved inspection?")) {
                      onDelete(insp.id);
                    }
                  }} aria-label="Delete" style={{ ...mini, color: "var(--color-accent-red)" }}><Icon name="delete" size={14} /></button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
