"use client";
import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";

// Generates a single, data-driven marketing tip for the org. Surfaced as
// the Dashboard "Quick tip" widget. Logic was originally the
// AI Marketing Coach in the Marketing tab — kept here so the same
// recommendation engine can be reused if we add another entry point.
export function useMarketingTip() {
  const org = useStore((s) => s.org);
  const reviews = useStore((s) => s.reviews);
  const jobs = useStore((s) => s.jobs);

  const [tip, setTip] = useState<string>("");
  const [loading, setLoading] = useState(false);

  const refresh = async () => {
    if (!org) return;
    setLoading(true);
    try {
      const completedJobs = jobs.filter((j) => ["complete", "invoiced", "paid"].includes(j.status)).length;
      const totalJobs = jobs.length;
      const avgRating = reviews.length ? (reviews.reduce((s, r) => s + (r.rating || 0), 0) / reviews.length).toFixed(1) : "none";

      const prompt = `You are a marketing coach for a small field service contractor. Give ONE short, specific, actionable marketing tip — 1-2 sentences max. Start with an emoji.

Business context:
- Business: ${org.name || "Service business"} in ${org.address || "unknown area"}
- Reviews: ${reviews.length} total, average ${avgRating} stars
- Jobs: ${totalJobs} total, ${completedJobs} completed
- Phone: ${org.phone ? "Yes" : "No"}

Be specific to their situation — if they have few reviews, focus on getting more. If they have lots of completed work, suggest sharing photos. Mix digital and offline tactics. Sound like a friend who knows marketing, not a textbook.

Return ONLY the tip — no preamble, no numbering, no headers.`;

      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 200,
          messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
        }),
      });
      const data = await res.json();
      const text = (data.content?.[0]?.text || "").trim();
      if (text) setTip(text);
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (!tip && !loading && org) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org?.id]);

  return { tip, loading, refresh };
}
