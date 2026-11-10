import { MAX_PDF_PHOTOS, pdfPhotos } from "@/lib/export-pdf";

const photo = (n: number, type: string) => ({ url: `u${n}`, label: "", type });

describe("pdfPhotos", () => {
  it("shows every photo when there are few", () => {
    const list = [photo(1, "work"), photo(2, "before"), photo(3, "after")];
    expect(pdfPhotos(list).map((p) => p.url)).toEqual(["u2", "u1", "u3"]);
  });

  it("caps a long list, before photos first", () => {
    const list = [
      ...Array.from({ length: 30 }, (_, i) => photo(i, "work")),
      photo(100, "before"),
      photo(101, "before"),
    ];
    const shown = pdfPhotos(list);
    expect(shown).toHaveLength(MAX_PDF_PHOTOS);
    expect(shown.slice(0, 2).map((p) => p.url)).toEqual(["u100", "u101"]);
    expect(shown[2].url).toBe("u0");
  });

  it("handles no photos", () => {
    expect(pdfPhotos([])).toEqual([]);
  });
});
