import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Hand-sent texts no longer go through Twilio (owner rule, 2026-11-10).
 *
 * Twilio sends only Creed's AUTOMATIC texts: review requests
 * (/api/reviews/dispatch), visit and invoice reminders (/api/sms/reminders,
 * /api/invoices/reminders), quote follow-ups (/api/quotes/followup), portal
 * login links the customer asks for, crew alerts (lib/notify-server.ts) and
 * the STOP / HELP replies. All of those call lib/sms.ts on the server.
 *
 * Anything a business sends a customer by hand (Send quote, Send invoice, the
 * job text buttons, On the way / Running late / Job done, the portal link and
 * share card texts) opens the phone's own Messages app with the number and
 * the text filled in (lib/job-send.ts `smsHref`).
 *
 * This route used to send those from the business number, including a
 * `{ to, body }` shape that let any signed-in account text any number. It now
 * sends nothing. It stays as a stub so an app that was open before this
 * deploy gets a plain answer (its Open Messages button still works) instead
 * of a 404.
 */
export async function POST() {
  return NextResponse.json(
    { error: "Texts you send yourself now open your phone's Messages app. Use Open Messages." },
    { status: 410 },
  );
}
