"use client";
import { useState, useRef, useEffect } from "react";
import { useStore } from "@/lib/store";
import { supabase, db } from "@/lib/supabase";
import type { Room, RoomItem, Material } from "@/lib/types";
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
} from "@/lib/parser";
import type { InspectionInput, GuideStep } from "@/lib/parser";
import { exportQuotePdf } from "@/lib/export-pdf";
import Inspector from "./Inspector";
import type { InspectionData } from "./Inspector";
import ClientSelect from "../ClientSelect";
import { t } from "@/lib/i18n";
import { Icon } from "../Icon";
import { wrapPrint, openPrint } from "@/lib/print-template";

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
    { label: "Reading document", icon: "📄", match: /reading|rendering|upload/i },
    { label: "Analyzing content", icon: "🔍", match: /analyzing|sending|text/i },
    { label: "Identifying repairs", icon: "🔧", match: /identify|photo|vision/i },
    { label: "Estimating costs", icon: "💰", match: /estimat|pric|cost/i },
    { label: "Building quote", icon: "📋", match: /build|generat|compil/i },
  ];
  const activeIdx = steps.findIndex((s) => s.match.test(status));
  const currentStep = activeIdx >= 0 ? activeIdx : status ? 1 : 0;

  return (
    <div style={{ padding: 20, textAlign: "center" }}>
      <div style={{ fontSize: 40, marginBottom: 12, animation: "pulse 1.5s ease-in-out infinite" }}>🤖</div>
      <style>{`@keyframes pulse { 0%,100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.1); opacity: 0.8; } } @keyframes shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }`}</style>
      <div style={{ fontSize: 14, fontFamily: "Oswald", color: "var(--color-primary)", marginBottom: 16 }}>
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
                width: 24, height: 24, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12,
                background: isDone ? "var(--color-success)" : isActive ? "var(--color-primary)" : "transparent",
                border: `2px solid ${isDone ? "var(--color-success)" : isActive ? "var(--color-primary)" : "#333"}`,
                color: isDone || isActive ? "#fff" : "#555",
              }}>
                {isDone ? "✓" : step.icon}
              </div>
              <span style={{ fontSize: 12, color: isDone ? "var(--color-success)" : isActive ? "#fff" : "#555", fontWeight: isActive ? 600 : 400 }}>
                {step.label}{isActive ? "..." : ""}
              </span>
            </div>
          );
        })}
      </div>

      {/* Progress bar */}
      <div style={{ marginTop: 16, height: 4, background: "#1e1e2e", borderRadius: 2, overflow: "hidden" }}>
        <div style={{
          height: 4, borderRadius: 2,
          background: "linear-gradient(90deg, var(--color-primary), var(--color-success), var(--color-primary))",
          backgroundSize: "200% 100%",
          animation: "shimmer 2s linear infinite",
          width: `${Math.max(10, ((currentStep + 1) / steps.length) * 100)}%`,
          transition: "width 0.5s",
        }} />
      </div>

      <div className="dim" style={{ fontSize: 12, marginTop: 8 }}>
        {status || "This usually takes 15-30 seconds"}
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

  const [mode, setMode] = useState<null | "paste" | "manual" | "edit" | "inspect" | "quick">(null);
  const [text, setText] = useState("");
  const [prop, setProp] = useState("");
  const [client, setClient] = useState("");
  const [rooms, setRooms] = useState<Room[]>([]);
  const [tab, setTab] = useState("quote");
  const [workers, setWorkers] = useState<string[]>([]);
  const [parsing, setParsing] = useState(false);
  const [parseStatus, setParseStatus] = useState("");
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [quickPhotos, setQuickPhotos] = useState<string[]>([]);
  const [quickDesc, setQuickDesc] = useState("");
  const [quickUploading, setQuickUploading] = useState(false);
  const quickPhotoRef = useRef<HTMLInputElement>(null);
  const quickCameraRef = useRef<HTMLInputElement>(null);
  const [jobPhotos, setJobPhotos] = useState<{ url: string; label: string; type: "before" | "after" | "work" }[]>([]);
  const [inspectionData, setInspectionData] = useState<InspectionData | null>(null);
  // Editable work order — null means "use auto-generated from guide.steps"
  const [customWorkOrder, setCustomWorkOrder] = useState<GuideStep[] | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const galleryRef = useRef<HTMLInputElement>(null);

  // Pre-load job data when editing
  useEffect(() => {
    if (!editJobId) return;
    const job = jobs.find((j) => j.id === editJobId);
    if (!job) return;

    setProp(job.property || "");
    setClient(job.client || "");
    setEditingId(job.id);

    try {
      const data = typeof job.rooms === "string" ? JSON.parse(job.rooms) : job.rooms;
      if (data?.rooms?.length) {
        setRooms(validateQuote(data.rooms));
      }
      if (data?.workers?.length) {
        setWorkers(data.workers.map((w: { id: string }) => w.id));
      }
      if (data?.workOrder?.length) {
        // Preserve any prior edits (incl. `done` checkboxes from Jobs/WorkVision)
        setCustomWorkOrder(data.workOrder.map((s: GuideStep) => ({
          room: s.room, detail: s.detail, action: s.action, pri: s.pri, hrs: s.hrs,
        })));
      }
    } catch {
      // rooms parse failed, start empty
    }

    setMode("edit");
    clearEditJob?.();
  }, [editJobId, jobs, clearEditJob]);

  // Add-item form state
  const [nr, setNr] = useState("");
  const [nd, setNd] = useState("");
  const [nc, setNc] = useState("");
  const [nh, setNh] = useState("1");
  const [nm, setNm] = useState("20");

  const fileRef = useRef<HTMLInputElement>(null);
  const org = useStore((s) => s.org);
  const defaultRate = user.rate || 55;

  // Get trade-specific rate or fall back to user rate
  const tradeRates: Record<string, number> = (() => {
    try { return org?.trade_rates ? JSON.parse(org.trade_rates) : {}; } catch { return {}; }
  })();
  const getRateForRoom = (roomName: string): number => {
    // Check if room name matches a trade
    for (const [trade, r] of Object.entries(tradeRates)) {
      if (roomName.toLowerCase().includes(trade.toLowerCase())) return r;
    }
    return defaultRate;
  };
  const rate = defaultRate; // fallback for non-trade-specific uses

  /* ── AI parse (vision + text) with regex fallback ── */
  /* ── Inspection complete handler ── */
  const handleInspectionComplete = async (data: InspectionData) => {
    setParsing(true);
    setParseStatus("Reading inspection report...");
    setMode("edit");

    setProp(data.property);
    setClient(data.client);
    setInspectionData(data);

    // Save inspection as standalone record
    try {
      await db.post("jobs", {
        property: data.property,
        client: data.client,
        job_date: new Date().toISOString().split("T")[0],
        rooms: JSON.stringify({
          inspection: {
            rooms: data.rooms.map((r) => ({
              name: r.name,
              sqft: r.sqft,
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

    // Collect all inspection photos and add to job gallery
    const inspectionPhotos: { url: string; label: string; type: "before" | "after" | "work" }[] = [];
    (data.rooms || []).forEach((room) => {
      (room.items || []).forEach((item) => {
        (item.photos || []).forEach((url) => {
          inspectionPhotos.push({ url, label: `${room.name} — ${item.name}`, type: "before" });
        });
      });
    });
    if (inspectionPhotos.length) setJobPhotos((prev) => [...prev, ...inspectionPhotos]);

    try {
      const input: InspectionInput = {
        rooms: data.rooms,
        property: data.property,
        client: data.client,
      };
      let licensedTradesInsp: string[] = [];
      try { licensedTradesInsp = org?.licensed_trades ? JSON.parse(org.licensed_trades) : []; } catch { /* */ }
      setParseStatus("Identifying repairs from findings...");
      const result = await aiParseInspection(input, rate, licensedTradesInsp);
      if (result && result.rooms.length > 0) {
        setParseStatus("Building quote...");
        setRooms(validateQuote(result.rooms));
        setParsing(false);
        setParseStatus("");
        return;
      }
    } catch (e) {
      console.error("AI inspection parse failed:", e);
    }

    // Fallback: convert inspection directly to rooms without AI
    setParseStatus("");
    setParsing(false);
    const fallbackRooms = data.rooms
      .map((r) => ({
        name: r.name,
        items: r.items
          .filter((it) => it.condition !== "S")
          .map((it) => ({
            id: crypto.randomUUID().slice(0, 8),
            detail: it.name,
            condition: it.condition,
            comment: it.notes || "Needs attention",
            laborHrs: 1,
            materials: [{ n: "Materials", c: 0 }] as { n: string; c: number }[],
          })),
      }))
      .filter((r) => r.items.length > 0);
    setRooms(validateQuote(fallbackRooms));
  };

  const doAiParse = async (rawText: string, file: File | null) => {
    setParsing(true);
    setParseStatus("Analyzing with AI...");

    try {
      // Get page images if we have a small PDF, or use paste photos
      // Skip images for large PDFs (>2MB) — text-only avoids Vercel 4.5MB body limit
      let images: string[] = [];
      if (file && file.name.endsWith(".pdf")) {
        if (file.size < 2 * 1024 * 1024) {
          // Small PDF — send up to 5 pages as images + text
          setParseStatus("Rendering PDF pages...");
          images = await renderPdfPages(file, 5);
          setParseStatus(`Sending ${images.length} pages + text to AI...`);
        } else {
          // Large PDF — send first 3 key pages as images + all text
          setParseStatus(`Large PDF (${(file.size / 1024 / 1024).toFixed(1)}MB) — rendering key pages...`);
          try {
            images = await renderPdfPages(file, 3);
            setParseStatus(`Sending ${images.length} key pages + text to AI...`);
          } catch (e) {
            console.warn("Failed to render pages for large PDF:", e);
            setParseStatus("Sending text only to AI...");
          }
        }
      } else if (quickPhotos.length > 0) {
        // Photos are now URLs — fetch and convert to base64 for AI
        const urlsToSend = quickPhotos.slice(0, 15);
        setParseStatus(`Loading ${urlsToSend.length} photos for AI...`);
        for (const url of urlsToSend) {
          try {
            if (url.startsWith("data:")) { images.push(url); continue; }
            const resp = await fetch(url);
            const blob = await resp.blob();
            const b64 = await new Promise<string>((res) => {
              const reader = new FileReader();
              reader.onloadend = () => res(reader.result as string);
              reader.readAsDataURL(blob);
            });
            images.push(b64);
          } catch { /* skip failed fetches */ }
        }
        setParseStatus(`Sending text + ${images.length} photos to AI...`);
      } else {
        setParseStatus("Sending text to AI...");
      }

      let licensedTrades: string[] = [];
      try { licensedTrades = org?.licensed_trades ? JSON.parse(org.licensed_trades) : []; } catch { /* */ }
      const result = await aiParsePdf(rawText, images, rate, licensedTrades, extractZip(prop));

      if (result && result.rooms.length > 0) {
        if (result.property && !prop) setProp(result.property);
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
        setRooms(validateQuote(result.rooms));
        setParsing(false);
        setParseStatus("");
        setMode("edit");
        return;
      }
    } catch (e) {
      console.error("AI parse error:", e);
      useStore.getState().showToast("AI parsing failed — trying built-in parser", "warning");
    }

    // Fallback to regex parser. Also carry Quick Quote photos onto the job
    // so they don't get lost when AI is unavailable.
    if (quickPhotos.length > 0) {
      const beforePhotos = quickPhotos.map((url) => ({
        url, label: "Quick Quote", type: "before" as const,
      }));
      setJobPhotos((prev) => {
        const existing = new Set(prev.map((p) => p.url));
        return [...prev, ...beforePhotos.filter((p) => !existing.has(p.url))];
      });
    }
    setParseStatus("AI unavailable — using built-in parser...");
    doRegexParse(rawText);
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
    if (!f) return;
    setParsing(true);
    setParseStatus("Reading file...");
    try {
      if (f.name.endsWith(".pdf")) {
        setPdfFile(f);
        setParseStatus(`Reading PDF (${(f.size / 1024 / 1024).toFixed(1)}MB)...`);
        const t = await readPdf(f);
        if (!t.trim()) {
          useStore.getState().showToast("PDF appears empty — try pasting text instead", "warning");
          setParsing(false);
          setParseStatus("");
          setMode("paste");
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

  /* ── Add item ── */
  const addItem = () => {
    if (!nr || !nd) return;
    const it: RoomItem = {
      id: crypto.randomUUID().slice(0, 8),
      detail: nd,
      condition: "-",
      comment: nc || "Per scope",
      laborHrs: parseFloat(nh) || 1,
      materials: [{ n: "Materials", c: parseFloat(nm) || 0 }],
    };
    const ex = rooms.find((r) => r.name === nr);
    if (ex) {
      setRooms(
        rooms.map((r) =>
          r.name === nr ? { ...r, items: [...r.items, it] } : r
        )
      );
    } else {
      setRooms([...rooms, { name: nr, items: [it] }]);
    }
    // Track custom material for AI learning. Tag with the property's ZIP so
    // future quotes in the same area weight these prices over out-of-region.
    db.post("price_corrections", {
      item_name: nd,
      original_hours: 0,
      corrected_hours: parseFloat(nh) || 1,
      original_mat_cost: 0,
      corrected_mat_cost: parseFloat(nm) || 0,
      material_name: "Custom item",
      trade: nr,
      zip: extractZip(prop),
    });
    setNd("");
    setNc("");
    setNh("1");
    setNm("20");
    if (mode !== "edit") setMode("edit");
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

  const upItem = (rn: string, id: string, field: string, value: number | Material[]) => {
    // Defensive: refuse to operate on a falsy id. Without this guard,
    // `i.id === id` would match every other item whose id is also undefined
    // and the patch would update them all at once.
    if (!id) {
      console.warn("upItem called without an item id — refusing to update");
      return;
    }
    // Track corrections for AI learning
    const room = rooms.find((r) => r.name === rn);
    const item = room?.items.find((i) => i.id === id);
    if (item && (field === "laborHrs" || field === "materials")) {
      const origHrs = item.laborHrs;
      const origMat = item.materials.reduce((s, m) => s + (m.c || 0), 0);
      const newHrs = field === "laborHrs" ? (value as number) : origHrs;
      const newMat = field === "materials" ? (value as Material[]).reduce((s, m) => s + (m.c || 0), 0) : origMat;
      // Only log if there's a meaningful change
      if (Math.abs(newHrs - origHrs) > 0.1 || Math.abs(newMat - origMat) > 2) {
        db.post("price_corrections", {
          item_name: item.detail,
          original_hours: origHrs,
          corrected_hours: newHrs,
          original_mat_cost: origMat,
          corrected_mat_cost: newMat,
          material_name: field === "materials" ? (value as Material[]).map((m) => m.n).join(", ") : item.materials.map((m) => m.n).join(", "),
          trade: rn,
          zip: extractZip(prop),
        });
      }
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

  /* ── Calculations ── */
  const markupPct = org?.markup_pct || 0;
  const taxPct = org?.tax_pct || 0;
  const all = rooms.flatMap((r) =>
    r.items.map((i) => {
      const roomRate = getRateForRoom(r.name);
      const cost = calculateCost(i, roomRate);
      // Apply markup to materials
      if (markupPct > 0) cost.mc = Math.round(cost.mc * (1 + markupPct / 100) * 100) / 100;
      cost.tot = Math.round((cost.lc + cost.mc) * 100) / 100;
      return { room: r.name, ...i, ...cost };
    })
  );
  const subtotal = all.reduce((s, i) => s + i.tot, 0);
  const taxAmount = taxPct > 0 ? Math.round(subtotal * (taxPct / 100) * 100) / 100 : 0;
  const gt = Math.round((subtotal + taxAmount) * 100) / 100;
  const tl = all.reduce((s, i) => s + i.lc, 0);
  const tm = all.reduce((s, i) => s + i.mc, 0);
  const th = all.reduce((s, i) => s + i.laborHrs, 0);
  const issues = classify(rooms);
  const guide = makeGuide(rooms);

  /* ── Save job ── */
  const saveJob = async () => {
    if (!prop.trim()) {
      useStore.getState().showToast("Enter a property address", "warning");
      return;
    }
    if (rooms.length === 0) {
      useStore.getState().showToast("Add at least one item to the quote", "warning");
      return;
    }
    if (gt <= 0 && !await useStore.getState().showConfirm("Empty Quote", "Quote total is $0. Save anyway?")) {
      return;
    }
    // Use custom work order if user edited it, otherwise auto-generate from guide
    const sourceSteps = customWorkOrder ?? guide.steps;
    const workOrder = sourceSteps.map((s) => ({
      room: s.room, detail: s.detail, action: s.action, pri: s.pri, hrs: s.hrs, done: false,
    }));
    const data = {
      rooms: rooms,
      workers: workers.map((wid) => {
        const u = profiles.find((x) => x.id === wid);
        return { id: wid, name: u?.name || "" };
      }),
      photos: jobPhotos,
      workOrder,
      inspection: inspectionData ? {
        rooms: inspectionData.rooms.map((r) => ({
          name: r.name,
          items: r.items.map((it) => ({ name: it.name, condition: it.condition, comment: it.notes, photos: it.photos })),
        })),
        property: inspectionData.property,
        client: inspectionData.client,
      } : undefined,
    };
    const jobData = {
      property: prop,
      client: client || "",
      job_date: new Date().toISOString().split("T")[0],
      rooms: JSON.stringify(data),
      total: gt,
      total_labor: tl,
      total_mat: tm,
      total_hrs: th,
      status: "quoted" as const,
      created_by: user.name,
    };

    if (editingId) {
      await db.patch("jobs", editingId, jobData);
      useStore.getState().showToast("Job updated: " + prop, "success");
    } else {
      await db.post("jobs", jobData);
      useStore.getState().showToast("Job created: " + prop, "success");
    }

    await loadAll();
    setMode(null);
    setRooms([]);
    setText("");
    setProp("");
    setClient("");
    setWorkers([]);
    setCustomWorkOrder(null);
    setEditingId(null);
    setPage("jobs");
  };

  /* ══════════════════════════════════════════
     START SCREEN
     ══════════════════════════════════════════ */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const printInspection = (insp: any, inspData: any, roomCount: number, findingsCount: number) => {
    const esc = (s: string) =>
      String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const orgN = org?.name || "Service Provider";
    const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    const reportNum = "INS-" + (insp.id || "").slice(0, 6).toUpperCase();
    const rms = inspData?.inspection?.rooms || [];

    let areasHtml = "";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rms.forEach((r: any) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows = r.items.map((it: any) => {
        const cc = it.condition === "D" ? "#C00000" : it.condition === "P" ? "#ff8800" : it.condition === "F" ? "#ffcc00" : "#00cc66";
        const cl = it.condition === "D" ? "DAMAGED" : it.condition === "P" ? "POOR" : it.condition === "F" ? "FAIR" : "OK";
        const photos = it.photos?.length
          ? it.photos.slice(0, 3).map((u: string) => `<img src="${esc(u)}" alt="" style="width:44px;height:44px;object-fit:cover;border-radius:4px;margin-right:2px;border:1px solid #ddd" />`).join("")
          : "";
        return `<tr><td><b>${esc(it.name)}</b></td><td class="r"><span style="font-family:Oswald,sans-serif;font-size:10px;padding:2px 8px;border-radius:3px;background:${cc}22;color:${cc};letter-spacing:.06em">${cl}</span></td><td class="dim">${esc(it.comment || "")}</td><td>${photos}</td></tr>`;
      }).join("");
      areasHtml += `<h3>${esc(r.name)}</h3>
<table>
  <thead>
    <tr>
      <th>Item</th>
      <th class="r" style="width:90px">Condition</th>
      <th>Notes</th>
      <th style="width:160px">Photos</th>
    </tr>
  </thead>
  <tbody>${rows}</tbody>
</table>`;
    });

    const body = `
<section style="display:flex;gap:12px;margin-bottom:18px">
  <div class="box" style="flex:1;text-align:center;padding:14px">
    <div style="font-family:Oswald,sans-serif;font-size:30px;font-weight:700;color:#2E75B6;line-height:1">${roomCount}</div>
    <div class="label" style="margin-top:6px">Areas Inspected</div>
  </div>
  <div class="box" style="flex:1;text-align:center;padding:14px">
    <div style="font-family:Oswald,sans-serif;font-size:30px;font-weight:700;color:#ff8800;line-height:1">${findingsCount}</div>
    <div class="label" style="margin-top:6px">Findings</div>
  </div>
</section>

<section class="grid-2" style="margin-bottom:14px">
  <div class="box"><div class="label">Property</div><div class="value">${esc(insp.property || "—")}</div></div>
  <div class="box"><div class="label">Client</div><div class="value">${esc(insp.client || "—")}</div></div>
</section>

<h2>Findings by Area</h2>
${areasHtml || '<div class="dim" style="text-align:center;padding:18px">No findings recorded.</div>'}
`;

    const html = wrapPrint(
      {
        orgName: orgN,
        orgPhone: org?.phone,
        orgEmail: org?.email,
        orgAddress: org?.address,
        orgLicense: org?.license_num,
        orgLogo: org?.logo_url,
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

  if (!mode) {
    return (
      <div className="fi">
        <h2 style={{ fontSize: 22, color: "var(--color-primary)", marginBottom: 14, display: "inline-flex", alignItems: "center", gap: 8 }}>
          <Icon name="quote" size={22} color="var(--color-primary)" />
          QuoteForge Pro
        </h2>
        {parsing && (
          <div className="cd mb">
            <AiLoadingDisplay status={parseStatus} />
          </div>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 10 }}>
          {/* Quick Quote */}
          <div
            onClick={() => setMode("quick")}
            style={{
              background: "linear-gradient(135deg, #2E75B6, #1a4d8a)",
              borderRadius: 12,
              padding: "20px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 14,
              position: "relative",
            }}
          >
            <span style={{ position: "absolute", top: 8, right: 10, fontSize: 11, color: "#C00000", fontFamily: "Oswald" }}>Small jobs</span>
            <div style={{ fontSize: 36 }}>📸</div>
            <div>
              <h4 style={{ color: "#fff", fontSize: 16, margin: 0 }}>Quick Quote</h4>
              <p style={{ color: "#ffffffaa", fontSize: 13, fontFamily: "Source Sans 3", textTransform: "none", letterSpacing: "normal", margin: "2px 0 0" }}>
                Describe the issue, add photos → AI generates a quote
              </p>
            </div>
          </div>

          {/* Inspect */}
          <div
            onClick={() => setMode("inspect")}
            style={{
              background: darkMode ? "#12121a" : "#fff",
              border: `2px solid var(--color-success)`,
              borderRadius: 12,
              padding: "20px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 14,
              position: "relative",
            }}
          >
            <span style={{ position: "absolute", top: 8, right: 10, fontSize: 11, color: "var(--color-success)", fontFamily: "Oswald" }}>Most accurate</span>
            <div style={{ fontSize: 36 }}>🔍</div>
            <div>
              <h4 style={{ color: "var(--color-success)", fontSize: 16, margin: 0 }}>Full Inspection</h4>
              <p style={{ color: "#888", fontSize: 13, fontFamily: "Source Sans 3", textTransform: "none", letterSpacing: "normal", margin: "2px 0 0" }}>
                Area-by-area walkthrough with conditions and photos
              </p>
            </div>
          </div>

          {/* Upload PDF */}
          <div
            onClick={() => fileRef.current?.click()}
            style={{
              background: darkMode ? "#12121a" : "#fff",
              border: `1px solid ${darkMode ? "#1e1e2e" : "#e0e0e0"}`,
              borderRadius: 12,
              padding: "20px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 14,
              position: "relative",
            }}
          >
            <span style={{ position: "absolute", top: 8, right: 10, fontSize: 11, color: "var(--color-warning)", fontFamily: "Oswald" }}>PDF reports</span>
            <div style={{ fontSize: 36 }}>📁</div>
            <div>
              <h4 style={{ color: "var(--color-warning)", fontSize: 16, margin: 0 }}>Upload Report</h4>
              <p style={{ color: "#888", fontSize: 13, fontFamily: "Source Sans 3", textTransform: "none", letterSpacing: "normal", margin: "2px 0 0" }}>
                Upload a PDF inspection report for AI analysis
              </p>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.txt"
              style={{ display: "none" }}
              onChange={handleFile}
            />
          </div>
        </div>

      <SavedInspections jobs={jobs} onQuote={handleInspectionComplete} onPrint={printInspection} onDelete={async (id) => { await db.del("jobs", id); loadAll(); }} />
    </div>
    );
  }

  /* ══════════════════════════════════════════
     INSPECT MODE
     ══════════════════════════════════════════ */
  if (mode === "inspect")
    return (
      <Inspector
        darkMode={darkMode}
        onCancel={() => setMode(null)}
        onComplete={handleInspectionComplete}
      />
    );

  /* ══════════════════════════════════════════
     QUICK QUOTE MODE
     ══════════════════════════════════════════ */
  if (mode === "quick")
    return (
      <div className="fi">
        <div className="row mb">
          <button className="bo" onClick={() => { setMode(null); setQuickPhotos([]); setQuickDesc(""); }}>←</button>
          <h2 style={{ fontSize: 18, color: "var(--color-accent-red)" }}>📸 Quick Quote</h2>
        </div>

        {/* Property + Client */}
        <div className="cd mb">
          <div className="g2">
            <input value={prop} onChange={(e) => setProp(e.target.value)} placeholder="Property address *" />
            <ClientSelect value={client} onChange={setClient} />
          </div>
        </div>

        {/* Description */}
        <div className="cd mb">
          <label style={{ fontSize: 12, color: "#888", fontFamily: "Oswald", textTransform: "uppercase", letterSpacing: ".08em" }}>
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
            <label style={{ fontSize: 12, color: "#888", fontFamily: "Oswald", textTransform: "uppercase", letterSpacing: ".08em" }}>
              Photos ({quickPhotos.length})
            </label>
            <div className="row" style={{ gap: 4 }}>
              <button
                className="bb"
                onClick={() => quickCameraRef.current?.click()}
                disabled={quickUploading}
                style={{ fontSize: 12, padding: "4px 10px" }}
              >
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6, justifyContent: "center" }}>
                  <Icon name="camera" size={16} />Take Photo
                </span>
              </button>
              <button
                className="bo"
                onClick={() => quickPhotoRef.current?.click()}
                disabled={quickUploading}
                style={{ fontSize: 12, padding: "4px 10px" }}
              >
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6, justifyContent: "center" }}>
                  <Icon name="upload" size={16} />Upload
                </span>
              </button>
            </div>
          </div>

          {quickUploading && <div className="dim" style={{ fontSize: 13, textAlign: "center", marginBottom: 6 }}>Processing photos...</div>}

          <input
            ref={quickCameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            style={{ display: "none" }}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setQuickUploading(true);
              try {
                // Upload to Supabase, store only URL (not base64)
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
              if (quickCameraRef.current) quickCameraRef.current.value = "";
            }}
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
              setQuickUploading(true);
              for (const file of Array.from(files)) {
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
              }
              setQuickUploading(false);
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
                      borderRadius: "50%", width: 16, height: 16, fontSize: 13,
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
              <div style={{ fontSize: 11 }}>Add photos of the issue for better accuracy</div>
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
              width: "100%", padding: 14, fontSize: 16,
              opacity: !quickDesc.trim() && !quickPhotos.length ? 0.5 : 1,
            }}
          >
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8, justifyContent: "center" }}>
              <Icon name="ai" size={18} />Generate Quote
            </span>
          </button>
        )}

        {/* Manual add option */}
        <div style={{ textAlign: "center", marginTop: 12 }}>
          <button
            className="bo"
            onClick={() => { setMode("manual"); }}
            style={{ fontSize: 13, padding: "6px 14px" }}
          >
            ✏️ Build manually instead
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
        <div className="row mb">
          <button className="bo" onClick={() => setMode(null)}>←</button>
          <h2 style={{ fontSize: 18, color: "var(--color-primary)" }}>Parse Report</h2>
        </div>
        <div className="cd">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste report text here..."
            style={{ height: 200, fontFamily: "monospace", fontSize: 11 }}
          />
          <div className="g2 mt">
            <input
              value={prop}
              onChange={(e) => setProp(e.target.value)}
              placeholder="Property address"
            />
            <ClientSelect value={client} onChange={setClient} />
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
        <div className="row mb">
          <button className="bo" onClick={() => setMode(null)}>←</button>
          <h2 style={{ fontSize: 18, color: "var(--color-warning)" }}>Manual Quote</h2>
        </div>
        <div className="cd mb">
          <div className="g2">
            <input
              value={prop}
              onChange={(e) => setProp(e.target.value)}
              placeholder="Property *"
            />
            <ClientSelect value={client} onChange={setClient} />
          </div>
        </div>
        <AddItemForm
          nr={nr} setNr={setNr} nd={nd} setNd={setNd} nc={nc} setNc={setNc}
          nh={nh} setNh={setNh} nm={nm} setNm={setNm} addItem={addItem}
          rooms={rooms}
        />
      </div>
    );

  /* ══════════════════════════════════════════
     EDIT MODE
     ══════════════════════════════════════════ */
  if (parsing && rooms.length === 0) {
    return (
      <div className="fi">
        <div className="row mb">
          <button className="bo" onClick={() => { setMode(null); setParsing(false); setParseStatus(""); }}>←</button>
          <h2 style={{ fontSize: 18, color: "var(--color-primary)" }}>⚡ Building Quote</h2>
        </div>
        <div className="cd">
          <AiLoadingDisplay status={parseStatus || "Processing inspection..."} />
        </div>
      </div>
    );
  }

  return (
    <div className="fi">
      {/* Header */}
      <div className="row mb">
        <button className="bo" onClick={() => { setMode(null); setRooms([]); }}>←</button>
        <h2 style={{ fontSize: 18, color: "var(--color-primary)" }}>⚡ Quote</h2>
        <span style={{ fontSize: 10 }} className="dim">${rate}/hr</span>
      </div>

      {/* Property + Total */}
      <div
        className="cd mb"
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        <div style={{ flex: "1 1 160px" }}>
          <input
            value={prop}
            onChange={(e) => setProp(e.target.value)}
            placeholder="Property *"
            style={{ marginBottom: 4, fontSize: 13 }}
          />
          <ClientSelect value={client} onChange={setClient} style={{ fontSize: 13 }} />
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="sl">Total</div>
          <div
            style={{
              fontSize: 28,
              fontFamily: "Oswald",
              fontWeight: 700,
              color: "var(--color-success)",
            }}
          >
            ${gt.toFixed(2)}
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="g4 mb">
        {[
          { l: "Labor", v: "$" + tl.toFixed(0), c: "var(--color-primary)" },
          { l: markupPct > 0 ? `Mat +${markupPct}%` : "Materials", v: "$" + tm.toFixed(0), c: "var(--color-warning)" },
          { l: "Hours", v: th.toFixed(1), c: "var(--color-highlight)" },
          ...(taxPct > 0 ? [{ l: `Tax ${taxPct}%`, v: "$" + taxAmount.toFixed(0), c: "var(--color-accent-red)" }] : []),
        ].map((x, i) => (
          <div key={i} className="cd" style={{ textAlign: "center", padding: 8 }}>
            <div className="sl">{x.l}</div>
            <div style={{ fontSize: 16, fontFamily: "Oswald", color: x.c }}>{x.v}</div>
          </div>
        ))}
      </div>

      {/* AI Re-quote */}
      <div className="cd mb">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <h4 style={{ fontSize: 13, display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Icon name="ai" size={14} color="var(--color-primary)" />AI Assist
          </h4>
        </div>
        <div className="row">
          <input
            value={quickDesc}
            onChange={(e) => setQuickDesc(e.target.value)}
            placeholder="Describe additional work to add..."
            style={{ flex: 1, fontSize: 13 }}
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
                const res = await fetch("/api/ai", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    model: "claude-sonnet-4-20250514",
                    max_tokens: 4000,
                    messages: [{ role: "user", content: [{ type: "text", text: `Additional work for ${prop || "property"}: ${quickDesc}\n\nReturn JSON with rooms array only. Same format as before. Group by trade category.` }] }],
                    system: `You are a field service quoting engine. Return ONLY valid JSON: {"rooms":[{"name":"Trade Category","items":[{"detail":"Brief description","condition":"-","comment":"Work description","laborHrs":1,"materials":[{"n":"Material","c":10}]}]}]}. Use realistic hours and material prices. Licensed trades: ${licensedTrades.join(", ") || "none"}.`,
                  }),
                });
                const data = await res.json();
                const text = data.content?.[0]?.text || "";
                const match = text.match(/\{[\s\S]*\}/);
                if (match) {
                  const parsed = JSON.parse(match[0]);
                  if (parsed.rooms?.length) {
                    // Merge new rooms into existing
                    const merged = [...rooms];
                    parsed.rooms.forEach((newRoom: Room) => {
                      const existing = merged.find((r) => r.name === newRoom.name);
                      if (existing) {
                        existing.items.push(...newRoom.items);
                      } else {
                        merged.push(newRoom);
                      }
                    });
                    setRooms(validateQuote(merged));
                    useStore.getState().showToast("AI added items to your quote", "success");
                  }
                }
              } catch (e) { console.error(e); useStore.getState().showToast("AI failed — try again", "error"); }
              setParsing(false);
              setParseStatus("");
              setQuickDesc("");
            }}
            style={{ fontSize: 12, padding: "6px 12px" }}
          >
            {parsing ? "..." : "+ Add"}
          </button>
        </div>
        {parseStatus && <div className="dim" style={{ fontSize: 12, marginTop: 4 }}>{parseStatus}</div>}
      </div>

      {/* Assign Workers */}
      <div className="cd mb">
        <h4 style={{ fontSize: 13, marginBottom: 6, display: "inline-flex", alignItems: "center", gap: 6 }}>
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
                fontSize: 12,
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
              {workers.includes(u.id) ? "✓ " : ""}
              {u.name}
            </button>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 3, marginBottom: 12, flexWrap: "wrap" }}>
        {[
          { id: "quote", l: "📄Quote" },
          { id: "guide", l: "🔧Guide" },
          { id: "issues", l: "⚠️Issues" },
          { id: "photos", l: "📸Photos" },
          { id: "add", l: "➕Add" },
        ].map((x) => (
          <button
            key={x.id}
            onClick={() => setTab(x.id)}
            style={{
              padding: "5px 12px",
              background:
                tab === x.id
                  ? "var(--color-primary)"
                  : darkMode
                  ? "#12121a"
                  : "#fff",
              color: tab === x.id ? "#fff" : "#888",
              border: `1px solid ${
                tab === x.id
                  ? "var(--color-primary)"
                  : darkMode
                  ? "#1e1e2e"
                  : "#ddd"
              }`,
              borderRadius: "6px 6px 0 0",
              fontFamily: "Oswald",
              fontSize: 13,
            }}
          >
            {x.l}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button
          className="bo"
          onClick={() =>
            (() => {
              const o = useStore.getState().org;
              const clientData = useStore.getState().clients.find((c) => c.name === client);
              exportQuotePdf({
                property: prop,
                client,
                clientPhone: clientData?.phone,
                clientEmail: clientData?.email,
                rooms,
                rate,
                workers: workers.map((wid) => {
                  const u = profiles.find((x) => x.id === wid);
                  return { id: wid, name: u?.name || "" };
                }),
                grandTotal: gt,
                totalLabor: tl,
                totalMat: tm,
                totalHrs: th,
                orgName: o?.name,
                orgPhone: o?.phone,
                orgEmail: o?.email,
                orgLicense: o?.license_num,
                orgAddress: o?.address,
                orgLogo: o?.logo_url,
                photos: jobPhotos,
                markupPct,
                taxPct,
                taxAmount,
              });
            })()
          }
          style={{ fontSize: 12, padding: "6px 16px" }}
        >
          📄 Export PDF
        </button>
        <button
          className="bo"
          onClick={() => {
            const clientData = profiles.length ? useStore.getState().clients.find((c: { name: string }) => c.name === client) : null;
            const email = clientData?.email || "";
            const orgName = useStore.getState().org?.name || "Service Provider";
            const subject = encodeURIComponent(`Quote — ${prop}`);
            const body = encodeURIComponent(
              `Hi ${client || "there"},\n\n` +
              `Please find your property repair quote for ${prop}.\n\n` +
              `Total: $${gt.toFixed(2)}\n` +
              `Labor: $${tl.toFixed(2)} (${th.toFixed(1)} hours)\n` +
              `Materials: $${tm.toFixed(2)}\n\n` +
              `This quote is valid for 30 days.\n\n` +
              `Thank you,\n${orgName}\n`
            );
            window.open(`mailto:${email}?subject=${subject}&body=${body}`, "_self");
          }}
          style={{ fontSize: 12, padding: "6px 16px" }}
        >
          ✉ Send Quote
        </button>
        <button
          className="bg"
          onClick={saveJob}
          style={{ fontSize: 12, padding: "6px 16px" }}
        >
          {editingId ? "Update Job →" : "Save & Create Job →"}
        </button>
      </div>

      {/* QUOTE TAB */}
      {tab === "quote" && <QuoteTab rooms={rooms} rate={rate} darkMode={darkMode} upItem={upItem} rmItem={rmItem} getRateForRoom={getRateForRoom} />}

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
              return base.filter((_, idx) => idx !== i);
            });
          }}
          onAddStep={(step) => {
            setCustomWorkOrder((curr) => {
              const base = curr ?? guide.steps.map((s) => ({ ...s }));
              return [...base, step];
            });
          }}
          onReset={() => setCustomWorkOrder(null)}
          darkMode={darkMode}
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
            <button className="bb" onClick={() => galleryRef.current?.click()} disabled={uploadingPhoto} style={{ fontSize: 13, padding: "6px 12px" }}>
              {uploadingPhoto ? "Uploading..." : (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6, justifyContent: "center" }}>
                  <Icon name="camera" size={14} />Add Photos
                </span>
              )}
            </button>
            <span className="dim" style={{ fontSize: 11 }}>{jobPhotos.length} photo{jobPhotos.length !== 1 ? "s" : ""}</span>
          </div>

          {/* Type filter */}
          {jobPhotos.length > 0 && (
            <>
              <div className="row mb">
                {["before", "work", "after"].map((t) => {
                  const count = jobPhotos.filter((p) => p.type === t).length;
                  return (
                    <span key={t} style={{ fontSize: 12, color: "#888" }}>
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
                        fontSize: 13,
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
                        fontSize: 12,
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
              <p className="dim" style={{ fontSize: 12 }}>Add before, during, and after photos of the work</p>
            </div>
          )}
        </div>
      )}

      {/* ADD TAB */}
      {tab === "add" && (
        <AddItemForm
          nr={nr} setNr={setNr} nd={nd} setNd={setNd} nc={nc} setNc={setNc}
          nh={nh} setNh={setNh} nm={nm} setNm={setNm} addItem={addItem}
          rooms={rooms}
        />
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════
   SUB-COMPONENTS
   ═══════════════════════════════════════════ */

function QuoteTab({
  rooms,
  rate,
  darkMode,
  upItem,
  rmItem,
  getRateForRoom,
}: {
  rooms: Room[];
  rate: number;
  darkMode: boolean;
  upItem: (rn: string, id: string, field: string, value: number | Material[]) => void;
  rmItem: (rn: string, id: string) => void;
  getRateForRoom?: (roomName: string) => number;
}) {
  const [expandedMat, setExpandedMat] = useState<string | null>(null);
  return (
    <>
      {rooms.map((rm) => (
        <div key={rm.name} style={{ marginBottom: 12 }}>
          <h4
            style={{
              color: "var(--color-primary)",
              fontSize: 13,
              marginBottom: 4,
              borderBottom: `1px solid ${darkMode ? "#1e1e2e" : "#eee"}`,
              paddingBottom: 3,
            }}
          >
            {rm.name}
          </h4>
          {rm.items.map((it) => {
            const roomRate = getRateForRoom ? getRateForRoom(rm.name) : rate;
            const { lc: _lc, mc: _mc, tot } = calculateCost(it, roomRate);
            void _lc; void _mc;
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
                    <b style={{ fontSize: 12 }}>{it.detail}</b>{" "}
                    <ConditionBadge condition={it.condition} />
                    <div style={{ fontSize: 11 }} className="dim">
                      {it.comment}
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    <div style={{ textAlign: "center" }}>
                      <div style={{ fontSize: 8 }} className="dim">SQFT</div>
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
                        style={{ width: 40, textAlign: "center", padding: "2px", fontSize: 11 }}
                      />
                    </div>
                    <div style={{ textAlign: "center" }}>
                      <div style={{ fontSize: 8 }} className="dim">HRS</div>
                      <input
                        type="number"
                        value={it.laborHrs === 0 ? "" : it.laborHrs}
                        placeholder="0"
                        step=".25"
                        min="0"
                        onFocus={(e) => e.target.select()}
                        onChange={(e) => {
                          const raw = e.target.value;
                          const v = raw === "" ? 0 : (parseFloat(raw) || 0);
                          upItem(rm.name, it.id, "laborHrs", v);
                        }}
                        style={{ width: 45, textAlign: "center", padding: "2px", fontSize: 11 }}
                      />
                    </div>
                    <div style={{ textAlign: "center", position: "relative" }}>
                      <div style={{ fontSize: 8 }} className="dim">MAT</div>
                      <div
                        onClick={(e) => {
                          e.stopPropagation();
                          setExpandedMat(expandedMat === it.id ? null : it.id);
                        }}
                        style={{ width: 50, textAlign: "center", padding: "2px", fontSize: 11, cursor: "pointer", color: "var(--color-warning)", fontFamily: "Oswald", border: `1px solid ${darkMode ? "#1e1e2e" : "#ddd"}`, borderRadius: 4 }}
                      >
                        ${it.materials.reduce((s, m) => s + (m.c || 0), 0).toFixed(0)}
                      </div>
                      {expandedMat === it.id && (<>
                        <div onClick={() => setExpandedMat(null)} style={{ position: "fixed", inset: 0, zIndex: 199, background: "rgba(0,0,0,.4)" }} />
                        <div onClick={(e) => e.stopPropagation()} style={{
                          position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
                          zIndex: 200, width: "90%", maxWidth: 360, maxHeight: "70vh", overflowY: "auto",
                          background: darkMode ? "#12121a" : "#fff", border: `1px solid ${darkMode ? "#1e1e2e" : "#ddd"}`,
                          borderRadius: 12, padding: 14, boxShadow: "0 8px 32px rgba(0,0,0,.5)",
                        }}>
                          <div style={{ display: "flex", gap: 4, marginBottom: 6, fontSize: 11, fontWeight: 600 }}>
                            <span style={{ flex: 1 }}>Material</span>
                            <span style={{ width: 32, textAlign: "center" }}>Qty</span>
                            <span style={{ width: 55, textAlign: "right" }}>Price</span>
                            <span style={{ width: 16 }}></span>
                          </div>
                          {it.materials.map((mat, mi) => {
                            const matAny = mat as unknown as { qty?: number };
                            const qtyVal = matAny.qty;
                            return (
                              <div key={mi} style={{ display: "flex", gap: 4, alignItems: "center", marginBottom: 4, fontSize: 12 }}>
                                <input
                                  value={mat.n}
                                  onChange={(e) => {
                                    const mats = [...it.materials];
                                    mats[mi] = { ...mats[mi], n: e.target.value };
                                    upItem(rm.name, it.id, "materials", mats);
                                  }}
                                  style={{ flex: 1, fontSize: 11, padding: 2 }}
                                />
                                <input
                                  type="number"
                                  // Allow the field to clear to empty — previously `|| 1` snapped
                                  // back to 1 every keystroke, so typing "3" over "1" became "13".
                                  value={qtyVal === undefined || qtyVal === null ? "" : qtyVal}
                                  placeholder="1"
                                  min="0"
                                  step="1"
                                  onFocus={(e) => e.target.select()}
                                  onChange={(e) => {
                                    const raw = e.target.value;
                                    const mats = [...it.materials];
                                    const clone = { ...(mats[mi] as unknown as Record<string, unknown>) };
                                    if (raw === "") delete clone.qty;
                                    else clone.qty = parseInt(raw) || 0;
                                    mats[mi] = clone as unknown as Material;
                                    upItem(rm.name, it.id, "materials", mats);
                                  }}
                                  onBlur={(e) => {
                                    const v = parseInt(e.target.value);
                                    if (!v || v < 1) {
                                      const mats = [...it.materials];
                                      const clone = { ...(mats[mi] as unknown as Record<string, unknown>) };
                                      clone.qty = 1;
                                      mats[mi] = clone as unknown as Material;
                                      upItem(rm.name, it.id, "materials", mats);
                                    }
                                  }}
                                  style={{ width: 36, fontSize: 11, padding: 2, textAlign: "center" }}
                                />
                                <span style={{ fontSize: 11 }}>$</span>
                                <input
                                  type="number"
                                  value={mat.c === 0 ? "" : mat.c}
                                  placeholder="0"
                                  min="0"
                                  step="0.01"
                                  onFocus={(e) => e.target.select()}
                                  onChange={(e) => {
                                    const raw = e.target.value;
                                    const nextC = raw === "" ? 0 : (parseFloat(raw) || 0);
                                    const mats = [...it.materials];
                                    mats[mi] = { ...mats[mi], c: nextC };
                                    upItem(rm.name, it.id, "materials", mats);
                                  }}
                                  style={{ width: 56, fontSize: 11, padding: 2, textAlign: "right" }}
                                />
                                <button
                                  onClick={() => {
                                    const mats = it.materials.filter((_, i) => i !== mi);
                                    upItem(rm.name, it.id, "materials", mats.length ? mats : [{ n: "Materials", c: 0 }]);
                                  }}
                                  style={{ background: "none", color: "var(--color-accent-red)", fontSize: 11, padding: 0 }}
                                >✕</button>
                              </div>
                            );
                          })}
                          <button
                            onClick={() => {
                              upItem(rm.name, it.id, "materials", [...it.materials, { n: "New material", c: 0 }]);
                            }}
                            style={{ fontSize: 11, background: "none", color: "var(--color-primary)", padding: "2px 0", width: "100%", textAlign: "center", marginTop: 4 }}
                          >+ Add Material</button>
                          <button
                            onClick={() => setExpandedMat(null)}
                            className="bo"
                            style={{ fontSize: 12, padding: "4px 0", width: "100%", marginTop: 8 }}
                          >Done</button>
                        </div>
                      </>)}
                    </div>
                    <div style={{ minWidth: 50, textAlign: "right" }}>
                      <div style={{ fontSize: 8 }} className="dim">TOT</div>
                      <div
                        style={{
                          fontSize: 13,
                          fontFamily: "Oswald",
                          color: "var(--color-success)",
                        }}
                      >
                        ${tot.toFixed(0)}
                      </div>
                    </div>
                    <button
                      onClick={() => rmItem(rm.name, it.id)}
                      style={{ background: "none", color: "var(--color-accent-red)", fontSize: 13, padding: 1 }}
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
}: {
  guide: ReturnType<typeof makeGuide>;
  workOrder: GuideStep[];
  isCustomized: boolean;
  onEditStep: (i: number, patch: Partial<GuideStep>) => void;
  onRemoveStep: (i: number) => void;
  onAddStep: (step: GuideStep) => void;
  onReset: () => void;
  darkMode: boolean;
}) {
  const border = darkMode ? "#1e1e2e" : "#eee";
  const [checkedTools, setCheckedTools] = useState<Set<string>>(() => new Set());
  const [checkedShop, setCheckedShop] = useState<Set<number>>(() => new Set());
  const [extraTools, setExtraTools] = useState<string[]>([]);
  const [extraShop, setExtraShop] = useState<{ n: string; c: number; room: string }[]>([]);
  const [newTool, setNewTool] = useState("");
  const [newShopName, setNewShopName] = useState("");
  // New-task form state
  const [taskRoom, setTaskRoom] = useState("");
  const [taskDetail, setTaskDetail] = useState("");
  const [taskAction, setTaskAction] = useState("");
  const [taskPri, setTaskPri] = useState<"HIGH" | "MED" | "LOW">("MED");
  const [taskHrs, setTaskHrs] = useState("1");
  const workOrderHrs = workOrder.reduce((s, x) => s + (x.hrs || 0), 0);
  const [newShopCost, setNewShopCost] = useState("");

  const allTools = [...guide.tools, ...extraTools];
  const allShop = [...guide.shop, ...extraShop];

  const toggleTool = (t: string) =>
    setCheckedTools((prev) => {
      const next = new Set(prev);
      next.has(t) ? next.delete(t) : next.add(t);
      return next;
    });

  const toggleShop = (i: number) =>
    setCheckedShop((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });

  return (
    <div>
      <div className="g2 mb">
        <div className="cd">
          <h4 style={{ color: "var(--color-primary)", fontSize: 13, marginBottom: 6 }}>
            🧰 Tools ({allTools.length})
          </h4>
          {allTools.map((t, i) => {
            const done = checkedTools.has(t);
            return (
              <div
                key={i}
                onClick={() => toggleTool(t)}
                style={{
                  fontSize: 12,
                  padding: "4px 0",
                  borderBottom: `1px solid ${border}`,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  textDecoration: done ? "line-through" : "none",
                  opacity: done ? 0.5 : 1,
                }}
              >
                <span style={{
                  width: 16, height: 16, borderRadius: 3,
                  border: `2px solid ${done ? "var(--color-success)" : "#555"}`,
                  background: done ? "var(--color-success)" : "transparent",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 12, color: "#fff", flexShrink: 0,
                }}>
                  {done && "✓"}
                </span>
                {t}
              </div>
            );
          })}
          {/* Add custom tool */}
          <div className="row" style={{ marginTop: 6 }}>
            <input
              value={newTool}
              onChange={(e) => setNewTool(e.target.value)}
              placeholder="Add tool..."
              style={{ flex: 1, fontSize: 13, padding: "4px 8px" }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newTool.trim()) {
                  setExtraTools((prev) => [...prev, newTool.trim()]);
                  setNewTool("");
                }
              }}
            />
            <button
              onClick={() => {
                if (newTool.trim()) {
                  setExtraTools((prev) => [...prev, newTool.trim()]);
                  setNewTool("");
                }
              }}
              style={{ background: "none", color: "var(--color-primary)", fontSize: 14, padding: "0 4px" }}
            >
              +
            </button>
          </div>
        </div>
        <div className="cd">
          <h4 style={{ color: "var(--color-warning)", fontSize: 13, marginBottom: 6 }}>
            🛒 Shopping ($
            {allShop.reduce((s, i) => s + (i.c || 0), 0)})
          </h4>
          <div>
            {allShop.map((s, i) => {
              const done = checkedShop.has(i);
              // Show trade header when trade changes
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const prevTrade = i > 0 ? (allShop[i - 1] as any).trade : null;
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const curTrade = (s as any).trade || "";
              const showHeader = curTrade && curTrade !== prevTrade;
              return (
                <div key={i}>
                  {showHeader && (
                    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--color-primary)", marginTop: i > 0 ? 10 : 0, marginBottom: 4 }}>{curTrade}</div>
                  )}
                  <div
                    onClick={() => toggleShop(i)}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      fontSize: 13,
                      padding: "3px 0 3px 12px",
                      borderBottom: `1px solid ${border}`,
                      cursor: "pointer",
                      textDecoration: done ? "line-through" : "none",
                      opacity: done ? 0.5 : 1,
                    }}
                  >
                    <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                      <span style={{
                        width: 14, height: 14, borderRadius: 3,
                        border: `2px solid ${done ? "var(--color-success)" : "#555"}`,
                        background: done ? "var(--color-success)" : "transparent",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 13, color: "#fff", flexShrink: 0,
                      }}>
                        {done && "✓"}
                      </span>
                      {s.n}
                    </span>
                    <span style={{ color: done ? "#555" : "var(--color-success)" }}>${s.c}</span>
                  </div>
                </div>
              );
            })}
          </div>
          {/* Add custom shop item */}
          <div className="row" style={{ marginTop: 6 }}>
            <input
              value={newShopName}
              onChange={(e) => setNewShopName(e.target.value)}
              placeholder="Item name..."
              style={{ flex: 1, fontSize: 13, padding: "4px 8px" }}
            />
            <input
              type="number"
              value={newShopCost}
              onChange={(e) => setNewShopCost(e.target.value)}
              placeholder="$"
              style={{ width: 50, fontSize: 13, padding: "4px 6px" }}
            />
            <button
              onClick={() => {
                if (newShopName.trim()) {
                  setExtraShop((prev) => [...prev, { n: newShopName.trim(), c: parseFloat(newShopCost) || 0, room: "Custom" }]);
                  setNewShopName("");
                  setNewShopCost("");
                }
              }}
              style={{ background: "none", color: "var(--color-warning)", fontSize: 14, padding: "0 4px" }}
            >
              +
            </button>
          </div>
        </div>
      </div>
      <div className="cd">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <h4 style={{ color: "var(--color-success)", fontSize: 13, margin: 0 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <Icon name="list" size={14} color="var(--color-success)" />
              Work Order ({workOrder.length} tasks · {workOrderHrs.toFixed(1)}h)
            </span>
          </h4>
          {isCustomized && (
            <button
              onClick={onReset}
              title="Discard edits and rebuild from quote items"
              style={{ background: "none", color: "var(--color-primary)", fontSize: 11, padding: "2px 6px" }}
            >
              ↺ Regenerate
            </button>
          )}
        </div>
        {workOrder.length === 0 && (
          <div className="dim" style={{ fontSize: 11, padding: "4px 0" }}>
            No tasks yet. Add items to the quote or create one below.
          </div>
        )}
        {workOrder.map((s, i) => (
          <div
            key={i}
            style={{
              padding: "4px 0",
              borderBottom: `1px solid ${border}`,
              fontSize: 12,
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
                  style={{ fontSize: 10, padding: "1px 4px", width: "auto", fontFamily: "Oswald" }}
                >
                  <option value="HIGH">HIGH</option>
                  <option value="MED">MED</option>
                  <option value="LOW">LOW</option>
                </select>
                <input
                  value={s.room}
                  onChange={(e) => onEditStep(i, { room: e.target.value })}
                  style={{ fontSize: 12, padding: "1px 4px", width: 100, color: "var(--color-primary)", fontWeight: 600 }}
                />
                <span>→</span>
                <input
                  value={s.detail}
                  onChange={(e) => onEditStep(i, { detail: e.target.value })}
                  style={{ fontSize: 12, padding: "1px 4px", flex: 1, minWidth: 80 }}
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
                  style={{ fontSize: 11, padding: "1px 4px", width: 50, textAlign: "center" }}
                />
                <span className="dim" style={{ fontSize: 11 }}>h</span>
              </div>
              <input
                value={s.action}
                onChange={(e) => onEditStep(i, { action: e.target.value })}
                placeholder="Action / method"
                style={{ fontSize: 12, padding: "1px 4px", marginTop: 2, width: "100%", color: "#aaa" }}
              />
            </div>
            <button
              onClick={() => onRemoveStep(i)}
              title="Remove task"
              style={{ background: "none", color: "var(--color-accent-red)", fontSize: 12, padding: "0 4px" }}
            >
              ✕
            </button>
          </div>
        ))}

        {/* Add new task */}
        <div style={{ marginTop: 8, padding: 6, border: `1px dashed ${border}`, borderRadius: 4 }}>
          <div className="dim" style={{ fontSize: 10, marginBottom: 4, fontFamily: "Oswald", textTransform: "uppercase", letterSpacing: ".08em" }}>
            + Add task
          </div>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 4 }}>
            <select
              value={taskPri}
              onChange={(e) => setTaskPri(e.target.value as "HIGH" | "MED" | "LOW")}
              style={{ fontSize: 10, padding: "2px 4px", width: "auto" }}
            >
              <option value="HIGH">HIGH</option>
              <option value="MED">MED</option>
              <option value="LOW">LOW</option>
            </select>
            <input
              value={taskRoom}
              onChange={(e) => setTaskRoom(e.target.value)}
              placeholder="Trade / area"
              style={{ fontSize: 12, padding: "2px 4px", width: 110 }}
            />
            <input
              value={taskDetail}
              onChange={(e) => setTaskDetail(e.target.value)}
              placeholder="Task"
              style={{ fontSize: 12, padding: "2px 4px", flex: 1, minWidth: 90 }}
            />
            <input
              type="number"
              value={taskHrs}
              onChange={(e) => setTaskHrs(e.target.value)}
              step=".25"
              min="0"
              style={{ fontSize: 11, padding: "2px 4px", width: 50, textAlign: "center" }}
            />
          </div>
          <div style={{ display: "flex", gap: 4 }}>
            <input
              value={taskAction}
              onChange={(e) => setTaskAction(e.target.value)}
              placeholder="Action / method (optional)"
              style={{ fontSize: 12, padding: "2px 4px", flex: 1 }}
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
              style={{ background: "var(--color-primary)", color: "#fff", padding: "2px 10px", fontSize: 12, borderRadius: 4, opacity: taskDetail.trim() ? 1 : 0.5 }}
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
        <div key={i} className="cd mb" style={{ borderLeft: `3px solid ${s.c}` }}>
          <h4 style={{ color: s.c, fontSize: 13, marginBottom: 4 }}>
            {s.t} ({s.it.length})
          </h4>
          {!s.it.length ? (
            <span className="dim" style={{ fontSize: 11 }}>None</span>
          ) : (
            s.it.map((x, j) => (
              <div
                key={j}
                style={{
                  fontSize: 12,
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
  nr, setNr, nd, setNd, nc, setNc, nh, setNh, nm, setNm, addItem, rooms,
}: {
  nr: string; setNr: (v: string) => void;
  nd: string; setNd: (v: string) => void;
  nc: string; setNc: (v: string) => void;
  nh: string; setNh: (v: string) => void;
  nm: string; setNm: (v: string) => void;
  addItem: () => void;
  rooms: Room[];
}) {
  return (
    <div className="cd">
      <div className="g2 mb">
        <div>
          <label style={{ fontSize: 10 }} className="dim">Room</label>
          <input value={nr} onChange={(e) => setNr(e.target.value)} list="rl" />
          <datalist id="rl">
            {rooms.map((r) => (
              <option key={r.name} value={r.name} />
            ))}
          </datalist>
        </div>
        <div>
          <label style={{ fontSize: 10 }} className="dim">Item</label>
          <input value={nd} onChange={(e) => setNd(e.target.value)} />
        </div>
      </div>
      <div style={{ marginBottom: 8 }}>
        <label style={{ fontSize: 10 }} className="dim">Description</label>
        <input value={nc} onChange={(e) => setNc(e.target.value)} />
      </div>
      <div className="g2 mb">
        <div>
          <label style={{ fontSize: 10 }} className="dim">Hours</label>
          <input
            type="number"
            value={nh}
            onChange={(e) => setNh(e.target.value)}
            min="0"
            step=".25"
          />
        </div>
        <div>
          <label style={{ fontSize: 10 }} className="dim">Mat $</label>
          <input
            type="number"
            value={nm}
            onChange={(e) => setNm(e.target.value)}
            min="0"
          />
        </div>
      </div>
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
        fontSize: 13,
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
        fontSize: 13,
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
function SavedInspections({ jobs, onQuote, onPrint, onDelete }: { jobs: any[]; onQuote: (data: any) => void; onPrint: (insp: any, data: any, rooms: number, findings: number) => void; onDelete: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const inspections = jobs.filter((j) => j.status === "inspection");
  if (!inspections.length) return null;

  return (
    <div style={{ marginTop: 14 }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 14px",
          borderRadius: 8,
          fontSize: 13,
          fontFamily: "Oswald",
          textTransform: "uppercase",
          letterSpacing: ".05em",
          border: "1px solid var(--color-primary)",
          background: open ? "var(--color-primary)22" : "transparent",
          color: "var(--color-primary)",
          cursor: "pointer",
        }}
      >
        <span>🗂 {t("qf.savedInspections")} ({inspections.length})</span>
        <span style={{ fontSize: 12 }}>{open ? "▼" : "▶"}</span>
      </button>
      {open && (
        <div style={{ marginTop: 8 }}>
          {inspections.map((insp) => {
            let inspData: Record<string, unknown> = {};
            try { inspData = typeof insp.rooms === "string" ? JSON.parse(insp.rooms) : insp.rooms || {}; } catch { inspData = {}; }
            const inspection = inspData.inspection as { rooms?: { name: string; items: { name: string; condition: string; comment: string; photos?: string[] }[] }[] } | undefined;
            const roomCount = inspection?.rooms?.length || 0;
            const findingsCount = inspection?.rooms?.reduce((s, r) => s + r.items.filter((it) => it.condition !== "S").length, 0) || 0;

            return (
              <div key={insp.id} className="cd mb" style={{ padding: 12 }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{insp.property || "Untitled"}</div>
                  <div className="dim" style={{ fontSize: 12 }}>
                    {insp.client || "No client"} · {insp.job_date} · {roomCount} areas · {findingsCount} findings
                  </div>
                </div>
                <div className="row" style={{ marginTop: 8, gap: 6 }}>
                  <button className="bb" onClick={() => { if (inspection) onQuote(inspection); }} style={{ fontSize: 12, padding: "5px 10px" }}>
                    {t("qf.quoteThis")}
                  </button>
                  <button className="bo" onClick={() => onPrint(insp, inspData, roomCount, findingsCount)} style={{ fontSize: 12, padding: "5px 10px" }}>
                    {t("qf.print")}
                  </button>
                  <button className="bo" onClick={async () => {
                    if (await useStore.getState().showConfirm("Delete Inspection", "Delete this saved inspection?")) {
                      onDelete(insp.id);
                    }
                  }} style={{ fontSize: 12, padding: "5px 10px", color: "var(--color-accent-red)" }}>
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
