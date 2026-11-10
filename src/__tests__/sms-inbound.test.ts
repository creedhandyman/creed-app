import { imageExt, keywordOf, last10, photosFrom, pickMatch, prettyPhone, type MatchInput } from "../lib/sms-inbound";

const base = (over: Partial<MatchInput> = {}): MatchInput => ({
  thread: null,
  customers: [],
  customerJobs: [],
  residentJobs: [],
  textingOrgs: ["orgA"],
  ...over,
});

describe("pickMatch", () => {
  it("a number we texted goes to that business and job", () => {
    const m = pickMatch(base({
      thread: { orgId: "orgA", jobId: "j1", customerId: "c1" },
      customers: [{ id: "c1", orgId: "orgA", name: "Pat" }, { id: "c9", orgId: "orgB", name: "Other" }],
    }));
    expect(m).toEqual({ orgId: "orgA", jobId: "j1", customerId: "c1", status: "thread", name: "Pat" });
  });

  it("one customer: their newest open job, not a newer finished one", () => {
    const m = pickMatch(base({
      customers: [{ id: "c1", orgId: "orgA", name: "Pat" }],
      customerJobs: [
        { id: "old-open", customerId: "c1", orgId: "orgA", status: "scheduled", createdAt: "2026-10-01" },
        { id: "new-paid", customerId: "c1", orgId: "orgA", status: "paid", createdAt: "2026-11-01" },
      ],
    }));
    expect(m).toMatchObject({ orgId: "orgA", jobId: "old-open", customerId: "c1", status: "customer", name: "Pat" });
  });

  it("one customer with only finished jobs: the newest", () => {
    const m = pickMatch(base({
      customers: [{ id: "c1", orgId: "orgA", name: "Pat" }],
      customerJobs: [
        { id: "a", customerId: "c1", orgId: "orgA", status: "paid", createdAt: "2026-09-01" },
        { id: "b", customerId: "c1", orgId: "orgA", status: "complete", createdAt: "2026-10-01" },
      ],
    }));
    expect(m.jobId).toBe("b");
  });

  it("one resident: that job", () => {
    const m = pickMatch(base({ residentJobs: [{ id: "j7", orgId: "orgA", name: "Sam", createdAt: "2026-11-01" }] }));
    expect(m).toEqual({ orgId: "orgA", jobId: "j7", customerId: null, status: "resident", name: "Sam" });
  });

  it("several matches in one business: newest job, flagged", () => {
    const m = pickMatch(base({
      customers: [{ id: "c1", orgId: "orgA", name: "Pat" }, { id: "c2", orgId: "orgA", name: "Lee" }],
      customerJobs: [
        { id: "j1", customerId: "c1", orgId: "orgA", status: "quoted", createdAt: "2026-10-01" },
        { id: "j2", customerId: "c2", orgId: "orgA", status: "quoted", createdAt: "2026-11-02" },
      ],
    }));
    expect(m).toMatchObject({ orgId: "orgA", jobId: "j2", customerId: "c2", status: "several", name: "" });
  });

  it("on file at two businesses that never texted it: held from both", () => {
    const m = pickMatch(base({
      customers: [{ id: "c1", orgId: "orgA", name: "Pat" }, { id: "c2", orgId: "orgB", name: "Pat" }],
      textingOrgs: ["orgA", "orgB"],
    }));
    expect(m).toEqual({ orgId: null, jobId: null, customerId: null, status: "held", name: "" });
  });

  it("unknown number goes to the only business with texting on", () => {
    expect(pickMatch(base())).toMatchObject({ orgId: "orgA", status: "unknown", jobId: null });
  });

  it("unknown number is held when several businesses text", () => {
    expect(pickMatch(base({ textingOrgs: ["orgA", "orgB"] }))).toMatchObject({ orgId: null, status: "held" });
    expect(pickMatch(base({ textingOrgs: [] }))).toMatchObject({ orgId: null, status: "held" });
  });
});

describe("keywordOf", () => {
  it("reads STOP, START and HELP words however they're typed", () => {
    expect(keywordOf("stop")).toBe("stop");
    expect(keywordOf(" Unsubscribe. ")).toBe("stop");
    expect(keywordOf("START")).toBe("start");
    expect(keywordOf("help")).toBe("help");
  });

  it("an ordinary message is not a keyword", () => {
    expect(keywordOf("Please stop by Tuesday")).toBeNull();
    expect(keywordOf("Thanks!")).toBeNull();
  });

  it("'Yes' is a reply, unless the number opted out", () => {
    expect(keywordOf("Yes!")).toBeNull();
    expect(keywordOf("yes", true)).toBe("start");
  });
});

describe("photosFrom", () => {
  it("keeps Twilio image attachments only, up to 5", () => {
    const p: Record<string, string> = { NumMedia: "7" };
    for (let i = 0; i < 7; i++) {
      p[`MediaUrl${i}`] = `https://api.twilio.com/2010-04-01/Accounts/AC1/Messages/MM1/Media/ME${i}`;
      p[`MediaContentType${i}`] = i === 1 ? "video/mp4" : "image/jpeg";
    }
    const out = photosFrom(p);
    expect(out).toHaveLength(5);
    expect(out.every((x) => x.contentType === "image/jpeg")).toBe(true);
    expect(out.map((x) => x.url.slice(-3))).toEqual(["ME0", "ME2", "ME3", "ME4", "ME5"]);
  });

  it("ignores links that aren't Twilio's", () => {
    expect(photosFrom({ NumMedia: "1", MediaUrl0: "https://evil.example/x.jpg", MediaContentType0: "image/jpeg" })).toEqual([]);
    expect(photosFrom({})).toEqual([]);
  });
});

describe("phone helpers", () => {
  it("last10 and prettyPhone handle mixed formats", () => {
    expect(last10("(316) 555-0142")).toBe("3165550142");
    expect(last10("+1 316 555 0142")).toBe("3165550142");
    expect(last10("555-0142")).toBe("");
    expect(prettyPhone("+13165550142")).toBe("(316) 555-0142");
  });

  it("imageExt picks an extension", () => {
    expect(imageExt("image/png")).toBe("png");
    expect(imageExt("image/jpeg")).toBe("jpg");
    expect(imageExt("image/heic")).toBe("heic");
  });
});
