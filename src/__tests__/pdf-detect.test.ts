import { looksLikePdfBytes, withTimeout } from "../lib/pdf-detect";

const bytes = (s: string) => Uint8Array.from(Buffer.from(s, "latin1"));

describe("looksLikePdfBytes", () => {
  it("accepts a normal PDF header", () => {
    expect(looksLikePdfBytes(bytes("%PDF-1.7\n%\xE2\xE3\xCF\xD3\n1 0 obj"))).toBe(true);
  });
  it("accepts a little junk before the header (readers do)", () => {
    expect(looksLikePdfBytes(bytes("\r\n  %PDF-1.4\n"))).toBe(true);
  });
  it("rejects plain text and images", () => {
    expect(looksLikePdfBytes(bytes("Kitchen — replace faucet\nBath — recaulk"))).toBe(false);
    expect(looksLikePdfBytes(bytes("\xFF\xD8\xFF\xE0\x00\x10JFIF"))).toBe(false);
    expect(looksLikePdfBytes(new Uint8Array())).toBe(false);
  });
});

describe("withTimeout", () => {
  it("passes a value through", async () => {
    await expect(withTimeout(Promise.resolve(7), 50, "slow")).resolves.toBe(7);
  });
  it("passes a rejection through", async () => {
    await expect(withTimeout(Promise.reject(new Error("bad")), 50, "slow")).rejects.toThrow("bad");
  });
  it("rejects with the message when the promise never settles", async () => {
    await expect(withTimeout(new Promise(() => {}), 20, "The PDF took too long to open")).rejects.toThrow("The PDF took too long to open");
  });
});
