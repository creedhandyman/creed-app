"use client";
import { useState, useEffect } from "react";
import { useStore } from "@/lib/store";
import { t } from "@/lib/i18n";
import { Icon } from "./Icon";

type SourcePhoto = { url: string; type?: string };

export type RenderModalProps = {
  open: boolean;
  onClose: () => void;
  /** Candidate source images — quote: inspection photos; work: job photos. */
  sourcePhotos: SourcePhoto[];
  /** Prefilled prompt, usually buildRenderPrompt(rooms).prompt. */
  initialPrompt: string;
  promptMeta?: { usedCount: number; skipped: number };
  /** Preselect a specific source (WorkVision's per-photo ✨). */
  initialSourceUrl?: string;
  /** Needed by /api/render to namespace storage — render is disabled without it. */
  jobId?: string;
  /** Show the "include in the quote PDF" toggle (QuoteForge only). */
  showQuoteToggle?: boolean;
  /** Parent attaches the rendered photo to the job. */
  onSaved: (renderedUrl: string, sourceUrl: string, includeInQuote: boolean) => void | Promise<void>;
};

const VIOLET = "#9d4edd";

/**
 * Shared AI "after" render modal — source picker → editable auto-prompt →
 * Generate (POST /api/render) → before/after → Save. Used by QuoteForge (sell
 * the finish at quote time) and WorkVision (document the finished work). The
 * prompt is built from the quote's line items upstream via buildRenderPrompt.
 */
