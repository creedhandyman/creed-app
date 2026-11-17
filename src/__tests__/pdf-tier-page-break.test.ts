/**
 * Tiered quote PDF layout: a long Good/Better/Best option box must be allowed
 * to split across pages (it used to jump whole to the next page and leave the
 * page before half empty), and each option's "What this option adds" section
 * flows on instead of forcing a new page.
 */
let printed = "";
jest.mock("@/lib/supabase", () => ({ db: {}, supabase: {} }));
jest.mock("@/lib/api", () => ({ apiFetch: jest.fn() }));
jest.mock("@/lib/print-template", () => {
  const real = jest.requireActual("@/lib/print-template");
  return { ...real, openPrint: (html: string) => { printed = html; return true; } };
});
import { openJobQuotePdf } from "@/lib/quote-pdf";
import { printStyles } from "@/lib/print-template";
import type { Job } from "@/lib/types";

const A = ["base", "better", "best"];
const line = (id: string, tiers: string[], detail: string) => ({
  id, tiers, detail, comment: detail, laborHrs: 2, aiHrs: 2, condition: "P",
  materials: [{ n: "Supplies", qty: 1, unitPrice: 10, c: 10 }],
});

function tieredJob(): Job {
  const items = [
    ...Array.from({ length: 14 }, (_, i) => line(`s${i}`, A, `Shared task number ${i} with a long description of the work`)),
    line("e1", ["base"], "Lighting (Essential) — relamp"),
    line("c1", ["better"], "Lighting (Complete) — LED tubes"),
    line("p1", ["best"], "Lighting (Premium) — new fixtures"),
  ];
  const blob = {
    rooms: [{ name: "Renovation", items }],
    tieredQuote: true, tierSplit: true, laborRate: 55,
    tierNames: { base: "Essential", better: "Complete", best: "Premium" },
  };
  return { id: "job-1", property: "1 Main St", client: "Test", status: "quoted", total: 2000, rooms: JSON.stringify(blob) } as unknown as Job;
}

describe("tiered quote PDF page breaks", () => {
  beforeEach(() => { printed = ""; openJobQuotePdf(tieredJob(), { name: "Shop" } as never); });

  it("renders the option boxes and per-option sections", () => {
    expect(printed).toContain('class="tier-box"');
    expect(printed).toContain('class="tier-section"');
    expect(printed).toMatch(/What This Option Adds/);
  });

  it("never keeps a whole option box (or the grid) on one page", () => {
    const boxes = printed.match(/<div class="tier-(box|grid)" style="[^"]*"/g) || [];
    expect(boxes.length).toBeGreaterThan(3);
    for (const b of boxes) expect(b).not.toMatch(/page-break-inside:\s*avoid|break-inside:\s*avoid/);
  });

  it("does not force a new page before each option's section", () => {
    const sections = printed.match(/<div class="tier-section" style="[^"]*"/g) || [];
    expect(sections.length).toBeGreaterThan(0);
    for (const s of sections) expect(s).not.toMatch(/page-break-before|break-before/);
  });

  it("print CSS lets boxes split but keeps each line item whole", () => {
    const css = printStyles();
    expect(css).toMatch(/\.tier-grid, \.tier-box, \.tier-section \{ break-inside: auto; \}/);
    expect(css).toMatch(/\.tier-box li \{ break-inside: avoid; \}/);
  });
});
