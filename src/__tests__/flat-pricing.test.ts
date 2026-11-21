/**
 * Flat-price quotes (2026-11-19): the customer sees one price per line, never
 * hours or an hourly rate. Hours × rate still set every price, and the totals
 * are unchanged.
 */
let printed = "";
jest.mock("@/lib/supabase", () => ({ db: {}, supabase: {} }));
jest.mock("@/lib/api", () => ({ apiFetch: jest.fn() }));
jest.mock("@/lib/print-template", () => {
  const real = jest.requireActual("@/lib/print-template");
  return { ...real, openPrint: (html: string) => { printed = html; return true; } };
});
import { openJobQuotePdf } from "@/lib/quote-pdf";
import { flatPricingFor, readFlatPricing, readQuoteSettings } from "@/lib/quote-blob";
import { quoteSections } from "@/lib/pricing";
import { buildQuoteSave } from "@/lib/quote-save";
import type { Job } from "@/lib/types";

const A = ["base", "better", "best"];
const line = (id: string, detail: string, hrs: number, mat: number, tiers?: string[]) => ({
  id, detail, comment: "", laborHrs: hrs, aiHrs: hrs, condition: "P",
  materials: mat ? [{ n: `Material for ${id}`, qty: 1, unitPrice: mat, c: mat }] : [],
  ...(tiers ? { tiers } : {}),
});

/** Two trades at $76/hr: 2.5 h + $40 → $230, 1 h + $0 → $76, 4 h + $100 → $404. */
function job(extra: Record<string, unknown> = {}, rooms?: unknown[]): Job {
  const blob = {
    rooms: rooms ?? [
      { name: "Plumbing", items: [line("p1", "Bathroom — Replace faucet", 2.5, 40), line("p2", "Bathroom — Snake drain", 1, 0)] },
      { name: "Painting", items: [line("c1", "Hall — Paint walls", 4, 100)] },
    ],
    laborRate: 76,
    pricedRates: { rate: 76, trades: null },
    ...extra,
  };
  return { id: "job-flat-1", property: "1 Main St", client: "Pat", status: "quoted", total: 710, rooms: JSON.stringify(blob) } as unknown as Job;
}
const org = { name: "Shop", default_rate: 76, min_labor_hours: 0 } as never;

// Anything that would show hours or an hourly rate.
const HOURS_OR_RATE = /man-h|Man-Hrs|labor hours|\/hr|\/man-hour|\bhrs?\b|Labor rate|× \d+ crew|Labor hours/i;
const textOf = (html: string) => html.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, " ");

