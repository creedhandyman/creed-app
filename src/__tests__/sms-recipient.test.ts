import { isPropertyManager, textRecipient } from "../lib/sms-recipient";

const blob = (o: Record<string, unknown>) => JSON.stringify({ rooms: [], ...o });
const pmCo = { type: "property_manager", name: "Keyrenter Wichita", phone: "316-555-0100", email: "pm@example.com" };
const homeowner = { type: "individual", name: "Jane Smith", phone: "(316) 555-0199", email: "jane@example.com" };

describe("isPropertyManager", () => {
  it("is true only for property_manager", () => {
    expect(isPropertyManager(pmCo)).toBe(true);
    expect(isPropertyManager({ type: " Property_Manager " })).toBe(true);
    expect(isPropertyManager(homeowner)).toBe(false);
    expect(isPropertyManager({ type: "business" })).toBe(false);
    expect(isPropertyManager(null)).toBe(false);
  });
});

describe("textRecipient", () => {
  it("texts the resident, not the property manager, for visit texts", () => {
    const job = { rooms: blob({ residentName: "Maria Lopez", residentPhone: "316 555 0142" }) };
    for (const kind of ["enroute", "late", "complete", "reminder"] as const) {
      expect(textRecipient(kind, job, pmCo)).toEqual({ ok: true, phone: "+13165550142", name: "Maria Lopez", role: "resident" });
    }
  });

  it("uses the AppFolio tenant fields when no resident was typed", () => {
    const job = { rooms: blob({ tenantName: "Sam", tenantPhone: "3165550111" }) };
    expect(textRecipient("enroute", job, pmCo)).toMatchObject({ ok: true, phone: "+13165550111", role: "resident" });
  });

  it("sends nothing on a PM job with no resident number (never falls back to the PM)", () => {
    const r = textRecipient("enroute", { rooms: blob({ residentName: "Maria" }) }, pmCo);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("no_resident_phone");
    expect(textRecipient("reminder", { rooms: null }, pmCo).ok).toBe(false);
  });

  it("still texts the resident when their number matches the PM's", () => {
    const job = { rooms: blob({ residentPhone: "316-555-0100" }) };
    expect(textRecipient("enroute", job, pmCo)).toMatchObject({ ok: true, role: "resident" });
  });

  it("sends invoices to whoever pays, never the resident", () => {
    const job = { rooms: blob({ residentName: "Maria", residentPhone: "3165550142" }) };
    expect(textRecipient("invoice", job, pmCo)).toEqual({ ok: true, phone: "+13165550100", name: "Keyrenter Wichita", role: "property_manager" });
  });

  it("texts a regular customer directly for everything", () => {
    const job = { rooms: blob({ residentPhone: "3165550142" }), client: "Jane" };
    expect(textRecipient("enroute", job, homeowner)).toEqual({ ok: true, phone: "+13165550199", name: "Jane Smith", role: "customer" });
    expect(textRecipient("invoice", job, homeowner)).toMatchObject({ ok: true, role: "customer" });
  });

  it("reports a missing customer phone", () => {
    const r = textRecipient("enroute", { rooms: null }, { type: "individual", name: "No Phone" });
    expect(r).toMatchObject({ ok: false, reason: "no_customer_phone" });
    expect(textRecipient("enroute", { rooms: null }, null)).toMatchObject({ ok: false, reason: "no_customer_phone" });
  });
});
