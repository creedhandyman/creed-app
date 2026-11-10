import { extractContacts, planContactFill, phoneKey, formatPhone } from "../lib/contact-extract";

const none = { name: "", phone: "", email: "" };

describe("extractContacts", () => {
  it("reads a labeled tenant from an AppFolio lead description", () => {
    const r = extractContacts("Keyrenter work order 148766-1, 627 N Somerset Ct, Andover. Freezer epoxy.\nTenant: Catherine Yingling. Pet: Beagle mix. Maintenance limit $300.");
    expect(r.resident).toEqual({ name: "Catherine Yingling", phone: "", email: "" });
    expect(r.customer).toEqual(none);
    expect(r.loose).toEqual(none);
  });

  it("reads tenant name, phone and email on one line", () => {
    const r = extractContacts("Tenant: Mary Jones 316-555-0142, mary.j@example.com. Dog in back yard.");
    expect(r.resident).toEqual({ name: "Mary Jones", phone: "(316) 555-0142", email: "mary.j@example.com" });
  });

  it("handles 'Tenant name:' and a separate phone label", () => {
    const r = extractContacts("Tenant name: Madison\nTenant phone: (316) 555 0177");
    expect(r.resident.name).toBe("Madison");
    expect(r.resident.phone).toBe("(316) 555-0177");
  });

  it("reads a customer label and keeps the scope text out of the name", () => {
    const r = extractContacts("Customer: Joe Nde, (316) 555-0199, JOE@Example.com\nRepaint two bedrooms and hall.");
    expect(r.customer).toEqual({ name: "Joe Nde", phone: "(316) 555-0199", email: "joe@example.com" });
  });

  it("keeps resident and customer apart when both are labeled", () => {
    const r = extractContacts("Owner: Sam Lee 316-555-0101. Resident: Ana Ruiz 316-555-0102");
    expect(r.customer.name).toBe("Sam Lee");
    expect(r.customer.phone).toBe("(316) 555-0101");
    expect(r.resident.name).toBe("Ana Ruiz");
    expect(r.resident.phone).toBe("(316) 555-0102");
  });

  it("puts unlabeled details in loose, with the name right before the number", () => {
    const r = extractContacts("Leaky kitchen faucet, call Mary Jones at 316.555.0142 to get in");
    expect(r.loose).toEqual({ name: "Mary Jones", phone: "(316) 555-0142", email: "" });
  });

  it("skips the business's own numbers", () => {
    const r = extractContacts("Text me at (316) 252-6335 when done. Tenant: Mary 3165550142", { exclude: ["316-252-6335"] });
    expect(r.loose.phone).toBe("");
    expect(r.resident.phone).toBe("(316) 555-0142");
  });

  it("ignores work order numbers, prices and zip codes", () => {
    const r = extractContacts("Work order 152578-1, 1238 Ellet St, El Dorado, KS 67042. Limit $300. Tenant: Madison.");
    expect(r.loose).toEqual(none);
    expect(r.resident).toEqual({ name: "Madison", phone: "", email: "" });
  });

  it("does not start a segment on an owner mentioned in passing", () => {
    const r = extractContacts("The owner said the tenant is out of town");
    expect(r).toEqual({ customer: none, resident: none, loose: none });
  });

  it("is empty for empty text", () => {
    expect(extractContacts("")).toEqual({ customer: none, resident: none, loose: none });
  });
});

describe("phone helpers", () => {
  it("compares on the last 10 digits", () => {
    expect(phoneKey("+1 (316) 555-0142")).toBe("3165550142");
    expect(phoneKey("555-0142")).toBe("");
    expect(formatPhone("13165550142")).toBe("(316) 555-0142");
  });
});

