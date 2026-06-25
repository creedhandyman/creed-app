/**
 * Shared payroll-run logic — used by both the manual "Run Payroll"
 * button in Payroll.tsx AND the Vercel cron at /api/payroll/auto-run.
 *
 * The pure parts (loading unpaid time_entries, computing hrs/pay,
 * building the stub HTML, writing pay_history + marking paid_at +
 * recording quest_payouts) live here so the cron endpoint doesn't
 * have to duplicate them. Payroll.tsx still owns the UI bits
 * (confirmation modal, toast, quest approval checkboxes).
 *
 * Concurrency: the helper claims unpaid entries atomically by
 * issuing an UPDATE ... WHERE paid_at IS NULL and reading back the
 * rows that were actually claimed. Two parallel invocations cannot
 * both pay the same entry — only one update sees the row in its
 * pre-NULL state. This is what makes the cron endpoint safe against
 * double-fire (Vercel cron retries, manual re-trigger overlapping
 * with the scheduled run, etc.).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { wrapPrint } from "./print-template";
import { isHex } from "./brand";

export type StubJob = { job: string; hrs: number; amount: number };
export type StubBonus = { name: string; amount: number };

export interface StubInput {
  empName: string;
  empNum: string;
  rate: number;
  payDate: string;            // human label, e.g. "Apr 30, 2026"
  stubNum: string;            // PS-XXXXXX
  totalHrs: number;
  laborPay: number;
  totalBonus: number;
  totalPay: number;
  jobs: StubJob[];
  bonuses: StubBonus[];
  org: {
    name?: string; phone?: string; email?: string;
    address?: string; license_num?: string; logo_url?: string;
    brand_color?: string; brand_color_2?: string;
  };
}

/** Pure builder for the pay-stub HTML. Same renderer used at process-pay
 *  time (frozen into pay_history.details.stubHtml) AND when rebuilding
 *  legacy pay_history rows whose details predate the snapshot field. */
