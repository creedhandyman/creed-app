import { computePlatformFee, currentPeriodStart, PLATFORM_FEE_CAP_CENTS } from "@/lib/platform-fee";

// ─── computePlatformFee ──────────────────────────────────────────────────────

describe("computePlatformFee — Pro tier", () => {
  test("returns 0 for any amount when plan is pro", () => {
    expect(computePlatformFee(10_000, "pro", 0)).toBe(0);
    expect(computePlatformFee(1_000_000, "pro", 0)).toBe(0);
  });

  test("returns 0 even if feesCollected is 0 (Pro has no cap concept)", () => {
    expect(computePlatformFee(500_00, "pro", PLATFORM_FEE_CAP_CENTS)).toBe(0);
  });
});

describe("computePlatformFee — Solo/Crew under cap", () => {
  test("solo: charges exactly 0.5% when well under cap", () => {
    // $1,000 payment → $5.00 fee
    expect(computePlatformFee(100_000, "solo", 0)).toBe(500);
  });

  test("crew: same rate as solo", () => {
    expect(computePlatformFee(100_000, "crew", 0)).toBe(500);
  });

  test("rounds to nearest cent — $1 charge → 1¢ fee (0.5¢ rounds up)", () => {
    expect(computePlatformFee(100, "solo", 0)).toBe(1);
  });

  test("rounds to nearest cent — $2 charge → 1¢ fee (1.0¢ rounds down)", () => {
    expect(computePlatformFee(200, "solo", 0)).toBe(1);
  });

  test("$20,000 charge ($100 raw fee) is exactly at cap — returns $100", () => {
    expect(computePlatformFee(2_000_000, "solo", 0)).toBe(10_000);
  });
});

describe("computePlatformFee — cap exhausted", () => {
  test("returns 0 when monthly cap is exactly reached", () => {
    expect(computePlatformFee(100_000, "solo", PLATFORM_FEE_CAP_CENTS)).toBe(0);
  });

  test("returns 0 when fees already exceed cap (refund/correction edge case)", () => {
    expect(computePlatformFee(100_000, "solo", PLATFORM_FEE_CAP_CENTS + 500)).toBe(0);
  });
});

describe("computePlatformFee — straddling the cap", () => {
  test("charges only remaining headroom when transaction would cross cap", () => {
    // $98 collected, $10 raw fee on a $2,000 charge → only $2 remaining
    expect(computePlatformFee(200_000, "solo", 9_800)).toBe(200);
  });

  test("$80 collected, $40 raw fee on $8,000 charge → only $20 remaining", () => {
    expect(computePlatformFee(800_000, "solo", 8_000)).toBe(2_000);
  });

  test("$0.01 remaining: giant charge → only 1¢ fee", () => {
    expect(computePlatformFee(10_000_000, "solo", 9_999)).toBe(1);
  });
});

describe("computePlatformFee — guard rails", () => {
  test("zero amount returns 0", () => {
    expect(computePlatformFee(0, "solo", 0)).toBe(0);
  });

  test("negative amount returns 0", () => {
    expect(computePlatformFee(-500, "solo", 0)).toBe(0);
  });

  test("null plan (unknown tier) applies standard 0.5% — not treated as Pro", () => {
    expect(computePlatformFee(100_000, null, 0)).toBe(500);
  });

  test("undefined plan applies standard 0.5%", () => {
    expect(computePlatformFee(100_000, undefined, 0)).toBe(500);
  });

  test("result is always an integer (no float output)", () => {
    for (const cents of [1, 3, 7, 333, 999, 12_345]) {
      const fee = computePlatformFee(cents, "solo", 0);
      expect(Number.isInteger(fee)).toBe(true);
    }
  });
});

describe("computePlatformFee — mid-period tier change", () => {
  // The plan field is passed per-transaction. Upgrading to Pro mid-period
  // just means subsequent calls get plan="pro" → fee=0. No special handling needed.
  test("switching to Pro stops all fees immediately", () => {
    // Suppose $50 was collected this period on solo
    expect(computePlatformFee(100_000, "pro", 5_000)).toBe(0);
  });

  test("downgrading from Pro to crew resumes normal fee", () => {
    expect(computePlatformFee(100_000, "crew", 5_000)).toBe(500);
  });
});

// ─── currentPeriodStart ──────────────────────────────────────────────────────

describe("currentPeriodStart", () => {
  test("returns the first day of the current month at UTC midnight", () => {
    const ps = currentPeriodStart();
    expect(ps.getUTCDate()).toBe(1);
    expect(ps.getUTCHours()).toBe(0);
    expect(ps.getUTCMinutes()).toBe(0);
    expect(ps.getUTCSeconds()).toBe(0);
    expect(ps.getUTCMilliseconds()).toBe(0);
  });

  test("is in the past relative to now", () => {
    expect(currentPeriodStart().getTime()).toBeLessThanOrEqual(Date.now());
  });
});
