import { buildCalendar, foldLine, visitHours, icsText } from "@/lib/calendar-feed";

const now = new Date(Date.UTC(2026, 9, 23, 12, 0, 0));
const rows = [
  { id: "a", job: "12 Oak St", job_id: "j1", sched_date: "2026-10-26", note: "🕐 08:00 · 👷 Ann Lee, Bo · gate code 4" },
  { id: "b", job: "9 Elm", job_id: "j2", sched_date: "2026-10-27", end_date: "2026-10-28", note: "👷 Bo" },
  { id: "c", job: "5 Pine", job_id: "j3", sched_date: "2026-10-27", note: "🕐 13:00" },
];
const jobs = [
  { id: "j1", client: "Smith", total_hrs: 8 },
  { id: "j2", total_hrs: 0 },
  { id: "j3", requested_tech: "Ann Lee", total_hrs: 3, archived: false },
];
const opts = { name: "Ann's jobs", appUrl: "https://www.creedhm.com", now };

test("personal feed: only my visits, timed as exact UTC from Central time", () => {
  const ics = buildCalendar(rows, jobs, { ...opts, forName: "ann lee" });
  expect(ics).toContain("UID:a-20261026@creedhm.com");
  expect(ics).toContain("DTSTART:20261026T130000Z"); // 8:00 AM CDT
  expect(ics).toContain("DTEND:20261026T170000Z"); // 8h ÷ 2 crew = noon CDT
  expect(ics).toContain("SUMMARY:12 Oak St — Smith");
  expect(ics).toContain("DTSTART:20261027T180000Z"); // 1 PM CDT; requested tech counts
  expect(ics).toContain("X-WR-TIMEZONE:America/Chicago");
  expect(ics).not.toContain("9 Elm");
  expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
  expect(ics).toContain("Notes: gate code 4");
});

test("team feed: everyone, untimed multi-day = one all-day span", () => {
  const ics = buildCalendar(rows, jobs, { ...opts, forName: null });
  expect(ics).toContain("SUMMARY:Ann\\, Bo: 12 Oak St");
  expect(ics).toContain("DTSTART;VALUE=DATE:20261027");
  expect(ics).toContain("DTEND;VALUE=DATE:20261029");
});

test("archived jobs drop out", () => {
  expect(buildCalendar(rows, [{ ...jobs[0], archived: true }], { ...opts, forName: null })).not.toContain("12 Oak St");
});

test("helpers", () => {
  expect(visitHours(undefined, 1, 1)).toBe(2);
  expect(visitHours({ id: "x", total_hrs: 40 }, 1, 1)).toBe(10);
  expect(icsText("a,b;c\nd")).toBe("a\\,b\\;c\\nd");
  const long = "DESCRIPTION:" + "x".repeat(200);
  expect(foldLine(long).split("\r\n ").map((p) => p.length).every((n) => n <= 75)).toBe(true);
  expect(foldLine(long).replace(/\r\n /g, "")).toBe(long);
});

test("Google read the old floating times as UTC: times now carry Z and follow DST", () => {
  const winter = buildCalendar([{ id: "w", job: "1 A St", sched_date: "2026-12-07", note: "🕐 08:00 · 👷 Ann Lee" }], [], { ...opts, forName: null });
  expect(winter).toContain("DTSTART:20261207T140000Z"); // CST = UTC-6
  expect(winter.split(/\r?\n/).filter((l) => /^DTSTART:\d{8}T\d{6}$/.test(l))).toEqual([]); // never floating
  const pacific = buildCalendar([{ id: "p", job: "1 A St", sched_date: "2026-12-07", note: "🕐 08:00" }], [], { ...opts, forName: null, tz: "America/Los_Angeles" });
  expect(pacific).toContain("DTSTART:20261207T160000Z");
});
