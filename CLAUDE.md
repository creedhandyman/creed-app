# Creed App — Notes for Claude

If you're a fresh Claude session opening this repo, read this first. It's
the handoff doc, not user-facing copy.

## What this is

A Next.js 15 + React 19 + TypeScript app for handyman / field-service
crews. Multi-tenant. Customers run quotes, schedule, clock in, get paid
via Stripe. Backend is Supabase (Postgres + Auth + Storage + RLS).
Hosted on Vercel (**Pro** plan) — `main` auto-deploys. All 3
`vercel.json` crons run, including the **hourly** `reviews/dispatch`:
Hobby caps cron frequency at once/day (an hourly schedule fails the
build), so hourly needs Pro. The old 2-cron Hobby *count* cap was
removed Jan 2026 (now 100/project on every plan), so the count is a
non-issue regardless of plan.

## Where things live

```
src/
  app/                    Next.js routes
    api/                  Server routes (Stripe, AI, billing, verify-payment)
    payment/success/      Post-Stripe redirect (server-verifies the session)
    status/, review/, s/  Public pages
  components/
    Icon.tsx              Lucide icon wrapper — single source of truth
    AppShell.tsx          Top-level page router for the logged-in app
    VerticalNav.tsx       The right-side / bottom nav with the logo button
    Toast.tsx, ConfirmModal.tsx
    Settings.tsx          Personal settings only (Account / General)
    BillingSettings.tsx   Stripe Connect + Subscription (used in Ops → Billing)
    BrandingSettings.tsx  Logo + business info (used in Ops → Settings)
    TeamSettings.tsx      Team roster + role/rate/photo edits (Ops → Team)
    screens/              The 14 main screens (one per nav tab + dash)
  lib/
    store.ts              Zustand store (auth, jobs, profiles, etc.)
    supabase.ts           db.get/post/patch/del helpers + auto org_id inject;
                          surfaces errors via window.__dbToast → store.showToast
    parser.ts             AI quote parsing (aiParsePdf / aiParseInspection),
                          validateQuote, makeGuide, extractZip
    types.ts              Shared interfaces (Job, Profile, Organization, …)
    i18n.ts               t() function; en + es translation maps
    print-template.ts     Shared header/footer/styles for ALL printed PDFs
    export-pdf.ts         Quote PDF (uses print-template)
    export-job-report.ts  Job completion report PDF (uses print-template)
  app/globals.css         Design tokens, button/card/input styles, animations
```

## How this user works

- **Commits land on `main`.** No PRs. Every push triggers a Vercel
  redeploy that updates the app on their phone in ~1–2 minutes. The
  worktree at `.claude/worktrees/loving-jepsen-b540e0` is gitignored —
  used only as a place where `npm install` ran so we can type-check.
- **Workflow**: Edit/Write file in the main checkout → `cp` to worktree
  → `npx tsc --noEmit` in worktree → `git add` → `git commit` →
  `git push origin main`. Repeat.
- **No `.env.local` in the repo**, so we can't `npm run dev` locally;
  rely on Vercel deploy + the user's testing on their phone.
- **Don't run destructive git** (force-push, reset --hard) without
  explicit ask.
- **Edit, don't recreate.** This codebase has lots of inline-styled
  React, big files (QuoteForge.tsx ~2.2k lines). Surgical edits only.

## Conventions in the codebase

- **Styling**: globals.css holds tokens. Buttons are `.bb` (primary),
  `.br` (red/destructive), `.bg` (success), `.bo` (outline). Cards are
  `.cd`. Layout helpers `.row`, `.g2`, `.g4`, `.mt`, `.mb`, `.fi`.
- **Icons**: import from `<Icon name="..." />`. Curated set in
  `Icon.tsx`. Inline emoji in flowing copy (✅ status, ⭐ ratings) is
  fine; UI affordances should be Lucide.
- **DB writes**: `db.patch/post/del` already toast their own errors.
  Don't add try/catch wrapping just to toast — only catch when you
  need to react to the error.
- **org_id injection**: `db.post` auto-stamps `org_id` from
  localStorage. Pass it explicitly when the row is critical (receipts
  did this once after a hard-to-debug filter mismatch).
- **Status colors (ROYGBIV)**: quoted=red, accepted=orange,
  scheduled=yellow, active=green, complete=blue, invoiced=indigo,
  paid=violet. Shared `statusColor()` lives in `src/lib/status.ts`
  (lead = hot-pink, ranks before quoted); imported by Jobs, Schedule,
  WorkVision, CustomerDetail, and the portal. Promote to a real `.chip`
  in globals.css for read-only status pills.
