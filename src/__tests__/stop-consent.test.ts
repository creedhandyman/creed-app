import { nextCustomerSmsConsent, autoTextConsent, isStopReply } from "@/lib/sms-consent";

const stop = { granted: false, at: "2026-11-10T15:00:00Z", source: "replied STOP", phone: "3165551234" };
const formYes = { granted: true, at: "2026-11-12T15:00:00Z", source: "website quote form", phone: "(316) 555-1234" };

test("a form's checked box does not undo a STOP reply for that number", () => {
  expect(isStopReply(stop)).toBe(true);
  expect(nextCustomerSmsConsent(stop, formYes, "form")).toBeNull();
  expect(nextCustomerSmsConsent(stop, { ...formYes, source: "online booking page" }, "form")).toBeNull();
});

test("START, the owner, or a different number still turn texts on", () => {
  expect(nextCustomerSmsConsent(stop, { granted: true, at: "2026-11-12T15:00:00Z", source: "replied START", phone: "3165551234" }, "set"))
    .toMatchObject({ granted: true, source: "replied START" });
  expect(nextCustomerSmsConsent(stop, { ...formYes, source: "recorded by owner" }, "set")).toMatchObject({ granted: true });
  // The STOP was for another number: the form's yes covers the new one.
  expect(nextCustomerSmsConsent(stop, { ...formYes, phone: "316-555-9999" }, "form")).toMatchObject({ granted: true, phone: "3165559999" });
  // An owner-set "off" (not a STOP) is still replaced by the customer's own yes, as before.
  expect(nextCustomerSmsConsent({ ...stop, source: "turned off by owner" }, formYes, "form")).toMatchObject({ granted: true });
});

test("automatic texts stay off after STOP even when a newer job carries a form yes", () => {
  const customer = { sms_consent: stop, phone: "316-555-1234" };
  const jobRooms = JSON.stringify({ smsConsent: { granted: true, at: "2026-11-12T15:00:00Z", source: "website quote form" } });
  const r = autoTextConsent(customer, jobRooms);
  expect(r.ok).toBe(false);
  expect(r.reason).toMatch(/STOP/);
  // Without the STOP the job's yes still counts.
  expect(autoTextConsent({ sms_consent: null, phone: "316-555-1234" }, jobRooms).ok).toBe(true);
});