describe("flat-price setting", () => {
  it("the quote's own choice wins; absent = the org default; anything else = absent", () => {
    expect(flatPricingFor({ flatPricing: true }, { flat_pricing: false })).toBe(true);
    expect(flatPricingFor({ flatPricing: false }, { flat_pricing: true })).toBe(false);
    expect(flatPricingFor({}, { flat_pricing: true })).toBe(true);
    expect(flatPricingFor({}, null)).toBe(false);
    expect(flatPricingFor(null, { flat_pricing: true })).toBe(true);
    expect(readFlatPricing("yes")).toBeNull();
    expect(readQuoteSettings({ flatPricing: true }).flatPricing).toBe(true);
    expect(readQuoteSettings({}).flatPricing).toBeNull();
  });

  it("a save writes the resolved choice onto the quote", () => {
    const base = {
      rooms: [{ name: "Plumbing", items: [line("p1", "Bathroom — Replace faucet", 2.5, 40)] }],
      workers: [], jobPhotos: [], steps: [], guideSteps: [],
      guideState: { customTools: [], customShop: [], checkedTools: [], checkedShop: [], removedGuideShop: [] },
      settings: {
        discount: null, laborRate: null, minLaborHours: null, taxMode: null, materialTaxPct: 0, materialTaxZip: "",
        tieredQuote: false, tierNames: { better: "Complete", best: "Premium" }, crewSize: null, estDays: null,
        pricedRates: { rate: 76, trades: null }, flatPricing: true,
      },
      pricing: {
        gt: 230, tl: 190, tm: 40, th: 2.5,
        tierTotals: { base: 230, better: 230, best: 230 },
        tierBreakdown: { base: { labor: 190, mat: 40, hrs: 2.5 }, better: { labor: 190, mat: 40, hrs: 2.5 }, best: { labor: 190, mat: 40, hrs: 2.5 } },
        headlineKey: "best" as const, hasSplit: false,
      },
      prev: null,
      identity: { editing: false, property: "1 Main St", client: "Pat", createdBy: "Owner", trade: "Plumbing", today: "2026-11-19" },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { blob } = buildQuoteSave(base as any);
    expect(blob.flatPricing).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const off = buildQuoteSave({ ...base, settings: { ...base.settings, flatPricing: false } } as any);
    expect(off.blob.flatPricing).toBe(false);
    // The internal hours stay on the quote for scheduling and job costing.
    expect(blob.rooms[0].items[0].laborHrs).toBe(2.5);
  });

  it("each line carries its own price, and they add up to the section", () => {
    const secs = quoteSections(
      [{ name: "Plumbing", items: [line("p1", "Faucet", 2.5, 40), line("p2", "Drain", 1, 0)] }],
      { rate: 76, materialTaxPct: 0, markupPct: 0 },
    );
    expect(secs[0].lines.map((l) => l.price)).toEqual([230, 76]);
    expect(secs[0].lines.reduce((s, l) => s + l.price, 0)).toBeCloseTo(secs[0].total, 6);
  });
});

describe("quote PDF with flat prices", () => {
  beforeEach(() => { printed = ""; });

  it("prints one price per line and no hours or rate anywhere", () => {
    openJobQuotePdf(job({ flatPricing: true }), org);
    const text = textOf(printed);
    expect(text).toContain("Bathroom — Replace faucet");
    expect(text).toContain("$230.00");
    expect(text).toContain("$76.00");
    expect(text).toContain("$404.00");
    expect(text).toContain("$710.00"); // same grand total as hours × rate
    expect(text).not.toMatch(HOURS_OR_RATE);
    expect(text).not.toContain("$76.00/");
  });

  it("follows the org default when the quote has no choice saved", () => {
    openJobQuotePdf(job(), { ...(org as object), flat_pricing: true } as never);
    expect(textOf(printed)).not.toMatch(HOURS_OR_RATE);
  });

  it("is unchanged when off (hours and rate still print)", () => {
    openJobQuotePdf(job({ flatPricing: false }), { ...(org as object), flat_pricing: true } as never);
    expect(printed).toMatch(/Man-Hrs/);
    expect(printed).toMatch(/\/man-hour|\/hr/);
    // The check the flat tests rely on does catch the hours-and-rate version.
    expect(textOf(printed)).toMatch(HOURS_OR_RATE);
  });

  it("hides the hours behind a minimum service charge", () => {
    const small = job({ flatPricing: true, minLaborHours: 2 }, [
      { name: "Plumbing", items: [line("p1", "Bathroom — Tighten faucet", 0.5, 0)] },
    ]);
    openJobQuotePdf(small, org);
    const text = textOf(printed);
    expect(text).toContain("Minimum service charge");
    expect(text).toContain("$152.00"); // 2 h minimum × $76, shown as money only
    expect(text).not.toMatch(HOURS_OR_RATE);
  });

  it("works with the three tiers: each option's lines and totals, no hours", () => {
    const tiered = job({ flatPricing: true, tieredQuote: true, tierSplit: true }, [
      { name: "Electrical", items: [
        line("e0", "Lighting — Clean fixtures", 1, 0, A),
        line("e1", "Lighting (Essential) — Relamp", 1.5, 32, ["base"]),
        line("e2", "Lighting (Complete) — LED tubes", 2.5, 66, ["better"]),
        line("e3", "Lighting (Premium) — New fixtures", 5, 321, ["best"]),
      ] },
    ]);
    openJobQuotePdf(tiered, org);
    const text = textOf(printed);
    expect(printed).toContain('class="tier-box"');
    expect(text).toContain("Lighting (Premium) — New fixtures");
    expect(text).toContain("$701.00"); // 5 h × 76 + 321, as one price
    // Option totals: shared 76 + its own line.
    expect(text).toContain("$222.00"); // Essential 76 + 146
    expect(text).toContain("$332.00"); // Complete 76 + 256
    expect(text).toContain("$777.00"); // Premium 76 + 701
    expect(text).not.toMatch(HOURS_OR_RATE);
  });
});
