import { readBlob, tryReadBlob, jobBlob, woKey } from "@/lib/job-blob";

describe("readBlob", () => {
  it("parses a JSON string blob", () => {
    expect(readBlob('{"jobNotes":"hi","rooms":[]}')).toEqual({ jobNotes: "hi", rooms: [] });
  });

  it("passes an object blob through as the same reference", () => {
    const blob = { workOrder: [{ room: "Kitchen", detail: "Fix tap", done: false }] };
    expect(readBlob(blob)).toBe(blob);
  });

  it("never throws: missing / malformed / non-object → {}", () => {
    for (const v of [undefined, null, "", "{not json", "null", "42", '"str"', "[1,2]", [1, 2], 7, true]) {
      expect(readBlob(v)).toEqual({});
    }
  });

  it("tryReadBlob tells 'no blob' apart with null", () => {
    expect(tryReadBlob("{bad")).toBeNull();
    expect(tryReadBlob(null)).toBeNull();
    expect(tryReadBlob("[]")).toBeNull();
    expect(tryReadBlob('{"a":1}')).toEqual({ a: 1 });
  });

  it("jobBlob reads a row's rooms (and tolerates no row)", () => {
    expect(jobBlob({ rooms: '{"tieredQuote":true}' })).toEqual({ tieredQuote: true });
    expect(jobBlob(null)).toEqual({});
    expect(jobBlob({})).toEqual({});
  });
});

describe("woKey", () => {
  it("is case- and edge-space-insensitive on room + detail", () => {
    expect(woKey({ room: " Kitchen ", detail: "Fix TAP" })).toBe(woKey({ room: "kitchen", detail: "fix tap " }));
    expect(woKey({ room: "Kitchen", detail: "Fix tap" })).toBe("kitchen|||fix tap");
    expect(woKey({})).toBe("|||");
  });
});
