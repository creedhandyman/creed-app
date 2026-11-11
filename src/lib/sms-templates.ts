import type { RecipientRole, SmsKind } from "./sms-recipient";

/**
 * The words of each automatic customer text. PURE (tested in
 * sms-templates.test.ts). Shared by the one-tap buttons (as the editable
 * draft), /api/sms (when the app sends only a job + kind) and both timers.
 *
 * A RESIDENT never sees a price or the status/pay link: that page shows the
 * quote total, which is between the business and the paying property manager.
 * lib/sms.ts adds the "Reply STOP to opt out." line to every text.
 */
export interface TextVars {
  role: RecipientRole;
  /** Who it's addressed to; only the first name is used. */
  name?: string | null;
  business?: string | null;
  property?: string | null;
  /** Running late: minutes. */
  minutes?: number;
  /** Day-before reminder: "HH:MM" 24h, or "" when the visit has no time. */
  time?: string;
  /** Reminder sent the morning OF the visit (booked or moved after the
   *  evening run): says "today" instead of "tomorrow". */
  sameDay?: boolean;
  /** Job done (customer): the job total. Invoice: the balance still due. */
  amount?: number;
  /** Status / pay link (customers and property managers only). */
  link?: string;
}

const first = (n?: string | null) => (n || "").trim().split(/\s+/)[0] || "";
const money = (n?: number) => `$${(Number(n) || 0).toFixed(2)}`;

/** "14:30" -> "2:30 PM"; "" -> "". */
export function clock12(hhmm?: string): string {
  const m = (hhmm || "").match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return "";
  const h = Number(m[1]);
  return `${h % 12 || 12}:${m[2]} ${h >= 12 ? "PM" : "AM"}`;
}

export function textBody(kind: SmsKind, v: TextVars): string {
  const biz = (v.business || "").trim() || "us";
  const resident = v.role === "resident";
  const prop = (v.property || "").trim() || (resident ? "your home" : "your property");
  const hi = first(v.name) ? `Hi ${first(v.name)}! ` : "Hi! ";
  const link = !resident && v.link ? v.link : "";

  switch (kind) {
    case "enroute":
      return `${hi}This is ${biz}. We're on our way to ${prop}.${link ? ` Track your job: ${link}` : ""}`;
    case "late": {
      const mins = Math.max(1, Math.round(Number(v.minutes) || 15));
      return `${hi}Quick heads-up from ${biz}: we're running about ${mins} minutes late to ${prop}. Thanks for your patience!`;
    }
    case "complete":
      return resident
        ? `${hi}Work at ${prop} is complete. Thanks for having us! ${biz}`
        : `${hi}Work at ${prop} is complete. Total: ${money(v.amount)}.${link ? ` View & pay: ${link}` : ""}`;
    case "reminder": {
      const at = clock12(v.time);
      return `${hi}This is ${biz}. A reminder that we'll be at ${prop} ${v.sameDay ? "today" : "tomorrow"}${at ? ` at ${at}` : ""}. See you then!`;
    }
    case "invoice":
      return `${hi}A friendly reminder from ${biz}: ${money(v.amount)} is still due for the work at ${prop}.${link ? ` View & pay: ${link}` : ""}`;
  }
}
