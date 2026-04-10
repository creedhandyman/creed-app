"use client";
import { useState, useRef, useEffect } from "react";
import { useStore } from "@/lib/store";
import { db } from "@/lib/supabase";
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
} from "@/lib/parser";
import type { InspectionInput } from "@/lib/parser";
import { exportQuotePdf } from "@/lib/export-pdf";
import Inspector from "./Inspector";
import type { InspectionData } from "./Inspector";

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

  const [mode, setMode] = useState<null | "paste" | "manual" | "edit" | "inspect">(null);
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
        setRooms(data.rooms);
      }
      if (data?.workers?.length) {
        setWorkers(data.workers.map((w: { id: string }) => w.id));
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
  const rate = user.rate || 55;

  /* ── AI parse (vision + text) with regex fallback ── */
  /* ── Inspection complete handler ── */
  const handleInspectionComplete = async (data: InspectionData) => {
    setParsing(true);
    setParseStatus("Analyzing inspection with AI...");
    setMode("edit"); // Switch to edit view with loading overlay

    setProp(data.property);
    setClient(data.client);

    try {
      const input: InspectionInput = {
        rooms: data.rooms,
        property: data.property,
        client: data.client,
      };
      const result = await aiParseInspection(input);
      if (result && result.rooms.length > 0) {
        setRooms(result.rooms);
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
    setRooms(fallbackRooms);
  };

  const doAiParse = async (rawText: string, file: File | null) => {
    setParsing(true);
    setParseStatus("Analyzing with AI...");

    try {
      // Get page images if we have a PDF
      let images: string[] = [];
      if (file && file.name.endsWith(".pdf")) {
        setParseStatus("Rendering PDF pages...");
        images = await renderPdfPages(file, 15);
        setParseStatus(`Sending ${images.length} pages to AI...`);
      } else {
        setParseStatus("Sending text to AI...");
      }

      const result = await aiParsePdf(rawText, images);

      if (result && result.rooms.length > 0) {
        if (result.property && !prop) setProp(result.property);
        if (result.client && !client) setClient(result.client);
        setRooms(result.rooms);
        setParsing(false);
        setParseStatus("");
        setMode("edit");
        return;
      }
    } catch (e) {
      console.error("AI parse error:", e);
    }

    // Fallback to regex parser
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
      alert(
        `Found ${c} "Maintenance" refs but couldn't parse. Try Upload PDF or Manual.`
      );
      return;
    }
    const pm = rawText.match(
      /([\d]+\s+[\w\s]+(?:Ave|St|Blvd|Ln|Dr|Rd|Ct|Way|Circle|Place))/i
    );
    if (pm && !prop) setProp(pm[1].trim());
    setRooms(p);
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
        const t = await readPdf(f);
        setText(t);
        setParsing(false);
        setParseStatus("");
        setMode("paste");
      } else {
        setPdfFile(null);
        const t = await f.text();
        setText(t);
        setParsing(false);
        setParseStatus("");
        setMode("paste");
      }
    } catch (err) {
      console.error(err);
      alert("Error reading file");
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
    setNd("");
    setNc("");
    setNh("1");
    setNm("20");
    if (mode !== "edit") setMode("edit");
  };

  /* ── Item ops ── */
  const rmItem = (rn: string, id: string) =>
    setRooms(
      rooms
        .map((r) =>
          r.name === rn ? { ...r, items: r.items.filter((i) => i.id !== id) } : r
        )
        .filter((r) => r.items.length > 0)
    );

  const upItem = (rn: string, id: string, field: string, value: number | Material[]) =>
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

  const toggleWorker = (id: string) =>
    setWorkers((w) =>
      w.includes(id) ? w.filter((x) => x !== id) : [...w, id]
    );

  /* ── Calculations ── */
  const all = rooms.flatMap((r) =>
    r.items.map((i) => ({ room: r.name, ...i, ...calculateCost(i, rate) }))
  );
  const gt = all.reduce((s, i) => s + i.tot, 0);
  const tl = all.reduce((s, i) => s + i.lc, 0);
  const tm = all.reduce((s, i) => s + i.mc, 0);
  const th = all.reduce((s, i) => s + i.laborHrs, 0);
  const issues = classify(rooms);
  const guide = makeGuide(rooms);

  /* ── Save job ── */
  const saveJob = async () => {
    if (!prop) {
      alert("Enter address");
      return;
    }
    const data = {
      rooms: rooms,
      workers: workers.map((wid) => {
        const u = profiles.find((x) => x.id === wid);
        return { id: wid, name: u?.name || "" };
      }),
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
      alert("Job updated: " + prop);
    } else {
      await db.post("jobs", jobData);
      alert("Job created: " + prop);
    }

    await loadAll();
    setMode(null);
    setRooms([]);
    setText("");
    setProp("");
    setClient("");
    setWorkers([]);
    setEditingId(null);
    setPage("jobs");
  };

  /* ══════════════════════════════════════════
     START SCREEN
     ══════════════════════════════════════════ */
  if (!mode)
    return (
      <div className="fi">
        <h2 style={{ fontSize: 22, color: "var(--color-primary)", marginBottom: 14 }}>
          ⚡ QuoteForge Pro
        </h2>
        {parsing && (
          <div className="cd mb" style={{ textAlign: "center", padding: 20 }}>
            <h4 style={{ color: "var(--color-primary)" }}>
              {parseStatus || "Processing..."}
            </h4>
            <div style={{ marginTop: 8 }}>
              <div style={{
                width: 40, height: 40, border: "3px solid #1e1e2e",
                borderTopColor: "var(--color-primary)", borderRadius: "50%",
                animation: "spin 0.8s linear infinite", margin: "0 auto",
              }} />
              <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
            </div>
          </div>
        )}
        {/* Inspect CTA */}
        <div
          onClick={() => setMode("inspect")}
          style={{
            background: `linear-gradient(135deg, #1a4d8a, #2E75B6)`,
            borderRadius: 12,
            padding: "16px 20px",
            textAlign: "center",
            cursor: "pointer",
            marginBottom: 12,
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <div style={{ fontSize: 32 }}>🔍</div>
          <div style={{ textAlign: "left" }}>
            <h4 style={{ color: "#fff", fontSize: 14, margin: 0 }}>Run Inspection</h4>
            <p style={{ color: "#ffffffaa", fontSize: 11, fontFamily: "Source Sans 3", textTransform: "none", letterSpacing: "normal", margin: 0 }}>
              Walk through rooms, set conditions, take photos → AI generates quote
            </p>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
          <div
            className="cd"
            style={{ cursor: "pointer", textAlign: "center", padding: 18 }}
            onClick={() => fileRef.current?.click()}
          >
            <div style={{ fontSize: 28 }}>📁</div>
            <h4 style={{ color: "var(--color-warning)", fontSize: 12, marginTop: 4 }}>
              Upload PDF
            </h4>
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.txt"
              style={{ display: "none" }}
              onChange={handleFile}
            />
          </div>
          <div
            className="cd"
            style={{ cursor: "pointer", textAlign: "center", padding: 18 }}
            onClick={() => setMode("paste")}
          >
            <div style={{ fontSize: 28 }}>📄</div>
            <h4 style={{ color: "var(--color-primary)", fontSize: 12, marginTop: 4 }}>
              Paste Text
            </h4>
          </div>
          <div
            className="cd"
            style={{ cursor: "pointer", textAlign: "center", padding: 18 }}
            onClick={() => setMode("manual")}
          >
            <div style={{ fontSize: 28 }}>✏️</div>
            <h4 style={{ color: "var(--color-success)", fontSize: 12, marginTop: 4 }}>
              Manual
            </h4>
          </div>
        </div>
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
      />
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
            <input
              value={client}
              onChange={(e) => setClient(e.target.value)}
              placeholder="Client"
            />
          </div>
          {parsing ? (
            <div style={{ textAlign: "center", padding: 16 }}>
              <div style={{
                width: 32, height: 32, border: "3px solid #1e1e2e",
                borderTopColor: "var(--color-primary)", borderRadius: "50%",
                animation: "spin 0.8s linear infinite", margin: "0 auto 8px",
              }} />
              <div style={{ fontSize: 12, color: "var(--color-primary)" }}>
                {parseStatus || "Processing..."}
              </div>
            </div>
          ) : (
            <div className="row mt">
              <button className="bb" onClick={doParse}>🤖 AI Parse →</button>
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
            <input
              value={client}
              onChange={(e) => setClient(e.target.value)}
              placeholder="Client"
            />
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
          <input
            value={client}
            onChange={(e) => setClient(e.target.value)}
            placeholder="Client"
            style={{ fontSize: 13 }}
          />
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
          { l: "Materials", v: "$" + tm.toFixed(0), c: "var(--color-warning)" },
          { l: "Hours", v: th.toFixed(1), c: "var(--color-highlight)" },
          { l: "Days", v: (th / 8).toFixed(1), c: "var(--color-success)" },
        ].map((x, i) => (
          <div key={i} className="cd" style={{ textAlign: "center", padding: 8 }}>
            <div className="sl">{x.l}</div>
            <div style={{ fontSize: 16, fontFamily: "Oswald", color: x.c }}>{x.v}</div>
          </div>
        ))}
      </div>

      {/* Assign Workers */}
      <div className="cd mb">
        <h4 style={{ fontSize: 13, marginBottom: 6 }}>👷 Assign Workers</h4>
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
              fontSize: 11,
            }}
          >
            {x.l}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button
          className="bo"
          onClick={() =>
            exportQuotePdf({
              property: prop,
              client,
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
            })
          }
          style={{ fontSize: 12, padding: "6px 16px" }}
        >
          📄 Export PDF
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
      {tab === "quote" && <QuoteTab rooms={rooms} rate={rate} darkMode={darkMode} upItem={upItem} rmItem={rmItem} />}

      {/* GUIDE TAB */}
      {tab === "guide" && <GuideTab guide={guide} th={th} darkMode={darkMode} />}

      {/* ISSUES TAB */}
      {tab === "issues" && <IssuesTab issues={issues} darkMode={darkMode} />}

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
}: {
  rooms: Room[];
  rate: number;
  darkMode: boolean;
  upItem: (rn: string, id: string, field: string, value: number | Material[]) => void;
  rmItem: (rn: string, id: string) => void;
}) {
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
            const { lc: _lc, mc: _mc, tot } = calculateCost(it, rate);
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
                      <div style={{ fontSize: 8 }} className="dim">HRS</div>
                      <input
                        type="number"
                        value={it.laborHrs}
                        step=".25"
                        min="0"
                        onChange={(e) =>
                          upItem(rm.name, it.id, "laborHrs", parseFloat(e.target.value) || 0)
                        }
                        style={{ width: 45, textAlign: "center", padding: "2px", fontSize: 11 }}
                      />
                    </div>
                    <div style={{ textAlign: "center" }}>
                      <div style={{ fontSize: 8 }} className="dim">MAT</div>
                      <input
                        type="number"
                        value={it.materials.reduce((s, m) => s + (m.c || 0), 0)}
                        step="1"
                        min="0"
                        onChange={(e) =>
                          upItem(rm.name, it.id, "materials", [
                            { n: "Mat", c: parseFloat(e.target.value) || 0 },
                          ])
                        }
                        style={{ width: 50, textAlign: "center", padding: "2px", fontSize: 11 }}
                      />
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
  th,
  darkMode,
}: {
  guide: ReturnType<typeof makeGuide>;
  th: number;
  darkMode: boolean;
}) {
  const border = darkMode ? "#1e1e2e" : "#eee";
  return (
    <div>
      <div className="g2 mb">
        <div className="cd">
          <h4 style={{ color: "var(--color-primary)", fontSize: 13, marginBottom: 6 }}>
            🧰 Tools ({guide.tools.length})
          </h4>
          {guide.tools.map((t, i) => (
            <div key={i} style={{ fontSize: 12, padding: "3px 0", borderBottom: `1px solid ${border}` }}>
              ☐ {t}
            </div>
          ))}
        </div>
        <div className="cd">
          <h4 style={{ color: "var(--color-warning)", fontSize: 13, marginBottom: 6 }}>
            🛒 Shopping ($
            {guide.shop.reduce((s, i) => s + (i.c || 0), 0)})
          </h4>
          <div style={{ maxHeight: 300, overflowY: "auto" }}>
            {guide.shop.map((s, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: 11,
                  padding: "2px 0",
                  borderBottom: `1px solid ${border}`,
                }}
              >
                <span>
                  ☐ {s.n} <span className="dim">({s.room})</span>
                </span>
                <span style={{ color: "var(--color-success)" }}>${s.c}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="cd">
        <h4 style={{ color: "var(--color-success)", fontSize: 13, marginBottom: 6 }}>
          📋 Work Order ({guide.steps.length} tasks · {th.toFixed(1)}h)
        </h4>
        {guide.steps.map((s, i) => (
          <div
            key={i}
            style={{
              padding: "4px 0",
              borderBottom: `1px solid ${border}`,
              fontSize: 12,
            }}
          >
            <PriorityBadge pri={s.pri} />
            <b style={{ color: "var(--color-primary)" }}>{s.room}</b> → {s.detail}{" "}
            <span className="dim">({s.hrs}h)</span>
            <div className="dim" style={{ fontSize: 11, paddingLeft: 4 }}>
              {s.action}
            </div>
          </div>
        ))}
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
        fontSize: 9,
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
        fontSize: 9,
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
