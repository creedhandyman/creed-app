"use client";
/**
 * Cloudflare Turnstile ("I'm not a robot") for the public quote form. Renders
 * nothing unless NEXT_PUBLIC_TURNSTILE_SITE_KEY is set (the server checks the
 * token only when TURNSTILE_SECRET_KEY is set — set both or neither).
 */
import { useEffect, useRef } from "react";

declare global {
  interface Window {
    turnstile?: { render: (el: HTMLElement, o: Record<string, unknown>) => string; remove?: (id: string) => void };
  }
}

export const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || "";
const SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

export default function Turnstile({ onToken }: { onToken: (t: string) => void }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!TURNSTILE_SITE_KEY || !box.current) return;
    let id: string | undefined;
    let dead = false;
    const draw = () => {
      if (dead || !box.current || !window.turnstile) return;
      id = window.turnstile.render(box.current, {
        sitekey: TURNSTILE_SITE_KEY, theme: "dark",
        callback: (tok: string) => onToken(tok),
        "expired-callback": () => onToken(""),
        "error-callback": () => onToken(""),
      });
    };
    if (window.turnstile) draw();
    else {
      let s = document.querySelector<HTMLScriptElement>(`script[src="${SRC}"]`);
      if (!s) { s = document.createElement("script"); s.src = SRC; s.async = true; document.head.appendChild(s); }
      s.addEventListener("load", draw);
    }
    return () => { dead = true; if (id && window.turnstile?.remove) window.turnstile.remove(id); };
  }, [onToken]);
  if (!TURNSTILE_SITE_KEY) return null;
  return <div ref={box} style={{ margin: "4px 0 12px", minHeight: 65 }} />;
}
