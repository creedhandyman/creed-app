/**
 * Home page FAQ — ONE source for the visible FAQ (Landing.tsx) and the
 * FAQPage structured data (app/page.tsx), so the two can't drift apart.
 * Answers are plain text (they go into JSON-LD verbatim); `more` adds an
 * on-page link after the answer.
 *
 * Every answer describes shipped behaviour — keep it that way. Plan prices
 * mirror TIERS in src/app/pricing/page.tsx: change both together.
 */
import { TRIAL_DAYS } from "@/lib/trial";

export interface HomeFaq {
  q: string;
  a: string;
  more?: { href: string; label: string };
}

export const HOME_FAQ: HomeFaq[] = [
  {
    q: "What is Creed Handy Manager?",
    a: "An all-in-one app for handyman businesses: AI quoting, scheduling, a crew time clock, payroll, invoicing and card payments. It runs in any browser and installs on your phone's home screen.",
    more: { href: "/features", label: "See every feature" },
  },
  {
    q: "How does the AI quote work?",
    a: "Walk the job and snap photos, talk it through with Voice Walk, or upload an inspection report. The AI writes an itemized quote by trade with labor hours and materials, and it learns your real prices from your edits, receipts and finished jobs.",
  },
  {
    q: "Can customers sign and pay online?",
    a: "Yes. Text or email the customer a link: they review the quote, sign it, and pay a deposit or the balance by card. Offer Good / Better / Best options and they pick one before signing. Payments go to your own Stripe account.",
  },
  {
    q: "Does it work on iPhone and Android?",
    a: "Yes. It runs in the phone's browser and installs to the home screen like an app, with no app store download. Clock-ins and job photos taken without signal sync when you reconnect.",
  },
  {
    q: "How much does it cost?",
    a: `Solo is $24.99 a month for one user, Crew is $59.99 for up to 8 users, and Pro is $149.99 for unlimited users. Every plan starts with a ${TRIAL_DAYS}-day free trial and no card. Solo and Crew add a 0.5% fee on customer payments, capped at $100 a month; Pro has none.`,
    more: { href: "/pricing", label: "Compare plans" },
  },
  {
    q: "Can my crew clock in from their phones?",
    a: "Yes. Techs clock in to a job, see its work order and upload photos from their phones. Hours flow straight to payroll, and you can see who's on the clock at a glance.",
  },
  {
    q: "Is it only for handymen?",
    a: "It's built for handyman and home-repair businesses, and it tailors its defaults for plumbers, electricians, HVAC, painters, flooring, roofers, general contractors and landscapers.",
  },
  {
    q: "Who built it?",
    a: "Creed Handyman LLC, a handyman company in Wichita, Kansas. It was built to run that company's own jobs, and it's used there every day.",
  },
];
