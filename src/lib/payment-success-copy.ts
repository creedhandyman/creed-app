/**
 * What /payment/success says after Stripe sends the customer back.
 *
 * Kept as a pure helper so the wording rules are tested:
 * - A remaining balance on a job whose work is done is due now, not "when the
 *   work is complete".
 * - When the page can't confirm the payment it never says the card went
 *   through: Stripe not showing it paid reads as not completed, anything else
 *   (our save failed, no connection) reads as still being confirmed.
 * - A bank transfer (pending) is started, not received: it says the money is
 *   on its way and not to pay again.
 * - A tip is thanked separately and never counted toward the invoice.
 */
export interface SuccessCopyInput {
  /** The verify call failed. notPaid = Stripe says the session isn't paid. */
  error?: { notPaid: boolean } | null;
  result?: {
    paidNow?: number;
    balance?: number;
    fullyPaid?: boolean;
    /** The job's work is finished (complete / invoiced / paid). */
    workDone?: boolean;
    /** A bank transfer that hasn't cleared yet. */
    pending?: boolean;
    /** Tip on this payment, in dollars (0/absent = none). */
    tipPaid?: number;
  } | null;
}

export interface SuccessCopy {
  title: string;
  body: string;
  tone: string;
  icon: string;
}

const money = (n?: number) => `$${(Number(n) || 0).toFixed(2)}`;

/** Job statuses where the work is finished, matching the /status page's billing view. */
export function isWorkDone(status?: string | null): boolean {
  return status === "complete" || status === "invoiced" || status === "paid";
}

export function paymentSuccessCopy({ error, result }: SuccessCopyInput): SuccessCopy {
  if (error) {
    if (error.notPaid) {
      return {
        title: "Payment not completed",
        body: "This payment didn't go through, so nothing was added to your invoice. You can try again from your job page, or contact us if you think this is wrong.",
        tone: "#ffb15e",
        icon: "!",
      };
    }
    return {
      title: "Confirming your payment",
      body: "We couldn't confirm your payment just yet. Please don't pay again: your job page will update once it's confirmed. Contact us if it still shows unpaid tomorrow.",
      tone: "#ffb15e",
      icon: "!",
    };
  }
  if (result) {
    const tip = Number(result.tipPaid) || 0;
    if (result.pending) {
      const tipNote = tip > 0.004 ? `, plus your ${money(tip)} tip,` : "";
      return {
        title: "Bank payment started",
        body: `Thank you! Your bank payment of ${money(result.paidNow)}${tipNote} is on its way. It usually clears in about 4 business days, and your job page updates when it does. Please don't pay again.`,
        tone: "#8cc0ff",
        icon: "✓",
      };
    }
    const tipThanks = tip > 0.004 ? ` Thanks also for the ${money(tip)} tip!` : "";
    if (result.fullyPaid) {
      return {
        title: "Paid in full",
        body: `Thank you! We received ${money(result.paidNow)} and your invoice is paid in full.${tipThanks}`,
        tone: "#00cc66",
        icon: "✓",
      };
    }
    const due = result.workDone ? "due now" : "due when the work is complete";
    return {
      title: "Payment received",
      body: `Thank you! We received ${money(result.paidNow)}. Remaining balance: ${money(result.balance)}, ${due}.${tipThanks}`,
      tone: "#00cc66",
      icon: "✓",
    };
  }
  return {
    title: "Confirming your payment…",
    body: "One moment while we confirm it with the bank.",
    tone: "#8cc0ff",
    icon: "…",
  };
}
