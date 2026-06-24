"use client";
import { useEffect, useRef, useState } from "react";

/**
 * Animated number that ticks from its previous value up (or down) to the new
 * one with an ease-out — the "AI did that in seconds" / "watch it grow" moment.
 * Mounts animating from 0. Honors prefers-reduced-motion (snaps instantly).
 */
interface Props {
  value: number;
  duration?: number; // ms
  prefix?: string;
  suffix?: string;
  decimals?: number;
  className?: string;
  style?: React.CSSProperties;
}

const prefersReduced = () =>
  typeof window !== "undefined" &&
  !!window.matchMedia &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export default function CountUp({ value, duration = 1100, prefix = "", suffix = "", decimals = 0, className, style }: Props) {
  const [display, setDisplay] = useState(0);
  const displayRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const from = displayRef.current;
    const to = value;
    if (prefersReduced() || from === to) {
      displayRef.current = to;
      setDisplay(to);
      return;
    }
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / duration);
      const eased = 1 - Math.pow(1 - p, 3); // ease-out cubic
      const v = from + (to - from) * eased;
      displayRef.current = v;
      setDisplay(v);
      if (p < 1) rafRef.current = requestAnimationFrame(tick);
      else displayRef.current = to;
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [value, duration]);

  const text =
    prefix +
    display.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) +
    suffix;
  return <span className={className} style={style}>{text}</span>;
}
