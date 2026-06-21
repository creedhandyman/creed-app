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
  `.cd`. Big glow action cards are `.cta` + a hue (`.glow-blue` /
  `.glow-red` / `.glow-green`) with `.ic` (icon tile) / `.tx b` (title) /
  `.tx small` (sub) inside — used by the dashboard Quote/Clock CTAs and the
  Time clock-in; don't re-inline the glow. Layout helpers `.row`, `.g2`,
  `.g4`, `.mt`, `.mb`, `.fi`.
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
- `NOTIFY_SMS_ENABLED` — set to `"1"` to turn ON the SMS channel for
  notifications (job-assigned / new-lead). Unset/`"0"` = in-app feed only
  (the v1 default — texting is the fast-follow). Reuses the existing
  `TWILIO_*` creds. `src/lib/notify-server.ts` reads it.
- (Stripe / Supabase keys per existing setup.)

## Schema migrations the user should run in Supabase

- `ALTER TABLE price_corrections ADD COLUMN zip TEXT;`
- Self-learning v2 — richer outcome capture + recency/dedup weighting:
  ```sql
  ALTER TABLE price_corrections ADD COLUMN IF NOT EXISTS source TEXT;         -- 'receipt_scan'|'manual_add'|'quote_edit'|'job_completion'
  ALTER TABLE price_corrections ADD COLUMN IF NOT EXISTS job_id UUID;         -- which job produced the row (dedup + traceability)
  ALTER TABLE price_corrections ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();  -- recency weighting
  ```
  Until this runs, job-completion learning writes toast a "column does not
  exist" error — but the write is best-effort/try-caught so completing a job
  still works, and the read side (parser.ts) is migration-safe (undefined
  fields fall through). `lib/learning.ts` `recordJobOutcome` writes the rows.
- `ALTER TABLE profiles ADD COLUMN photo_url TEXT;`
- `ALTER TABLE organizations ADD COLUMN trip_fee NUMERIC DEFAULT 0;`
- Multi-day scheduling: `ALTER TABLE schedule ADD COLUMN IF NOT EXISTS end_date TEXT;`
  (YYYY-MM-DD; absent/equal to sched_date = single day). Schedule.tsx treats
  an entry as covering `sched_date..end_date` (`spansDay()` helper). Single-day
  scheduling omits `end_date` on insert, so it still works before this runs.
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
  In-app: Operations → Payroll → Auto Payroll has a **"Run now (test)"**
  button that hits the same endpoint with the owner's Supabase JWT
  (`Authorization: Bearer`, validated server-side via `isOwnerSession`,
  owner/manager only) and toasts a plain-language summary (paid N · M
  skipped (reasons) · K errored). Diagnostics added after "auto payroll
  never paid my crew" reports: the endpoint now (a) reports crew with
  **rate ≤ 0** as an explicit `"no pay rate set"` skip instead of silently
  dropping them (the old `.gt("rate",0)` filter hid them — and manual
  payroll masks the problem via a `rate || 55` fallback the cron
  deliberately does NOT use); (b) returns a `hint` when the
  `auto_payroll_*` columns are missing; (c) returns `usingServiceRole`
  (false = anon fallback). The cron's day check is UTC `getDay()` at 17:00
  UTC — same calendar day as US daytime, so day-matching is fine for US;
  `auto_payroll_hour` is advisory on the single daily cron (runs ~midday
  Central regardless of the hour picked).
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
- Notifications (in-app feed v1):
  ```
  CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL,
    user_id UUID NOT NULL,                 -- recipient profile id
    type TEXT NOT NULL CHECK (type IN ('job_assigned','new_lead')),
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    job_id UUID,                           -- deep-link target (nullable)
    read_at TIMESTAMPTZ,                   -- NULL = unread
    created_at TIMESTAMPTZ DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS idx_notifications_user        ON notifications(user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id) WHERE read_at IS NULL;

  ALTER TABLE profiles ADD COLUMN phone TEXT;
  ALTER TABLE profiles ADD COLUMN notify_sms      BOOLEAN DEFAULT TRUE; -- master "text me"
  ALTER TABLE profiles ADD COLUMN notify_assigned BOOLEAN DEFAULT TRUE; -- event: assigned to me
  ALTER TABLE profiles ADD COLUMN notify_leads    BOOLEAN DEFAULT TRUE; -- event: new lead
  ```
  Same RLS posture as the rest of the app (no policies added; the client
  reads scoped by `user_id` in loadAll, server writes via service-role).
  Defaults are TRUE = opt-out model. Existing logged-in sessions read the
  new pref fields as `undefined` until the user re-logs / initAuth runs;
  the UI + send path treat `undefined` as opted-in so that's harmless.

