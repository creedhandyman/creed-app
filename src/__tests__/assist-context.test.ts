import { buildAssistJobContext } from "@/lib/assist-context";

describe("buildAssistJobContext", () => {
  test("empty job → no context block", () => {
    expect(buildAssistJobContext({})).toBe("");
  });
  test("inspection: sizes always, only findings (non-OK or noted)", () => {
    const out = buildAssistJobContext({
      inspection: {
        type: "move-out",
        rooms: [{ name: "Master Bedroom", width: 12, length: 14, sqft: 168, items: [
          { name: "Walls", condition: "P", notes: "8 holes" },
          { name: "Floor", condition: "S" },
          { name: "Ceiling", condition: "S", comment: "water stain old" },
        ] }],
      },
    });
    expect(out).toContain("Master Bedroom (12x14 ft, 168 sqft)");
    expect(out).toContain("Walls [Poor]: 8 holes");
    expect(out).toContain("Ceiling [OK]: water stain old");
    expect(out).not.toContain("Floor");
  });
  test("work order: finished + hand-added tasks; notes and request", () => {
    const out = buildAssistJobContext({
      workOrder: [
        { detail: "Kitchen — Patch", done: true },
        { detail: "Garage — Fix shelf", custom: true, room: "Carpentry" },
        { detail: "Open task" },
      ],
      jobNotes: "Dog in back yard",
      leadDescription: "Need walls fixed before move-in",
    });
    expect(out).toContain("FINISHED:\n- Kitchen — Patch");
    expect(out).toContain("- Carpentry: Garage — Fix shelf");
    expect(out).not.toContain("Open task");
    expect(out).toContain("Dog in back yard");
    expect(out).toContain("Need walls fixed before move-in");
  });
});
