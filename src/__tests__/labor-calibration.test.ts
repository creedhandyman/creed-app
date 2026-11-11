// parser.ts imports the Supabase client, which throws without env vars.
jest.mock("@/lib/supabase", () => ({ db: {}, supabase: {} }));
jest.mock("@/lib/api", () => ({ apiFetch: jest.fn() }));

import {
  calibratedHours,
  calibrationFactor,
  flooringFloorHrs,
  laborCalibrationFrom,
  RAW_FACTOR_MAX,
  RAW_FACTOR_MIN,
  LEGACY_FACTOR_MAX,
  type CalibrationRow,
} from "@/lib/parser";

const raw = (job: string, trade: string, ai: number, act: number, at = "2026-11-01T00:00:00Z"): CalibrationRow => ({
  item_name: `__jobraw__:${trade}`,
  original_hours: ai,
  corrected_hours: act,
  trade,
  job_id: job,
  created_at: at,
});

/** n jobs, each `ai` AI hours that clocked ai × ratio. */
const jobs = (n: number, ai: number, ratio: number, trade = "Carpentry") =>
  Array.from({ length: n }, (_, i) => raw(`j${i}`, trade, ai, ai * ratio));

describe("laborCalibrationFrom — raw basis", () => {
  it("stays on the legacy basis until 8 jobs and 40 AI hours back it", () => {
    expect(laborCalibrationFrom(jobs(7, 10, 0.7)).basis).toBe("none");
    expect(laborCalibrationFrom(jobs(8, 4, 0.7)).basis).toBe("none");
    expect(laborCalibrationFrom(jobs(8, 10, 0.7)).basis).toBe("raw");
  });

  it("moves only part of the way to the measured ratio — more jobs, more trust", () => {
    // measured 0.7; trust = n / (n + 10)
    expect(laborCalibrationFrom(jobs(10, 10, 0.7)).overall).toBeCloseTo(1 - 0.5 * 0.3, 5);
    expect(laborCalibrationFrom(jobs(25, 10, 0.7)).overall).toBeCloseTo(1 - (25 / 35) * 0.3, 5);
    // …and the same going up.
    expect(laborCalibrationFrom(jobs(10, 10, 1.4)).overall).toBeCloseTo(1.2, 5);
  });

  it("shrinks a trade's own ratio toward the overall one", () => {
    const rows = [...jobs(12, 10, 1, "Carpentry"), raw("p1", "Painting", 10, 16), raw("p2", "Painting", 10, 16), raw("p3", "Painting", 10, 16)];
    const cal = laborCalibrationFrom(rows);
    expect(cal.byTrade.painting).toBeGreaterThan(cal.overall);
    expect(cal.byTrade.painting).toBeLessThan(1.6); // 3 jobs are not enough to believe 1.6x outright
    expect(cal.byTrade.carpentry).toBeCloseTo(cal.overall + (12 / 22) * (1 - cal.overall), 5);
  });

  it("an under-clocked job can't swing it (each row clamps to 0.4–3x)", () => {
    const rows = [...jobs(9, 10, 1), raw("bad", "Carpentry", 10, 0.5)];
    // without the clamp: 90.5/100; with it the bad row counts as 4h → 94/100
    expect(laborCalibrationFrom(rows).overall).toBeCloseTo(1 + 0.5 * (94 / 100 - 1), 5);
  });

  it("matches this shop's first 18 finished jobs (AI ran ~19% over the clock)", () => {
    // Real rows, 2026-10-02 → 2026-11-10: [job, trade, AI hours, clocked share].
    const real: [string, string, number, number, string?][] = [
      ["842127eb", "General", 15.25, 4.61],
      ["26dbaaa4", "Carpentry", 9.5, 7.59, "2026-11-10T20:00:00Z"], ["26dbaaa4", "Electrical", 0.75, 0.73, "2026-11-10T20:00:00Z"],
      // the same job's earlier completion, hours before the last clock entry — must be ignored
      ["26dbaaa4", "Carpentry", 9.5, 6.88, "2026-11-10T15:00:00Z"], ["26dbaaa4", "Electrical", 0.75, 0.66, "2026-11-10T15:00:00Z"],
      ["81b6c65e", "Painting", 7, 3.42], ["81b6c65e", "Carpentry", 6, 3.64],
      ["08d40cd6", "Carpentry", 1, 1.04], ["08d40cd6", "Electrical", 1.5, 1.64], ["08d40cd6", "Plumbing", 1.5, 1.73],
      ["5de5f406", "Carpentry", 2.5, 1.45], ["88682a70", "Carpentry", 3.5, 8], ["d1c70c7d", "Carpentry", 4.25, 4.79],
      ["cb128159", "General", 0.75, 0.31], ["cb128159", "Painting", 1.5, 0.7], ["cb128159", "HVAC", 0.5, 0.21],
      ["afe0c96b", "Carpentry", 10.5, 4.05], ["c8c2a981", "Carpentry", 1, 1.64], ["d5a93afd", "Painting", 6.5, 1.49],
      ["a407029a", "General", 1.75, 0.3], ["a407029a", "Flooring", 1, 0.46], ["a407029a", "Painting", 2, 0.61],
      ["a407029a", "HVAC", 0.3, 0.11], ["a407029a", "Carpentry", 3.3, 1.44], ["a407029a", "Electrical", 0.8, 0.34],
      ["a407029a", "Plumbing", 1.8, 0.8], ["6c0adf7f", "Carpentry", 1, 0.33], ["6c0adf7f", "Electrical", 1.5, 1.64],
      ["6c3646fc", "Painting", 13.5, 22], ["6c3646fc", "Carpentry", 7.4, 10.54], ["e049e225", "Carpentry", 1.5, 3.31],
      ["e049e225", "Plumbing", 1, 2.2], ["596fd36e", "Plumbing", 1.25, 1.73], ["6edfe5ad", "General", 3.5, 0.63],
      ["568d1808", "Painting", 4, 3.81],
    ];
    const cal = laborCalibrationFrom(real.map(([j, t, ai, act, at]) => raw(j, t, ai, act, at)));
    expect(cal.basis).toBe("raw");
    // Measured ≈ 0.87 after the per-row clamps; 18 jobs → 64% trust → ≈ 0.92.
    expect(cal.overall).toBeGreaterThan(0.89);
    expect(cal.overall).toBeLessThan(0.95);
    // Every trade lands inside the enforced range, none below a 15% trim.
    for (const t of ["Carpentry", "Painting", "General", "Plumbing", "Electrical", "HVAC", "Flooring"]) {
      const f = calibrationFactor(cal, t);
      expect(f).toBeGreaterThanOrEqual(RAW_FACTOR_MIN);
      expect(f).toBeLessThanOrEqual(1.2);
    }
  });
});