describe("planContactFill", () => {
  const keyrenter = { id: "pm", name: "Keyrenter", type: "property_manager", phone: "316-555-0000", email: "wo@kr.com" };
  const jane = { id: "c1", name: "Jane Smith", type: "individual", phone: "", email: "jane@example.com" };

  it("on a property manager job, unlabeled details go to the resident and the PM is never touched", () => {
    const found = extractContacts("Thermostat out. Mary Jones 316-555-0142");
    const plan = planContactFill({ found, linked: keyrenter, clientName: "Keyrenter", residentOnFile: none, customers: [keyrenter] });
    expect(plan.customer).toBeNull();
    expect(plan.resident).toEqual({ name: "Mary Jones", phone: "(316) 555-0142", email: "" });
  });

  it("only offers resident fields the job doesn't already have", () => {
    const found = extractContacts("Tenant: Mary Jones 316-555-0142");
    const plan = planContactFill({ found, linked: keyrenter, clientName: "Keyrenter", residentOnFile: { name: "Mary", phone: "", email: "" }, customers: [] });
    expect(plan.resident).toEqual({ name: "", phone: "(316) 555-0142", email: "" });
  });

  it("offers nothing when everything is already filled", () => {
    const found = extractContacts("Tenant: Mary Jones 316-555-0142");
    const plan = planContactFill({ found, linked: keyrenter, clientName: "Keyrenter", residentOnFile: { name: "Mary", phone: "316-555-0142", email: "" }, customers: [] });
    expect(plan).toEqual({ customer: null, resident: null });
  });

  it("with no customer picked, offers a new customer from unlabeled details", () => {
    const found = extractContacts("Joe Nde 316-555-0199 joe@example.com repaint bedrooms");
    const plan = planContactFill({ found, linked: null, clientName: "", residentOnFile: none, customers: [keyrenter, jane] });
    expect(plan.customer).toEqual({ name: "Joe Nde", phone: "(316) 555-0199", email: "joe@example.com", mode: "new" });
    expect(plan.resident).toBeNull();
  });

  it("matches an existing customer by phone, email or name instead of making a duplicate", () => {
    const byEmail = planContactFill({ found: extractContacts("Customer: Jane, 316-555-0123, jane@example.com"), linked: null, clientName: "", residentOnFile: none, customers: [jane] });
    expect(byEmail.customer).toEqual({ name: "Jane Smith", phone: "(316) 555-0123", email: "", mode: "match", matchId: "c1", matchName: "Jane Smith" });
    const byName = planContactFill({ found: extractContacts("Customer: Jane Smith"), linked: null, clientName: "", residentOnFile: none, customers: [jane] });
    expect(byName.customer?.mode).toBe("match");
  });

  it("uses the AI's client name when the description has only a number", () => {
    const plan = planContactFill({ found: extractContacts("Fix the gate, 316-555-0188"), linked: null, clientName: "Dana Cole", residentOnFile: none, customers: [] });
    expect(plan.customer).toEqual({ name: "Dana Cole", phone: "(316) 555-0188", email: "", mode: "new" });
  });

  it("fills a picked customer's blank phone, never their filled email", () => {
    const plan = planContactFill({ found: extractContacts("Jane Smith 316-555-0123 other@example.com"), linked: jane, clientName: "Jane Smith", residentOnFile: none, customers: [jane] });
    expect(plan.customer).toEqual({ name: "", phone: "(316) 555-0123", email: "", mode: "fill", matchId: "c1", matchName: "Jane Smith" });
  });

  it("won't put an unlabeled stranger's number on the picked customer", () => {
    const plan = planContactFill({ found: extractContacts("Gate latch broken, call Mary Jones at 316-555-0142"), linked: jane, clientName: "Jane Smith", residentOnFile: none, customers: [jane] });
    expect(plan.customer).toBeNull();
  });

  it("won't put someone else's number on the picked customer", () => {
    const plan = planContactFill({ found: extractContacts("Customer: Robert King 316-555-0123"), linked: jane, clientName: "Jane Smith", residentOnFile: none, customers: [jane] });
    expect(plan.customer).toBeNull();
  });
});
