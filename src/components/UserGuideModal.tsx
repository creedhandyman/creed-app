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
          "Operations → Settings: upload your logo, business name, license #, address, phone, email. These appear on every quote, invoice, and printout.",
          "Set your default labor rate, materials markup %, tax %, and any per-trade hourly rates you charge differently.",
          "Operations → Team: add employees with their pay rate so payroll knows what to log when they clock in.",
        ],
      },
      {
        heading: "The five tabs you'll live in",
        lines: [
          "Quote — start a new estimate (camera, voice walk, PDF inspection, or quick form).",
          "Jobs — every quote and active job in one list, sortable by status.",
          "Sched — calendar view of upcoming work.",
          "Time — clock in/out (replaced by Work Vision once a job is active).",
          "Ops — the admin tabs: Payroll, Financials, Customers, Team, Billing, Settings.",
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
          "Voice Walk — narrate as you walk the property, photos auto-attach. AI builds a structured inspection then a quote from it. Best for property-manager turnovers.",
          "Inspector — tap-through checklist by room. Conditions S/F/P/D plus photos. Best when you want to be deliberate.",
          "Quote PDF — upload a customer's existing scope-of-work PDF. AI extracts the line items.",
          "Quick Form — type the items yourself. Best for callbacks where you already know the scope.",
        ],
      },
      {
        heading: "Edit before sending",
        lines: [
          "Add, remove, or tweak any item, hour, or material price. The AI learns from your corrections — same-ZIP corrections weight heaviest.",
          "Tap MAT to open the materials editor for an item. The breakdown of qty × unit price shows on the quote PDF.",
          "Save the job — it lands in Jobs as Quoted.",
        ],
      },
      {
        heading: "Send it",
        lines: [
          "From Jobs, tap the quote → Print PDF or copy the share link. Customers can sign electronically on the link.",
          "When they sign, the job auto-promotes to Accepted and you get the signed PDF saved in their portal.",
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
        heading: "Clock in",
        lines: [
          "Tap Clock In on the dashboard or pick a job from the schedule. Time logs against that specific job (callbacks at the same address won't blend).",
          "Work Vision opens automatically — your in-the-field cockpit.",
        ],
      },
      {
        heading: "Work Vision tabs",
        lines: [
          "Tasks — priority-sorted checklist. Tap a task to expand for materials, notes, before-photos.",
          "Guide — step-by-step instructions grouped by trade with workflow ordering.",
          "Notes — freeform notes that survive into the job report.",
          "Photos — capture before/during/after. They auto-tag and feed the completion report.",
        ],
      },
      {
        heading: "Receipts as you go",
        lines: [
          "Snap a photo of every supply-store receipt. The AI scans line items and feeds them into the quote-learning system, plus your real material cost replaces the charged proxy in your profit math.",
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
          "From Jobs or Work Vision, mark the job Complete when work is done. The job report PDF is generated from your work-order checklist + photos.",
          "Mark Invoiced when you've sent the invoice. Or skip straight to Paid if it was a same-day cash/Zelle job.",
        ],
      },
      {
        heading: "Stripe payments",
        lines: [
          "Connect your Stripe account once under Operations → Billing. After that, the customer's status page (the link you sent earlier) has a Pay button.",
          "When they pay, the job auto-flips to Paid via the Stripe webhook. You don't have to remember.",
        ],
      },
      {
        heading: "Quick review request",
        lines: [
          "After a job goes Complete, the app prompts you to send a review-request SMS. Tap it; their reply links them straight to your Google review page.",
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
        heading: "Operations tabs",
        lines: [
          "Payroll — close out a pay period. Time entries marked paid_at instead of deleted, so Team Stats keeps lifetime history.",
          "Financials — revenue, profit, A/R aging, by-trade breakdown, top clients. Print a P&L for any period.",
          "Customers — full CRM with addresses, history, and one-click portal link generation.",
          "Team — per-tech stats: lifetime hours, jobs, top trades.",
          "Billing — Stripe Connect status and your subscription.",
        ],
      },
      {
        heading: "Customer portal",
        lines: [
          "Generate a magic-link from CustomerDetail → Portal Link. Text/email/copy. They land at /portal — read-only view of their quotes, scheduled work, completed jobs, and downloadable documents.",
        ],
      },
      {
        heading: "Sharing your business card",
        lines: [
          "Dashboard has a card preview. Tap it for the QR + share link. Pulls from your branding settings; share via SMS, native share sheet, or copy.",
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
          "Edit the price/hours on items the AI got wrong, save the job. Future quotes in the same ZIP will weight your corrections.",
          "Set per-trade rates under Settings if your plumbing rate is different from carpentry — the AI uses these for labor.",
        ],
      },
      {
        heading: "Two jobs at the same property",
        lines: [
          "Hours track per job_id, so a callback at an address that already had a prior job won't blend its hours into the original.",
        ],
      },
      {
        heading: "Quotes you're never going to win",
        lines: [
          "From Jobs, archive them. They keep their status (so a restore brings them back unchanged) but disappear from the live funnel.",
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
          <h3 style={{ fontFamily: "Oswald, sans-serif", fontSize: 18, color: "var(--color-primary)", margin: 0, textTransform: "uppercase", letterSpacing: ".05em", display: "inline-flex", alignItems: "center", gap: 8 }}>
            <Icon name="help" size={20} color="var(--color-primary)" />
            User Guide
          </h3>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: "transparent", border: "none",
              color: darkMode ? "#888" : "#555",
              fontSize: 22, lineHeight: 1, cursor: "pointer",
              padding: 4,
            }}
          >
            ×
          </button>
        </div>

        <p className="dim" style={{ fontSize: 12, margin: "0 0 14px", lineHeight: 1.5 }}>
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
                  fontFamily: "Oswald, sans-serif", fontSize: 13,
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
                      <h4 style={{ fontSize: 12, marginBottom: 4, color: "var(--color-primary)", fontFamily: "Oswald, sans-serif", letterSpacing: ".04em" }}>
                        {b.heading}
                      </h4>
                      <ul style={{ paddingLeft: 18, margin: 0, fontSize: 13, lineHeight: 1.55, color: darkMode ? "#ccc" : "#333" }}>
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

        <p className="dim" style={{ fontSize: 11, marginTop: 14, textAlign: "center", lineHeight: 1.5 }}>
          Stuck? Most workflows have built-in tooltips and toasts that explain what just happened. The Troubleshoot screen on the dashboard is your reset button when something looks off.
        </p>
      </div>
    </div>
  );
}
