"use client";
import { useState, useRef } from "react";
import { useStore } from "@/lib/store";
import { supabase } from "@/lib/supabase";

interface Message {
  role: "user" | "assistant";
  content: string;
  images?: string[];
}

const SYSTEM_PROMPT = `You are a troubleshooting assistant built into a handyman and trades worker app. Your job is to help users diagnose and fix issues with residential and commercial equipment, appliances, and systems through a guided, conversational process.

Core rules:
- Troubleshoot step by step. Start with the most likely cause, confirm or rule it out, then move to the next.
- After each suggestion, ask what happened so you can adjust.
- Use plain, direct language. The user is hands-on but may not know this specific equipment.
- Prioritize safety. Include warnings for electrical, gas, refrigerants, heights, springs.
- Keep responses concise — one step or question at a time.
- Use bold for key actions.
- If you see photos, identify brand, model, indicator lights, visible damage.
- If beyond DIY scope, say so and recommend a licensed pro.
- Estimate difficulty and time for each fix.
- Never fabricate model-specific procedures. If unsure, say so.

Categories: garage doors, HVAC, electrical, plumbing, appliances, smart home, doors/windows, irrigation, roofing, painting, flooring, drywall.

Diagnostic sequence: Identify equipment → Clarify symptom → Check basics (power, connections) → Test isolation → Interpret error codes → Guide fix step by step → Verify fix.`;

