import { spokenDims, wordsToDigits } from "@/lib/voice-measure";

describe("wordsToDigits", () => {
  it("turns spoken numbers into digits", () => {
    expect(wordsToDigits("twelve by fourteen")).toBe("12 by 14");
    expect(wordsToDigits("one hundred twenty feet")).toBe("120 feet");
    expect(wordsToDigits("twenty two and a half feet")).toBe("22.5 feet");
    expect(wordsToDigits("six-foot privacy fence")).toBe("6 foot privacy fence");
  });
});

describe("spokenDims — rooms", () => {
  it("reads W by L", () => {
    expect(spokenDims("Bedroom is about 12 by 14, carpet is stained")).toEqual({ width: 12, length: 14 });
    expect(spokenDims("the room's twelve by fourteen feet")).toEqual({ width: 12, length: 14 });
    expect(spokenDims("10 x 11.5 kitchen")).toEqual({ width: 10, length: 11.5 });
    expect(spokenDims("12 feet 6 inches by 10 feet")).toEqual({ width: 12.5, length: 10 });
  });
  it("reads square feet when that's all that was said", () => {
    expect(spokenDims("about 180 square feet of LVP")).toEqual({ sqft: 180 });
  });
  it("ignores other numbers", () => {
    expect(spokenDims("2 outlets missing covers, 3 blinds broken")).toBeNull();
    expect(spokenDims("need two 2 by 4 studs, sister the joist")).toBeNull();
    expect(spokenDims("replace a 4 x 8 sheet of drywall, room is 11 by 13")).toEqual({ width: 11, length: 13 });
    expect(spokenDims("")).toBeNull();
  });
});

describe("spokenDims — fences", () => {
  it("reads height and run length", () => {
    expect(spokenDims("six foot privacy fence, about one hundred twenty feet long", "fence")).toEqual({ width: 6, length: 120 });
    expect(spokenDims("this run is 80 feet, posts leaning", "fence")).toEqual({ length: 80 });
    expect(spokenDims("4 ft tall chain link", "fence")).toEqual({ width: 4 });
  });
  it("a W by L on a fence: longer side is the run", () => {
    expect(spokenDims("roughly 6 by 96", "fence")).toEqual({ width: 6, length: 96 });
    expect(spokenDims("replace the 2 by 4 rails", "fence")).toBeNull();
  });
});
