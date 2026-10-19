import { applyFix, finalMiles, GAP_MS, type DriveTrip } from "../lib/drive-tracker";
import { haversineMiles, ROAD_FACTOR } from "../lib/geo";

const blank = (): DriveTrip => ({
  job: "", startedAt: "", accMiles: 0, startLat: null, startLng: null,
  lastLat: null, lastLng: null, lastAcc: null, lastAt: null, fixes: 0,
});
// ~0.69 mi per 0.01° of latitude
const at = (lat: number, accuracy: number, t: number) => ({ lat, lng: -97.33, accuracy, at: t });

describe("drive tracker", () => {
  it("takes the first usable fix as the start, even a rough one", () => {
    const t = applyFix(blank(), at(37.70, 300, 0));
    expect(t.startLat).toBe(37.70);
    expect(t.fixes).toBe(1);
    expect(applyFix(blank(), at(37.70, 900, 0)).fixes).toBe(0); // useless fix ignored
  });

  it("refines a rough start with a sharper fix nearby instead of counting miles", () => {
    let t = applyFix(blank(), at(37.70, 300, 0));
    t = applyFix(t, at(37.7015, 20, 2000)); // ~170 m away, inside the 300 m circle
    expect(t.accMiles).toBe(0);
    expect(t.startLat).toBe(37.7015);
  });

  it("sums continuous fixes and ignores jitter", () => {
    let t = applyFix(blank(), at(37.70, 10, 0));
    t = applyFix(t, at(37.70005, 10, 1000)); // ~5 m wander
    expect(t.accMiles).toBe(0);
    t = applyFix(t, at(37.71, 10, 20000));
    t = applyFix(t, at(37.72, 10, 40000));
    expect(t.accMiles).toBeCloseTo(haversineMiles(37.70, -97.33, 37.72, -97.33), 2);
  });

  it("road-adjusts a jump across a gap (app was in the background behind Maps)", () => {
    let t = applyFix(blank(), at(37.70, 15, 0));
    t = applyFix(t, at(37.80, 150, GAP_MS + 5000)); // rough fix on return still accepted
    expect(t.accMiles).toBeCloseTo(haversineMiles(37.70, -97.33, 37.80, -97.33) * ROAD_FACTOR, 2);
  });

  it("the stop fix still measures a drive that got no fixes along the way", () => {
    const t = applyFix(blank(), at(37.70, 15, 0));
    const { miles, hadStart } = finalMiles(t, at(37.75, 30, 1000));
    expect(hadStart).toBe(true);
    expect(miles).toBeCloseTo(haversineMiles(37.70, -97.33, 37.75, -97.33) * ROAD_FACTOR, 1);
  });

  it("never logs less than the start→end straight line", () => {
    let t = applyFix(blank(), at(37.70, 10, 0));
    t = applyFix(t, at(37.71, 10, 10000));
    const { miles } = finalMiles(t, at(37.80, 20, 20000));
    expect(miles).toBeGreaterThanOrEqual(Math.round(haversineMiles(37.70, -97.33, 37.80, -97.33) * ROAD_FACTOR * 10) / 10 - 0.05);
  });

  it("no start point and no stop fix = 0 (caller asks for miles)", () => {
    expect(finalMiles(blank(), null)).toEqual({ miles: 0, hadStart: false });
  });
});
