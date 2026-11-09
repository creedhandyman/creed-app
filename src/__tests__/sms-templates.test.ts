import { clock12, textBody } from "../lib/sms-templates";

const base = { business: "Creed Handyman", property: "123 Main St", link: "https://example.com/status?job=1" };

describe("textBody", () => {
  it("never shows a resident the price or the link", () => {
    for (const kind of ["enroute", "late", "complete", "reminder"] as const) {
      const t = textBody(kind, { ...base, role: "resident", name: "Maria Lopez", amount: 250 });
      expect(t).not.toContain("https://");
      expect(t).not.toContain("$");
      expect(t.startsWith("Hi Maria! ")).toBe(true);
    }
  });

  it("gives customers the link and total", () => {
    expect(textBody("enroute", { ...base, role: "customer", name: "Jane" })).toContain("Track your job: https://example.com");
    expect(textBody("complete", { ...base, role: "customer", name: "Jane", amount: 250 })).toContain("Total: $250.00. View & pay: https://");
  });

  it("writes the running-late minutes", () => {
    expect(textBody("late", { ...base, role: "resident", minutes: 30 })).toContain("about 30 minutes late to 123 Main St");
    expect(textBody("late", { ...base, role: "resident" })).toContain("about 15 minutes");
  });

  it("puts the visit time in the reminder when there is one", () => {
    expect(textBody("reminder", { ...base, role: "resident", name: "Maria", time: "09:30" }))
      .toBe("Hi Maria! This is Creed Handyman. A reminder that we'll be at 123 Main St tomorrow at 9:30 AM. See you then!");
    expect(textBody("reminder", { ...base, role: "customer", time: "" })).toContain("tomorrow. See you then!");
  });

  it("writes the balance in the invoice reminder", () => {
    expect(textBody("invoice", { ...base, role: "property_manager", name: "Keyrenter Wichita", amount: 125.05 }))
      .toBe("Hi Keyrenter! A friendly reminder from Creed Handyman: $125.05 is still due for the work at 123 Main St. View & pay: https://example.com/status?job=1");
  });

  it("falls back gracefully without a name or business", () => {
    expect(textBody("enroute", { role: "resident", property: "" })).toBe("Hi! This is us. We're on our way to your home.");
  });
});

describe("clock12", () => {
  it("formats 24h times", () => {
    expect(clock12("00:15")).toBe("12:15 AM");
    expect(clock12("12:30")).toBe("12:30 PM");
    expect(clock12("13:30")).toBe("1:30 PM");
    expect(clock12("")).toBe("");
    expect(clock12("soon")).toBe("");
  });
});
