import { balanceOf, invoiceText, sendsFromBusiness } from "@/lib/job-send";

describe("sendsFromBusiness", () => {
  it("needs Ops set to the business number AND the business-number switch on", () => {
    expect(sendsFromBusiness({ job_text_via: "business", auto_sms_enroute: true })).toBe(true);
    expect(sendsFromBusiness({ job_text_via: "business", auto_sms_enroute: false })).toBe(false);
    expect(sendsFromBusiness({ job_text_via: "phone", auto_sms_enroute: true })).toBe(false);
  });

  it("defaults to the phone's own Messages app", () => {
    expect(sendsFromBusiness(null)).toBe(false);
    expect(sendsFromBusiness(undefined)).toBe(false);
    expect(sendsFromBusiness({})).toBe(false);
    expect(sendsFromBusiness({ auto_sms_enroute: true })).toBe(false);
  });
});

describe("balanceOf", () => {
  it("is the total less what's been paid, to the cent", () => {
    expect(balanceOf({ total: 250, amount_paid: 100.005 })).toEqual({ paid: 100.01, due: 149.99 });
    expect(balanceOf({ total: 110 })).toEqual({ paid: 0, due: 110 });
  });

  it("never goes below zero", () => {
    expect(balanceOf({ total: 100, amount_paid: 150 }).due).toBe(0);
    expect(balanceOf({}).due).toBe(0);
  });
});

describe("invoiceText", () => {
  const job = { client: "Dana", property: "12 Oak St", total: 300, amount_paid: 0 };

  it("shows the total and the pay link", () => {
    const text = invoiceText(job, { url: "https://x.test/status?job=1", orgName: "Creed Handyman", payOnline: true });
    expect(text).toContain("Hi Dana! Here's your invoice from Creed Handyman for 12 Oak St.");
    expect(text).toContain("Total due: $300.00");
    expect(text).toContain("View & pay online: https://x.test/status?job=1");
  });

  it("shows the balance after a deposit", () => {
    const text = invoiceText({ ...job, amount_paid: 150 }, { url: "", orgName: "Creed Handyman" });
    expect(text).toContain("Balance due: $150.00 (after the $150.00 you already paid)");
    expect(text).not.toContain("View");
  });

  it("says View, not Pay, when the business can't take cards online", () => {
    const text = invoiceText(job, { url: "https://x.test/s", payOnline: false });
    expect(text).toContain("View your invoice: https://x.test/s");
    expect(text).toContain("from us for");
  });
});
