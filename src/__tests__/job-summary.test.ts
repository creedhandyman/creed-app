import {
  autoLong, autoShort, firstSentence, jobSummary, splitDetail, summaryEditDelta, summarySig, summaryTasks,
} from "@/lib/job-summary";

const line = (detail: string, laborHrs = 1, extra: Record<string, unknown> = {}) =>
  ({ id: detail, detail, condition: "-", comment: "", laborHrs, materials: [], ...extra });

const quote = {
  rooms: [
    { name: "Plumbing", items: [line("Bathroom — Replace toilet wax ring", 1), line("Kitchen — Replace sprayer and re-caulk sink", 1.5)] },
    { name: "Drywall", items: [line("Bathroom — Patch 2 drywall holes", 2), line("Job setup, staging & cleanup", 1)] },
    { name: "Painting", items: [line("Bedroom — Paint walls", 4), line("Painting supplies", 0)] },
  ],
};

describe("splitDetail", () => {
  it("splits place and task, keeping units", () => {
    expect(splitDetail("Unit B — Bathroom — Re-caulk tub")).toEqual({ place: "Unit B Bathroom", task: "Re-caulk tub" });
    expect(splitDetail("Kitchen - Replace faucet")).toEqual({ place: "Kitchen", task: "Replace faucet" });
    expect(splitDetail("Fix gate latch")).toEqual({ place: "", task: "Fix gate latch" });
    expect(splitDetail("Bathroom — [T&M] Evaluate tub surround")).toEqual({ place: "Bathroom", task: "Evaluate tub surround" });
  });
});

describe("summaryTasks", () => {
  it("skips overhead and supplies-only lines", () => {
    expect(summaryTasks(quote).map((t) => t.task)).toEqual([
      "Replace toilet wax ring", "Replace sprayer and re-caulk sink", "Patch 2 drywall holes", "Paint walls",
    ]);
  });

  it("describes only the accepted / sent / recommended option of a three-tier quote", () => {
    const tiered = {
      tieredQuote: true,
      rooms: [{ name: "Painting", items: [
        line("Living room — Touch up walls", 2, { tiers: ["base", "better"] }),
        line("Living room — Repaint walls and ceiling", 8, { tiers: ["best"] }),
      ] }],
    };
    // Recommended (Complete) by default.
    expect(summaryTasks(tiered).map((t) => t.task)).toEqual(["Touch up walls"]);
    expect(summaryTasks({ ...tiered, acceptedTier: "best" }).map((t) => t.task)).toEqual(["Repaint walls and ceiling"]);
    expect(summaryTasks({ ...tiered, sentTier: "best", tierTotals: { base: 200, better: 200, best: 900 } }).map((t) => t.task)).toEqual(["Repaint walls and ceiling"]);
  });

  it("never throws on junk", () => {
    expect(summaryTasks({})).toEqual([]);
    expect(summaryTasks({ rooms: "nope" })).toEqual([]);
    expect(summaryTasks({ rooms: [null, { items: [null, { detail: 5 }] }] })).toEqual([]);
  });
});

describe("autoShort", () => {
  it("leads with the biggest tasks and counts the rest", () => {
    expect(autoShort(quote)).toBe("Paint walls, patch 2 drywall holes, replace sprayer and re-caulk sink, and 1 more.");
  });

  it("names the place when the job is in one or two places", () => {
    const one = { rooms: [{ name: "Plumbing", items: [line("Kitchen — Replace faucet", 1), line("Kitchen — Fix disposal", 0.5)] }] };
    expect(autoShort(one)).toBe("Kitchen: Replace faucet and fix disposal.");
  });

  it("stays one short sentence", () => {
    const long = { rooms: [{ name: "General", items: Array.from({ length: 12 }, (_, i) =>
      line(`Room ${i} — Replace the extremely long named fixture assembly number ${i} with matching hardware`, 1)) }] };
    const s = autoShort(long);
    expect(s.length).toBeLessThanOrEqual(150);
    expect(s).toMatch(/more\.$|…$/);
  });

  it("falls back to the lead's own words before there is a quote", () => {
    expect(autoShort({ leadDescription: "Leaky faucet in the kitchen. Also the back door sticks." })).toBe("Leaky faucet in the kitchen.");
    expect(autoShort({})).toBe("");
  });
});

describe("autoLong", () => {
  it("groups tasks by place and gives the size", () => {
    expect(autoLong(quote)).toBe(
      "Bathroom: replace toilet wax ring and patch 2 drywall holes. Kitchen: replace sprayer and re-caulk sink. Bedroom: paint walls. 4 items, about 8.5 labor hours.",
    );
  });

  it("uses the full lead request when there is no quote", () => {
    expect(autoLong({ leadDescription: "  Leaky faucet.\nBack door sticks. " })).toBe("Leaky faucet. Back door sticks.");
  });
});

describe("firstSentence", () => {
  it("cuts long text at a word", () => {
    const s = firstSentence("word ".repeat(80));
    expect(s.endsWith("…")).toBe(true);
    expect(s.length).toBeLessThanOrEqual(141);
  });
});

describe("owner edits", () => {
  it("an edit wins and goes stale when the quote changes", () => {
    const delta = summaryEditDelta(quote, "Bathroom refresh and a bedroom repaint.", "");
    expect(delta.summaryEdit?.short).toBe("Bathroom refresh and a bedroom repaint.");
    expect(delta.summaryEdit?.long).toBeUndefined();
    const saved = { ...quote, ...delta };
    const s = jobSummary(saved);
    expect(s.source).toBe("edited");
    expect(s.short).toBe("Bathroom refresh and a bedroom repaint.");
    expect(s.long).toBe(autoLong(quote)); // the paragraph still follows the quote
    expect(s.stale).toBe(false);

    const changed = { ...saved, rooms: [...quote.rooms, { name: "Doors", items: [line("Front door — Adjust strike", 0.5)] }] };
    const s2 = jobSummary(changed);
    expect(s2.short).toBe("Bathroom refresh and a bedroom repaint.");
    expect(s2.stale).toBe(true);
  });

  it("saving the auto text (or nothing) clears the edit", () => {
    expect(summaryEditDelta(quote, autoShort(quote), autoLong(quote))).toEqual({ summaryEdit: null });
    expect(summaryEditDelta(quote, "  ", "")).toEqual({ summaryEdit: null });
  });

  it("the signature follows the quote lines, not prices", () => {
    const priced = { ...quote, rooms: quote.rooms.map((r) => ({ ...r, items: r.items.map((i) => ({ ...i, laborHrs: 9 })) })) };
    expect(summarySig(priced)).toBe(summarySig(quote));
    expect(summarySig({ leadDescription: "a" })).not.toBe(summarySig({ leadDescription: "b" }));
  });

  it("reports where the text came from", () => {
    expect(jobSummary(quote).source).toBe("quote");
    expect(jobSummary({ leadDescription: "Fix fence" }).source).toBe("lead");
    expect(jobSummary({}).source).toBe("none");
  });
});
