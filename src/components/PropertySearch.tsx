"use client";
/**
 * Reusable typeahead search. Shows a dropdown of suggested matches as
 * the user types, ranked by simple substring scoring. Used on Jobs,
 * Schedule, and Customers tabs so Bernard can jump to a specific
 * property/customer without scrolling a long list.
 *
 * Generic over the item type — each tab passes:
 *   - items: the list to search
 *   - getKey: stable id for React keys + dedupe
 *   - match:  the searchable text blob (lowercased internally)
 *   - render: how each suggestion looks in the dropdown
 *   - onSelect: what to do on click / Enter
 *
 * Keyboard: ↑↓ navigate, Enter selects, Esc closes.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { Icon } from "./Icon";

interface Props<T> {
  items: T[];
  getKey: (item: T) => string;
  match: (item: T) => string;
  render: (item: T) => React.ReactNode;
  onSelect: (item: T) => void;
  placeholder?: string;
  /** Max suggestions shown in the dropdown. Default 6. */
  maxSuggestions?: number;
  /** Called every keystroke with the trimmed query — lets the parent
   *  filter its full list to mirror the typeahead. Optional. */
  onQueryChange?: (q: string) => void;
  /** Cleared by parent when set; sync from outside to reset the input. */
  resetSignal?: number;
}

export default function PropertySearch<T>({
  items,
  getKey,
  match,
  render,
  onSelect,
  placeholder = "Search…",
  maxSuggestions = 6,
  onQueryChange,
  resetSignal,
}: Props<T>) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  // Read theme from the store so the dropdown picks the right card
  // bg + text color. Hardcoding `--color-card-dark` made the suggestion
  // text render dark-navy on dark-gray in light mode (page text color
  // is dark in light mode, but we forced the dropdown bg to dark).
  const darkMode = useStore((s) => s.darkMode);
  const popoverBg = darkMode ? "var(--color-card-dark)" : "var(--color-card-light)";
  const popoverBorder = darkMode ? "var(--color-border-dark)" : "var(--color-border-light)";
  const popoverColor = darkMode ? "#e8e8ee" : "#1a1a2a";

  // Sync to parent on every keystroke so the parent's list reflects
  // the same filter the typeahead is using.
  useEffect(() => {
    if (onQueryChange) onQueryChange(q.trim());
  }, [q, onQueryChange]);

  // External reset (e.g. after navigating away).
  useEffect(() => {
    if (resetSignal !== undefined) setQ("");
  }, [resetSignal]);

  // Click-outside to close.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [open]);

  // Score and rank: starts-with > word-boundary > substring. Items with no
  // hit are filtered out. Ties broken by original order (stable sort).
  const suggestions = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return [] as T[];
    const scored: { item: T; score: number; idx: number }[] = [];
    items.forEach((item, idx) => {
      const hay = match(item).toLowerCase();
      if (!hay) return;
      let score = 0;
      if (hay.startsWith(needle)) score = 100;
      else if (new RegExp(`\\b${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(hay)) score = 60;
      else if (hay.includes(needle)) score = 30;
      if (score > 0) scored.push({ item, score, idx });
    });
    scored.sort((a, b) => (b.score - a.score) || (a.idx - b.idx));
    return scored.slice(0, maxSuggestions).map((s) => s.item);
  }, [q, items, match, maxSuggestions]);

  // Reset highlight whenever suggestions change.
  useEffect(() => {
    setHighlight(0);
  }, [q]);

  const select = (item: T) => {
    setOpen(false);
    onSelect(item);
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, suggestions.length - 1));
      setOpen(true);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter" && suggestions[highlight]) {
      e.preventDefault();
      select(suggestions[highlight]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <div style={{ position: "relative" }}>
        <span
          style={{
            position: "absolute",
            left: 10,
            top: "50%",
            transform: "translateY(-50%)",
            color: "#888",
            display: "inline-flex",
            alignItems: "center",
            pointerEvents: "none",
          }}
        >
          <Icon name="search" size={15} color="#888" />
        </span>
        <input
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKey}
          placeholder={placeholder}
          style={{
            width: "100%",
            paddingLeft: 32,
            paddingRight: q ? 32 : 12,
          }}
        />
        {q && (
          <button
            onClick={() => { setQ(""); setOpen(false); }}
            aria-label="Clear search"
            style={{
              position: "absolute",
              right: 6,
              top: "50%",
              transform: "translateY(-50%)",
              background: "transparent",
              border: "none",
              padding: 4,
              cursor: "pointer",
              color: "#888",
              display: "inline-flex",
              alignItems: "center",
            }}
          >
            <Icon name="close" size={14} />
          </button>
        )}
      </div>

      {open && q.trim() && suggestions.length > 0 && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            marginTop: 4,
            background: popoverBg,
            color: popoverColor,
            border: `1px solid ${popoverBorder}`,
            borderRadius: 8,
            boxShadow: "0 8px 24px rgba(0,0,0,.4)",
            zIndex: 50,
            overflow: "hidden",
          }}
        >
          {suggestions.map((item, i) => (
            <div
              key={getKey(item)}
              // onMouseDown for desktop (fires before the input's blur,
              // so the dropdown isn't gone before we register the
              // selection). onClick as a backup for any environment
              // where mousedown is suppressed (some embedded WebViews).
              onMouseDown={(e) => { e.preventDefault(); select(item); }}
              onClick={() => select(item)}
              onMouseEnter={() => setHighlight(i)}
              style={{
                padding: "8px 12px",
                cursor: "pointer",
                color: popoverColor,
                background: i === highlight ? "var(--color-primary)" + "22" : "transparent",
                borderTop: i === 0 ? "none" : `1px solid ${popoverBorder}`,
                fontSize: 13,
              }}
            >
              {render(item)}
            </div>
          ))}
        </div>
      )}

      {open && q.trim() && suggestions.length === 0 && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            marginTop: 4,
            background: popoverBg,
            // Empty-state copy is intentionally muted (#888) regardless
            // of mode so it reads as secondary text, not a real result.
            color: "#888",
            border: `1px solid ${popoverBorder}`,
            borderRadius: 8,
            zIndex: 50,
            padding: "10px 12px",
            fontSize: 12,
          }}
        >
          No matches for &ldquo;{q}&rdquo;.
        </div>
      )}
    </div>
  );
}
