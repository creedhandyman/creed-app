/**
 * Clock in / clock out — the ONE sequence behind Time (Timer.tsx), Work mode
 * (WorkVision.tsx) and the office's Force clock-out.
 *
 * This module OWNS this phone's clock state in localStorage:
 *   c_t_on            on the clock?
 *   c_t_st            epoch ms the shift started
 *   c_t_sj            the job (address text) clocked into, "" = General
 *   c_t_active_id     the open time_entries row id (stable client id)
 *   c_t_active_job_id the exact job id picked at clock-in
 * Everything else reads it through readLocalClock() — never the raw keys.
 *
 * The rules that must survive (see clock-sync.ts for the why):
 *  - clock-in = a client-id row (newRowId) inserted through the offline queue
 *    (store.saveTimeEntry), then a one-shot GPS stamp, then scheduled → active
 *  - every close is `onlyIfOpen`; the tech's own clock-out is `earlierWins`
 *    (it beats a LATER office close on an unpaid row), an office close
 *    (reason "force") is not — it never shrinks a real one
 *  - markLocalClockOut around our own close so reconcileClock doesn't read it
 *    as the office's; local state goes off the moment the write is queued
 *  - a row already closed elsewhere is never written again, and clocking out
 *    with no open row never posts a second entry
 *  - a shift under MIN_SHIFT_HOURS is removed instead of kept as a 0 h ghost
 *
 * UI stays in the screens: confirms, toasts and the long-shift "when did you
 * finish?" question (passed in as `askFinish`). The data side is injected
 * (`ClockDeps`, built by store.clockDeps()) so this is testable on its own.
 */
import type { Job, TimeEntry } from "./types";
import { isClosedRow, markLocalClockOut, unmarkLocalClockOut } from "./clock-sync";
import { LONG_SHIFT_MS, entryStartMs } from "./shift";
import { entryAmount, roundHours } from "./pay";

// ── Local clock state ──────────────────────────────────────────────────────

export interface LocalClockState {
  on: boolean;
  /** Epoch ms the shift started. */
  st: number | null;
  /** Job (address text) clocked into; "" = General. */
  sj: string;
  activeId: string | null;
  activeJobId: string | null;
}

type KV = Pick<Storage, "getItem" | "setItem">;

const KEYS: Record<keyof LocalClockState, string> = {
  on: "c_t_on",
  st: "c_t_st",
  sj: "c_t_sj",
  activeId: "c_t_active_id",
  activeJobId: "c_t_active_job_id",
};

function store(kv?: KV): KV | null {
  if (kv) return kv;
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}

function get<T>(kv: KV | null, key: string, fallback: T): T {
  if (!kv) return fallback;
  try { const v = kv.getItem(key); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; }
}

/** This phone's clock as stored. Bad / missing values read as off. */
export function readLocalClock(kv?: KV): LocalClockState {
  const s = store(kv);
  const st = get<unknown>(s, KEYS.st, null);
  const sj = get<unknown>(s, KEYS.sj, "");
  const activeId = get<unknown>(s, KEYS.activeId, null);
  const activeJobId = get<unknown>(s, KEYS.activeJobId, null);
  return {
    on: get<unknown>(s, KEYS.on, false) === true,
    st: typeof st === "number" ? st : null,
    sj: typeof sj === "string" ? sj : "",
    activeId: typeof activeId === "string" && activeId ? activeId : null,
    activeJobId: typeof activeJobId === "string" && activeJobId ? activeJobId : null,
  };
}

/** Persist part of the clock (e.g. the Time picker's remembered job). */
export function writeLocalClock(patch: Partial<LocalClockState>, kv?: KV): void {
  const s = store(kv);
  if (!s) return;
  for (const k of Object.keys(patch) as (keyof LocalClockState)[]) {
    try { s.setItem(KEYS[k], JSON.stringify(patch[k] ?? null)); } catch { /* storage full / blocked */ }
  }
}