(The app handles missing columns gracefully — db helpers toast the
"column does not exist" error so the user notices.)

## Big systems shipped recently (for context)

- **AI Render from the quote (`Creed_AI_Render_Enhancement`)**: the "after"
  render now reads the quote's own line items instead of a fixed prompt.
  `src/lib/render-prompt.ts` `buildRenderPrompt(rooms, onlyRoom?)` keyword-maps
  VISIBLE scope (paint/floors/fixtures/blinds/doors…) to short render phrases
  and skips hidden work (plumbing internals, fill valves, smoke detectors);
  returns `{prompt, usedCount, skipped}`. `src/components/RenderModal.tsx` is a
  shared modal (source picker → editable auto-prompt with a "Built from N
  visual items" chip → Generate via `/api/render` → before/after → Save);
  `onSaved(url, sourceUrl, includeInQuote)` lets the parent attach the photo.
  **QuoteForge**: violet **Render** button in the action bar (PDF · Render ·
  Send · Save), seeded from the line items, **disabled until the quote is
  saved once** (needs a jobId — spec Option A) and there's ≥1 photo; the saved
  render attaches to the job's `rooms.photos` as `type:"rendered"` +
  `includeInQuote`, surviving later Updates (saveJob preserves photos).
  **WorkVision** now uses the same RenderModal (its inline modal +
  `DEFAULT_RENDER_PROMPT` removed, −279 lines), seeded from `buildRenderPrompt`.
  **PDF**: `export-pdf.ts` takes an optional `renders` param → a "Proposed
  Finish" Now→Done before/after section; QuoteForge passes the includeInQuote
  renders. `/api/render` (gpt-image-1 edits) unchanged. NOT done: the public
  `s/` + `status/` pages don't show renders yet; no org "house finish profile"
  in Ops → Settings; no per-room render loop.

- **Operations remodel (from mockups)**: `Creed_Ops_Streamlined` +
  `Creed_Ops_Customers_Team_Settings` + `Creed_Settings_Full`. **Ops tab DONE.**
  `Operations.tsx` is no longer an 8-tab strip; it's a **launcher hub**: topbar
  (OPERATIONS + role chip) → 3 KPIs (Payroll due = exact unpaid hrs×rate;
  Revenue·mo + Net profit = this-month approximations by created_at) → a 2-col
  **tile grid** (Payroll/Financials/Customers/Recurring/HR[badge=pending
  time-off]/Team/Billing/Settings; `TILE_STYLE` map). `tab` state is `OpsTab |
  null` — null = hub (admins only); a tile opens that area's **detail** =
  back-header (chevron → hub) + the sub-component. Non-admins skip the hub (HR
  is their root). Deep-link `initialTab` works + bounces non-admins off
  admin-only areas. **Detail restyles shipped:** Payroll (avatar strip + team
  summary + per-employee rows w/ Ready/No-rate tag + "Process all" via the safe
  auto-run endpoint; `embedded` prop hides its H2 inside Ops; per-person
  Process Pay + bonus approval kept), Financials (period pills + 4 P&L cards +
  pipeline statusbar/legend; deep analytics kept below), Customers (blue-pill
  filters + CRM rows: type icon/chip + jobs·open + lifetime $), Team
  (baseball-card for top earner: 6-stat grid incl. questsWon + noCallbackPct +
  top-trade bar; compact rows; edits in the expand), Ops Settings (de-emoji
  only — branding/quote-defaults/review-automation logic untouched). **Recurring
  / HR / Billing** open their existing components unchanged (mock didn't restyle
  them). **NOT yet done:** the personal **Settings gear** screen
  (`Creed_Settings_Full` screen 1 — profile / notifications / appearance /
  security); that's a separate screen from the Ops tab.

- **Quests redesign (from mockup)**: `Creed_Quests_Tabs_Confetti` mockup —
  `Quests.tsx` rebuilt to a battle-pass "QUEST HUB" while ALL the quest
  computation logic (per-user cycle stats, tiers, qBonus/qEnabled config,
  HandyKing aggregate) + `addReview`/`addReferral` were preserved verbatim.
  Topbar = title + violet trophy tile; violet-active segmented sub-tabs
  (Quests/Team/Reviews/Referrals). **Quests**: violet battle-pass hero
  (cycle + reset countdown, $earned of $max, a pip bar of completedCount /
  total, "N / M QUESTS COMPLETE") → tier headers (T-badge + name + done/total)
  → mission cards (left color bar, gold coin payout pill, progress, "Done ·
  pending" flag + gold glow when complete). **Team** = leaderboard (podium
  top-3 + ranked rows + "Team cycle payout so far"), ranked by real
  `quest_payouts` $ this cycle (5★ tiebreaker) — replaced the old per-tech
  baseball-card stats (those live in TeamStats / Ops → Team). **Reviews** =
  gold star hero (avg + N reviews · M five-star this cycle) + 2 quest chips +
  review cards; the QR collect + manual add-review form are kept below.
  **Referrals** = 2 quest chips + green "Refer a client" CTA that toggles the
  add form + referral rows (status still an editable select, styled as a
  colored chip) + payout line. **Confetti celebration**: a fixed overlay
  (confetti + trophy burst + quest name + coin) fires the first time the user
  sees a quest cross into done, acked per-quest in localStorage
  (`creed_quest_seen_<uid>_<yr>_<mo>`). Micro-labels ("QUESTS COMPLETE",
  "Done · pending", chip labels) are literals, not i18n keys yet. **Icon**:
  `quest` now maps to `Trophy` in `Icon.tsx` (was `Target`), so the nav tab,
  screen, More hub, and dashboard all show a trophy.
- **Shared in-app camera (`CameraModal.tsx`)**: one full-screen live-camera
  component — rear-facing preview, shutter, flash/torch, front/back flip, and a
  "choose from library" fallback for desktop / denied permission. It hands back
  JPEG `File`s via `onCapture(files)` and does NOT upload; each screen keeps its
  own upload + AI logic, so it was a drop-in for the existing handlers.
  Extracted from VoiceWalk's proven getUserMedia primitive (single audio-less
  video call, iOS `playsInline`, torch via `applyConstraints`); **VoiceWalk
  keeps its OWN camera** (entangled with audio recording — see its redesign
  below), not this component. Props:
  `open / onClose / onCapture / multiple? / allowLibrary? / title? / maxSize? /
  quality?`. `multiple` keeps it open after each shot (uploads stream in) with a
  Done(N) button; single mode closes after one. Wired into the **6 spots** that
  used to pop the OS camera/file picker: Quick Quote (QuoteForge), receipt scan
  (Jobs detail **and** WorkVision Photos tab), work-order photos (WorkVision
  per-task button **and** Photos-tab Photo button), and room inspection
  (Inspector per-item). The **"Upload"/gallery file-pickers next to them were
  left as-is on purpose** (the "Take Photo + Library" choice). Added `flash`
  (Zap) + `flipCamera` (SwitchCamera) to `Icon.tsx`. NOT migrated this pass
  (deferred): the gallery pickers themselves, the public lead/portal customer
  photo forms, and logo/avatar uploads (BrandingSettings / onboarding /
  TeamStats) — logos especially are file uploads, not snapped photos.
  **Flash detection** (CameraModal + VoiceWalk): the torch button shows only
  when the video track's `getCapabilities().torch` is true (or caps are unknown
  — some Android WebViews). iOS Safari reports caps WITHOUT torch (no web torch
  API exists there) so the button correctly hides on iPhone instead of offering
  one that can't fire the LED; CameraModal also verifies via `getSettings()`
  after toggling and backs out (hides + toast) if it didn't take.
