import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const state = { user: { role: "owner", name: "Bernard" }, loadAll: jest.fn(), showConfirm: jest.fn(), showToast: jest.fn() };
jest.mock("@/lib/store", () => ({ useStore: (sel: (s: unknown) => unknown) => sel(state) }));
jest.mock("@/lib/supabase", () => ({ db: { patch: jest.fn() } }));
jest.mock("@/lib/i18n", () => ({ t: (k: string) => k }));

import TextConsentCard from "@/components/TextConsentCard";
import type { Customer, Job } from "@/lib/types";

const h = React.createElement;
const cust = (extra: Partial<Customer> = {}): Customer =>
  ({ id: "c1", org_id: "o1", name: "Pat", type: "individual", phone: "3165550100", ...extra }) as Customer;

describe("TextConsentCard", () => {
  it("no answer on file: 'not opted in' and the record-a-yes button", () => {
    const html = renderToStaticMarkup(h(TextConsentCard, { customer: cust(), jobs: [] }));
    expect(html).toContain("consent.notAsked");
    expect(html).toContain("consent.recordYes");
    expect(html).not.toContain("consent.turnOff");
  });
  it("a yes on the customer shows how and when, plus turn-off and history", () => {
    const html = renderToStaticMarkup(h(TextConsentCard, {
      customer: cust({ sms_consent: { granted: true, at: "2026-11-12T15:00:00Z", source: "recorded by owner", method: "phone_call", by: "Bernard", phone: "3165550100" } }),
      jobs: [],
    }));
    expect(html).toContain("consent.on");
    expect(html).toContain("consent.method.phone_call");
    expect(html).toContain("consent.turnOff");
    expect(html).toContain("consent.history");
  });
  it("a yes that only lives on a job still shows as opted in, marked as from a job", () => {
    const job = { id: "j1", rooms: JSON.stringify({ smsConsent: { granted: true, at: "2026-11-01T00:00:00Z", source: "website quote form" } }) } as unknown as Job;
    const html = renderToStaticMarkup(h(TextConsentCard, { customer: cust(), jobs: [job] }));
    expect(html).toContain("consent.on");
    expect(html).toContain("consent.fromJob");
    expect(html).toContain("website quote form");
  });
  it("crew see the status but no buttons", () => {
    state.user = { role: "tech", name: "Sam" };
    const html = renderToStaticMarkup(h(TextConsentCard, { customer: cust(), jobs: [] }));
    expect(html).toContain("consent.notAsked");
    expect(html).not.toContain("consent.recordYes");
    state.user = { role: "owner", name: "Bernard" };
  });
});
