"use client";
import { useEffect, useRef } from "react";

/**
 * Hardware/gesture BACK for in-screen levels (Android PWA).
 *
 * AppShell gives each PAGE a history entry, but screens like Jobs (list →
 * job detail → work order) and Operations (hub → area → customer) switch
 * levels with plain state — so system back skipped every level and left the
 * section. `useBackLayer(open, close)` gives a level its own history entry
 * while it's open:
 *   - system back pops the entry → the TOPMOST open layer's `close()` runs;
 *   - closing in-app (a chevron, a Done button) consumes the entry with
 *     history.back() so the stack never drifts;
 *   - unmounting with the layer open (navigating to another page) leaves the
 *     entry — never calls history.back(), which would undo that navigation;
 *   - a React StrictMode remount (dev double-invoke) keeps the same entry.
 * The close-vs-unmount-vs-remount decision is deferred one tick, because an
 * effect cleanup can't tell them apart at the moment it runs.
 * Layer entries copy the underlying history.state (incl. AppShell's
 * creedPage), so AppShell's own popstate handler stays on the same page.
 */

interface Layer { id: number; close: () => void }
const stack: Layer[] = [];
let nextId = 1;
let ignorePops = 0;

if (typeof window !== "undefined") {
  window.addEventListener("popstate", () => {
    if (ignorePops > 0) { ignorePops--; return; }
    const top = stack.pop();
    if (top) top.close();
  });
}

export function useBackLayer(open: boolean, close: () => void): void {
  const closeRef = useRef(close);
  closeRef.current = close;
  const unmounted = useRef(false);
  useEffect(() => {
    unmounted.current = false;
    return () => { unmounted.current = true; };
  }, []);
  // History entry this hook owns (layer id), and a deferred "consume it".
  const entryId = useRef<number | null>(null);
  const pendingBack = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) return;
    if (pendingBack.current && entryId.current !== null) {
      // Remounted right after a cleanup (StrictMode) — keep our entry.
      clearTimeout(pendingBack.current);
      pendingBack.current = null;
    } else {
      entryId.current = nextId++;
      const base = (window.history.state && typeof window.history.state === "object") ? window.history.state : {};
      window.history.pushState({ ...base, creedLayer: entryId.current }, "");
    }
    const id = entryId.current!;
    stack.push({ id, close: () => { entryId.current = null; closeRef.current(); } });

    return () => {
      const i = stack.findIndex((l) => l.id === id);
      if (i < 0) return; // popped by system back — its entry is already gone
      stack.splice(i, 1);
      pendingBack.current = setTimeout(() => {
        pendingBack.current = null;
        if (unmounted.current) { entryId.current = null; return; } // left the page
        entryId.current = null;
        ignorePops++;              // closed in-app → consume our entry quietly
        window.history.back();
      }, 0);
    };
  }, [open]);
}
