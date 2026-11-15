import { ymdInZone } from "@/lib/dates";
import { todayYmd } from "@/lib/schedule-notify";

// New jobs / leads used new Date().toISOString().split("T")[0] — UTC — so
// anything saved after 7 PM Central got TOMORROW as its job_date (and landed
// in next month's revenue on the 31st).
describe("a job's date is the business's date, not UTC's", () => {
  it("8:30 PM Central on Oct 31 is still Oct 31", () => {
    const t = Date.parse("2026-11-01T01:30:00Z");
    expect(new Date(t).toISOString().split("T")[0]).toBe("2026-11-01"); // the old bug
    expect(ymdInZone(t)).toBe("2026-10-31");
  });
  it("todayYmd reads the device's local calendar date", () => {
    expect(todayYmd(new Date(2026, 9, 31, 20, 30))).toBe("2026-10-31");
  });
});