export default function Troubleshoot({ setPage }: { setPage: (p: string) => void }) {
  const darkMode = useStore((s) => s.darkMode);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [photos, setPhotos] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const photoRef = useRef<HTMLInputElement>(null);
  const chatRef = useRef<HTMLDivElement>(null);

  const compressImage = async (file: File): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        let w = img.width, h = img.height;
        const max = 1200;
        if (w > max || h > max) {
          if (w > h) { h = Math.round(h * max / w); w = max; }
          else { w = Math.round(w * max / h); h = max; }
        }
        canvas.width = w; canvas.height = h;
        canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", 0.6));
      };
      img.onerror = () => resolve("");
      img.src = URL.createObjectURL(file);
    });
  };

  const handlePhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length) return;
    setUploading(true);
    const newPhotos: string[] = [];
    for (let i = 0; i < Math.min(files.length, 4); i++) {
      const compressed = await compressImage(files[i]);
      if (compressed) newPhotos.push(compressed);
    }
    setPhotos((prev) => [...prev, ...newPhotos].slice(0, 6));
    setUploading(false);
    if (e.target) e.target.value = "";
  };

  const send = async () => {
    if (!input.trim() && !photos.length) return;

    const userMsg: Message = {
      role: "user",
      content: input.trim() || "(photo uploaded)",
      images: photos.length ? [...photos] : undefined,
    };

    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    setInput("");
    setPhotos([]);
    setLoading(true);

    try {
      // Build API message content
      const apiMessages = updatedMessages.map((m) => {
        const content: Array<
          | { type: "text"; text: string }
          | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
        > = [];

        if (m.images?.length) {
          m.images.forEach((img) => {
            const [header, data] = img.split(",");
            const mediaType = header.match(/image\/([\w]+)/)?.[0] || "image/jpeg";
            content.push({ type: "image", source: { type: "base64", media_type: mediaType, data } });
          });
        }

        if (m.content) {
          content.push({ type: "text", text: m.content });
        }

        return { role: m.role, content };
      });

      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1500,
          system: SYSTEM_PROMPT,
          messages: apiMessages,
        }),
      });

      const data = await res.json();
      const text = data.content?.[0]?.text || "I couldn't process that. Try describing the issue differently.";

      setMessages((prev) => [...prev, { role: "assistant", content: text }]);
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", content: "Connection error. Check your internet and try again." }]);
    }

    setLoading(false);
    setTimeout(() => chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: "smooth" }), 100);
  };

  return (
    <div className="fi" style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 80px)" }}>
      {/* Header */}
      <div className="row mb" style={{ justifyContent: "space-between", flexShrink: 0 }}>
        <div className="row">
          <button className="bo" onClick={() => setPage("dash")} style={{ fontSize: 12, padding: "4px 10px" }}>← Back</button>
          <h2 style={{ fontSize: 20, color: "var(--color-primary)" }}>🔧 AI Troubleshooter</h2>
        </div>
        {messages.length > 0 && (
          <button
            className="bo"
            onClick={() => setMessages([])}
            style={{ fontSize: 12, padding: "4px 10px" }}
          >
            New Session
          </button>
        )}
      </div>

      {/* Chat area */}
      <div
        ref={chatRef}
        style={{
          flex: 1, overflowY: "auto", marginBottom: 10,
          display: "flex", flexDirection: "column", gap: 10,
        }}
      >
        {messages.length === 0 && !loading && (
          <div style={{ textAlign: "center", padding: "40px 20px" }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>🔧</div>
            <h3 style={{ color: "var(--color-primary)", fontSize: 16, marginBottom: 8 }}>
              What needs fixing?
            </h3>
            <p className="dim" style={{ fontSize: 13, maxWidth: 350, margin: "0 auto", lineHeight: 1.6 }}>
              Describe the issue or upload a photo of the equipment. I&apos;ll walk you through diagnosing and fixing it step by step.
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, justifyContent: "center", marginTop: 16 }}>
              {[
                "Garage door won't open",
                "AC not cooling",
                "Toilet keeps running",
                "Outlet not working",
                "Disposal is jammed",
                "Water heater no hot water",
              ].map((q) => (
                <button
                  key={q}
                  onClick={() => { setInput(q); }}
                  style={{
                    fontSize: 12, padding: "6px 12px", borderRadius: 20,
                    background: darkMode ? "#1a1a28" : "#f0f0f5",
                    border: `1px solid ${darkMode ? "#1e1e2e" : "#ddd"}`,
                    color: darkMode ? "#aaa" : "#555", cursor: "pointer",
                  }}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div
            key={i}
            style={{
              alignSelf: m.role === "user" ? "flex-end" : "flex-start",
              maxWidth: "85%",
              padding: "10px 14px",
              borderRadius: m.role === "user" ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
              background: m.role === "user"
                ? "var(--color-primary)"
                : darkMode ? "#12121a" : "#f0f2f5",
              color: m.role === "user" ? "#fff" : darkMode ? "#e2e2e8" : "#1a1a2a",
              border: m.role === "assistant" ? `1px solid ${darkMode ? "#1e1e2e" : "#ddd"}` : "none",
            }}
          >
            {m.images && m.images.length > 0 && (
              <div style={{ display: "flex", gap: 4, marginBottom: 6, flexWrap: "wrap" }}>
                {m.images.map((img, j) => (
                  <img key={j} src={img} alt="" style={{ width: 60, height: 60, objectFit: "cover", borderRadius: 6 }} />
                ))}
              </div>
            )}
            <div style={{ fontSize: 13, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
              {m.content.split(/\*\*(.*?)\*\*/g).map((part, pi) =>
                pi % 2 === 1 ? <b key={pi}>{part}</b> : <span key={pi}>{part}</span>
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div style={{
            alignSelf: "flex-start", padding: "10px 14px", borderRadius: "14px 14px 14px 4px",
            background: darkMode ? "#12121a" : "#f0f2f5", border: `1px solid ${darkMode ? "#1e1e2e" : "#ddd"}`,
          }}>
            <div className="dim" style={{ fontSize: 13 }}>Thinking...</div>
          </div>
        )}
      </div>

      {/* Photo preview */}
      {photos.length > 0 && (
        <div style={{ display: "flex", gap: 6, marginBottom: 6, flexShrink: 0 }}>
          {photos.map((p, i) => (
            <div key={i} style={{ position: "relative" }}>
              <img src={p} alt="" style={{ width: 50, height: 50, objectFit: "cover", borderRadius: 6, border: `1px solid ${darkMode ? "#1e1e2e" : "#ddd"}` }} />
              <button
                onClick={() => setPhotos((prev) => prev.filter((_, j) => j !== i))}
                style={{ position: "absolute", top: -4, right: -4, background: "#C00000", color: "#fff", border: "none", borderRadius: "50%", width: 16, height: 16, fontSize: 10, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
              >✕</button>
            </div>
          ))}
        </div>
      )}

      {/* Input area */}
      <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
        <button
          onClick={() => photoRef.current?.click()}
          disabled={uploading || photos.length >= 6}
          style={{
            background: "none", border: `1px solid ${darkMode ? "#1e1e2e" : "#ddd"}`,
            borderRadius: 8, padding: "8px 10px", fontSize: 16, cursor: "pointer",
            color: darkMode ? "#888" : "#666", flexShrink: 0,
          }}
        >
          📷
        </button>
        <input
          ref={photoRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={handlePhoto}
        />
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !loading && send()}
          placeholder={messages.length ? "Describe what happened..." : "What needs fixing?"}
          style={{ flex: 1, fontSize: 14, padding: "10px 14px" }}
          disabled={loading}
        />
        <button
          onClick={send}
          disabled={loading || (!input.trim() && !photos.length)}
          style={{
            background: "var(--color-primary)", color: "#fff", border: "none",
            borderRadius: 8, padding: "8px 16px", fontSize: 14,
            fontFamily: "Oswald, sans-serif", cursor: loading ? "wait" : "pointer",
            opacity: loading || (!input.trim() && !photos.length) ? 0.5 : 1,
            flexShrink: 0,
          }}
        >
          {loading ? "..." : "Send"}
        </button>
      </div>
    </div>
  );
}