/** Off the clock: every key cleared (job too). */
export function clearLocalClock(kv?: KV): void {
  writeLocalClock({ on: false, st: null, sj: "", activeId: null, activeJobId: null }, kv);
}

// ── Job resolution ─────────────────────────────────────────────────────────

/** Job statuses the clock-in pickers hide: finished work and pre-quote
 *  inspections aren't clock-into-able. */
export const PICKER_HIDDEN = ["complete", "invoiced", "paid", "inspection"];

/** The jobs a clock-in picker shows. */
export const pickableJobs = (jobs: Job[]): Job[] =>
  jobs.filter((j) => !j.archived && !PICKER_HIDDEN.includes(j.status));

/**
 * The job an address means when two share it (callback work): active >
 * scheduled > accepted > quoted > complete > invoiced > paid, newest wins
 * ties. undefined for General / no match.
 */
export function resolveActiveJobId(jobs: Job[], address: string): string | undefined {
  if (!address || address === "General") return undefined;
  const matches = jobs.filter((j) => j.property === address);
  if (matches.length === 0) return undefined;
  if (matches.length === 1) return matches[0].id;
  const order = ["active", "scheduled", "accepted", "quoted", "complete", "invoiced", "paid", "lead", "inspection"];
  const sorted = [...matches].sort((a, b) => {
    const oa = order.indexOf(a.status);
    const ob = order.indexOf(b.status);
    if (oa !== ob) return oa - ob;
    return (b.created_at || "").localeCompare(a.created_at || "");
  });
  return sorted[0]?.id;
}

/** Clock-in's job: the open jobs the picker shows first — across ALL jobs a
 *  paid or archived job at the address can outrank the open one picked. */
export const resolveClockInJobId = (jobs: Job[], address: string): string | undefined =>
  resolveActiveJobId(pickableJobs(jobs), address) || resolveActiveJobId(jobs, address);

// ── Shared rules ───────────────────────────────────────────────────────────

/** A shift whose 2 dp hours come out below this (under ~18 s) is an
 *  in-and-out; the row is removed. */
export const MIN_SHIFT_HOURS = 0.01;

/** "09:30 AM" — always en-US (a Spanish / en-GB phone's default wrote
 *  "p.m." / 24h stamps that entryStartMs misread). */
export const fmtClockTime = (ts: number): string =>
  new Date(ts).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });

/** Shift length in stored (2 dp) hours. */
export const shiftHours = (startMs: number, endMs: number): number => roundHours((endMs - startMs) / 3600000);

/** The user's most recent OPEN row, by real start time (entry date + 12h
 *  clock), for a clock-out that lost its row id (legacy rows). */
export function latestOpenRow(entries: TimeEntry[], userId: string): TimeEntry | undefined {
  const at = (e: TimeEntry) => entryStartMs(e.entry_date, e.start_time) ?? -Infinity;
  return entries
    .filter((e) => e.user_id === userId && e.start_time && !e.end_time)
    .sort((a, b) => at(b) - at(a))[0];
}

// ── The sequences ──────────────────────────────────────────────────────────

export interface ClockDeps {
  saveTimeEntry: (rowId: string, patch: Record<string, unknown>, mode: "post" | "patch", opts?: { onlyIfOpen?: boolean; earlierWins?: boolean }) => Promise<boolean>;
  dropTimeEntry: (rowId: string, opts?: { onlyIfOpen?: boolean }) => Promise<boolean>;
  /** Current store rows (read fresh — after any optimistic write). */
  timeEntries: () => TimeEntry[];
  /** Row ids with an unsynced time_entries write. */
  pendingRowIds: () => string[];
  /** One-shot GPS fix; null when denied / too slow. */
  getFix: (timeoutMs: number) => Promise<{ lat: number; lng: number; accuracy: number } | null>;
  /** scheduled → active on clock-in. */
  setJobActive: (jobId: string) => Promise<unknown>;
  newRowId: () => string;
  now?: () => number;
  storage?: KV;
}