- **VoiceWalk camera redesign (bigger preview + overlaid checklist)**: the
  per-room camera was a small 4:3 box with the key-items checklist stacked
  below it (cramped). Now, while recording, the camera fills the screen
  (`height: min(64vh, 560px)`) and the checklist rides ON the preview as small
  translucent chips along the top — each chip **glows green** (green border +
  box-shadow) the instant its keyword is auto-ticked (or it's tapped). Shutter
  + gallery + photo-count moved to a bottom scrim; REC timer + N/total + flash
  to a top scrim. The separate checklist / empty-state cards render only when
  NOT inspecting (pre-record review). Snap / upload / audio plumbing unchanged.
- **QuoteForge redesign (from mockup)**: `Creed_Quote_Section` mockup —
  restyled the hub + editor; all AI/editing logic preserved. **Hub**: topbar
  (QUOTEFORGE + "New quote") + three glow CTAs (Quick Quote gold, Full
  Inspection green, Upload Report blue) with icon/title/subtitle/tag pill;
  `SavedInspections` is now a folder header + cards with a gold "Quote this"
  + mini edit/print/delete icon buttons (no emoji). **Editor**: gold-gradient
  total card; clean gold-active segmented tabs (Quote/Guide/Issues/Photos/
  Add); a separate **action bar** (PDF / Send / Save = green primary) split
  out of the old crammed tab row; trade-dot room headers in `QuoteTab`; emoji
  removed (incl. the worker chips). Kept as-is (functional, richer than the
  mock): the expanded pricing controls (labor/discount/tax), the stats `.g4`
  grid, AI Assist, and the editable hrs/mat/sqft line-item inputs + material
  modal. The **AI-build loading screen** (shared `AiLoadingDisplay`, used by
  both the hub overlay and the build view) is gold-themed to the mock — a
  sparkles-in-gold-tile "robot", Lucide step icons (done=green check,
  now=gold, todo=muted), and a solid gold progress bar. NOT yet matched:
  the compact pricing tiles + the action bar pinned to the very bottom.
- **Schedule redesign (from mockup)**: `Schedule.tsx` rebuilt to **Day /
  Week / Month** views + a **worker-filter** avatar row (`Creed_Schedule`
  mockup). Topbar = title + date-nav (label adapts per view, tap = today;
  `periodLabel` + `stepView` handle day/week/month). **Day** = time-rail
  blocks (status-color bar, trade·hrs, crew avatars) + an **Unscheduled**
  section (proximity `suggestion` + per-job **Assign** that arms the job +
  opens the quick-add modal). **Week** = day-row list (count·hrs; per-job
  dot + time + `solo`/`+others` relative to the filtered worker). **Month**
  = status-dot grid + the shared selected-day detail. The **worker filter**
  parses the schedule note's `👷 names` (+ linked `job.requested_tech`
  fallback via `entryWorkers`/`matchesWorker`) — name-based, no new schema.
  **Assign flow**: Day-view Unscheduled → per-job **Assign** opens the
  quick-add modal, which now has a **date picker** (pick any day; defaults to
  the viewed day) + a proximity hint, plus time/workers/notes. Status
  auto-bump + proximity kept. Dropped per request: the standalone
  Add-to-Schedule form, the All-Scheduled list, the old `renderDayCell` grid,
  AND the drag-and-drop palette + all emoji (📍/⏱/👆/⭐ → Lucide icons; the
  day-detail note is parsed, not shown raw). `PropertySearch` still above the
  views. The note still STORES `🕐/👷` (parsed by `parseTime`/`parseWorkers`).
