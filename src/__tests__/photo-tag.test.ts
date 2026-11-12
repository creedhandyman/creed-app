import { defaultPhotoTag } from "@/lib/photo-tag";

describe("defaultPhotoTag", () => {
  it("fresh job (no before photo, nothing ticked) starts on Before", () => {
    expect(defaultPhotoTag([], [{ done: false }])).toBe("before");
    expect(defaultPhotoTag(null, null)).toBe("before");
  });
  it("every task done starts on After", () => {
    expect(defaultPhotoTag([{ type: "before" }], [{ done: true }, { done: true }])).toBe("after");
  });
  it("a finished job starts on After whatever the photos say", () => {
    expect(defaultPhotoTag([], [], "complete")).toBe("after");
    expect(defaultPhotoTag([], [], "paid")).toBe("after");
  });
  it("mid-job: no opinion (keep the current pick)", () => {
    expect(defaultPhotoTag([{ type: "before" }], [{ done: true }, { done: false }])).toBeNull();
  });
});
