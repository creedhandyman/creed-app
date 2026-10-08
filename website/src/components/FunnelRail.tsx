"use client";

import { useEffect, useState } from "react";

// The homepage path from first look to booked job, in page order.
const STAGES = [
  { id: "reviews", label: "Reviews" },
  { id: "about", label: "Meet the owner" },
  { id: "services", label: "Services" },
  { id: "gallery", label: "Our work" },
  { id: "process", label: "How it works" },
  { id: "pricing", label: "Pricing" },
  { id: "guarantee", label: "Guarantee" },
  { id: "book", label: "Free estimate" },
];

/** Wide-desktop progress rail on the right edge: one dot per stage, the
 *  current one lit; tap a dot to jump. Hidden below 1300px (CSS). */
export default function FunnelRail() {
  const [active, setActive] = useState("");

  useEffect(() => {
    const els = STAGES.map((s) => document.getElementById(s.id)).filter(Boolean) as HTMLElement[];
    const onScroll = () => {
      const mid = window.innerHeight * 0.4;
      let cur = "";
      for (const el of els) if (el.getBoundingClientRect().top <= mid) cur = el.id;
      setActive(cur);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <nav className="frail" aria-label="On this page">
      {STAGES.map((s, i) => {
        const done = STAGES.findIndex((x) => x.id === active) >= i;
        return (
          <a key={s.id} href={`#${s.id}`} className={(s.id === active ? "on " : "") + (done ? "done" : "")}>
            <span className="lbl">{s.label}</span>
            <i />
          </a>
        );
      })}
    </nav>
  );
}
