import {
  buildGrounding,
  kbTask,
  pastWorkFrom,
  rankByRequest,
  receiptPricesFrom,
  shopPricesFor,
  taskOf,
  tokens,
  usableKbRows,
  type GroundingRow,
  type KbRow,
} from "../lib/quote-grounding";

const row = (o: Partial<GroundingRow>): GroundingRow => ({
  item_name: "",
  original_hours: 0,
  corrected_hours: 0,
  original_mat_cost: 0,
  corrected_mat_cost: 0,
  ...o,
});

describe("taskOf / tokens", () => {
  it("drops the location so a task learned in one room applies in another", () => {
    expect(taskOf("Kitchen — Replace GFCI outlet that will not reset")).toBe("Replace GFCI outlet that will not reset");
    expect(taskOf("Whole Property — [T&M] Diagnose thermostat")).toBe("Diagnose thermostat");
    expect(taskOf("Replace sump pump")).toBe("Replace sump pump");
    expect(taskOf("Unit B — Bathroom — Re-caulk tub")).toBe("Bathroom — Re-caulk tub");
  });
  it("stems and drops filler words", () => {
    expect(tokens("Replace the 3 broken blinds")).toEqual(["plac", "broken", "blind"]);
    expect(tokens("Replacing broken blind")).toEqual(["plac", "broken", "blind"]);
  });
});

describe("pastWorkFrom", () => {
  it("collapses an edit chain to where the owner left it (rows are newest-first)", () => {
    // Real shape: 12h → 9h → 10h on one quote, logged as three rows.
    const rows = [
      row({ item_name: "Exterior — Install gravel patio base", source: "quote_edit", job_id: "j1", original_hours: 9, corrected_hours: 10, original_mat_cost: 425, corrected_mat_cost: 340, created_at: "2026-11-10T03:00:00Z" }),
      row({ item_name: "Exterior — Install gravel patio base", source: "quote_edit", job_id: "j1", original_hours: 12, corrected_hours: 9, original_mat_cost: 425, corrected_mat_cost: 425, created_at: "2026-11-10T02:00:00Z" }),
    ];
    expect(pastWorkFrom(rows)).toEqual([{ task: "Install gravel patio base", hrs: 10, mat: 340, jobs: 1 }]);
  });

  it("merges the same task across jobs and rooms, with the median", () => {
    const rows = [
      row({ item_name: "Bathroom — Replace GFCI outlet", source: "quote_edit", job_id: "a", corrected_hours: 1, corrected_mat_cost: 15 }),
      row({ item_name: "Kitchen — Replace GFCI outlet", source: "quote_edit", job_id: "b", corrected_hours: 0.8, corrected_mat_cost: 23 }),
      row({ item_name: "Garage — Replace GFCI outlet", source: "quote_edit", job_id: "c", corrected_hours: 3, corrected_mat_cost: 19 }),
    ];
    expect(pastWorkFrom(rows)).toEqual([{ task: "Replace GFCI outlet", hrs: 1, mat: 19, jobs: 3 }]);
  });

  it("adds clocked hours from a completed job, but not from a badly clocked one", () => {
    const good = [
      row({ item_name: "Exterior — Realign wood fence section", source: "job_completion", job_id: "a", original_hours: 2, corrected_hours: 1.73 }),
    ];
    expect(pastWorkFrom(good)).toEqual([{ task: "Realign wood fence section", hrs: 2, actualHrs: 1.73, jobs: 1 }]);
    // 5.8h quoted, 1.52h "actual" (the job's one clock entry was 4.6h of 16.7) — keep the quote only.
    const bad = [
      row({ item_name: "North Side — Install buried downspout extension", source: "job_completion", job_id: "b", original_hours: 5.8, corrected_hours: 1.52 }),
    ];
    expect(pastWorkFrom(bad)).toEqual([{ task: "Install buried downspout extension", hrs: 5.8, jobs: 1 }]);
  });

  it("ignores calibration rows, receipts, T&M and overhead lines", () => {
    const rows = [
      row({ item_name: "__job__:Carpentry", original_hours: 5, corrected_hours: 7 }),
      row({ item_name: "__jobraw__:Carpentry", original_hours: 5, corrected_hours: 7 }),
      row({ item_name: "OSI QUAD SEALANT CLEAR 10 OZ", corrected_mat_cost: 8.98 }),
      row({ item_name: "Whole Property — [T&M] Diagnose thermostat", source: "job_completion", job_id: "a", original_hours: 0.75, corrected_hours: 1.26 }),
      row({ item_name: "Whole Property — Job setup, staging & cleanup", source: "quote_edit", job_id: "a", corrected_hours: 2 }),
    ];
    expect(pastWorkFrom(rows)).toEqual([]);
  });

  it("counts a hand-added line (no source, hours typed)", () => {
    const rows = [row({ item_name: "Hang 2 TVs on drywall", material_name: "Custom item", corrected_hours: 2, corrected_mat_cost: 20 })];
    expect(pastWorkFrom(rows)).toEqual([{ task: "Hang 2 TVs on drywall", hrs: 2, mat: 20, jobs: 1 }]);
  });
});