describe("calibrationFactor", () => {
  it("raw basis: trims to 0.85 at most, raises to 1.5 at most", () => {
    expect(calibrationFactor({ byTrade: {}, overall: 0.6, basis: "raw" }, "Carpentry")).toBe(RAW_FACTOR_MIN);
    expect(calibrationFactor({ byTrade: {}, overall: 2, basis: "raw" }, "Carpentry")).toBe(RAW_FACTOR_MAX);
    expect(calibrationFactor({ byTrade: { painting: 1.3 }, overall: 0.9, basis: "raw" }, " Painting ")).toBe(1.3);
  });
  it("legacy basis: never trims, capped at 1.15", () => {
    expect(calibrationFactor({ byTrade: {}, overall: 0.7, basis: "history" }, "Carpentry")).toBe(1);
    expect(calibrationFactor({ byTrade: {}, overall: 1.6, basis: "history" }, "Carpentry")).toBe(LEGACY_FACTOR_MAX);
    expect(calibrationFactor({ byTrade: {}, overall: 1, basis: "none" }, "Carpentry")).toBe(1);
  });
});

describe("calibratedHours", () => {
  const line = (laborHrs: number, o: Record<string, unknown> = {}) => ({ detail: "Kitchen — Replace cabinet door", comment: "", laborHrs, ...o });
  it("leaves hours alone inside the ±5% dead band", () => {
    expect(calibratedHours(line(4), 1.04)).toBe(4);
    expect(calibratedHours(line(4), 0.96)).toBe(4);
  });
  it("raises every line", () => {
    expect(calibratedHours(line(4), 1.2)).toBe(4.8);
    expect(calibratedHours(line(0.5), 1.2)).toBe(0.6);
  });
  it("trims only lines of an hour or more", () => {
    expect(calibratedHours(line(4), 0.9)).toBe(3.6);
    expect(calibratedHours(line(0.75), 0.9)).toBe(0.75);
    expect(calibratedHours(line(0), 0.9)).toBe(0);
  });
  it("never trims a T&M assessment line", () => {
    expect(calibratedHours(line(1, { tnm: true }), 0.85)).toBe(1);
  });
  it("never trims flooring below its per-sqft minimum", () => {
    const lvp = { detail: "Living Room — Replace carpet with LVP", comment: "Tear out carpet, install LVP", sqft: 420 };
    const floor = flooringFloorHrs(lvp); // 420 / 28 = 15
    expect(floor).toBe(15);
    expect(calibratedHours({ ...lvp, laborHrs: 15 }, 0.85)).toBe(15);
    expect(calibratedHours({ ...lvp, laborHrs: 20 }, 0.85)).toBe(17);
  });
});
