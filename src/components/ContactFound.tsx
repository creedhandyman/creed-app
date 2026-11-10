"use client";
/**
 * "Contact info found" card on the quote editor. Reads the names, phones and
 * emails typed into the quote's description (lib/contact-extract.ts) and
 * offers them as the job's customer and resident in one tap — so review
 * requests (and on-the-way texts) later have someone to go to without
 * re-typing anything into the job.
 *
 * Nothing is written until the owner taps Add:
 *  - customer: links an existing customer (matched by phone, email or name),
 *    fills a blank phone/email on the picked customer, or creates a new one.
 *    A property manager's record is never changed.
 *  - resident: handed back to QuoteForge (onResident) and saved onto the job
 *    with the quote (lib/quote-save.ts → residentName/Phone/Email).
 * Fields are editable first, so a misread is fixed before it's saved.
 */
import { useEffect, useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import { Icon } from "./Icon";
import {
  extractContacts, planContactFill, type FoundContact, type ContactPlan,
} from "@/lib/contact-extract";

interface Props {
  /** The description the quote was built from (Quick Quote text / lead description). */
  sourceText: string;
  customerId?: string;
  client: string;
  setCustomerId: (v: string | undefined) => void;
  setClient: (v: string) => void;
  /** Resident already on the job (saved blob merged with anything added this session). */
  residentOnFile: FoundContact;
  onResident: (r: FoundContact) => void;
}

const fieldStyle = {
  flex: 1, minWidth: 0, fontSize: 14, padding: "6px 8px", borderRadius: 6,
  border: "1px solid var(--color-border-dark, #2a2a3e)", background: "transparent", color: "inherit",
} as const;

export default function ContactFound({
  sourceText, customerId, client, setCustomerId, setClient, residentOnFile, onResident,
}: Props) {
  const customers = useStore((s) => s.customers);
  const org = useStore((s) => s.org);
  const profiles = useStore((s) => s.profiles);
  const upsertCustomer = useStore((s) => s.upsertCustomer);
  const showToast = useStore((s) => s.showToast);

  // The business's own numbers are never a customer's.
  const exclude = useMemo(
    () => [org?.phone, ...profiles.map((p) => p.phone)].filter(Boolean) as string[],
    [org?.phone, profiles],
  );
  const linked = customerId ? customers.find((c) => c.id === customerId) ?? null : null;

  const plan: ContactPlan = useMemo(() => planContactFill({
    found: extractContacts(sourceText, { exclude }),
    linked,
    clientName: client,
    residentOnFile,
    customers,
  }), [sourceText, exclude, linked, client, residentOnFile, customers]);

  const planKey = JSON.stringify(plan);
  // Hidden after Add / Not now until the quote is built from new text.
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);
  const [cus, setCus] = useState<FoundContact>({ name: "", phone: "", email: "" });
  const [res, setRes] = useState<FoundContact>({ name: "", phone: "", email: "" });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setCus({ name: plan.customer?.name || "", phone: plan.customer?.phone || "", email: plan.customer?.email || "" });
    setRes({ name: plan.resident?.name || "", phone: plan.resident?.phone || "", email: plan.resident?.email || "" });
  }, [planKey]); // eslint-disable-line react-hooks/exhaustive-deps

  if ((!plan.customer && !plan.resident) || dismissedFor === sourceText) return null;

  const pc = plan.customer;
  const customerNote = !pc ? ""
    : pc.mode === "new" ? "New customer"
    : pc.mode === "match" ? `Already a customer: ${pc.matchName}`
    : `Adds to ${pc.matchName}`;

  const add = async () => {
    setBusy(true);
    const done: string[] = [];
    try {
      if (pc) {
        const phone = cus.phone.trim();
        const email = cus.email.trim().toLowerCase();
        if (pc.mode === "new") {
          const name = cus.name.trim();
          if (!name) {
            showToast("Add the customer's name first", "warning");
            setBusy(false);
            return;
          }
          const created = await upsertCustomer({
            name, type: "individual",
            ...(phone ? { phone } : {}),
            ...(email ? { email } : {}),
          });
          if (created) {
            setCustomerId(created.id);
            setClient(created.name);
            done.push(`customer ${created.name}`);
          }
        } else if (pc.matchId) {
          const existing = customers.find((c) => c.id === pc.matchId);
          if (existing) {
            const fill: { phone?: string; email?: string } = {};
            if (phone && !existing.phone) fill.phone = phone;
            if (email && !existing.email) fill.email = email;
            if (fill.phone || fill.email) await upsertCustomer({ id: existing.id, name: existing.name, ...fill });
            if (pc.mode === "match") {
              setCustomerId(existing.id);
              setClient(existing.name);
            }
            done.push(`customer ${existing.name}`);
          }
        }
      }
      if (plan.resident) {
        const r = { name: res.name.trim(), phone: res.phone.trim(), email: res.email.trim().toLowerCase() };
        if (r.name || r.phone || r.email) {
          onResident(r);
          done.push(`resident${r.name ? ` ${r.name}` : ""}`);
        }
      }
      if (done.length) showToast(`Added ${done.join(" and ")} to the job`, "success");
      setDismissedFor(sourceText);
    } finally {
      setBusy(false);
    }
  };

  const row = (
    label: string, v: FoundContact, set: (c: FoundContact) => void, showName: boolean,
  ) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
      <b style={{ fontSize: 13 }}>{label}</b>
      {showName && (
        <input value={v.name} placeholder="Name" aria-label={`${label} name`}
          onChange={(e) => set({ ...v, name: e.target.value })} style={fieldStyle} />
      )}
      <div style={{ display: "flex", gap: 6 }}>
        <input value={v.phone} type="tel" placeholder="Phone" aria-label={`${label} phone`}
          onChange={(e) => set({ ...v, phone: e.target.value })} style={fieldStyle} />
        <input value={v.email} type="email" placeholder="Email" aria-label={`${label} email`}
          onChange={(e) => set({ ...v, email: e.target.value })} style={fieldStyle} />
      </div>
    </div>
  );

  return (
    <div className="cd mb" style={{ border: "1.5px solid var(--color-primary)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Icon name="star" size={16} color="var(--color-highlight)" />
        <b style={{ fontSize: 15 }}>Contact info found</b>
      </div>
      <div className="dim" style={{ fontSize: 12, marginTop: 2 }}>
        From your description. Check it, then add it so review requests and texts go to the right person.
      </div>
      {pc && row(`Customer · ${customerNote}`, cus, setCus, pc.mode === "new")}
      {plan.resident && row("Resident", res, setRes, true)}
      <div className="row" style={{ gap: 8, marginTop: 10 }}>
        <button className="bb" disabled={busy} onClick={add}
          style={{ fontSize: 14, padding: "6px 14px", display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Icon name="check" size={14} /> {busy ? "Adding…" : "Add to job"}
        </button>
        <button className="bo" disabled={busy} onClick={() => setDismissedFor(sourceText)}
          style={{ fontSize: 14, padding: "6px 14px" }}>
          Not now
        </button>
      </div>
    </div>
  );
}
