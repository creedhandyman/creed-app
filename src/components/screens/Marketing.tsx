"use client";
import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { Icon } from "../Icon";

export default function Marketing() {
  const org = useStore((s) => s.org);
  const reviews = useStore((s) => s.reviews);
  const jobs = useStore((s) => s.jobs);

  const [tips, setTips] = useState<string[]>([]);
  const [tipsLoading, setTipsLoading] = useState(false);

  const loadTips = async () => {
    setTipsLoading(true);
    try {
      const completedJobs = jobs.filter((j) => ["complete", "invoiced", "paid"].includes(j.status)).length;
      const totalJobs = jobs.length;
      const avgRating = reviews.length ? (reviews.reduce((s, r) => s + (r.rating || 0), 0) / reviews.length).toFixed(1) : "none";

      const prompt = `You are a marketing coach for a small field service contractor. Give exactly 5 short, specific, actionable marketing tips. Each tip should be 1-2 sentences max. Use an emoji at the start of each tip.

Business context:
- Business: ${org?.name || "Service business"} in ${org?.address || "unknown area"}
- Reviews: ${reviews.length} total, average ${avgRating} stars
- Jobs: ${totalJobs} total, ${completedJobs} completed
- Phone: ${org?.phone ? "Yes" : "No"}

Give tips they haven't heard before. Be specific to their situation — if they have few reviews, focus on getting more. Mix digital and offline tactics. Make each tip feel like advice from a friend who knows marketing, not a textbook.

Return ONLY the 5 tips, one per line. No numbering, no headers.`;

      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 500,
          messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
        }),
      });
      const data = await res.json();
      const text = data.content?.[0]?.text || "";
      const lines = text.split("\n").filter((l: string) => l.trim().length > 5).slice(0, 5);
      if (lines.length) setTips(lines);
    } catch (e) {
      console.error(e);
    }
    setTipsLoading(false);
  };

  useEffect(() => {
    if (tips.length === 0 && !tipsLoading) loadTips();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fi">
      <h2 style={{ fontSize: 22, color: "var(--color-primary)", marginBottom: 14, display: "inline-flex", alignItems: "center", gap: 8 }}>
        <Icon name="marketing" size={22} color="var(--color-primary)" />
        Marketing
      </h2>

      <div className="cd">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <h4 style={{ fontSize: 13 }}>💡 AI Marketing Coach</h4>
          <button
            className="bo"
            onClick={loadTips}
            disabled={tipsLoading}
            style={{ fontSize: 12, padding: "3px 10px" }}
          >
            {tipsLoading ? "Thinking..." : "🔄 New Tips"}
          </button>
        </div>
        {tips.length > 0 ? (
          <div style={{ fontSize: 13, lineHeight: 1.9 }}>
            {tips.map((tip, i) => (
              <div key={i} style={{ marginBottom: 6 }}>{tip}</div>
            ))}
          </div>
        ) : tipsLoading ? (
          <div className="dim" style={{ textAlign: "center", padding: 16, fontSize: 13 }}>
            Analyzing your business and generating personalized tips...
          </div>
        ) : (
          <div className="dim" style={{ textAlign: "center", padding: 12, fontSize: 13 }}>
            Tap &quot;New Tips&quot; for AI-powered marketing advice tailored to your business
          </div>
        )}
      </div>
    </div>
  );
}
