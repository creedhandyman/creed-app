import { completionJobIds, dropUnfinishedJobRows } from "../lib/learning-rows";

const rows = [
  { item_name: "__jobraw__:General", source: "job_completion", job_id: "reopened" },
  { item_name: "Kitchen — Replace faucet", source: "job_completion", job_id: "reopened" },
  { item_name: "__jobraw__:Carpentry", source: "job_completion", job_id: "done" },
  { item_name: "__jobraw__:Painting", source: "job_completion", job_id: "deleted" },
  { item_name: "Bath — Re-caulk tub", source: "quote_edit", job_id: "reopened" },
  { item_name: "OSI QUAD SEALANT", source: null, job_id: null },
];

describe("learning rows of a reopened job", () => {
  it("asks only about jobs that have completion rows", () => {
    expect(completionJobIds(rows).sort()).toEqual(["deleted", "done", "reopened"]);
  });

  it("leaves out a reopened job's completion rows, keeps everything else", () => {
    const kept = dropUnfinishedJobRows(rows, { reopened: "active", done: "paid" });
    expect(kept.map((r) => r.item_name)).toEqual([
      "__jobraw__:Carpentry",
      "__jobraw__:Painting", // status unknown → kept
      "Bath — Re-caulk tub", // the owner's quote edit still stands
      "OSI QUAD SEALANT",
    ]);
  });

  it("counts the rows again once the job is finished again", () => {
    expect(dropUnfinishedJobRows(rows, { reopened: "complete" })).toHaveLength(rows.length);
    expect(dropUnfinishedJobRows(rows, { reopened: "invoiced" })).toHaveLength(rows.length);
  });

  it("keeps everything when the status lookup returned nothing", () => {
    expect(dropUnfinishedJobRows(rows, {})).toHaveLength(rows.length);
  });
});
