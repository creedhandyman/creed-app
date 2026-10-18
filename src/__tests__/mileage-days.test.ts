import { groupTripsByDay, dayLabel, legStartTimes, clockMinutes, formatClock } from "@/lib/mileage-days";

const trip = (id: string, date: string, job: string, mi: number, at: string) =>
  ({ id, job, trip_date: date, start_miles: 0, end_miles: 0, total_miles: mi, created_at: at });

describe("groupTripsByDay", () => {
  const trips = [
    trip("c", "2026-10-16", "Wichita, KS", 8, "2026-10-16T22:00:00Z"),
    trip("a", "2026-10-16", "6807 E Rodeo St", 10, "2026-10-16T14:00:00Z"),
    trip("b", "2026-10-16", "827 S Sunset Cir", 12.5, "2026-10-16T18:00:00Z"),
    trip("d", "2026-10-14", "258 S Turkle Ave", 5, "2026-10-14T15:00:00Z"),
  ];

  it("groups newest day first, legs in logged order, with a day total", () => {
    const days = groupTripsByDay(trips, "Wichita, KS");
    expect(days.map((d) => d.date)).toEqual(["2026-10-16", "2026-10-14"]);
    expect(days[0].legs.map((l) => l.trip.id)).toEqual(["a", "b", "c"]);
    expect(days[0].miles).toBe(30.5);
  });

  it("infers each leg's start: shop first, then the previous stop", () => {
    const [day] = groupTripsByDay(trips, "Wichita, KS");
    expect(day.legs.map((l) => l.from)).toEqual(["Wichita, KS", "6807 E Rodeo St", "827 S Sunset Cir"]);
    expect(day.legs.map((l) => l.toBase)).toEqual([false, false, true]);
  });

  it("leaves the first start unknown without a shop address", () => {
    const [day] = groupTripsByDay(trips, "");
    expect(day.legs[0].from).toBeNull();
    expect(day.legs[2].toBase).toBe(false);
  });

  it("can sort oldest first for the PDF", () => {
    expect(groupTripsByDay(trips, null, true).map((d) => d.date)).toEqual(["2026-10-14", "2026-10-16"]);
  });

  it("labels days locally", () => {
    expect(dayLabel("2026-10-16")).toBe("Fri, Oct 16");
  });
});

describe("legStartTimes", () => {
  const trips = [
    { ...trip("a", "2026-10-16", "6807 E Rodeo St", 14, "2026-10-16T14:00:00Z") },
    { ...trip("b", "2026-10-16", "827 S Sunset Cir", 12.5, "2026-10-16T18:00:00Z") },
    { ...trip("c", "2026-10-16", "Wichita, KS", 8, "2026-10-16T22:00:00Z") },
  ];
  const clock = [
    { job: "827 S Sunset Cir", start_time: "01:30 PM", end_time: "04:45 PM" },
    { job: "6807 E Rodeo St", start_time: "08:30 AM", end_time: "12:10 PM" },
    { job: "General", start_time: "06:00 AM", end_time: "07:00 AM" },
  ];

  it("estimates from clock-ins: shop → arrival minus drive, then each clock-out", () => {
    const [day] = groupTripsByDay(trips, "Wichita, KS");
    expect(legStartTimes(day, clock, "Wichita, KS")).toEqual([
      { time: "8:00 AM", estimated: true }, // 14 mi ≈ 30 min before 8:30
      { time: "12:10 PM", estimated: true },
      { time: "4:45 PM", estimated: true },
    ]);
  });

  it("a stored start time wins and isn't marked estimated", () => {
    const [day] = groupTripsByDay([{ ...trips[0], start_time: "7:52 AM" }], "Wichita, KS");
    expect(legStartTimes(day, clock, "Wichita, KS")[0]).toEqual({ time: "7:52 AM", estimated: false });
  });

  it("no clock data → unknown", () => {
    const [day] = groupTripsByDay(trips, "Wichita, KS");
    expect(legStartTimes(day, [], "Wichita, KS")).toEqual([null, null, null]);
  });

  it("formats clock times", () => {
    expect(clockMinutes("12:05 AM")).toBe(5);
    expect(formatClock(clockMinutes("12:05 PM")!)).toBe("12:05 PM");
  });
});
