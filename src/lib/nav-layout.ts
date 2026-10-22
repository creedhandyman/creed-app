"use client";
import { useSyncExternalStore } from "react";
import { useStore, type NavMode } from "./store";

// Wide enough for the labeled side menu: laptops, desktops, landscape iPads.
export const SIDE_NAV_QUERY = "(min-width: 1024px)";

/** bottom = the phone tab bar · rail = the 56px icon strip · side = the
 *  labeled menu with every main screen. */
export type NavLayout = "bottom" | "rail" | "side";

function subscribe(cb: () => void) {
  const mq = window.matchMedia(SIDE_NAV_QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

export function useWideScreen(): boolean {
  return useSyncExternalStore(subscribe, () => window.matchMedia(SIDE_NAV_QUERY).matches, () => false);
}

/** Where the nav actually sits for a pick + screen width. Auto = side menu on
 *  a computer, bottom bar on a phone; Left/Right = side menu on a computer,
 *  icon rail on a phone; Bottom = bottom bar everywhere. */
export function navLayout(mode: NavMode, wide: boolean): { layout: NavLayout; right: boolean } {
  if (mode === "bottom" || (mode === "auto" && !wide)) return { layout: "bottom", right: false };
  return { layout: wide ? "side" : "rail", right: mode === "right" };
}

export function useNavLayout() {
  const mode = useStore((s) => s.navMode);
  return navLayout(mode, useWideScreen());
}
