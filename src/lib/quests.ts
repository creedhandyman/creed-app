/**
 * Shared quest engine — single source of truth for quest progress + bonuses.
 *
 * Both the Quests screen (logged-in tech) and Payroll (admin paying a selected
 * employee) call this so the bonuses they show ALWAYS agree. Previously each
 * screen computed quests independently: payroll only knew about 6 of the 12
 * quests and measured them org-wide/all-time, while the tech's screen measured
 * per-tech/per-cycle — so payroll could offer the wrong amount (or miss a
 * bonus entirely). Keeping the math here means there's nothing to drift.
 *
 * This is a faithful extraction of the Quests-screen computation; behaviour is
 * unchanged for the tech, and payroll now inherits the exact same numbers.
 */
import type { Job, Review, Referral, TimeEntry } from "./types";

export interface QuestDef {
  key: string;
  name: string;
  desc: string;
  bonus: string;        // display label, e.g. "$75"
  bonusAmount: number;  // numeric dollars (what payroll pays)
  progress: number;
  goal: number;
  unit: string;
  tier: string;
  tierColor: string;
}

export interface QuestTierGroup {
  name: string;
  color: string;
  quests: QuestDef[];
}

export interface QuestMetrics {
  completedJobs: number;
  positiveReviews: number;
  fiveStarReviews: number;
  convertedReferrals: number;
  repeatClients: number;
  bigJobs: number;
  totalHours: number;
  bestTradeCount: number;
  zeroCallbackStreak: number;
  speedDays: number;
  upsellCount: number;
  requestedByNameClients: number;
  handyKingProgress: number;
}

export interface QuestEngineInput {
  userId: string;
  userName: string;
  jobs: Job[];
  reviews: Review[];
  referrals: Referral[];
  timeEntries: TimeEntry[];
  questConfig: Record<string, { enabled?: boolean; bonus?: number }>;
  cycleStart: Date;
}

export interface QuestEngineResult {
  tiers: QuestTierGroup[];
  /** Flat list of enabled quests across all tiers. */
  allQuests: QuestDef[];
  metrics: QuestMetrics;
}

export const QUEST_DEFAULT_BONUSES: Record<string, number> = {
  review_favor: 75, five_star: 100, super_handy: 50, network_scout: 50,
  critical_referral: 150, deal_closer: 25, repeat_machine: 100,
  skill_mastery: 100, make_ready: 350, zero_callback: 150, mr_speed: 25, handy_king: 750,
};