describe("receiptPricesFrom", () => {
  const rows = [
    row({ item_name: "OSI QUAD SEALANT CLEAR 10 OZ", corrected_mat_cost: 8.98, zip: "67203" }),
    row({ item_name: "OSI QUAD SEALANT CLEAR 10 OZ", corrected_mat_cost: 9.48, zip: "67203" }),
    row({ item_name: "OSI QUAD SEALANT CLEAR 10 OZ", corrected_mat_cost: 14, zip: "67037" }),
    row({ item_name: "POWERADE MOUNTAIN BLAST 28OZ", corrected_mat_cost: 2.88 }),
  ];
  it("takes the median and drops what isn't a material", () => {
    expect(receiptPricesFrom(rows)).toEqual([{ name: "OSI QUAD SEALANT CLEAR 10 OZ", price: 9.48, n: 3 }]);
  });
  it("prefers purchases in the job's own ZIP", () => {
    expect(receiptPricesFrom(rows, "67037")).toEqual([{ name: "OSI QUAD SEALANT CLEAR 10 OZ", price: 14, n: 1 }]);
  });
});

describe("rankByRequest", () => {
  const tasks = [
    "Replace GFCI outlet that will not reset",
    "Replace sump pump and repair discharge line",
    "Repair broken patio step",
    "Clean out 2 window wells",
  ];
  it("returns only what resembles the request, most specific first", () => {
    const got = rankByRequest(tasks, (t) => t, "Sump pump in the basement quit, discharge line is cracked. Replace and repair. Also the patio step is broken, repair it.", 10);
    expect(got).toEqual(["Replace sump pump and repair discharge line", "Repair broken patio step"]);
  });
  it("returns nothing for a request with no words to match (photo-only)", () => {
    expect(rankByRequest(tasks, (t) => t, "", 10)).toEqual([]);
  });
  it("matches inside one finding, not across the whole report", () => {
    // "door" in one room + "paint" in another must not add up to "Paint interior doors".
    const report = ["Bedroom: interior door knob missing", "Hallway: touch up paint on walls"].join("\n");
    expect(rankByRequest(["Paint interior doors"], (t) => t, report, 10)).toEqual([]);
    expect(rankByRequest(["Paint interior doors"], (t) => t, "Paint the interior doors white", 10)).toEqual(["Paint interior doors"]);
  });
  it("treats re-caulk, recaulk and caulking as the same word", () => {
    expect(rankByRequest(["Recaulk tub or shower"], (t) => t, "Tub: re-caulk tub and shower surround", 10)).toEqual(["Recaulk tub or shower"]);
  });
  it("needs more than one shared word", () => {
    expect(rankByRequest(tasks, (t) => t, "replace the mailbox", 10)).toEqual([]);
  });
});

