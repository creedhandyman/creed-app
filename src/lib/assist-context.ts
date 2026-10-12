/**
 * Job context for AI Assist — the saved inspection, work-order state, job
 * notes and the customer's original request, as compact read-only text.
 *
 * AI Assist used to see only the current quote lines, so a later edit ("make
 * Best a full repaint") had to guess room sizes the inspection already
 * recorded, and could rescope a line the crew had already finished. Text only
 * (no photos) so every Assist call stays about the same cost and speed.
 */

type InspItem = { name?: string; condition?: string; notes?: string; comment?: string };
type InspRoom = { name?: string; sqft?: number; width?: number; length?: number; items?: InspItem[] };
export type AssistInspection = { type?: string; rooms?: InspRoom[] } | null | undefined;
type WOTask = { room?: string; detail?: string; action?: string; done?: boolean; custom?: boolean };

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + "…" : s);
const COND: Record<string, string> = { S: "OK", F: "Fair", P: "Poor", D: "Damaged" };

export function buildAssistJobContext(src: {
  inspection?: AssistInspection;
  workOrder?: WOTask[] | null;
  jobNotes?: string | null;
  leadDescription?: string | null;
}): string {
  const parts: string[] = [];

  const rooms = src.inspection?.rooms || [];
  if (rooms.length) {
    const lines: string[] = [];
    for (const r of rooms) {
      const size = r.width && r.length ? `${r.width}x${r.length} ft` : "";
      const area = r.sqft ? `${r.sqft} sqft` : "";
      const head = `- ${r.name || "Room"}${size || area ? ` (${[size, area].filter(Boolean).join(", ")})` : ""}`;
      // Satisfactory items with no note are noise; everything else is a
      // finding (or a note the tech bothered to write).
      const findings = (r.items || [])
        .map((it) => ({ ...it, note: (it.notes ?? it.comment ?? "").trim() }))
        .filter((it) => (it.condition && it.condition !== "S") || it.note)
        .map((it) => `${it.name || "Item"} [${COND[it.condition || "S"] || it.condition}]${it.note ? `: ${clip(it.note, 200)}` : ""}`);
      lines.push(findings.length ? `${head}: ${findings.join("; ")}` : head);
    }
    parts.push(`INSPECTION (${src.inspection?.type || "walkthrough"}) — room sizes + findings:\n${clip(lines.join("\n"), 6000)}`);
  }

  const wo = Array.isArray(src.workOrder) ? src.workOrder : [];
  const done = wo.filter((w) => w.done && w.detail);
  const custom = wo.filter((w) => w.custom && w.detail);
  if (done.length) {
    parts.push(`WORK ORDER — tasks the crew already FINISHED:\n${done.map((w) => `- ${w.detail}`).join("\n")}`);
  }
  if (custom.length) {
    parts.push(
      `WORK ORDER — tasks added by hand (not quote lines):\n` +
      custom.map((w) => `- ${w.room ? `${w.room}: ` : ""}${w.detail}${w.action ? ` — ${clip(w.action, 200)}` : ""}${w.done ? " (done)" : ""}`).join("\n"),
    );
  }

  const notes = (src.jobNotes || "").trim();
  if (notes) parts.push(`JOB NOTES (crew/office):\n${clip(notes, 1500)}`);
  const lead = (src.leadDescription || "").trim();
  if (lead) parts.push(`CUSTOMER'S ORIGINAL REQUEST:\n${clip(lead, 1500)}`);

  return parts.join("\n\n");
}