export function computeQuests(input: QuestEngineInput): QuestEngineResult {
  const { userId, userName, jobs, reviews, referrals, timeEntries, questConfig, cycleStart } = input;

  const inCycle = (dateStr?: string | null): boolean => {
    if (!dateStr) return false;
    try { return new Date(dateStr) >= cycleStart; } catch { return false; }
  };

  // PER-USER QUEST FILTERING. The "this user worked on this job" join is built
  // from time_entries (every clock-in / manual entry stamps user_id + job_id),
  // with a job-name fallback for legacy rows with NULL job_id.
  const userTimeEntries = timeEntries.filter((e) => e.user_id === userId);
  const userJobIds = new Set(
    userTimeEntries.map((e) => e.job_id).filter((id): id is string => !!id),
  );
  // Name fallback applies ONLY to legacy entries with no job_id. Entries that
  // DO carry a job_id are already matched precisely via userJobIds above —
  // adding their address here would re-attribute OTHER jobs at the same
  // property to this user (cross-tech bleed when two techs work one address).
  const userJobNames = new Set(
    userTimeEntries
      .filter((e) => !e.job_id)
      .map((e) => e.job)
      .filter((n): n is string => !!n && n !== "General"),
  );
  const isUserJob = (j: Job) =>
    userJobIds.has(j.id) || (!!j.property && userJobNames.has(j.property));
  const userNameLc = userName.toLowerCase();
  const reviewTagsUser = (r: Review) => {
    if (!r.employee_names) return false;
    return r.employee_names.toLowerCase().split(",").map((s) => s.trim()).includes(userNameLc);
  };

  // Computed stats — filtered to current cycle AND to this user.
  const cycleJobs = jobs.filter((j) => inCycle(j.created_at) && isUserJob(j));
  const completedJobs = cycleJobs.filter((j) => j.status === "complete" || j.status === "invoiced" || j.status === "paid").length;
  const positiveReviews = reviews.filter((r) => (r.rating || 0) >= 3 && inCycle(r.created_at) && reviewTagsUser(r)).length;
  const fiveStarReviews = reviews.filter((r) => r.rating === 5 && inCycle(r.created_at) && reviewTagsUser(r)).length;
  // Network Scout is per-tech: only referrals THIS user brought in (stamped
  // referred_by_user_id at creation) count. Legacy rows + public website
  // submissions have no referrer, so they credit no individual tech.
  const convertedReferrals = referrals.filter((r) => r.status === "converted" && inCycle(r.created_at) && r.referred_by_user_id === userId).length;

  // Repeat clients with 5+ jobs (cycle). Exclude leads.
  const jobsByClient: Record<string, number> = {};
  cycleJobs.filter((j) => j.client && j.status !== "lead").forEach((j) => {
    jobsByClient[j.client] = (jobsByClient[j.client] || 0) + 1;
  });
  const repeatClients = Object.values(jobsByClient).filter((c) => c >= 5).length;

  // Big jobs (24+ hours, cycle).
  const bigJobs = cycleJobs.filter((j) => (j.status === "complete" || j.status === "paid") && (j.total_hrs || 0) >= 24).length;

  // Total hours logged — this user's hours in cycle only.
  const totalHours = userTimeEntries
    .filter((e) => inCycle(e.entry_date))
    .reduce((s, e) => s + (e.hours || 0), 0);

  // Skill Mastery: completed jobs per trade.
  const jobsByTrade: Record<string, number> = {};
  cycleJobs.filter((j) => (j.status === "complete" || j.status === "paid") && j.trade).forEach((j) => {
    jobsByTrade[j.trade] = (jobsByTrade[j.trade] || 0) + 1;
  });
  const bestTradeCount = Math.max(0, ...Object.values(jobsByTrade));

  // Zero Callback streak — over the user's own completed jobs.
  const completedJobsSorted = cycleJobs
    .filter((j) => j.status === "complete" || j.status === "paid")
    .sort((a, b) => (a.created_at > b.created_at ? -1 : 1));
  let zeroCallbackStreak = 0;
  for (const j of completedJobsSorted) {
    if (j.callback) break;
    zeroCallbackStreak++;
  }

  // Mr.Speed: user days with 5+ completed jobs.
  const jobsByDate: Record<string, number> = {};
  cycleJobs.filter((j) => j.status === "complete" || j.status === "paid").forEach((j) => {
    const d = j.job_date || j.created_at?.split("T")[0] || "";
    if (d) jobsByDate[d] = (jobsByDate[d] || 0) + 1;
  });
  const speedDays = Object.values(jobsByDate).filter((c) => c >= 5).length;

  // Deal Closer: user's upsell jobs.
  const upsellCount = cycleJobs.filter((j) => j.is_upsell).length;

  // Repeat Machine: distinct clients who requested THIS user by name (cycle).
  const myRequestClients = new Set<string>();
  jobs
    .filter((j) => inCycle(j.created_at) && j.requested_tech && j.client)
    .forEach((j) => {
      if (j.requested_tech.toLowerCase() === userNameLc) {
        myRequestClients.add(j.client);
      }
    });
  const techsRequestedByName = myRequestClients.size >= 3 ? 1 : 0;

  // HandyKing: how many of the other 11 quests are complete.
  const handyKingProgress = [
    positiveReviews >= 15,
    fiveStarReviews >= 10,
    completedJobs >= 10,
    convertedReferrals >= 1,
    repeatClients >= 1,
    upsellCount >= 1,
    techsRequestedByName >= 1,
    bestTradeCount >= 10,
    bigJobs >= 7,
    zeroCallbackStreak >= 20,
    speedDays >= 1,
  ].filter(Boolean).length;

  const qBonus = (key: string) => questConfig[key]?.bonus ?? QUEST_DEFAULT_BONUSES[key] ?? 0;
  const qEnabled = (key: string) => questConfig[key]?.enabled !== false;

  const mk = (
    key: string, name: string, desc: string, progress: number, goal: number,
    unit: string, tier: string, tierColor: string,
  ): QuestDef | null =>
    qEnabled(key)
      ? { key, name, desc, bonus: "$" + qBonus(key), bonusAmount: qBonus(key), progress, goal, unit, tier, tierColor }
      : null;

  const T1 = "var(--color-primary)";
  const T2 = "var(--color-success)";
  const T3 = "var(--color-warning)";
  const T4 = "var(--color-accent-red)";

  const tiers: QuestTierGroup[] = [
    {
      name: "TIER 1: FOUNDATION",
      color: T1,
      quests: [
        mk("review_favor", "Review Favor", "Collect 15 positive testimonials (3+ stars)", Math.min(positiveReviews, 15), 15, "reviews", "T1", T1),
        mk("five_star", "Five Star Tech", "Collect 10 five-star reviews", Math.min(fiveStarReviews, 10), 10, "5★", "T1", T1),
        mk("super_handy", "Super Handy", "Complete 10 work orders", Math.min(completedJobs, 10), 10, "jobs", "T1", T1),
      ].filter((q): q is QuestDef => !!q),
    },
    {
      name: "TIER 2: GROWTH",
      color: T2,
      quests: [
        mk("network_scout", "Network Scout", "Secure new jobs from clients", convertedReferrals, 1, "secured", "T2", T2),
        mk("critical_referral", "Critical Referral", "Turn 1 client into 5 jobs", Math.min(repeatClients, 1), 1, "client", "T2", T2),
        mk("deal_closer", "Deal Closer", `Upsell on existing jobs — ${upsellCount} logged`, Math.min(upsellCount, 1), 1, "upsells", "T2", T2),
        mk("repeat_machine", "Repeat Machine", `3 distinct clients request YOU by name (${myRequestClients.size} so far)`, Math.min(myRequestClients.size, 3), 3, "clients", "T2", T2),
      ].filter((q): q is QuestDef => !!q),
    },
    {
      name: "TIER 3: MASTERY",
      color: T3,
      quests: [
        mk("skill_mastery", "Skill Mastery", `10 jobs in your best trade${bestTradeCount > 0 ? " — " + Object.entries(jobsByTrade).sort((a, b) => b[1] - a[1]).map(([t, c]) => `${t}: ${c}`).join(", ") : ""}`, Math.min(bestTradeCount, 10), 10, "jobs", "T3", T3),
        mk("make_ready", "Make Ready Pro", "7 unit turns (24+ hrs each)", Math.min(bigJobs, 7), 7, "turns", "T3", T3),
        mk("zero_callback", "Zero Callback", "20 consecutive jobs, no callbacks", Math.min(zeroCallbackStreak, 20), 20, "streak", "T3", T3),
        mk("mr_speed", "Mr.Speed", "5 work orders in one day", Math.min(speedDays, 1), 1, "days", "T3", T3),
      ].filter((q): q is QuestDef => !!q),
    },
    {
      name: "TIER 4: LEGEND",
      color: T4,
      quests: [
        mk("handy_king", "HandyKing", `Complete ALL other quests — ${handyKingProgress}/11 done`, handyKingProgress, 11, "quests", "T4", T4),
      ].filter((q): q is QuestDef => !!q),
    },
  ];

  const allQuests = tiers.flatMap((tr) => tr.quests);

  return {
    tiers,
    allQuests,
    metrics: {
      completedJobs, positiveReviews, fiveStarReviews, convertedReferrals,
      repeatClients, bigJobs, totalHours, bestTradeCount, zeroCallbackStreak,
      speedDays, upsellCount, requestedByNameClients: myRequestClients.size,
      handyKingProgress,
    },
  };
}
