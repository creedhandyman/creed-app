"use client";
/**
 * In-app user guide. Opens from the help button next to the dashboard
 * settings gear. Plain-text walkthrough of the daily workflow — no
 * external docs site, no PDFs to keep in sync. Edit copy here when the
 * app's flow changes so the guide doesn't drift.
 *
 * Audience: a contractor or tech who's never used the app. Sections
 * follow the natural order of a job (quote → schedule → work → bill →
 * paid) so a new user can read top-to-bottom.
 */
import { useState } from "react";
import Grizz from "./Grizz";
import { useStore } from "@/lib/store";
import { Icon, type IconName } from "./Icon";

interface Props {
  onClose: () => void;
}

interface Section {
  id: string;
  icon: IconName;
  title: string;
  body: { heading: string; lines: string[] }[];
}

const SECTIONS: Section[] = [
  {
    id: "start",
    icon: "rocket",
    title: "Getting Started",
    body: [
      {
        heading: "Set up your business once",
        lines: [
          "More → Settings → Brand: upload your logo, business name, license #, address, phone, email. These appear on every quote, invoice, and PDF.",
          "Set your default labor rate, materials markup %, and tax % there too. Per-trade hourly overrides live under each trade.",
          "More → Operations → Team: add employees with their pay rate so payroll knows what to log when they clock in.",
        ],
      },
      {
        heading: "The nav bar",
        lines: [
          "Quote — start a new estimate from three options: Quick Quote, Full Inspection, or Upload Report.",
          "Jobs — every quote and active job in one list. Tap a card to open the full detail screen.",
          "Home — your dashboard: next job, money snapshot, and quick actions.",
          "Time — clock in/out. Once clocked in, this becomes WorkVision — your in-field cockpit.",
          "More — Schedule, Quests, Operations, Customers, Mileage, Settings, and Help all live here.",
        ],
      },
    ],
  },
  {
    id: "quote",
    icon: "quote",
    title: "Building a Quote",
    body: [
      {
        heading: "Three ways to start",
        lines: [
          "Quick Quote — type in what needs doing (or snap a photo) and the AI prices it instantly. Best for callbacks where you already know the scope.",
          "Full Inspection — tap through each room, mark conditions, attach photos. Inside, hit Voice Walk to narrate damage out loud — AI listens and fills in every item automatically. Best for walk-throughs and property-manager turnovers.",
          "Upload Report — paste in a customer's existing scope-of-work PDF and the AI pulls the line items straight out.",
        ],
      },
      {
        heading: "Edit before sending",
        lines: [
          "Adjust any item, hour count, or material price. The AI learns from every edit — same-ZIP corrections weight heaviest so it gets sharper on your market.",
          "Tap MAT on an item to open the materials editor. The qty × unit breakdown prints on the quote PDF.",
          "Hit the Render button in the action bar to generate an AI before/after visual from your quote's scope — attach it to impress clients.",
          "Save → job lands in Jobs as Quoted.",
        ],
      },
      {
        heading: "Send it",
        lines: [
          "From the action bar tap PDF to print, or Send to copy the customer status link.",
          "Customers open the link, review the scope, and tap Approve & Sign. The job auto-promotes to Accepted and the signed PDF saves to their portal.",
        ],
      },
    ],
  },
  {
    id: "work",
    icon: "worker",
    title: "Working a Job",
    body: [
      {
        heading: "Schedule it first",
        lines: [
          "Open Schedule (More → Schedule) and tap Dispatch. Every accepted and quoted job that hasn't been put on the calendar shows here.",
          "Tap Assign on any job to pick a date and crew — it drops onto the calendar and notifies the assigned tech.",
        ],
      },
      {
        heading: "Clock in",
        lines: [
          "Tap Clock In on the dashboard or pick a job from Today's schedule chip. Time logs against that specific job — callbacks at the same address won't mix up hours.",
          "WorkVision opens automatically once you're on the clock.",
        ],
      },
      {
        heading: "WorkVision tabs",
        lines: [
          "Tasks — checklist grouped by trade. Tap a task to snap a photo of your progress.",
          "Guide — step-by-step instructions with a live shopping list you can check off and edit as you go.",
          "Notes — freeform field notes that print on the completion report.",
          "Photos — before/work/after. Tap the sparkle button on any photo to generate an AI after-render.",
        ],
      },
      {
        heading: "Receipts as you go",
        lines: [
          "Snap every supply-store receipt in WorkVision → Photos → Scan receipt. The AI reads the line items, feeds them into the quote-learning system, and replaces the estimated material cost with your real cost in the profit math.",
        ],
      },
    ],
  },
  {
    id: "bill",
    icon: "money",
    title: "Getting Paid",
    body: [
      {
        heading: "Mark complete",
        lines: [
          "Tap Complete Job at the bottom of the WorkVision Tasks tab, or flip the status in Jobs. A completion report PDF is generated from your checklist and photos.",
          "Mark Invoiced when you send the bill, or skip straight to Paid for same-day cash or Zelle jobs.",
        ],
      },
      {
        heading: "Stripe payments",
        lines: [
          "Connect Stripe once under More → Operations → Billing. The customer's status-link page then shows a Pay button.",
          "When they pay, the job auto-flips to Paid via the Stripe webhook — you don't have to touch it.",
        ],
      },
      {
        heading: "Automatic review request",
        lines: [
          "Once a job hits Paid, the app auto-schedules a review-request text for 24 hours later (configurable in Ops → Settings → Review Automation).",
          "The text links straight to your Google review page. You can also trigger one manually from the job's Manage section.",
        ],
      },
    ],
  },
  {
    id: "ops",
    icon: "ops",
    title: "Running the Business",
    body: [
      {
        heading: "Operations hub",
        lines: [
          "More → Operations opens a tile grid. Tap any tile to go deep: Payroll, Financials, Customers, Recurring, HR, Team, Billing, Settings.",
          "Payroll — run pay for your crew. Time entries are marked paid (not deleted) so Team Stats keeps lifetime history.",
          "Financials — revenue, profit, A/R aging, by-trade breakdown, top clients. Print a P&L for any period.",
          "HR — approve time-off requests, adjust PTO and sick balances per employee.",
          "Recurring — set up automated service schedules (weekly, monthly, etc.) that fire new jobs on their own.",
        ],
      },
      {
        heading: "Quests & bonuses",
        lines: [
          "More → Quests shows your active missions: review targets, referral goals, completion streaks. Finishing quests unlocks cash bonuses that pay out through payroll.",
          "The Team leaderboard ranks everyone by quest earnings for the cycle — healthy competition.",
        ],
      },
      {
        heading: "Notifications",
        lines: [
          "The bell on the dashboard shows new job assignments and incoming leads. Tap a notification to jump straight to that job.",
          "Turn on push alerts in the notification panel so you get pinged even when the app is closed (requires installing Creed to your home screen on iOS).",
        ],
      },
      {
        heading: "Customer portal & business card",
        lines: [
          "Generate a portal magic-link from Customers → any client → Portal Link. They see their quotes, scheduled work, completed jobs, and can download documents.",
          "Your digital business card lives on the dashboard — tap it for the QR code and share link.",
        ],
      },
    ],
  },
  {
    id: "tips",
    icon: "tip",
    title: "Tips & Troubleshooting",
    body: [
      {
        heading: "AI quotes feel off",
        lines: [
          "Edit the price or hours on items the AI got wrong, then save. Future quotes in the same ZIP code will weight your corrections — it learns fast.",
          "Set per-trade rates under Ops → Settings if your plumbing rate differs from your carpentry rate; the AI uses these for labor.",
        ],
      },
      {
        heading: "Scheduling unassigned jobs",
        lines: [
          "If a job isn't showing on the calendar, go to Schedule → Dispatch. All accepted/quoted jobs without a date pool here — tap Assign to place them.",
        ],
      },
      {
        heading: "Two jobs at the same property",
        lines: [
          "Hours track per job, not per address, so a callback at a property that already had a prior job won't mix up the history.",
        ],
      },
      {
        heading: "Crew activity looks wrong",
        lines: [
          "If someone shows as clocked in but they're not, check for an open time entry from a previous day. You can close it manually from Time → Crew → their card → Force clock out.",
        ],
      },
      {
        heading: "Quotes you're never going to win",
        lines: [
          "From Jobs, archive them. They keep their status so a restore brings them back unchanged, but they disappear from the live funnel.",
        ],
      },
    ],
  },
];

