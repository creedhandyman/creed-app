import { balanceOf, invoiceText, smsHref } from "@/lib/job-send";

describe("smsHref", () => {
  it("opens Messages with the number and the text filled in", () => {
    expect(smsHref("(316) 555-0142", "Hi Dana! Total due: $300.00")).toBe(
      "sms:3165550142?&body=Hi%20Dana!%20Total%20due%3A%20%24300.00",
    );
  });

  it("keeps a leading + and survives a link and line breaks in the text", () => {
    const href = smsHref("+1 316-555-0142", "Pay here:\nhttps://x.test/status?job=1&t=abc");
    expect(href.startsWith("sms:+13165550142?&body=")).toBe(true);
    expect(decodeURIComponent(href.split("body=")[1])).toBe("Pay here:\nhttps://x.test/status?job=1&t=abc");
  });

  it("with no number still opens Messages with the text", () => {
    expect(smsHref("", "hello")).toBe("sms:?&body=hello");
    expect(smsHref(null, "hello")).toBe("sms:?&body=hello");
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