export function buildStubHtml(s: StubInput): string {
  const accent = isHex(s.org.brand_color) ? s.org.brand_color : "#2E75B6";
  const esc = (x: string) =>
    String(x ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const jobRows = s.jobs
    .map((j) =>
      `<tr><td>${esc(j.job)}</td><td class="r">${j.hrs.toFixed(2)}</td><td class="r">$${j.amount.toFixed(2)}</td></tr>`,
    )
    .join("");
  const bonusRows = s.bonuses
    .map((b) =>
      `<tr><td><span style="color:#9d4edd;font-weight:600">★ ${esc(b.name)}</span></td><td class="r dim">Bonus</td><td class="r">$${b.amount.toFixed(2)}</td></tr>`,
    )
    .join("");

  const body = `
<section style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:20px">
  <div class="box">
    <div class="label">Employee</div>
    <div class="value">${esc(s.empName)}</div>
  </div>
  <div class="box">
    <div class="label">Employee #</div>
    <div class="value">${esc(s.empNum || "—")}</div>
  </div>
  <div class="box">
    <div class="label">Hourly Rate</div>
    <div class="value">$${s.rate}/hr</div>
  </div>
</section>

<h2>Earnings Detail</h2>
<table>
  <thead>
    <tr>
      <th>Job / Item</th>
      <th class="r" style="width:90px">Hours</th>
      <th class="r" style="width:110px">Amount</th>
    </tr>
  </thead>
  <tbody>
    ${jobRows || '<tr><td colspan="3" class="dim">No labor entries</td></tr>'}
    ${bonusRows}
  </tbody>
</table>

<section style="background:linear-gradient(135deg,#f0f4f8 0%,#e8eef5 100%);border-radius:10px;padding:18px 22px;margin:18px 0;border-left:4px solid ${accent}">
  <div style="display:flex;justify-content:space-between;font-size:13px;padding:3px 0">
    <span class="muted">Total Hours</span><span style="font-family:Oswald,sans-serif">${s.totalHrs.toFixed(2)}</span>
  </div>
  <div style="display:flex;justify-content:space-between;font-size:13px;padding:3px 0">
    <span class="muted">Labor (${s.totalHrs.toFixed(2)} × $${s.rate}/hr)</span><span style="font-family:Oswald,sans-serif">$${s.laborPay.toFixed(2)}</span>
  </div>
  ${s.totalBonus > 0 ? `<div style="display:flex;justify-content:space-between;font-size:13px;padding:3px 0;color:#9d4edd"><span>★ Quest Bonuses (${s.bonuses.length})</span><span style="font-family:Oswald,sans-serif">$${s.totalBonus.toFixed(2)}</span></div>` : ""}
  <div style="display:flex;justify-content:space-between;align-items:center;border-top:2px solid ${accent};margin-top:10px;padding-top:12px">
    <span style="font-family:Oswald,sans-serif;font-size:13px;text-transform:uppercase;letter-spacing:.1em;color:${accent}">Net Pay</span>
    <span style="font-family:Oswald,sans-serif;font-size:28px;font-weight:700;color:${accent}">$${s.totalPay.toFixed(2)}</span>
  </div>
</section>

<div style="font-size:10.5px;color:#888;margin-top:12px;line-height:1.6">
  <p>This statement reflects gross earnings only. It is not an official tax document. For tax purposes, refer to your W-2 or 1099.</p>
</div>
`;

  return wrapPrint(
    {
      orgName: s.org.name || "Service Provider",
      orgPhone: s.org.phone,
      orgEmail: s.org.email,
      orgAddress: s.org.address,
      orgLicense: s.org.license_num,
      orgLogo: s.org.logo_url,
      accent,
      accent2: s.org.brand_color_2 || undefined,
      docTitle: "Pay Stub",
      docNumber: s.stubNum,
      docDate: s.payDate,
      docSubtitle: s.empName,
    },
    body,
  );
}

export interface ApprovedBonus {
  key: string;
  name: string;
  bonus: number;
}

export interface RunPayrollOpts {
  supabase: SupabaseClient;
  orgId: string;
  userId: string;
  userName: string;
  rate: number;
  empNum?: string;
  /** ISO timestamp to stamp on each paid time_entries row. Defaults
   *  to "now" — passing it explicitly is useful when the cron wants
   *  every per-user run in a batch to share the same paid_at. */
  paidAt?: string;
  /** Bonuses the admin has explicitly approved for this pay cycle.
   *  Auto-run MUST pass [] here — pending quests stay pending until a
   *  human reviews them in the Payroll UI. Only approved bonuses
   *  insert a quest_payouts row and roll into total pay. */
  approvedBonuses?: ApprovedBonus[];
  /** Org branding for the stub HTML. */
  org?: StubInput["org"];
  /** If true, the claim query also captures unpaid entries with
   *  user_id IS NULL whose user_name matches userName. Used by the
   *  manual Payroll.tsx flow to keep legacy entries (pre user_id
   *  column) reachable by their owner. Auto-run leaves this false to
   *  avoid attributing nameless entries to the wrong profile when
   *  two profiles share a display name. */
  includeLegacyNameMatch?: boolean;
}

export interface RunPayrollResult {
  ok: boolean;
  /** True when there were no unpaid entries to process. Not an error —
   *  the cron skips these orgs/users cleanly. */
  skipped?: boolean;
  reason?: string;
  payHistoryId?: string;
  entriesPaid: number;
  totalHrs: number;
  laborPay: number;
  totalBonus: number;
  totalPay: number;
  error?: string;
}

interface TimeEntryRow {
  id: string;
  job?: string | null;
  hours?: number | null;
  user_id?: string | null;
  user_name?: string | null;
  org_id?: string | null;
  paid_at?: string | null;
}

interface PayHistoryRow {
  id: string;
}

/**
 * Claim every unpaid time_entries row for this user and turn them
 * into a single pay_history row. Returns a summary. Never throws —
 * errors surface via the `error` field on the result.
 */
export async function runPayrollForUser(opts: RunPayrollOpts): Promise<RunPayrollResult> {
  const {
    supabase,
    orgId,
    userId,
    userName,
    rate,
    empNum,
    paidAt: paidAtIn,
    approvedBonuses,
    org,
    includeLegacyNameMatch,
  } = opts;

  const paidAt = paidAtIn || new Date().toISOString();
  const bonuses = approvedBonuses || [];

  // 1. Atomic claim. UPDATE ... RETURNING gives us the rows that were
  // unpaid *at the instant we wrote* — a second concurrent run will
  // get back an empty array since paid_at is no longer NULL.
  //
  // org_id scoping: the cron path runs with the service role key (RLS
  // bypassed) and MUST filter by org_id to avoid touching other orgs.
  // The manual path runs with the anon key and relies on RLS to scope
  // — so we skip the explicit filter there to keep legacy rows with
  // NULL org_id reachable (Payroll.tsx pre-refactor never filtered).
  let claimQuery = supabase
    .from("time_entries")
    .update({ paid_at: paidAt })
    .is("paid_at", null);

  if (!includeLegacyNameMatch) {
    claimQuery = claimQuery.eq("org_id", orgId);
  }

  if (includeLegacyNameMatch) {
    // PostgREST OR syntax — either user_id matches, OR user_id is null
    // AND user_name matches (the legacy fallback). Escape user_name so
    // commas / parens / quotes inside the name don't break the filter.
    const escapedName = String(userName).replace(/"/g, '\\"');
    claimQuery = claimQuery.or(
      `user_id.eq.${userId},and(user_id.is.null,user_name.eq."${escapedName}")`,
    );
  } else {
    claimQuery = claimQuery.eq("user_id", userId);
  }

  const { data: claimed, error: claimErr } = await claimQuery.select();

  if (claimErr) {
    return {
      ok: false,
      entriesPaid: 0,
      totalHrs: 0,
      laborPay: 0,
      totalBonus: 0,
      totalPay: 0,
      error: claimErr.message,
    };
  }

  const entries = (claimed as TimeEntryRow[] | null) || [];
  if (entries.length === 0) {
    return {
      ok: true,
      skipped: true,
      reason: "no unpaid entries",
      entriesPaid: 0,
      totalHrs: 0,
      laborPay: 0,
      totalBonus: 0,
      totalPay: 0,
    };
  }

  const totalHrs = entries.reduce((s, e) => s + (Number(e.hours) || 0), 0);
  const laborPay = totalHrs * rate;
  const totalBonus = bonuses.reduce((s, b) => s + (b.bonus || 0), 0);
  const totalPay = laborPay + totalBonus;

  const byJob: Record<string, number> = {};
  for (const e of entries) {
    const k = (e.job as string) || "General";
    byJob[k] = (byJob[k] || 0) + (Number(e.hours) || 0);
  }
  const jobs: StubJob[] = Object.entries(byJob).map(([job, hrs]) => ({
    job,
    hrs,
    amount: parseFloat((hrs * rate).toFixed(2)),
  }));

  const now = new Date();
  const payDateLabel = now.toLocaleDateString("en-US", {
    year: "numeric", month: "long", day: "numeric",
  });
  const payDateShort = now.toLocaleDateString("en-US");
  const stubNum = "PS-" + Date.now().toString(36).toUpperCase().slice(-6);

  const stubInput: StubInput = {
    empName: userName,
    empNum: empNum || "",
    rate,
    payDate: payDateLabel,
    stubNum,
    totalHrs,
    laborPay,
    totalBonus,
    totalPay,
    jobs,
    bonuses: bonuses.map((b) => ({ name: b.name, amount: b.bonus })),
    org: org || {},
  };
  const stubHtml = buildStubHtml(stubInput);

  // 2. Insert the pay_history row. If this fails, the claim above
  // has already stamped paid_at — try to roll it back so the entries
  // re-appear in the next pay cycle (better than silently swallowing
  // the loss).
  const { data: phInserted, error: phErr } = await supabase
    .from("pay_history")
    .insert({
      org_id: orgId,
      user_id: userId,
      name: userName,
      pay_date: payDateShort,
      hours: totalHrs,
      amount: totalPay,
      entries: entries.length,
      details: JSON.stringify({
        jobs,
        bonuses: bonuses.map((b) => ({ name: b.name, amount: b.bonus })),
        rate,
        stubNum,
        stubHtml,
      }),
    })
    .select()
    .single();

  if (phErr) {
    await supabase
      .from("time_entries")
      .update({ paid_at: null })
      .in("id", entries.map((e) => e.id));
    return {
      ok: false,
      entriesPaid: 0,
      totalHrs,
      laborPay,
      totalBonus,
      totalPay,
      error: `pay_history insert failed: ${phErr.message}`,
    };
  }

  // 3. Record quest payouts for the approved bonuses (if any).
  // Auto-run passes [], so this loop is a no-op for the cron path.
  for (const q of bonuses) {
    await supabase.from("quest_payouts").insert({
      org_id: orgId,
      user_id: userId,
      quest_key: q.key,
      bonus_amount: q.bonus,
      paid_date: payDateShort,
    });
  }

  return {
    ok: true,
    payHistoryId: (phInserted as PayHistoryRow | null)?.id,
    entriesPaid: entries.length,
    totalHrs,
    laborPay,
    totalBonus,
    totalPay,
  };
}