- **Time + WorkVision visual redesign (from mockups)**: both screens already
  had the logic — this was a restyle toward the `Creed_Time_WorkVision_v2` /
  `Creed_WorkVision_Full` mockups, no plumbing changes. **Time** (`Timer.tsx`):
  segmented icon tabs (My time / Crew), a green **"next check"** card (unpaid ×
  rate — same metric as the dashboard), today's-jobs **chips** + a glowing
  **CLOCK IN** CTA when off the clock, and a live timer card + **Open work
  order** / Clock out when on. **WorkVision** (`WorkVision.tsx`): Tasks tab now
  **grouped by trade** (the work-order `room` field, with colored trade dots),
  a **per-item camera** on each task (uploads a "work" photo), and an icon
  segmented control for Tasks/Guide/Notes/Photos. Second pass restyled the
  WorkVision **clock-in picker** (tappable dark job cards) + **clocked-in
  header** (compact topbar + live timer chip + job row w/ Map). Work mode was
  then **leaned to the mock**: clock-out is a small header link, the top
  Clock-out/Complete row + the Total/Hours/Help tile bar are gone, and
  **COMPLETE JOB** is a full-width green button at the bottom of the Tasks
  tab. Third pass
  **rebuilt Crew-activity to the mockup**: the topbar shows "N on the clock";
  the body is one **crew card per teammate** (avatar + status dot, name,
  location/job when on-the-clock or "Last out … · Xh today" when off,
  live duration + On-the-clock/Off chip), sorted on-the-clock first. Tap a
  card → expand: "Clocked in HH:MM", per-entry editable hours (running rows
  show "since …"), **Force clock out** (folded in — the old standalone
  force-stop card is gone), and **Add entry for {first name}** (jumps to My
  time with the manual form pre-set to that person). GPS still deferred.
  Notes internals still original. **Photos** was rebuilt to the
  `Creed_WorkVision_Full` mock (no logic change): Before/Work/After tag
  chips (sets `photoType` for the next shot) → a 3-col thumb grid with
  translucent type tags + a dashed **Add** tile + a per-photo sparkle
  render button → a **Camera / Upload / Scan receipt** action row → an **AI
  after-render** card (Generate seeds the render modal with the latest photo,
  toasts a hint if none). The renderings list (source/result pairs) still
  renders below. All handlers reused (`setWvCam`, `uploadWorkPhoto`,
  `uploadReceipt`, `openRenderModal`). **Guide shopping list is editable**: the
  checkbox alone toggles bought-state; tapping an item's name/price opens an
  inline editor (rename / change cost / delete). Custom items edit their
  `customShop` entry in place; quote-derived items are "adopted" into
  `customShop` with their original key recorded in a new `removedGuideShop`
  array on the rooms blob (so the auto list hides the original). Checked
  state migrates when a rename changes the `shopKey`.
