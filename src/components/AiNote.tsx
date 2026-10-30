"use client";
import { GrizzFace } from "./Grizz";

/**
 * One-line "AI can make mistakes" disclosure, shown wherever AI output lands
 * in the app (quote editor, AI Assist, Fix-it chat, renders, Voice Walk).
 * The full wording lives in the Terms (section 5); this is the in-context
 * reminder. Keep it small and quiet — a note, not a warning banner.
 */
export default function AiNote({ text, style }: { text: string; style?: React.CSSProperties }) {
  return (
    <div
      className="dim"
      role="note"
      style={{ display: "flex", alignItems: "flex-start", gap: 5, fontSize: 11.5, lineHeight: 1.4, ...style }}
    >
      <GrizzFace size={16} style={{ marginTop: -1 }} />
      <span>{text}</span>
    </div>
  );
}
