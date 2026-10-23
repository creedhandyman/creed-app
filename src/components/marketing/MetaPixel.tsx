"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { pixelPageView } from "@/lib/meta-pixel";

/** Paths inside MarketingShell that must NOT be tracked: the legal pages are
 *  linked from customer texts (homeowners, not prospects). */
const SKIP = new Set(["/privacy", "/terms"]);

/**
 * Fires a Meta Pixel PageView for prospects on the marketing pages. Skipped for
 * anyone with a cached app session: "/" also renders (hidden) for signed-in
 * users before HomeGate swaps the app in, and app users aren't ad prospects.
 */
export default function MetaPixel() {
  const path = usePathname();
  useEffect(() => {
    if (!path || SKIP.has(path)) return;
    try {
      const u = JSON.parse(localStorage.getItem("c_user") || "null");
      if (u && u.id) return;
    } catch {
      /* unreadable cache = treat as a visitor */
    }
    pixelPageView();
  }, [path]);
  return null;
}