- **Prints**: every PDF goes through `wrapPrint(brand, body)` in
  `print-template.ts`. Never write your own `<html>` boilerplate.
- **Translation**: prefer `t("key.path")` for new strings. Keys live
  in `src/lib/i18n.ts`. Add to both `en` and `es`.
- **Time tracking**: clock-in inserts a `time_entries` row with
  `start_time` set, `end_time` empty, `hours: 0`. Clock-out patches
  that same row. The active row's id lives in localStorage as
  `c_t_active_id`. Both Timer.tsx and WorkVision.tsx share this state.

## Required env vars (Vercel)

- `ANTHROPIC_API_KEY` — Claude API for AI quoting / inspections.
- `OPENAI_API_KEY` — OpenAI Whisper transcription. Used by
  `/api/transcribe` for the Voice Walk feature's continuous-recording
  flow (MediaRecorder → Whisper → AI). Without it, Voice Walk falls
  back to Web Speech transcripts (incomplete on iOS Safari but
  functional on desktop Chrome).
- (Stripe / Supabase keys per existing setup.)

## Schema migrations the user should run in Supabase

- `ALTER TABLE price_corrections ADD COLUMN zip TEXT;`
- `ALTER TABLE profiles ADD COLUMN photo_url TEXT;`
- `ALTER TABLE organizations ADD COLUMN trip_fee NUMERIC DEFAULT 0;`
- Auto Payroll columns (cron at `/api/payroll/auto-run` reads these,
  Payroll.tsx's AutoPayrollPanel writes them):
  ```sql
  ALTER TABLE organizations ADD COLUMN auto_payroll_enabled BOOLEAN DEFAULT FALSE;
  ALTER TABLE organizations ADD COLUMN auto_payroll_day INTEGER DEFAULT 5;     -- 0=Sun…6=Sat
  ALTER TABLE organizations ADD COLUMN auto_payroll_hour INTEGER DEFAULT 17;   -- advisory on Hobby (daily cron)
  ALTER TABLE organizations ADD COLUMN auto_payroll_cadence TEXT DEFAULT 'weekly';
  ALTER TABLE organizations ADD COLUMN auto_payroll_last_run TIMESTAMPTZ;
  ```
  Test-fire on demand (bypasses day-of-week + cadence debounce):
  `curl -H "x-admin-token: $ADMIN_PASSWORD" 'https://<host>/api/payroll/auto-run?force=1'`
- `ALTER TABLE jobs ADD COLUMN archived BOOLEAN DEFAULT FALSE;`
- `ALTER TABLE jobs ADD COLUMN archived_at TIMESTAMPTZ;`
- `ALTER TABLE jobs ADD COLUMN review_requested_at TIMESTAMPTZ;`
- `ALTER TABLE time_entries ADD COLUMN paid_at TIMESTAMPTZ;`
  (Payroll now sets this instead of deleting the row, so Team Stats
  can compute lifetime hours/earnings. Existing rows have it NULL =
  unpaid, which is the correct state for any pre-migration entries
  the org has already paid out by hand. To retroactively flag those
  as paid: `UPDATE time_entries SET paid_at = NOW();`)
- `ALTER TABLE time_entries ADD COLUMN job_id UUID;`
  (Disambiguates time entries when two jobs share an address — e.g.
  a callback at a property that's already had a prior job. New clock-
  in rows stamp this from the active job; legacy rows have it NULL
  and fall back to address-match against the OLDEST job at that
  property. Without this column, hours from the original job leak
  onto a new job at the same address.)
- Recurring jobs (template-driven service schedules):
  ```
  CREATE TABLE IF NOT EXISTS recurring_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL,
    customer_id UUID,
    address_id UUID,
    property TEXT,
    client TEXT,
    template_rooms JSONB NOT NULL,
    title TEXT,
    cadence TEXT NOT NULL CHECK (cadence IN ('weekly','biweekly','monthly','quarterly','semiannual','annual')),
    day_of_week INTEGER,
    day_of_month INTEGER,
    hour INTEGER DEFAULT 9,
    is_active BOOLEAN DEFAULT TRUE,
    last_fired_at TIMESTAMPTZ,
    next_fire_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS idx_recurring_jobs_org_active ON recurring_jobs(org_id) WHERE is_active = TRUE;
  CREATE INDEX IF NOT EXISTS idx_recurring_jobs_next_fire ON recurring_jobs(next_fire_at) WHERE is_active = TRUE;
  ```
  Server-side cron fires daily at 09:00 UTC (`/api/recurring/fire`,
  registered in `vercel.json`). Each fire copies `template_rooms` into a
  fresh `jobs` row (status "scheduled"), then recomputes `next_fire_at`
  using `computeNextFire()` in `src/lib/recurring.ts`. Manual test:
  `curl -H "x-admin-token: $ADMIN_PASSWORD" 'https://<host>/api/recurring/fire?force=1&id=<row_id>'`.
- Review-Request automation (v1):
  ```
  CREATE TABLE IF NOT EXISTS review_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL,
    job_id UUID NOT NULL,
    customer_id UUID,
    scheduled_for TIMESTAMPTZ NOT NULL,
    channel TEXT NOT NULL CHECK (channel IN ('sms','email','both')),
    status TEXT NOT NULL DEFAULT 'scheduled'
      CHECK (status IN ('scheduled','sent','failed','cancelled')),
    sent_at TIMESTAMPTZ,
    error TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS idx_review_requests_pending
    ON review_requests(scheduled_for) WHERE status = 'scheduled';
  ALTER TABLE organizations ADD COLUMN review_request_enabled BOOLEAN DEFAULT TRUE;
  ALTER TABLE organizations ADD COLUMN review_request_delay_hours INTEGER DEFAULT 24;
  ALTER TABLE organizations ADD COLUMN review_request_channel TEXT DEFAULT 'sms';
  ALTER TABLE organizations ADD COLUMN review_request_message TEXT;
  ALTER TABLE organizations ADD COLUMN google_review_url TEXT;
  ```
  When `/api/verify-payment` flips a job to "paid", it inserts a row in
  `review_requests` scheduled for `now() + delay_hours` (idempotent —
  one row per job_id). Hourly Vercel cron `/api/reviews/dispatch`
  picks up rows where `scheduled_for <= now() AND status='scheduled'`,
  sends the message via Twilio (and Resend if `RESEND_API_KEY` is set
  for email channel), and updates `status` + `sent_at`. Manual
  "Request Review Now" cancels any pending row for the same job.
- HR / time-off (v1):
  ```
  CREATE TABLE time_off_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    user_name TEXT NOT NULL,
    org_id UUID,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    hours NUMERIC NOT NULL DEFAULT 0,
    kind TEXT NOT NULL DEFAULT 'vacation',
    reason TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    decided_by TEXT,
    decided_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
  );
  ALTER TABLE profiles ADD COLUMN pto_balance_hrs NUMERIC DEFAULT 0;
  ALTER TABLE profiles ADD COLUMN sick_balance_hrs NUMERIC DEFAULT 0;
  ```
  `kind` is one of vacation / sick / personal / unpaid. `status` is
  one of pending / approved / denied. Approving a request deducts
  `hours` from the matching balance (`pto_balance_hrs` for vacation
  /personal, `sick_balance_hrs` for sick, no deduction for unpaid).
  Admins manage from Operations → HR; employees submit from Settings
  → Time Off.

(The app handles missing columns gracefully — db helpers toast the
"column does not exist" error so the user notices.)

## Big systems shipped recently (for context)

- **Jobs tab redesign (list → detail → sub-screens)**: `Jobs.tsx` is no
  longer one screen with inline-expanding cards. It renders three levels
  gated by state — the **list** (two-row triage cards; status is a
  read-only `.chip`, whole card taps through), a **detail screen**
  (`detailJobId`: `.dhead` header with editable status + a status-aware
  primary CTA, then Properties / Notes / Money / Work / Manage sections),
  and **sub-screens** (`subScreen` = `{id, kind:'workorder'|'receipts'}`:
  the work-order checklist and the receipt scan/list). Render order in
  the main return is `subScreenJsx || detailScreen || (list)`, and the
  modals (recurring / review / QR-collect / photo) are mounted **after**
  that conditional so they render over any level — don't move them back
  inside it. The old inline-expand was deleted. Reusable building blocks
  live in `globals.css`: `.dhead` / `.section` / `.seclabel` / `.drow`
  (label-value row — NOT `.row`, the flex helper) / `.linkrow` / `.chip`.
  Per-job extras are stored in the job's `rooms` JSON blob — `jobNumber`,
  `jobNotes`, and the `workOrder` checklist — edited via the serialized
  `enqueueRoomsWrite` (avoids clobbering on quick taps). Full spec +
  build phases: `.claude/plans/jobs-redesign.md`.
- **Nav + Dashboard redesign**: nav bar trimmed to 5 tabs
  (Quote · Jobs · Home · Time · More) in `VerticalNav.tsx` — Home is a
  house icon (the logo image is gone), bottom-nav buttons are `flex:1`
  edge-to-edge. Overflow tabs live in a new **More hub**
  (`screens/MoreHub.tsx`): Schedule, Quests, Operations, Customers
  (deep-links Operations → customers via a new `initialTab` prop on
  Operations), Mileage, Settings, Help. Routed in `AppShell.tsx` as page
  `more`. The **Dashboard** (`screens/Dashboard.tsx`) is role-aware:
  owner/manager → Quote/Clock CTAs, Up next, Needs attention
  (To send / To invoice / Unpaid), Money (week / month / pipeline),
  business card; tech/apprentice → a "this week's pay" hero (vs last
  week + progress bar), CTAs, Up next, closest quest. Full-height flex
  column (`min-height: calc(100dvh - 150px)` + body `flex:1`
  space-between) so the cards fill the screen — the 150px is an estimate.
  Mileage moved off the dashboard into More.
- **Theme polish**: near-black bg (`--color-dark-bg #040406`), darker
  card tokens, bright-green money (`--color-money #00e676`), bright-blue
  translucent glass `.dhead`. Reusable globals.css classes added:
  `.dhead / .section / .seclabel / .drow / .linkrow / .chip / .iconbtn`.
- **Self-learning AI quoting**: edits + receipt scans + completed-job
  outcomes write to `price_corrections`. ZIP-tagged so AI weights
  same-ZIP data over regional. See parser.ts `aiParsePdf` for the
  prompt-building.
- **Stripe Connect**: per-org accounts. `/api/stripe/connect`,
  `/callback`, `/refresh`, `/webhook` (signature required, no
  dev-mode bypass). `/api/verify-payment` server-verifies the
  Stripe session before flipping a job to "paid" — payment success
  page calls it instead of trusting the URL's `job_id`.
- **Print template**: `print-template.ts` is shared by Quote, Invoice,
  Pay Stub, Schedule, Inspection, Job Report. Logo loads on every
  print; embedded script waits for all images to resolve before
  firing window.print() (was racing slow Supabase image loads).
- **Operations tabs**: Payroll, Financials, Clients, Team, Billing,
  Settings. Team & Billing & Branding moved out of general Settings
  (which is now personal-only: Account, General).
- **Icon system**: Lucide via `Icon.tsx`. ~65 named icons. Page-title
  h2s, nav, common UI buttons all use it.
- **Spanish (es)**: Many keys in i18n.ts, partially wired. Anything
  newly added in English should also get an `es` value.

## Things that still bug me / open follow-ups

- **Notifications (planned next)**: wire the dashboard topbar bell. Want
  staff alerts when a job is assigned to a tech and when a new lead comes
  in. App already has Twilio SMS (`/api/reviews/dispatch`, SMS-notify
  buttons) so SMS-first is likely simplest; web push (PWA + VAPID) is the
  fancier option. Needs per-user prefs + a phone field (check `profiles`).
- Dashboard fill-height `min-height: calc(100dvh - 150px)` is an estimate
  — nudge the `150px` if it scrolls or leaves a sliver.
- More hub shows every tile to everyone; Customers / admin Operations
  tabs probably shouldn't render for techs (role-gate them).
- Jobs Phase-3 polish: before/after photo grid on the Receipts screen +
  work-order per-item camera / Add item.
- Inspector trade chips and Marketing screen still have lots of
  English-only strings. Keys exist for some; just need `t()` swaps.
- `customWorkOrder` in QuoteForge — if rooms change after the user
  starts editing the work order, the auto-generated guide.steps
  drifts but the customWorkOrder stays. There's a "Regenerate"
  button but it could be smarter (merge new tasks rather than wipe).
- `tsconfig.tsbuildinfo` is gitignored but the worktree's local copy
  sometimes shows up in `git status -s`. Always add files explicitly,
  not `git add -A`.

## How to start a new chat

User can paste this into the new chat:

> Working on the Creed app. Read `CLAUDE.md` at the repo root for
> conventions and recent context. Current main branch is up to date
> with Vercel. What I want to work on next: …

That should bootstrap the context without re-explaining the whole
project.