export interface ClockInArgs {
  /** Address text ("" = General). */
  job: string;
  /** The exact job when the caller knows it (a tapped card / chip). */
  jobId?: string;
  jobs: Job[];
  user: { id: string; name: string };
  /** Called once local state is on (before any network wait). */
  onLocal?: (s: LocalClockState) => void;
}

/** Clock in. Resolves once the row is queued + synced (or queued offline)
 *  and a scheduled job has been promoted. */
export async function clockIn(a: ClockInArgs, d: ClockDeps): Promise<LocalClockState> {
  const startedAt = (d.now ?? Date.now)();
  const jid = a.jobId || resolveClockInJobId(a.jobs, a.job);
  // Stable client id so an offline clock-in + later clock-out reference the
  // SAME row (queued + replayed on reconnect) — clock-out always has a target.
  const id = d.newRowId();
  const local: LocalClockState = { on: true, st: startedAt, sj: a.job, activeId: id, activeJobId: jid ?? null };
  writeLocalClock(local, d.storage);
  a.onLocal?.(local);
  await d.saveTimeEntry(id, {
    job: a.job || "General",
    job_id: jid,
    // en-US (M/D/YYYY) on every phone — parseEntryDate reads a Spanish /
    // en-GB "12/10/2026" as December 10th.
    entry_date: new Date(startedAt).toLocaleDateString("en-US"),
    hours: 0,
    amount: 0,
    user_id: a.user.id,
    user_name: a.user.name,
    start_time: fmtClockTime(startedAt),
    // end_time intentionally omitted — presence of end_time == finished
  }, "post");
  // GPS stamp — fire-and-forget; never blocks or delays clock-in.
  void d.getFix(8000).then((fix) => {
    if (fix) void d.saveTimeEntry(id, { start_lat: fix.lat, start_lng: fix.lng, start_acc: fix.accuracy }, "patch");
  }).catch(() => { /* no fix */ });
  // scheduled → active (never flips finished work backwards). The exact job
  // wins when known; otherwise a scheduled job at the address.
  const promote = jid
    ? a.jobs.find((j) => j.id === jid && j.status === "scheduled")
    : a.job ? a.jobs.find((j) => j.property === a.job && j.status === "scheduled") : undefined;
  if (promote) await d.setJobActive(promote.id);
  return local;
}

export type ClockOutResult =
  /** Nothing to do (this phone isn't on the clock / no shift given). */
  | { status: "not-on" }
  /** The long-shift finish-time question was cancelled — still on. */
  | { status: "cancelled" }
  /** Closed or removed elsewhere (office / another phone), or no open row
   *  could be found — local clock reset, nothing written. Tell the user. */
  | { status: "already-closed" }
  /** Force-out on a row with no readable start (or no time on it yet). */
  | { status: "no-start" }
  /** In-and-out under MIN_SHIFT_HOURS — the row was removed. */
  | { status: "dropped" }
  /** `landed` false = it turned out closed elsewhere (the store toasted and
   *  the server kept its times). */
  | { status: "closed"; rowId: string; hours: number; landed: boolean };

export interface ClockOutArgs {
  /** "self" = this phone's own shift (local clock); "force" = the office
   *  closing someone's open row (`entry`). */
  reason: "self" | "force";
  entry?: TimeEntry;
  /** Whose shift — their rate prices the amount (0 with no rate). Self: the
   *  signed-in user; force: the row's person. */
  person: { id: string; rate?: number | null };
  /** Finish time already picked (skips the long-shift question). */
  endAt?: number;
  /** Long-shift question: resolves the real finish, or null to cancel. */
  askFinish?: (startMs: number) => Promise<number | null>;
  /** Self only: called the moment local state goes off (write queued). */
  onOff?: () => void;
}

