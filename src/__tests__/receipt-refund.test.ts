jest.mock("@/lib/supabase", () => ({ db: {}, supabase: {} }));
jest.mock("@/lib/api", () => ({ apiFetch: jest.fn() }));
import { scanMismatch } from "@/lib/receipt-scan";

describe("scanMismatch with refunds", () => {
  test("a refund that adds up is fine", () => {
    expect(scanMismatch({ items: [{ name: "Drywall", price: -40 }], tax: -3, total: -43 })).toBeNull();
  });
  test("a refund that doesn't add up warns", () => {
    expect(scanMismatch({ items: [{ name: "Drywall", price: -40 }], tax: -3, total: -60 })).toBe(-43);
  });
  test("purchases unchanged", () => {
    expect(scanMismatch({ items: [{ name: "Screws", price: 10 }], tax: 1, total: 11 })).toBeNull();
    expect(scanMismatch({ items: [{ name: "Screws", price: 10 }], tax: 1, total: 20 })).toBe(11);
  });
});
