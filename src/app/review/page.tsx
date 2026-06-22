"use client";
import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { db } from "@/lib/supabase";
import type { Profile, Organization } from "@/lib/types";
import { Suspense } from "react";
import { Icon } from "@/components/Icon";

function ReviewContent() {
  const params = useSearchParams();
  const orgId = params.get("org");

  const [name, setName] = useState("");
  const [rating, setRating] = useState(0);
  const [text, setText] = useState("");
  const [selectedEmployees, setSelectedEmployees] = useState<string[]>([]);
  const [employees, setEmployees] = useState<Profile[]>([]);
  const [orgData, setOrgData] = useState<Organization | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (orgId) {
      db.get<Organization>("organizations", { id: orgId }).then((orgs) => {
        if (orgs.length) setOrgData(orgs[0]);
      });
      db.get<Profile>("profiles", { org_id: orgId }).then((profiles) => {
        setEmployees(profiles.filter((p) => p.name?.trim()));
      });
    } else {
      // No org specified — don't load any employees to prevent cross-org data leak
      setEmployees([]);
    }
  }, [orgId]);

  const toggleEmployee = (empName: string) => {
    setSelectedEmployees((prev) =>
      prev.includes(empName)
        ? prev.filter((n) => n !== empName)
        : [...prev, empName]
    );
  };

  const submit = async () => {
    if (!name || !rating || !text) return;
    setSubmitting(true);
    await db.post("reviews", {
      client_name: name,
      review_text: text,
      rating,
      employee_names: selectedEmployees.join(", "),
      ...(orgId ? { org_id: orgId } : {}),
    });
    setSubmitting(false);
    setSubmitted(true);
  };

  // Optional public Google review link (set per-org in Ops → Settings).
  const googleUrl = (orgData as unknown as { google_review_url?: string })?.google_review_url?.trim();

  return (
    <div className="pub">
      <div className="pub-wrap">
        {/* Brand header */}
        <div className="bh">
          <div className="logo">
            {orgData?.logo_url
              ? <img src={orgData.logo_url} alt="" onError={(e) => ((e.target as HTMLImageElement).style.display = "none")} />
              : (orgData?.name?.[0]?.toUpperCase() || "C")}
          </div>
          <div className="nm">{orgData?.name || "Leave a Review"}</div>
          {orgData?.phone && <div className="ph">{orgData.phone}</div>}
        </div>

        {submitted ? (
          <div className="card" style={{ textAlign: "center", padding: 28 }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>🎉</div>
            <h2 style={{ fontFamily: "Oswald, sans-serif", fontSize: 22, color: "#3ee08f", textTransform: "uppercase", marginBottom: 8 }}>Thank You!</h2>
            <p className="muted" style={{ fontSize: 15, lineHeight: 1.5 }}>
              Your review means a lot to us. We appreciate your business and look forward to serving you again.
            </p>
            {googleUrl && (
              <a href={googleUrl} target="_blank" rel="noopener noreferrer" className="btn ghost" style={{ marginTop: 16, textDecoration: "none" }}>
                <Icon name="link" size={16} /> Also review us on Google
              </a>
            )}
          </div>
        ) : (
          <>
            {/* "All done" hero */}
            <div className="hero" style={{ background: "linear-gradient(135deg, rgba(245,180,0,.2), rgba(245,180,0,.04))", border: "1px solid rgba(245,180,0,.4)" }}>
              <div className="ic" style={{ background: "rgba(245,180,0,.2)" }}>🎉</div>
              <div className="st" style={{ color: "#ffd76b" }}>All done!</div>
              <div className="ds">How did we do? Tell us below.</div>
            </div>

            <div className="card">
              {/* Name */}
              <div className="lbl">Your name</div>
              <input className="in" value={name} onChange={(e) => setName(e.target.value)} placeholder="Enter your name" />

              {/* Employee selection */}
              {employees.length > 0 && (
                <>
                  <div className="lbl">Who worked on your property?</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 11 }}>
                    {employees.map((emp) => {
                      const selected = selectedEmployees.includes(emp.name);
                      return (
                        <button
                          key={emp.id}
                          onClick={() => toggleEmployee(emp.name)}
                          style={{
                            padding: "6px 13px", borderRadius: 99, fontSize: 13.5,
                            fontFamily: "Source Sans 3, sans-serif",
                            background: selected ? "rgba(46,117,182,.16)" : "transparent",
                            color: selected ? "#acd2ff" : "#8a8a99",
                            border: `1px solid ${selected ? "rgba(46,117,182,.9)" : "#2a2a3a"}`,
                            cursor: "pointer",
                          }}
                        >
                          {selected ? "✓ " : ""}{emp.name.trim()}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}

              {/* Star rating */}
              <div className="lbl">Rating</div>
              <div className="stars">
                {[1, 2, 3, 4, 5].map((star) => (
                  <span
                    key={star}
                    onClick={() => setRating(star)}
                    style={{
                      fontSize: 34, cursor: "pointer",
                      color: star <= rating ? "#f5b400" : "#3a3a48",
                      transform: star <= rating ? "scale(1.06)" : "scale(1)",
                      transition: "color .15s, transform .15s",
                    }}
                  >
                    ★
                  </span>
                ))}
              </div>

              {/* Comment */}
              <div className="lbl">How was your experience?</div>
              <textarea
                className="in"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Tell us what went well…"
                style={{ height: 100, resize: "vertical" }}
              />

              <button className="btn glow-gold" onClick={submit} disabled={!name || !rating || !text || submitting} style={{ marginBottom: googleUrl ? 10 : 0 }}>
                <Icon name="send" size={16} /> {submitting ? "Submitting…" : "Submit Review"}
              </button>
              {googleUrl && (
                <a href={googleUrl} target="_blank" rel="noopener noreferrer" className="btn ghost" style={{ textDecoration: "none" }}>
                  <Icon name="link" size={16} /> Also review us on Google
                </a>
              )}
            </div>
          </>
        )}

        <div style={{ textAlign: "center", marginTop: 16, color: "#666", fontSize: 12 }}>Powered by Creed App</div>
      </div>
    </div>
  );
}

export default function ReviewPage() {
  return (
    <Suspense fallback={<div className="pub" />}>
      <ReviewContent />
    </Suspense>
  );
}