- **Nav per-tab colors + morphing More slot; dashboard "next check"**:
  `VerticalNav.tsx` colors the active tab in its signature hue (Home blue,
  Quote yellow/gold, Jobs red, Time green, Quests purple, … — `TAB_COLOR`
  map in the file). Active = the **icon + label tinted** in that color on a
  transparent background (no filled box / `.act` gradient); inactive uses the
  default muted class color. The **More** slot
  morphs into whatever overflow tab is active (its icon + label + color via
  `OVERFLOW_TABS`) and still taps through to the More hub so you can switch.
  The dashboard pay figure — tech **"Your next check"** hero + admin
  **"My check"** tile — now shows **all unpaid hours × rate**, i.e. exactly
  what Run Payroll will pay (no calendar-week window), so it always
  reconciles with the actual check. Approved quest bonuses are added at
  payout, not previewed. The tech hero keeps the next-check headline AND a
  this-week-vs-last-week progress bar + "beat last week" line as the
  come-back motivator (weekly halves computed via `lib/dates.ts`
  `parseEntryDate` so manual ISO-dated entries bucket correctly).
- **Notifications (in-app feed v1)**: dashboard topbar **bell** with an
  unread badge → `NotificationsPanel.tsx` (overlay list, tap a row to mark
  read + deep-link to the job). Source of truth is the `notifications`
  table (per-user; loaded in `store.loadAll` scoped by `user_id`, capped
  50; `markNotificationRead` / `markAllNotificationsRead` actions).
  **Triggers**: (1) *job assigned* — Jobs detail → Requested-tech dropdown
  `onChange` POSTs `/api/notify` (skips clears / re-select / self-assign);
  (2) *new lead* — created server-side inside `/api/leads` after the job
  insert, to owners+managers **and** the referring tech (`referrer_tech_id`),
  best-effort so it never fails lead capture. Both paths go through
  `src/lib/notify-server.ts` `dispatchNotifications()`, which always writes
  the in-app rows and **only texts when `NOTIFY_SMS_ENABLED="1"`** (the
  SMS send path is built but flag-gated off — flip the env var to go live,
  no deploy needed). Deep-link: `AppShell.goToJob` → `Jobs` seeds
  `detailJobId` from `initialDetailJobId`, then clears the parent.
  **Prefs** (Settings → Account → Notifications): `phone` + `notify_sms`
  (master) + `notify_assigned` + `notify_leads`, all on `profiles`,
  default-TRUE opt-out. Not done: web push (PWA/VAPID — no service worker
  yet), a bell outside the dashboard, realtime (feed refreshes via the 15s
  `loadAll`).
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
  prompt-building. **v2 (`lib/learning.ts`)**: `recordJobOutcome(job,
  actualHrs)` now fires from BOTH completion paths — WorkVision's **Complete
  Job** button AND the Jobs status flip. Before, only the admin Jobs path
  logged, so jobs finished by techs in WorkVision (most of them) taught the
  AI nothing — the single biggest leak. It writes per-trade `__job__:` sizing
  rows AND per-item rows (actual hours split pro-rata by each item's estimate,
  keyed by item description for granular learning), tagged `source`/`job_id`.
  Materials are left untouched there (already learned per-item from receipts;
  `original_mat==corrected_mat` keeps them out of the material averages).
  parser.ts processes corrections **newest-first** (recent data survives the
  200-row per-item cap → learns faster) and **de-dupes `job_completion` rows
  by (job_id, item_name)** so a re-completed job (or both paths firing) can't
  double-count. Needs the `source`/`job_id`/`created_at` migration above.
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

- **Notifications follow-ups**: the in-app feed shipped (see "Big systems"
  above). Remaining: (a) flip `NOTIFY_SMS_ENABLED=1` on Vercel + verify a
  real text lands once a tech has a phone on file; (b) web push (PWA +
  VAPID) for in-app pop alerts — needs a service worker + manifest, none
  exists yet; (c) bell only lives on the dashboard — add to MoreHub /
  other topbars if wanted; (d) feed is poll-based (15s `loadAll`) — could
  move to Supabase realtime; (e) more event types (status changes, review
  landed, payment received).
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
