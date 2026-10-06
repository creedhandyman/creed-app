"use client";

import { useEffect, useRef, useState } from "react";

/** Drag-to-compare before/after. The handle "peeks" once when it first
 *  scrolls into view so people know it moves. */
export default function CompareSlider({
  before,
  after,
  title,
}: {
  before: string;
  after: string;
  title: string;
}) {
  const [pos, setPos] = useState(50);
  const [touched, setTouched] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return;
        io.disconnect();
        const t0 = performance.now();
        const run = (t: number) => {
          const p = (t - t0) / 1600;
          if (p >= 1) { setPos(50); return; }
          // 50 -> 22 -> 78 -> 50, eased
          setPos(50 + Math.sin(p * Math.PI * 2) * -28 * (1 - p * 0.3));
          raf = requestAnimationFrame(run);
        };
        raf = requestAnimationFrame(run);
      },
      { threshold: 0.5 },
    );
    io.observe(el);
    return () => { io.disconnect(); cancelAnimationFrame(raf); };
  }, []);

  return (
    <div className="cmp" ref={ref} style={{ ["--pos" as string]: `${pos}%` }}>
      <img src={after} alt={`${title} — after`} loading="lazy" className="cmp-img" />
      <img src={before} alt={`${title} — before`} loading="lazy" className="cmp-img cmp-before" />
      <span className="ba-tag cmp-tag-b">BEFORE</span>
      <span className="ba-tag after cmp-tag-a">AFTER</span>
      <div className="cmp-handle" aria-hidden="true"><span>‹ ›</span></div>
      <input
        type="range"
        min={0}
        max={100}
        value={pos}
        aria-label={`Slide to compare before and after: ${title}`}
        onChange={(e) => { setPos(Number(e.target.value)); setTouched(true); }}
        className="cmp-range"
      />
      {!touched && <span className="cmp-hint">Drag to compare</span>}
    </div>
  );
}
