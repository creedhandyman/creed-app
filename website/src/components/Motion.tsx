"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

// Elements that rise in as they scroll into view. Siblings stagger.
const REVEAL = [
  ".section > *:not(.svc-grid):not(.review-grid):not(.gal-grid):not(.price-grid)",
  ".svc", ".review", ".trust", ".ba", ".point", ".cred", ".faq details",
  ".rate-slab", ".special", ".step", ".card", ".promo > *", ".cta-close > *",
].join(",");

// Numbers that count up the first time they're seen ("$55", "17,000+", "5.0").
const COUNT = ".rate-slab .num b, .special .num b, .cred b, .hero-rating b";

function countUp(el: HTMLElement) {
  const m = (el.textContent || "").match(/^(\D*)([\d,]+(?:\.\d+)?)(.*)$/);
  if (!m) return;
  const [, pre, num, post] = m;
  const target = parseFloat(num.replace(/,/g, ""));
  const decimals = (num.split(".")[1] || "").length;
  const commas = num.includes(",");
  const fmt = (v: number) => {
    const s = v.toFixed(decimals);
    return commas ? Number(s).toLocaleString("en-US") : s;
  };
  const t0 = performance.now();
  const dur = 1100;
  const tick = (t: number) => {
    const p = Math.min(1, (t - t0) / dur);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = pre + fmt(target * eased) + post;
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/** Site-wide motion layer. Content is never hidden without JS, and
 *  anything already on screen at load is left alone (no flash, no LCP hit). */
export default function Motion() {
  const pathname = usePathname();

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const vh = window.innerHeight;

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const el = e.target as HTMLElement;
          if (el.matches(COUNT)) countUp(el);
          el.classList.add("in");
          io.unobserve(el);
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.12 },
    );

    document.querySelectorAll<HTMLElement>(REVEAL).forEach((el) => {
      if (el.getBoundingClientRect().top < vh * 0.92) return;
      const sibs = el.parentElement ? Array.from(el.parentElement.children) : [];
      el.style.setProperty("--rv-d", `${Math.min(sibs.indexOf(el), 6) * 70}ms`);
      el.classList.add("rv");
      io.observe(el);
    });
    document.querySelectorAll<HTMLElement>(COUNT).forEach((el) => {
      if (el.getBoundingClientRect().top < vh * 0.92) return;
      io.observe(el);
    });

    const hdr = document.querySelector(".hdr");
    const onScroll = () => hdr?.classList.toggle("hdr-scrolled", window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    // iOS Safari only applies :active (holding a finger pauses the work reel)
    // when a touchstart listener exists.
    const noop = () => {};
    document.addEventListener("touchstart", noop, { passive: true });

    return () => {
      io.disconnect();
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("touchstart", noop);
    };
  }, [pathname]);

  return null;
}
