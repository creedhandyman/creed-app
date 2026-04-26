# Creed App — Notes for Claude

If you're a fresh Claude session opening this repo, read this first. It's
the handoff doc, not user-facing copy.

## What this is

A Next.js 15 + React 19 + TypeScript app for handyman / field-service
crews. Multi-tenant. Customers run quotes, schedule, clock in, get paid
via Stripe. Backend is Supabase (Postgres + Auth + Storage + RLS).
Hosted on Vercel — `main` auto-deploys.

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
  paid=violet. Logic in Jobs.tsx `statusColor()`.
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
- `ALTER TABLE jobs ADD COLUMN archived BOOLEAN DEFAULT FALSE;`
- `ALTER TABLE jobs ADD COLUMN archived_at TIMESTAMPTZ;`
- `ALTER TABLE jobs ADD COLUMN review_requested_at TIMESTAMPTZ;`
- ```sql
  CREATE TABLE team_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID,
    author_id UUID,
    author_name TEXT,
    message TEXT NOT NULL,
    urgent BOOLEAN DEFAULT FALSE,
    read_by TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
  );
  ALTER TABLE team_messages DISABLE ROW LEVEL SECURITY;
  ```
  (RLS off matches the rest of the schema — multi-tenant isolation is
  enforced application-side via the auto-injected org_id filter.)

(The app handles missing columns gracefully — db helpers toast the
"column does not exist" error so the user notices. Same for missing
tables — Team Comms returns an empty inbox until the table is created.)

## Big systems shipped recently (for context)

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
