import { applyApproval } from "@/lib/approve-job";
import { readApprovalRecord, approvalPhrase, scopeFingerprint } from "@/lib/approval";

const blob = () => ({
  tieredQuote: true,
  tierTotals: { base: 400, better: 870, best: 1440 },
  tierBreakdown: { better: { labor: 600, mat: 270, hrs: 12 } },
  rooms: [{ name: "Painting", items: [
    { id: "a", detail: "Touch up", laborHrs: 2, materials: [], condition: "-", comment: "" },
    { id: "b", detail: "Full repaint", laborHrs: 8, materials: [], condition: "-", comment: "", tiers: ["best"] },
  ] }],
  workOrder: [
    { detail: "Touch up", tiers: ["base", "better", "best"] },
    { detail: "Full repaint", tiers: ["best"] },
  ],
});
const NOW = "2026-10-12T15:00:00.000Z";

test("in-person approval of an option locks price, work order and record", () => {
  const { patch, blob: b, approval } = applyApproval(
    { status: "quoted", rooms: JSON.stringify(blob()), total: 1440 },
    { signature: "Jane Doe", tier: "better", nowIso: NOW, via: "in_person", by: "Bernard", signer: "Jane Doe" },
  );
  expect(patch.status).toBe("accepted");
  expect(patch.total).toBe(870);
  expect(patch.total_hrs).toBe(12);
  expect(patch.client_signature).toBe("Jane Doe");
  expect(b!.acceptedTier).toBe("better");
  expect((b!.workOrder as unknown[]).length).toBe(1);
  expect(approval).toMatchObject({ total: 870, tier: "better", via: "in_person", by: "Bernard", signer: "Jane Doe", at: NOW });
  expect(approval!.fp).toBe(scopeFingerprint(blob().rooms as never));
  // round-trips through the blob reader the PDF uses
  expect(readApprovalRecord(b)).toMatchObject({ via: "in_person", by: "Bernard", signer: "Jane Doe" });
  expect(approvalPhrase(approval)).toBe("Approved in person");
});

test("online approval keeps the old shape (no via on the record)", () => {
  const { approval } = applyApproval(
    { status: "quoted", rooms: JSON.stringify(blob()), total: 1440 },
    { signature: "x", tier: "best", nowIso: NOW, via: "online" },
  );
  expect(approval!.via).toBeUndefined();
  expect(approvalPhrase(approval)).toBe("Approved electronically");
});

test("non-quoted status is kept; no tier = stored total", () => {
  const { patch, approval } = applyApproval(
    { status: "accepted", rooms: JSON.stringify({ rooms: [] }), total: 500 },
    { signature: "x", nowIso: NOW, via: "phone" },
  );
  expect(patch.status).toBeUndefined();
  expect(patch.total).toBeUndefined();
  expect(approval!.total).toBe(500);
  expect(approvalPhrase(approval)).toBe("Approved by phone");
});
