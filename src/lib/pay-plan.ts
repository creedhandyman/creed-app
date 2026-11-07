/**
 * What the customer can pay right now on the /status page, and what the button
 * will actually charge — ONE place, used by both the label and the checkout call
 * so they can't disagree.
 *
 *  - Before the work: a deposit (the business's own deposit %, when it takes
 *    deposits) or the whole thing; the deposit is the default.
 *  - After the work (complete / invoiced): it's a bill, so the default is the
 *    whole balance — but when the business takes deposits the customer can still
 *    choose to pay part now. (A completed job used to offer only the full
 *    balance, so a customer on a payment plan lost the deposit button the moment
 *    the job was marked complete.)
 *  - The partial amount is the deposit % of the TOTAL, capped at what's still
 *    owed; once what's left is no more than that, there's nothing to choose
 *    between and only "pay the balance" remains.
 *
 * The server (/api/checkout) re-clamps every amount to the outstanding balance,
 * so this only shapes the offer, never the safety of the charge.
 */
const r2 = (n: number) => Math.round(n * 100) / 100;

export interface PayPlanInput {
  /** The total the customer owes for the option they're on. */
  total: number;
  /** Paid so far (deposits already taken). */
  paid: number;
  /** The business's deposit setting (0 = takes no deposits). */
  orgDepositPct: number;
  /** The job is complete / invoiced: a bill rather than a deposit request. */
  billing: boolean;
  /** The % the customer tapped, or null if they haven't chosen. */
  pick: number | null;
}

export interface PayPlan {
  balanceDue: number;
  /** Percent choices to show, e.g. [50, 100]; a single [100] means no choice. */
  options: number[];
  /** The % in effect (the customer's pick if valid, else the default). */
  pct: number;
  /** What the button charges. */
  amount: number;
  /** What's still owed after this payment. */
  remaining: number;
  /** The partial amount offered (the deposit), capped at the balance. */
  partial: number;
  canChoose: boolean;
}

export function payPlan(i: PayPlanInput): PayPlan {
  const total = Math.max(0, Number(i.total) || 0);
  const paid = Math.max(0, Number(i.paid) || 0);
  const balanceDue = r2(Math.max(0, total - paid));
  const takesDeposits = i.orgDepositPct > 0 && i.orgDepositPct < 100;
  const partial = takesDeposits ? Math.min(r2((total * i.orgDepositPct) / 100), balanceDue) : balanceDue;
  const canChoose = takesDeposits && partial < balanceDue - 0.005;
  const options = canChoose ? [i.orgDepositPct, 100] : [100];
  const defaultPct = !takesDeposits || i.billing ? 100 : i.orgDepositPct;
  const pct =
    i.pick !== null && options.includes(i.pick) ? i.pick
    : options.includes(defaultPct) ? defaultPct
    : 100;
  const amount = pct === 100 ? balanceDue : partial;
  return { balanceDue, options, pct, amount, remaining: r2(Math.max(0, balanceDue - amount)), partial, canChoose };
}
