"use client";
import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { db } from "@/lib/supabase";
import type { Profile, Organization } from "@/lib/types";
import { Suspense } from "react";

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

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "linear-gradient(135deg, #0a0a0f, #0d1530)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <div style={{ width: "100%", maxWidth: 420 }}>
        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <img
            src={orgData?.logo_url || "/CREED_LOGO.png"}
            alt=""
            style={{ height: 64, marginBottom: 8 }}
            onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
          />
          <h1
            style={{
              fontFamily: "Oswald, sans-serif",
              fontSize: 22,
              color: "#2E75B6",
              textTransform: "uppercase",
              letterSpacing: ".05em",
            }}
          >
            {orgData?.name || "Leave a Review"}
          </h1>
          {orgData?.phone && (
            <div style={{ fontSize: 10, color: "#888", marginTop: 4 }}>{orgData.phone}</div>
          )}
        </div>

        {submitted ? (
          <div
            style={{
              background: "#12121a",
              border: "1px solid #1e1e2e",
              borderRadius: 12,
              padding: 32,
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: 48, marginBottom: 12 }}>🎉</div>
            <h2
              style={{
                fontFamily: "Oswald, sans-serif",
                fontSize: 20,
                color: "#00cc66",
                textTransform: "uppercase",
                marginBottom: 8,
              }}
            >
              Thank You!
            </h2>
            <p style={{ color: "#888", fontSize: 14, fontFamily: "Source Sans 3, sans-serif" }}>
              Your review means a lot to us. We appreciate your business and look forward to serving you again.
            </p>
            <div style={{ marginTop: 16, color: "#555", fontSize: 11 }}>
              — Thank you for choosing us
            </div>
          </div>
        ) : (
          <div
            style={{
              background: "#12121a",
              border: "1px solid #1e1e2e",
              borderRadius: 12,
              padding: 24,
            }}
          >
            <h2
              style={{
                fontFamily: "Oswald, sans-serif",
                fontSize: 18,
                color: "#e2e2e8",
                textTransform: "uppercase",
                textAlign: "center",
                marginBottom: 16,
              }}
            >
              Leave a Review
            </h2>

            {/* Name */}
            <div style={{ marginBottom: 12 }}>
              <label style={labelStyle}>Your Name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter your name"
                style={inputStyle}
              />
            </div>

            {/* Employee selection */}
            {employees.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <label style={labelStyle}>Who worked on your property?</label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
                  {employees.map((emp) => {
                    const selected = selectedEmployees.includes(emp.name);
                    return (
                      <button
                        key={emp.id}
                        onClick={() => toggleEmployee(emp.name)}
                        style={{
                          padding: "6px 14px",
                          borderRadius: 20,
                          fontSize: 13,
                          fontFamily: "Source Sans 3, sans-serif",
                          textTransform: "none",
                          letterSpacing: "normal",
                          background: selected ? "#2E75B622" : "transparent",
                          color: selected ? "#2E75B6" : "#888",
                          border: `1px solid ${selected ? "#2E75B6" : "#333"}`,
                          cursor: "pointer",
                        }}
                      >
                        {selected ? "✓ " : ""}{emp.name.trim()}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Star rating */}
            <div style={{ marginBottom: 12 }}>
              <label style={labelStyle}>Rating</label>
              <div style={{ display: "flex", gap: 6, justifyContent: "center", marginTop: 4 }}>
                {[1, 2, 3, 4, 5].map((star) => (
                  <span
                    key={star}
                    onClick={() => setRating(star)}
                    style={{
                      fontSize: 36,
                      cursor: "pointer",
                      color: star <= rating ? "#ffcc00" : "#333",
                      transition: "color 0.15s, transform 0.15s",
                      transform: star <= rating ? "scale(1.1)" : "scale(1)",
                    }}
                  >
                    ★
                  </span>
                ))}
              </div>
            </div>

            {/* Comment */}
            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>How was your experience?</label>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Tell us about the work we did..."
                style={{
                  ...inputStyle,
                  height: 100,
                  resize: "vertical" as const,
                }}
              />
            </div>

            {/* Submit */}
            <button
              onClick={submit}
              disabled={!name || !rating || !text || submitting}
              style={{
                width: "100%",
                padding: 12,
                background: !name || !rating || !text ? "#333" : "#2E75B6",
                color: "#fff",
                border: "none",
                borderRadius: 8,
                fontSize: 15,
                fontFamily: "Oswald, sans-serif",
                textTransform: "uppercase",
                letterSpacing: ".06em",
                cursor: !name || !rating || !text ? "not-allowed" : "pointer",
              }}
            >
              {submitting ? "Submitting..." : "Submit Review"}
            </button>
          </div>
        )}

        <div style={{ textAlign: "center", marginTop: 16, color: "#555", fontSize: 10 }}>
          Powered by Creed App
        </div>
      </div>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  color: "#888",
  fontFamily: "Oswald, sans-serif",
  textTransform: "uppercase",
  letterSpacing: ".08em",
  display: "block",
  marginBottom: 4,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  background: "#1a1a28",
  border: "1px solid #1e1e2e",
  borderRadius: 8,
  color: "#e2e2e8",
  fontSize: 14,
  fontFamily: "Source Sans 3, sans-serif",
  outline: "none",
  boxSizing: "border-box",
};


export default function ReviewPage() {
  return (
    <Suspense fallback={<div style={{ minHeight: "100vh", background: "#0a0a0f" }} />}>
      <ReviewContent />
    </Suspense>
  );
}
