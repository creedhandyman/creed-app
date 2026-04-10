"use client";
import { useState } from "react";
import { db } from "@/lib/supabase";

export default function ReviewPage() {
  const [name, setName] = useState("");
  const [rating, setRating] = useState(0);
  const [text, setText] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!name || !rating || !text) return;
    setSubmitting(true);
    await db.post("reviews", {
      client_name: name,
      review_text: text,
      rating,
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
            src="/CREED_LOGO.png"
            alt="Creed Handyman"
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
            Creed Handyman
          </h1>
          <div
            style={{
              fontFamily: "Oswald, sans-serif",
              fontSize: 10,
              color: "#C00000",
              letterSpacing: ".15em",
            }}
          >
            LLC
          </div>
        </div>

        {submitted ? (
          /* Thank you */
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
              — The Creed Handyman Team
            </div>
          </div>
        ) : (
          /* Review form */
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
              <label
                style={{
                  fontSize: 11,
                  color: "#888",
                  fontFamily: "Oswald, sans-serif",
                  textTransform: "uppercase",
                  letterSpacing: ".08em",
                  display: "block",
                  marginBottom: 4,
                }}
              >
                Your Name
              </label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter your name"
                style={{
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
                }}
              />
            </div>

            {/* Star rating */}
            <div style={{ marginBottom: 12 }}>
              <label
                style={{
                  fontSize: 11,
                  color: "#888",
                  fontFamily: "Oswald, sans-serif",
                  textTransform: "uppercase",
                  letterSpacing: ".08em",
                  display: "block",
                  marginBottom: 8,
                }}
              >
                Rating
              </label>
              <div style={{ display: "flex", gap: 6, justifyContent: "center" }}>
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
              <label
                style={{
                  fontSize: 11,
                  color: "#888",
                  fontFamily: "Oswald, sans-serif",
                  textTransform: "uppercase",
                  letterSpacing: ".08em",
                  display: "block",
                  marginBottom: 4,
                }}
              >
                How was your experience?
              </label>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Tell us about the work we did..."
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  background: "#1a1a28",
                  border: "1px solid #1e1e2e",
                  borderRadius: 8,
                  color: "#e2e2e8",
                  fontSize: 14,
                  fontFamily: "Source Sans 3, sans-serif",
                  outline: "none",
                  height: 100,
                  resize: "vertical",
                  boxSizing: "border-box",
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

        {/* Footer */}
        <div style={{ textAlign: "center", marginTop: 16, color: "#555", fontSize: 10 }}>
          Lic #8145054 · Wichita, KS · (316) 252-6335
        </div>
      </div>
    </div>
  );
}