describe("usableKbRows", () => {
  const kb: KbRow[] = [
    { item_name: "Locks & Hardware — Rekey lock", labor_hours_low: "0.25", labor_hours_high: "0.50", scope: "H", active: true },
    { item_name: "Electrical — Replace main panel", labor_hours_low: 6, labor_hours_high: 10, scope: "L", active: false },
    { item_name: "Remodel — Full kitchen remodel", labor_hours_low: 200, labor_hours_high: 2500, scope: "GC", active: true },
    { item_name: "Doors — Mystery row", labor_hours_low: 0, labor_hours_high: 0, scope: "H", active: true },
  ];
  it("keeps handyman rows with a real range only", () => {
    expect(usableKbRows(kb).map((r) => r.item_name)).toEqual(["Locks & Hardware — Rekey lock"]);
  });
});

describe("kbTask", () => {
  it("matches on the first wording, without category or qualifiers", () => {
    expect(kbTask({ item_name: "Toilet — Running toilet / phantom refill" })).toBe("Running toilet");
    expect(kbTask({ item_name: "Drywall — Patch small hole (nail/screw/anchor)" })).toBe("Patch small hole");
  });
});

describe("shopPricesFor", () => {
  it("finds shop-list items named in the request", () => {
    const got = shopPricesFor("Toilet is running, replace the flapper and the toilet seat.");
    const names = got.map((g) => g.name);
    expect(names).toContain("Flapper");
    expect(names).toContain("Toilet seat");
    expect(got.find((g) => g.name === "Toilet seat")?.price).toBe(13);
  });
  it("is empty for an empty request", () => {
    expect(shopPricesFor("")).toEqual([]);
  });
});

describe("buildGrounding", () => {
  const corrections = [
    row({ item_name: "Bathroom — Replace GFCI outlet that will not reset", source: "quote_edit", job_id: "a", corrected_hours: 1, corrected_mat_cost: 15 }),
    row({ item_name: "Exterior — Realign wood fence section with long screws", source: "job_completion", job_id: "b", original_hours: 2, corrected_hours: 1.73 }),
    row({ item_name: "OSI QUAD SEALANT CLEAR 10 OZ", corrected_mat_cost: 8.98 }),
  ];
  const kb: KbRow[] = [
    { item_name: "Outlets & Switches — Replace GFCI outlet", labor_hours_low: 0.5, labor_hours_high: 1, scope: "H", active: true, meta: { basis: "per each" } },
    { item_name: "Locks & Hardware — Rekey lock", labor_hours_low: 0.25, labor_hours_high: 0.5, scope: "H", active: true },
  ];

  it("sends only what matches the request", () => {
    const g = buildGrounding({ request: "Kitchen GFCI outlet will not reset — replace it.", corrections, kb });
    expect(g.used).toMatchObject({ pastWork: 1, kb: 1, receipts: 0 });
    expect(g.prompt).toContain("YOUR PAST WORK");
    expect(g.prompt).toContain("- Replace GFCI outlet that will not reset: quoted 1h, materials ~$15");
    expect(g.prompt).toContain("- Outlets & Switches — Replace GFCI outlet: 0.5–1h (per each)");
    expect(g.prompt).not.toContain("fence");
    expect(g.prompt).not.toContain("Rekey");
  });

  it("shows clocked hours when a finished job has them", () => {
    const g = buildGrounding({ request: "Fence section leaning, realign the wood fence with long screws", corrections, kb });
    expect(g.prompt).toContain("- Realign wood fence section with long screws: quoted 2h, took ~1.73h");
  });

  it("is empty when nothing on file resembles the request", () => {
    expect(buildGrounding({ request: "Analyze these photos and quote all repairs needed.", corrections, kb }).prompt).toBe("");
    expect(buildGrounding({ request: "", corrections: [], kb: [] }).prompt).toBe("");
  });
});