export default function RenderModal({
  open, onClose, sourcePhotos, initialPrompt, promptMeta, initialSourceUrl, jobId, showQuoteToggle, onSaved,
}: RenderModalProps) {
  const [source, setSource] = useState("");
  const [prompt, setPrompt] = useState(initialPrompt);
  const [rendering, setRendering] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [includeInQuote, setIncludeInQuote] = useState(true);
  const [saving, setSaving] = useState(false);

  // Reset state each time the modal opens.
  useEffect(() => {
    if (!open) return;
    setSource(initialSourceUrl || sourcePhotos[0]?.url || "");
    setPrompt(initialPrompt);
    setResult(null);
    setRendering(false);
    setIncludeInQuote(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const generate = async () => {
    if (!source || !prompt.trim() || !jobId) return;
    setRendering(true);
    setResult(null);
    try {
      const res = await fetch("/api/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photoUrl: source, prompt: prompt.trim(), jobId }),
      });
      const data = await res.json();
      if (!res.ok || !data.url) {
        useStore.getState().showToast(`${t("wv.renderFailed")}: ${data.error || res.status}`, "error");
        setRendering(false);
        return;
      }
      setResult(data.url);
    } catch (err) {
      useStore.getState().showToast(`${t("wv.renderFailed")}: ${err instanceof Error ? err.message : "Network error"}`, "error");
    }
    setRendering(false);
  };

  const save = async () => {
    if (!result || !source) return;
    setSaving(true);
    try { await onSaved(result, source, includeInQuote); } finally { setSaving(false); }
    onClose();
  };

  const busy = rendering || saving;
  const genDisabled = rendering || !prompt.trim() || !source || !jobId;

  return (
    <div
      onClick={() => { if (!busy) onClose(); }}
      style={{ position: "fixed", inset: 0, zIndex: 9998, background: "rgba(5,5,12,.8)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: "linear-gradient(180deg,#14141e,#12121a)", border: "1px solid rgba(157,78,221,.25)", borderTop: `3px solid ${VIOLET}`, borderRadius: 16, padding: "18px 18px 16px", width: "100%", maxWidth: 460, maxHeight: "92vh", overflowY: "auto", boxShadow: "0 24px 64px rgba(0,0,0,.6), 0 0 32px rgba(157,78,221,.18)" }}
      >
        {/* Title */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <div style={{ width: 32, height: 32, borderRadius: 10, background: "rgba(157,78,221,.18)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
            <Icon name="sparkle" size={17} color={VIOLET} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: "Oswald", fontWeight: 700, fontSize: 16, letterSpacing: ".4px" }}>AI FINISH PREVIEW</div>
            <div style={{ fontSize: 10, color: "var(--color-dim)" }}>Show the customer the after</div>
          </div>
          <button onClick={onClose} disabled={busy} aria-label="Close" style={{ width: 30, height: 30, borderRadius: 9, background: "var(--color-card-dark-3)", border: "1px solid var(--color-border-dark-2)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "inherit" }}>
            <Icon name="close" size={15} />
          </button>
        </div>

        {/* Source picker */}
        {sourcePhotos.length > 1 && (
          <>
            <div style={{ fontSize: 9.5, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--color-dim)", fontWeight: 600, margin: "2px 2px 7px" }}>Source photo</div>
            <div style={{ display: "flex", gap: 7, marginBottom: 12, overflowX: "auto", paddingBottom: 2 }}>
              {sourcePhotos.map((p) => {
                const on = source === p.url;
                return (
                  <button key={p.url} onClick={() => { setSource(p.url); setResult(null); }} style={{ width: 54, height: 54, borderRadius: 11, overflow: "hidden", flex: "none", padding: 0, cursor: "pointer", background: "var(--color-card-dark-2)", border: `2px solid ${on ? VIOLET : "transparent"}`, boxShadow: on ? "0 0 14px -4px rgba(157,78,221,.8)" : "none" }}>
                    <img src={p.url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  </button>
                );
              })}
            </div>
          </>
        )}

        {/* Before / After */}
        <div style={{ display: "flex", gap: 8, marginBottom: 11 }}>
          <div style={{ flex: 1, textAlign: "center" }}>
            <div style={{ aspectRatio: "1", borderRadius: 13, overflow: "hidden", marginBottom: 5, background: "var(--color-card-dark-2)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              {source ? <img src={source} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <Icon name="photo" size={24} color="var(--color-dim)" />}
            </div>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--color-dim)" }}>Before</div>
          </div>
          <div style={{ flex: 1, textAlign: "center" }}>
            <div style={{ aspectRatio: "1", borderRadius: 13, overflow: "hidden", marginBottom: 5, background: "var(--color-card-dark-2)", border: "1px solid rgba(157,78,221,.4)", boxShadow: "0 0 22px -8px rgba(157,78,221,.6)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              {rendering ? <span style={{ fontSize: 10.5, color: "#d8b6ff", fontFamily: "Oswald", animation: "rpulse 1.5s infinite", padding: 6, textAlign: "center" }}>{t("wv.renderGenerating")}</span>
                : result ? <img src={result} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                : <Icon name="sparkle" size={24} color="#9fe4c4" />}
            </div>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "#d8b6ff" }}>After · AI</div>
          </div>
        </div>

        {/* Prompt — editable, built from the line items */}
        <div style={{ background: "var(--color-card-dark-3)", border: "1px solid rgba(157,78,221,.35)", borderRadius: 13, padding: 11, marginBottom: 11 }}>
          {promptMeta && (
            <div style={{ marginBottom: 7 }}>
              <span style={{ fontSize: 8.5, fontWeight: 700, color: "#d8b6ff", background: "rgba(157,78,221,.16)", padding: "2px 8px", borderRadius: 99, display: "inline-flex", alignItems: "center", gap: 4 }}>
                <Icon name="list" size={10} color="#d8b6ff" /> Built from {promptMeta.usedCount} visual item{promptMeta.usedCount === 1 ? "" : "s"}{promptMeta.skipped ? ` · ${promptMeta.skipped} skipped` : ""}
              </span>
            </div>
          )}
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            disabled={rendering}
            rows={4}
            style={{ width: "100%", fontSize: 12, padding: 8, borderRadius: 8, border: "1px solid var(--color-border-dark-2)", background: "var(--color-card-dark)", color: "inherit", lineHeight: 1.5, resize: "vertical" }}
          />
        </div>

        {/* Generate / Save */}
        {!result ? (
          <button
            onClick={generate}
            disabled={genDisabled}
            style={{ width: "100%", border: "none", fontFamily: "Oswald", fontWeight: 600, fontSize: 14, letterSpacing: ".4px", padding: 13, borderRadius: 13, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, background: "linear-gradient(135deg,#9d4edd,#f5b400)", color: "#1a1305", boxShadow: "0 0 28px -6px rgba(157,78,221,.7)", cursor: genDisabled ? "not-allowed" : "pointer", opacity: genDisabled ? 0.6 : 1 }}
          >
            <Icon name="sparkle" size={16} color="#1a1305" /> {rendering ? t("wv.renderGenerating") : "Generate · ~$0.04"}
          </button>
        ) : (
          <button
            onClick={save}
            disabled={saving}
            className="bg"
            style={{ width: "100%", fontFamily: "Oswald", fontWeight: 600, fontSize: 14, letterSpacing: ".4px", padding: 13, borderRadius: 13, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, opacity: saving ? 0.6 : 1 }}
          >
            <Icon name="check" size={16} color="#06371f" /> {saving ? "Saving…" : "Save render"}
          </button>
        )}

        {/* Include in quote (QuoteForge) */}
        {showQuoteToggle && (
          <label style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 9, fontSize: 11, color: "var(--color-dim)", marginTop: 11, cursor: "pointer" }}>
            <input type="checkbox" checked={includeInQuote} onChange={(e) => setIncludeInQuote(e.target.checked)} />
            Include in the quote PDF &amp; customer link
          </label>
        )}

        <style>{`@keyframes rpulse { 0%,100% { opacity: .55; } 50% { opacity: 1; } }`}</style>
      </div>
    </div>
  );
}
