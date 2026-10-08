// How long a quoted job takes on site — ONE place, shared by the QuoteForge
// editor hint and the quote PDF's "Estimated completion" line.
//
// Labor hours on a quote are TOTAL work hours (price = hours × rate), so the
// crew size only changes the calendar: days = hours ÷ crew ÷ 8-hour days.
// The AI parse's own estDays also counts dry/cure/inspection waits (paint
// coats, mud, concrete) that add days but no labor hours — so when it's on
// file, the longer of the two wins.

export const WORKDAY_HOURS = 8;

/** The crew size to plan with: the one picked on the quote, else 2 when the
 *  job is over a day's work, else 1 (the same rule the PDF's per-section
 *  labor line has always used). */
export function planningCrew(totalHrs: number, crewSize?: number | null): number {
  if (typeof crewSize === "number" && crewSize > 0) return Math.round(crewSize);
  return totalHrs > WORKDAY_HOURS ? 2 : 1;
}

/** Whole working days on site (0 when there's no labor, e.g. materials-only). */
export function estimateDays(totalHrs: number, crewSize?: number | null, aiEstDays?: number | null): number {
  if (!(totalHrs > 0)) return 0;
  const byHours = Math.max(1, Math.ceil(totalHrs / planningCrew(totalHrs, crewSize) / WORKDAY_HOURS));
  const byAi = typeof aiEstDays === "number" && aiEstDays > 0 ? Math.ceil(aiEstDays) : 0;
  return Math.max(byHours, byAi);
}
