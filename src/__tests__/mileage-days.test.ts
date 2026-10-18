import { groupTripsByDay, dayLabel } from "@/lib/mileage-days";

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
