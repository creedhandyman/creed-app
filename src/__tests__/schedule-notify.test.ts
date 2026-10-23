import { visitSnap, scheduleNotices, noticeText, messagesFor, whenText, type VisitSnap } from "@/lib/schedule-notify";

const today = "2026-10-23";
const v = (o: Partial<VisitSnap> = {}): VisitSnap => ({ job: "12 Oak St", jobId: "j1", date: "2026-10-26", end: null, time: "08:00", crew: ["Ann", "Bo"], ...o });

describe("visitSnap", () => {
  test("crew = note list + requested tech, time parsed", () => {
    const s = visitSnap({ job: "12 Oak", sched_date: "2026-10-26", note: "🕐 14:00 · 👷 Ann, Bo · gate code 4" }, "Cy");
    expect(s).toMatchObject({ time: "14:00", crew: ["Ann", "Bo", "Cy"], end: null });
    expect(visitSnap({ sched_date: "2026-10-26", note: "👷 Ann" }, "ann").crew).toEqual(["Ann"]);
  });
});

describe("scheduleNotices", () => {
  test("new visit → everyone on it", () => {
    expect(scheduleNotices(null, v(), today).map((n) => [n.name, n.kind])).toEqual([["Ann", "scheduled"], ["Bo", "scheduled"]]);
  });
  test("deleted → removed", () => {
    expect(scheduleNotices(v(), null, today).map((n) => n.kind)).toEqual(["removed", "removed"]);
  });
  test("crew swap + move", () => {
    const n = scheduleNotices(v(), v({ crew: ["bo", "Cy"], time: "09:00" }), today);
    expect(n.map((x) => [x.name, x.kind])).toEqual([["bo", "changed"], ["Cy", "scheduled"], ["Ann", "removed"]]);
  });
  test("note-only edit tells nobody", () => {
    expect(scheduleNotices(v(), v(), today)).toEqual([]);
  });
  test("past visits are history", () => {
    expect(scheduleNotices(v({ date: "2026-10-01" }), null, today)).toEqual([]);
    expect(scheduleNotices(null, v({ date: "2026-10-20", end: "2026-10-24" }), today)).toHaveLength(2);
  });
});

describe("text", () => {
  test("when + messages", () => {
    expect(whenText(v())).toBe("Mon, Oct 26 at 8:00 AM");
    expect(whenText(v({ time: "", end: "2026-10-27" }))).toBe("Mon, Oct 26 – Tue, Oct 27");
    const [n] = scheduleNotices(v(), v({ time: "10:30" }), today);
    expect(noticeText(n).body).toBe("12 Oak St · now Mon, Oct 26 at 10:30 AM (was Mon, Oct 26 at 8:00 AM)");
  });
  test("3+ notices collapse into one summary", () => {
    const ns = [1, 2, 3].map((i) => ({ name: "Ann", kind: "scheduled" as const, visit: v({ job: `${i} Elm`, date: `2026-10-2${i + 5}` }) }));
    expect(messagesFor(ns.slice(0, 2))).toHaveLength(2);
    const [m] = messagesFor(ns);
    expect(m.title).toBe("Your schedule was updated");
    expect(m.body).toBe("3 visits: 3 new — Mon 1 Elm; Tue 2 Elm; Wed 3 Elm");
  });
});
