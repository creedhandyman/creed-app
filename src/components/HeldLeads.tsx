"use client";
/**
 * Jobs → "N requests held as possible spam". Website quote requests the spam
 * check held (vendor pitches: SEO, marketing, link lists…) wait here instead
 * of becoming leads or alerting anyone. One tap makes a real one a normal
 * lead; "Spam" files it away. Owners / managers only. Server:
 * /api/leads/review (rules: lib/lead-spam.ts).
 */
import { useCallback, useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { apiFetch } from "@/lib/api";
import { t } from "@/lib/i18n";
import { useBackLayer } from "@/lib/back-layer";
import { Icon } from "./Icon";

interface Held {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  street: string | null;
  city: string | null;
  description: string | null;
  score: number | null;
  reasons: string[] | null;
  ai_verdict: string | null;
  created_at: string;
}

const when = (iso: string) => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
};

export default function HeldLeads({ onRestored }: { onRestored?: () => void }) {
  const toast = useStore((s) => s.showToast);
  const [held, setHeld] = useState<Held[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  useBackLayer(open, () => setOpen(false));

  const load = useCallback(async () => {
    try {
      const r = await apiFetch("/api/leads/review");
      if (!r.ok) return;
      const j = await r.json();
      setHeld(Array.isArray(j.held) ? j.held : []);
    } catch { /* offline: show nothing */ }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (open && !held.length) setOpen(false); }, [open, held.length]);

  const act = async (id: string, action: "restore" | "dismiss") => {
    setBusy(id);
    try {
      const r = await apiFetch("/api/leads/review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, id }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok && r.status !== 409) { toast(j.error || t("spam.failed"), "error"); return; }
      setHeld((h) => h.filter((x) => x.id !== id));
      if (action === "restore" && r.ok) { toast(t("spam.restored"), "success"); onRestored?.(); }
      else if (action === "dismiss") toast(t("spam.dismissed"), "info");
    } catch {
      toast(t("spam.failed"), "error");
    } finally {
      setBusy(null);
    }
  };

  if (!held.length) return null;

  return (
    <>
      <button
        type="button"
        className="cd"
        onClick={() => setOpen(true)}
        style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left", cursor: "pointer", color: "inherit", padding: "10px 12px", marginBottom: 10, borderColor: "var(--color-warning)" }}
      >
        <Icon name="warn" size={18} color="var(--color-warning)" />
        <span style={{ flex: 1, fontSize: 15 }}>
          <b>{held.length === 1 ? t("spam.bannerOne") : t("spam.bannerMany").replace("{n}", String(held.length))}</b>
          <span className="dim" style={{ display: "block", fontSize: 13 }}>{t("spam.bannerSub")}</span>
        </span>
        <span style={{ fontSize: 14, fontWeight: 600, color: "var(--color-primary)" }}>{t("spam.review")}</span>
      </button>

      {open && (
        <div className="sheet-overlay" onClick={() => setOpen(false)}>
          <div className="sheet cd" onClick={(e) => e.stopPropagation()} style={{ maxHeight: "85vh", overflowY: "auto" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <Icon name="warn" size={18} color="var(--color-warning)" />
              <h3 style={{ fontSize: 18, margin: 0, flex: 1 }}>{t("spam.title")}</h3>
              <button type="button" className="bo" onClick={() => setOpen(false)} style={{ width: "auto", padding: "4px 10px" }} aria-label={t("common.close")}>
                <Icon name="close" size={15} />
              </button>
            </div>
            <div className="dim" style={{ fontSize: 13.5, marginBottom: 12 }}>{t("spam.help")}</div>
            {held.map((h) => {
              const text = h.description || "";
              const long = text.length > 220;
              const show = expanded === h.id || !long ? text : `${text.slice(0, 220)}…`;
              return (
                <div key={h.id} style={{ borderTop: "1px solid var(--color-border-dark-2, rgba(128,128,128,.25))", padding: "12px 0" }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                    <b style={{ fontSize: 15.5 }}>{h.name || h.email || h.phone || "?"}</b>
                    <span className="dim" style={{ fontSize: 12.5 }}>{when(h.created_at)}</span>
                  </div>
                  <div className="dim" style={{ fontSize: 13, margin: "2px 0 6px", wordBreak: "break-word" }}>
                    {[h.phone, h.email, [h.street, h.city].filter(Boolean).join(", ")].filter(Boolean).join(" · ")}
                  </div>
                  <div style={{ fontSize: 14.5, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                    {show}
                    {long && (
                      <button type="button" onClick={() => setExpanded(expanded === h.id ? null : h.id)} style={{ background: "none", border: "none", color: "var(--color-primary)", cursor: "pointer", padding: "0 4px", fontSize: 13.5 }}>
                        {expanded === h.id ? t("spam.less") : t("spam.more")}
                      </button>
                    )}
                  </div>
                  <div className="dim" style={{ fontSize: 12.5, marginTop: 6 }}>
                    {t("spam.why")}: {(h.reasons || []).filter((r) => !/repair word/.test(r)).slice(0, 5).join(", ") || "—"}
                    {h.ai_verdict ? ` · AI: ${h.ai_verdict}` : ""}
                  </div>
                  <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                    <button type="button" className="bg" disabled={busy === h.id} onClick={() => act(h.id, "restore")} style={{ width: "auto", padding: "9px 14px", fontSize: 14.5, display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <Icon name="check" size={15} /> {busy === h.id ? "…" : t("spam.restore")}
                    </button>
                    <button type="button" className="bo" disabled={busy === h.id} onClick={() => act(h.id, "dismiss")} style={{ width: "auto", padding: "9px 14px", fontSize: 14.5 }}>
                      {t("spam.dismiss")}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