export default function UserGuideModal({ onClose }: Props) {
  const darkMode = useStore((s) => s.darkMode);
  const [openId, setOpenId] = useState<string | null>("start");

  return (
    <div
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="User guide"
      style={{
        position: "fixed", inset: 0, zIndex: 999,
        background: "rgba(0,0,0,.7)",
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        padding: 16, overflowY: "auto",
        paddingTop: "max(24px, env(safe-area-inset-top))",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: 540,
          background: darkMode ? "var(--color-card-dark)" : "var(--color-card-light)",
          border: `1px solid ${darkMode ? "var(--color-border-dark)" : "var(--color-border-light)"}`,
          borderRadius: 14,
          padding: 16,
          maxHeight: "calc(100vh - 32px)",
          overflowY: "auto",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h3 style={{ fontFamily: "Oswald, sans-serif", fontSize: 20, color: "var(--color-primary)", margin: 0, textTransform: "uppercase", letterSpacing: ".05em", display: "inline-flex", alignItems: "center", gap: 8 }}>
            <Grizz pose="point" size={28} />
            Ask Grizz
          </h3>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: "transparent", border: "none",
              color: darkMode ? "#888" : "#555",
              fontSize: 24, lineHeight: 1, cursor: "pointer",
              padding: 4,
            }}
          >
            ×
          </button>
        </div>

        <p className="dim" style={{ fontSize: 14, margin: "0 0 14px", lineHeight: 1.5 }}>
          A quick walkthrough of the app, in the order you'll use it on a real job. Tap any section to expand.
        </p>

        {SECTIONS.map((sec) => {
          const open = openId === sec.id;
          return (
            <div
              key={sec.id}
              style={{
                marginBottom: 8,
                border: `1px solid ${darkMode ? "var(--color-border-dark)" : "var(--color-border-light)"}`,
                borderRadius: 10,
                overflow: "hidden",
              }}
            >
              <button
                onClick={() => setOpenId(open ? null : sec.id)}
                style={{
                  display: "flex", width: "100%",
                  alignItems: "center", justifyContent: "space-between", gap: 8,
                  padding: "10px 12px",
                  background: open ? "var(--color-primary)" + "15" : "transparent",
                  border: "none", cursor: "pointer",
                  color: "inherit", textAlign: "left",
                  fontFamily: "Oswald, sans-serif", fontSize: 15,
                  textTransform: "uppercase", letterSpacing: ".05em",
                }}
              >
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  <Icon name={sec.icon} size={16} color="var(--color-primary)" />
                  {sec.title}
                </span>
                <Icon name={open ? "collapse" : "expand"} size={14} color="#888" />
              </button>
              {open && (
                <div style={{ padding: "4px 14px 14px" }}>
                  {sec.body.map((b) => (
                    <div key={b.heading} style={{ marginTop: 10 }}>
                      <h4 style={{ fontSize: 14, marginBottom: 4, color: "var(--color-primary)", fontFamily: "Oswald, sans-serif", letterSpacing: ".04em" }}>
                        {b.heading}
                      </h4>
                      <ul style={{ paddingLeft: 18, margin: 0, fontSize: 15, lineHeight: 1.55, color: darkMode ? "#ccc" : "#333" }}>
                        {b.lines.map((line, i) => (
                          <li key={i} style={{ marginBottom: 4 }}>{line}</li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        <p className="dim" style={{ fontSize: 13, marginTop: 14, textAlign: "center", lineHeight: 1.5 }}>
          Stuck? Most workflows have built-in tooltips and toasts that explain what just happened. The Troubleshoot screen on the dashboard is your reset button when something looks off.
        </p>
      </div>
    </div>
  );
}