export async function clockOut(a: ClockOutArgs, d: ClockDeps): Promise<ClockOutResult> {
  const now = (d.now ?? Date.now)();
  if (a.reason === "force") {
    const e = a.entry;
    if (!e) return { status: "not-on" };
    const startMs = entryStartMs(e.entry_date, e.start_time);
    let endAt = a.endAt ?? now;
    if (a.endAt === undefined && startMs !== null && now - startMs >= LONG_SHIFT_MS && a.askFinish) {
      const picked = await a.askFinish(startMs);
      if (picked === null) return { status: "cancelled" };
      endAt = picked;
    }
    // Hours from the entry's real start (handles overnight) — never a 0 /
    // negative guess written over a shift.
    const hours = startMs !== null ? shiftHours(startMs, endAt) : 0;
    if (!(hours >= MIN_SHIFT_HOURS)) return { status: "no-start" };
    // An office close: onlyIfOpen, NOT earlierWins (never shrinks a real one).
    const landed = await d.saveTimeEntry(e.id, {
      hours, amount: entryAmount(hours, a.person), end_time: fmtClockTime(endAt),
    }, "patch", { onlyIfOpen: true });
    return { status: "closed", rowId: e.id, hours, landed };
  }

  const local = readLocalClock(d.storage);
  if (!local.on) return { status: "not-on" };
  const { activeId, st } = local;
  const goOff = () => { clearLocalClock(d.storage); a.onOff?.(); };
  // Already closed elsewhere (manager force clock-out / another phone) and
  // nothing of ours is waiting to sync → keep their times, just stop here.
  const mine = activeId ? d.timeEntries().find((e) => e.id === activeId) : undefined;
  if (activeId && isClosedRow(mine) && !d.pendingRowIds().includes(activeId)) {
    goOff();
    return { status: "already-closed" };
  }
  // Forgotten clock-out → ask when they actually finished.
  let endAt = a.endAt ?? now;
  if (a.endAt === undefined && st !== null && now - st >= LONG_SHIFT_MS && a.askFinish) {
    const picked = await a.askFinish(st);
    if (picked === null) return { status: "cancelled" };
    endAt = picked;
  }
  const hours = st !== null ? shiftHours(st, endAt) : 0;
  if (hours < MIN_SHIFT_HOURS) {
    // In-and-out: remove the open row rather than keep a zero-hour ghost.
    if (!activeId) { goOff(); return { status: "dropped" }; }
    markLocalClockOut(activeId);
    try {
      const write = d.dropTimeEntry(activeId, { onlyIfOpen: true });
      goOff();
      await write;
    } finally { unmarkLocalClockOut(activeId); }
    return { status: "dropped" };
  }
  // activeId lost (legacy row from before stable ids) → close this user's
  // most recent open row. Never post a second entry — that leaves the
  // original open row showing "still active".
  const rowId = activeId || latestOpenRow(d.timeEntries(), a.person.id)?.id || null;
  if (!rowId) { goOff(); return { status: "already-closed" }; }
  markLocalClockOut(rowId);
  try {
    // earlierWins: the tech's own tap — if the office closed the shift LATER
    // (more hours) while this sat queued, the real time wins.
    const write = d.saveTimeEntry(rowId, {
      hours, amount: entryAmount(hours, a.person), end_time: fmtClockTime(endAt), job: local.sj || "General",
    }, "patch", { onlyIfOpen: true, earlierWins: true });
    // Off the clock NOW — the write is already queued (durable); only its
    // sync is awaited, so a slow signal never leaves the button stuck.
    goOff();
    const landed = await write;
    if (landed) {
      void d.getFix(8000).then((fix) => {
        if (fix) void d.saveTimeEntry(rowId, { end_lat: fix.lat, end_lng: fix.lng, end_acc: fix.accuracy }, "patch");
      }).catch(() => { /* no fix */ });
    }
    return { status: "closed", rowId, hours, landed };
  } finally {
    unmarkLocalClockOut(rowId);
  }
}
