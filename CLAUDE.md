# Creed App — Notes for Claude

If you're a fresh Claude session opening this repo, read this first. It's
the handoff doc, not user-facing copy.

## What this is

A Next.js 15 + React 19 + TypeScript app for handyman / field-service
crews. Multi-tenant. Customers run quotes, schedule, clock in, get paid
via Stripe. Backend is Supabase (Postgres + Auth + Storage + RLS).
Hosted on Vercel (**Pro** plan) — `main` auto-deploys. All the
`vercel.json` crons run (8 as of 2026-11-11; the file is the source of
truth), including the **hourly** `reviews/dispatch`:
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

## Marketing site (`website/`)

A SEPARATE standalone Next.js app (static export) for Bernard's own
business site at **creedhandyman.com** — not part of the SaaS app build.
Excluded from the app's tsconfig; has its own package.json/node_modules.

- **Deploy: LIVE at https://www.creedhandyman.com** (apex 308s to www).
  Vercel project **`creed-website`** on the SAME repo, Root Directory =
  `website`, no env vars — every push to main deploys it alongside the
  app. DNS: the domain is registered at GoDaddy but its nameservers
  point at WIX, so records live in Wix's DNS manager (manage.wix.com →
  Domains): apex A → 216.150.1.1, www CNAME →
  b6e029a30a4a925d.vercel-dns-016.com. Old Wix records (if rollback is
  ever needed): apex A 185.230.63.107/.186/.171, www CNAME
  cdn3.wixdns.net. The `en` CNAME + MX records were left untouched.
  Gotcha fixed in f9a7cfb: website/ needs its OWN postcss.config.mjs —
  Next's config lookup walks up and finds the app's Tailwind config
  otherwise (works locally, breaks the Vercel build).
- **`website/src/lib/site.ts`** is the single source of truth for all
  business facts (phone, rate, hours, cities, services + per-service
  task lists, gallery, hero, lead endpoint). Edit there, updates
  everywhere.
- **Quote form** (`/contact`) POSTs cross-origin to the app's public
  `/api/leads` (slug `creedhandyman`) — leads land in the app's Jobs as
  status "lead" + notify owners. CORS allowlist lives in
  `src/app/api/leads/route.ts` (prod site origins + localhost:3005).
- **Photos** in `website/public/assets` are real job photos pulled from
  the app's Supabase storage (resized). Swap freely; `Img.tsx` renders a
  placeholder if a path 404s.
- **Design**: dark industrial (Oswald + Source Sans 3, red #cd2425 /
  blue #005fb3), from the Claude-Design mockup. Tokens + all layout
  classes in `website/src/app/globals.css`. Gotcha: `.section`,
  `.hero-grid`, `.promo`, `.cta-close` share an element with
  `.container` — keep their padding top/bottom-only or the 24px side
  gutters vanish.
- **Dev**: `npm --prefix website run dev` → port 3005 (launch.json entry
  "website"). Type-check: `npx tsc --noEmit` inside `website/`.
- Pages: home, services (+6 slugs), gallery, pricing,
  property-managers, about, churches, contact, plus per-city SEO pages
  /handyman-{derby,haysville,goddard,bel-aire,kechi,andover,newton}-ks
  (shared CityPage template; Andover/Newton are outside Sedgwick County, so
  CITY_PAGES entries can carry their own `county` and areaLine names them), content in site.ts CITY_PAGES, linked from the footer city
  list + the homepage service-area chips, which mark linked towns with →).
  Write new town pages from REAL job history (query the Creed org's jobs by
  town name / ZIP in Supabase) — Bel Aire + Kechi were; Park City / Valley
  Center / Maize had ~no jobs (2026-10-08), so they were skipped as thin.
  Sitemap/robots/JSON-LD (HomeAndConstructionBusiness + per-service
  Service schema, service-area, no street address) + per-page
  canonicals done. The leftover Wix `en` CNAME was deleted 2026-09-25;
  Wix DNS now holds only the two Vercel records + MX.

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
- **Pop-ups**: use `className="sheet-overlay"` (backdrop) + `className="sheet"`
  (panel, add `cd` for card colors) from globals.css — bottom sheet on phones,
  centered card ≥700px. Don't inline the overlay's alignItems/padding or the
  panel's width/borderRadius (they'd override the classes). Never use
  `window.alert/confirm/prompt` — `store.showConfirm` / `showToast` in the app,
  an in-page sheet on public pages. Full-screen viewers (photo lightbox, quest
  confetti, the help guide) stay as they are.
- **Screen headers**: every main screen starts with `<TopBar title icon color onBack? right? />`
  (`components/TopBar.tsx`, styles `.topbar*` in globals.css): [back] [icon tile] TITLE … [right
  slot]. `color` = the screen's nav hue (VerticalNav TAB_COLOR); `onBack` only on screens reached
  from More / a deep link. Don't hand-roll a new title row.
- **Settings = short category lists (2026-11-09)**: both the personal Settings
  gear and Ops → Settings render `components/SettingsCategories.tsx` — a list of
  rows (icon · title · one-line "what's inside"); tapping one opens just that
  category's settings with a back button (phone back too). Add a new setting
  INSIDE the right category (or add a category), never as another long section.
  Personal: Profile · Notifications & calendar · Appearance · Password · Quest
  bonuses (owner). Business: Business info (logo/name/address/license/primary
  trade + licensed trades) · Brand & public card · Pricing & taxes (quote
  settings + trade rates) · Quote terms · Online booking · Customer messages
  (automatic texts, quote follow-up, review requests, text-messaging links) ·
  System check (platform admins).
  `BrandingSettings` takes `part="business" | "brand" | "texting"` to show one
  slice (no `part` = all). The setup checklist's "open Business settings" links
  land on the list, not a category.
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
  **Server check (2026-10-13)**: that local state is reconciled with the
  server — after each online load `store.reconcileClock` asks "is my active
  row still open?" (by-id read, signed-in session only; skipped while a
  close-write for it is queued) and, if it was closed/removed elsewhere (a
  manager's Force clock-out, another phone), clears the local clock and sets
  `clockReset {id}`, which Timer/WorkVision/Home follow. Every shift close
  (clock-out, force-out, Set finish time, ghost delete) goes through the
  offline queue with `onlyIfOpen` (lands only while `end_time IS NULL`; a
  conflict keeps the server's times + toasts); clock-ins replay insert-only
  (`ignoreDuplicates`). Rule when a close finds the row already closed:
  `lib/clock-sync.ts resolveClose` (tested) — our own retry = done; paid rows
  never written; the tech's OWN clock-out (`earlierWins`) replaces a LATER
  office close on an unpaid row, office closes never shrink a real one.
  Clock-out flips local state off immediately (the write is queued
  synchronously) and `markLocalClockOut` keeps reconcile from reading our own
  close as the office's. The 15s poll retries the queue; transient errors
  (no code, PGRST000-003/303, 57014, 08xxx…) retry for 24h from the first
  failure. Never add an unconditional end_time patch — pass `onlyIfOpen`.
- **Quote pricing**: the min-labor-floor → trip-fee → discount → tax →
  grand-total cascade lives in ONE place — `src/lib/pricing.ts`
  `priceCascade()` — consumed by QuoteForge's live preview (headline +
  each Good/Better/Best tier) AND export-pdf (headline + tier columns).
  LINE mode (pass `subtotalRaw`) = QuoteForge's per-line-rounded math;
  AGGREGATE mode (omit it) = export-pdf's cent-rounded labor. Never
  re-implement the cascade inline — a regression suite covers it (the
  zzz quote-math audit test in the worktree, AUDIT_RUN=1 gated).
  **Its inputs too (2026-10-28)**: the org-settings side — labor rate (per-quote
  override → org → $55), trade rates, min hours (override → org → 1; 0 is
  honored), trip fee, tax %, tax mode, markup — resolves in `pricing.ts
  pricingInputs(org, overrides)`. QuoteForge, quote-pdf and the lead draft call
  it; never re-derive "min hours defaults to 1" / "trip fee || 0" at a call
  site (`pricing-inputs.test.ts`). The ZIP materials tax stays separate
  (`material-tax.ts`).
- **Money rollups**: revenue / net-profit math lives in ONE place —
  `src/lib/financials.ts` `profitSnapshot()` — consumed by the Financials
  screen AND the Ops hub KPIs (dashboard Revenue·mo mirrors its revenue
  rule). Rules: parseEntryDate (LOCAL) date filtering, job_date||created_at
  anchor, archived excluded, revenue = complete/invoiced/paid, labor = only
  entries on completed jobs at `amount || hrs×current rate`, materials =
  receipts else charged. Financials' "Month" pill = CALENDAR month-to-date
  (not rolling 30d) so hub → Financials shows the same number. Never
  re-implement a profit figure inline — extend the snapshot.
- **One home per rule (deepening pass, 2026-10-28)** — call these, never
  re-inline them (each has a test in `src/__tests__`):
  - `lib/clock.ts` — OWNS the c_t_* clock keys (`readLocalClock` /
    `writeLocalClock` / `clearLocalClock`) and the whole `clockIn` /
    `clockOut({reason:'self'|'force'})` sequence (stable row id, GPS stamps,
    scheduled→active, onlyIfOpen/earlierWins, markLocalClockOut). Timer +
    WorkVision call it; screens only show dialogs. Owner rules: a clock-out
    that can't find its open row NEVER posts a second entry; one brief-shift
    cutoff (rounded hrs ≥ 0.01).
  - `lib/pay.ts` — `entryAmount` / `unpaidFor` / `isUsersEntry` / `roundHours`.
    **No `rate || 55` for pay** (owner, 2026-10-28): rate ≤ 0 earns $0 and
    shows "No rate"; Payroll's per-person Process Pay refuses like Process
    All. (`org.default_rate || 55` for the CUSTOMER labor rate in quotes is a
    different thing and stays.)
  - `lib/job-entries.ts` `entriesForJob` / `receiptsForJob` — job_id, else
    address match credited only to the OLDEST job there (learning uses it too).
  - `lib/job-transition.ts` `transitionJob` (status patch + learning +
    equipment stamp) and `shouldPromptReview` (honors the org opt-out).
  - `lib/job-blob.ts` `readBlob(rooms)` / `jobBlob(row)` / `woKey` — the only
    way to READ `jobs.rooms` (never throws, {} on bad data).
  - `lib/quote-blob.ts` `readQuoteSettings(blob)` (+ `readDiscount`,
    `readLaborRate`, `readMinLaborHours`, `readTaxMode`, `readMaterialTax`,
    `readTierNames`, `readCrewSize`, `readEstDays`) — the ONE validity rule for a
    quote's per-quote settings read back from the blob (discount needs a positive
    value; min hours 0 is valid; tax mode is one of 3; names default to
    Better/Best…). Used by the QuoteForge load, quote-pdf, the Jobs invoice and
    /status — never re-check these inline. Photos are NOT in it on purpose (the
    PDF keeps `rendered`, the editor clamps types).
  - `lib/quote-save.ts` `buildQuoteSave(input)` → `{row, blob, droppedDone}` —
    what QuoteForge's `saveJob` WRITES, pure (2026-10-29): work-order merge
    (editable fields from the new step; only `done`/`completed_at` inherited from
    the prior task, matched by line id then room|detail key, each prior used
    once; option-membership tags; a quote with lines never saves an empty work
    order), photo merge (keep all, append new urls), prior blob spread first so
    keys QuoteForge doesn't own survive (jobNotes, approval, leadDraft) while the
    ones it owns are written explicitly (clearing really clears), status rule
    (new → quoted; edit keeps status; lead → quoted), accepted-option lock
    (re-save stays on the accepted option + prunes the work order; pre-approval =
    headline option, never `gt`), `job_date` only when creating. Also
    `dominantTrade(rooms)`. `saveJob` just validates, calls it, writes, resets the
    screen. Tested in `quote-save.test.ts`. Pricing numbers are INPUTS (the
    cascade stays in pricing.ts). The old per-task console.log of edited fields
    was dropped; the dropped-done warning is kept.
  - `lib/job-write.ts` (pure core) + `lib/job-write-client.ts` (Supabase +
    store wiring) — the way to WRITE it from the app (2026-10-29):
    `patchBlob(jobId, {key: value} | blob => delta | SKIP)`. Instant on-screen
    update, ONE per-job queue shared by Jobs / Work mode / offline photo replay,
    every write merged onto the SERVER's current blob (never the stale store
    copy — that clobbered the `approval` record once), nothing written when
    nothing changes, never throws (`{ok:false, reason}`). A function change runs
    twice (store copy, then server blob) so keep it pure; return only the keys
    you touched. `addPhoto(photo)` = append deduped by url; `runSerialized(jobId,
    task)` / `settled(jobId)` for anything else that must not interleave (the
    wo-queue flush). A failed write leaves the optimistic value until the 15s
    poll reconciles (as before). NOT moved onto it: wo-queue's offline ticks,
    QuoteForge's whole-blob saves, and the server routes (approve /
    record-approval / lead-draft keep their own status-guarded writes).
    Tested at the interface with fake adapters (`job-write.test.ts`).
  - `lib/job-photo-upload.ts uploadJobPhoto(jobId, file, tag)` — every job
    photo (Work mode + the Jobs tab's `JobPhotos` section) with the shared
    `PhotoTypePicker` (Before / Work / After) and `lib/photo-tag.ts
    defaultPhotoTag`. `day-plan afterVisitRemoved` — what the store drops /
    the job's status goes back to when a visit is deleted (applied at once).
  - `lib/sms-consent.ts autoTextConsent` (+ `sms-recipient.ts
    recipientConsent` for residents) — every AUTOMATIC Twilio text to a
    customer asks it first (2026-11-12, see shipped-systems.md "Text consent
    per customer"). Hand-sent texts (Messages app) never do.
  - `lib/nav-intent.ts` for every deep link; day-plan / dispatch-week
    `parseSchedTime` / `parseSchedCrew` / `stripNoteParts` for 🕐/👷 notes.
  - Server: `lib/cron-auth.ts` `cronAuth`; `lib/payment-fulfillment.ts`
    `fulfillJobPayment` (load → record → review → alert; `notify: false |
    {excludeUserId}` — Record payment skips the recorder, bulk Paid alerts no
    one), `paymentFromCheckoutSession`, `recordJobRefund` (org-scoped);
    `lib/stripe-subscription.ts` (plan/status mapping for webhook +
    verify-subscription); `notify-server` `resolveRecipients` (callers pass
    audience + event, never query profiles); `lib/sms.ts` `sendSms` /
    `normalizePhone` (the only Twilio sender); `lib/anthropic-server.ts`
    `callClaude` (every Claude call: fallback + ai_usage logging, call_type
    also receipt/tax/render/transcribe) + the logged OpenAI helper.
  - Quest bonuses: a `quest_payouts` row with `bonus_amount 0` = DISMISSED
    (`isDismissedPayout`) — Payroll's ✕; counts as handled, never as a win.
  - `promo-timed.ts promoEnd` steps months in UTC (2026-11-10), so its test
    passes in any local time zone; it used to fail by 1 h in Central across
    the November DST change.

## Required env vars (Vercel)

- `ANTHROPIC_API_KEY` — Claude API for AI quoting / inspections.
- `OPENAI_API_KEY` — OpenAI Whisper transcription. Used by
  `/api/transcribe` for the Voice Walk feature's continuous-recording
  flow (MediaRecorder → Whisper → AI). Without it, Voice Walk falls
  back to Web Speech transcripts (incomplete on iOS Safari but
  functional on desktop Chrome).
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_MESSAGING_SERVICE_SID`
  (preferred: the A2P 10DLC campaign's Messaging Service) or
  `TWILIO_FROM_NUMBER` — the only Twilio sender is `lib/sms.ts`
  (`smsConfigured()` says whether texting can work).
- `NOTIFY_SMS_ENABLED` — set to `"1"` to turn ON the SMS channel for
  notifications (job-assigned / new-lead). Unset/`"0"` = in-app feed only
  (the v1 default — texting is the fast-follow). Reuses the existing
  `TWILIO_*` creds. `src/lib/notify-server.ts` reads it.
- `PORTAL_SESSION_SECRET` — **REQUIRED** HMAC secret (any long random
  string, e.g. `openssl rand -hex 32`). Signs BOTH the customer-portal
  session cookie (`lib/portal-session.ts`) and the quote-approval token
  (`lib/job-token.ts`); both THROW if it's unset (no default, by design).
  Without it: the customer portal can't establish a session, AND the
  /status "Approve & Sign" fails with "this approval link is invalid or
  expired" — because `/api/status-link` minting throws, so `getStatusLink`
  silently drops the token from the owner's Send-Quote link. Use the SAME
  value across all environments or previously-sent links/sessions stop
  validating. (The token is a stable HMAC of the job id — no expiry — so
  "expired" in that error really means "no/!matching token".)
- `NEXT_PUBLIC_SITE_URL` — canonical app origin. `src/lib/site-url.ts`
  defaults to `https://www.creedhm.com` (the apex `creedhm.com` once had no TLS
  cert; it serves fine as of 2026-10-15 — the live Stripe webhook
  `we_1TLVCV…` posts to `https://creedhm.com/api/stripe/webhook` and listens to
  7 events: checkout.session.completed, customer.subscription.created/updated/
  deleted, invoice.paid, invoice.payment_failed, charge.refunded — `www` is the served origin, matching the Stripe routes' hardcoded
  fallback). Bank transfer (ACH) checkout also needs
  checkout.session.async_payment_succeeded and
  checkout.session.async_payment_failed added to that endpoint, plus ACH
  Direct Debit turned on in the Stripe dashboard; without them a bank payment
  never lands on the job. Card on file also needs payment_intent.succeeded
  on that endpoint, so a saved-card charge whose request died is still
  recorded. SEO metadata does NOT follow this env var: `app/layout.tsx`'s
  `metadataBase`, every marketing page's canonical, robots.txt and the sitemap
  use `src/lib/seo.ts` `SEO_ORIGIN` (hardcoded `https://www.creedhm.com`).
  **Portal magic-link emails/texts derive their origin from this**, via
  `src/lib/site-url.ts` `portalRedeemUrl()` — NOT the request `Host`/`Origin`
  header. This is a security fix: a spoofed Host on the PUBLIC
  `/api/portal/request-link[-email]` endpoints must not be able to point a
  customer's one-time link at an attacker domain (open-redirect → token theft).
  All three minting routes (`request-link`, `request-link-email`, `send-link`)
  use it. If this is set wrong, magic links point at the wrong domain.
- `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` — Web Push
  (notifications). Generate with `npx web-push generate-vapid-keys`;
  `VAPID_SUBJECT` is a `mailto:` (defaults to creedhandyman@gmail.com). Also set
  `NEXT_PUBLIC_VAPID_PUBLIC_KEY` to the **same** public key (the browser needs it
  to subscribe). Push send (`lib/notify-server.ts`) is a no-op until these are
  set; the in-app feed + SMS are unaffected. iOS only delivers web push to an
  **installed** PWA (Add to Home Screen, 16.4+), not a Safari tab.
- `APPFOLIO_AGENT_SECRET` / `APPFOLIO_AGENT_ORG_ID` — the AppFolio
  work-order agent's server-to-server endpoint (`/api/appfolio`, GET =
  upcoming jobs/schedule for slot proposals, POST = import one confirmed
  WO as a scheduled job + schedule entry, idempotent on the WO#). Bearer
  `APPFOLIO_AGENT_SECRET` auths it (fails closed when unset — the route
  just 401s, so leaving these unset disables the feature safely);
  `APPFOLIO_AGENT_ORG_ID` pins which org imports land in, server-side.
  Mark the SECRET as Sensitive in Vercel (write-only); the org id is a
  plain variable so it can be eyeballed later. Not in the preflight
  required-env list on purpose — it's optional, like Twilio.
- `RESEND_API_KEY` / `RESEND_FROM_EMAIL` — email via Resend (`lib/email.ts`).
  Email campaigns also read `RESEND_CAMPAIGN_FROM` (optional; the address on
  the campaign From line, shown as "Business Name <address>"; falls back to
  `RESEND_FROM_EMAIL`) and `RESEND_WEBHOOK_SECRET` (the `whsec_…` signing
  secret of the Resend webhook pointed at `/api/resend/webhook`; the route
  401s without it, so opens / clicks / bounces just aren't recorded).
- (Stripe / Supabase keys per existing setup.)

## Reference docs (read on demand, not loaded by default)

These hold the detail that used to live in this file. Read the relevant
entry BEFORE changing that area; search the file for the feature name.
When you ship a feature or add a migration, add the entry THERE, not here.

- **`docs/claude/migrations.md`** — every Supabase migration the user runs
  by hand in the SQL editor, with its SQL / file name and whether it has
  been run in prod. Read before touching the schema, adding a migration,
  or debugging a "column does not exist" error. As of 2026-11-10 the only
  one marked NOT yet run in prod is Online booking
  (`supabase/migrations/20261109190000_online_booking.sql`).
- **`docs/claude/shipped-systems.md`** — how each shipped feature works,
  where its code lives, and the rules it must keep. Read before changing
  any of: Follow-ups (2026-11-11) · Jobs that got lost (2026-11-11) · AI draft quotes for website leads (2026-10-24) · Quick Quote Voice Walk (2026-10-23) · Schedule alerts + phone-calendar feed (2026-10-23) · Desktop side menu (2026-10-21) · Dispatch Assistant — week route planner (2026-10-19) · Flip Mode — Phase 1 Deal Analyzer (2026-10-17) · Day-rhythm Home + calm polish pass (2026-10-12) · creedhm.com SEO (2026-10-08) · Signup / onboarding = ONE flow (2026-10-02) · PWA / offline (installable + offline reads) · Navigation (2026-10-02) · Shop (custom) quests (2026-10-08) · Vacant-turn inspections (2026-10-08, 87be489) · Fence inspection (2026-10-22, c2f0ec0) · Crew size + estimated days (2026-10-08) · Sending quotes (2026-10-02) · Good-Better-Best tiered quotes · Service list = organized templates (2026-10-21) · Drive tracking = Start drive + map (2026-10-19) · Edit-draft autosave for SAVED quotes (2026-10-12) · Quote PDF summary per option (2026-10-12) · Record an offline approval (2026-10-12) · Signed quotes print the customer's signature · Security hardening (`SECURITY-AUDIT.md` — local, untracked) · AI Render from the quote (`Creed_AI_Render_Enhancement`) · Operations remodel (from mockups) · Quests redesign (from mockup) · Shared in-app camera (`CameraModal.tsx`) · VoiceWalk camera redesign (bigger preview + overlaid checklist) · QuoteForge redesign (from mockup) · Schedule redesign (from mockup) · Time + WorkVision visual redesign (from mockups) · Nav per-tab colors + morphing More slot; dashboard "next check" · Notifications (in-app feed v1) · Jobs tab redesign (list → detail → sub-screens) · Nav + Dashboard redesign · Theme polish · Self-learning AI quoting · Models · Stripe Connect · Print template · Operations tabs · Icon system · Spanish (es).
- **`docs/claude/handoff-2026-10-28.md`** — notes saved from the old Creed dev,
  marketing and website chat sessions before they were deleted (2026-11-11).
  Read when picking up loose ends: standing owner rules (test accounts,
  text-first outreach, public-copy claims, platform fee), Play Store / keystore
  notes, open owner to-dos, features never tried on a real phone, known loose
  ends in the code. Leads to verify, not settled facts.

## Things that still bug me / open follow-ups

- **Walkthrough batch 1 (2026-11-10)**: (1) **Texts tab hidden** — texting isn't
  live yet. `lib/texts-client.ts TEXTS_TAB_VISIBLE = false` hides the side-menu
  item, the More hub tile, the unread dot and its poll; the screen still opens
  from a text-reply notification, and the job / customer Texts cards are
  unchanged. Flip the constant to bring the tab back. (2) **Schedule**: tapping
  a JOB in Week or Day view opens a job sheet (`visitCard` — Edit / Open job /
  Start / On the way buttons, the same card as the selected-day list); tapping
  the rest of a Week day row still drills into Day view. (3) **Dispatch tab**
  opens on just "Plan the week": `components/Fold.tsx` (collapsed header row,
  body rendered only while open) wraps "Crew right now · map" (the live crew
  rows + `<CrewMap embedded />`, the same map as the Crew Map screen), "Needs
  scheduling" and "This week · by tech". Folds start closed for owner/manager
  and open for crew (who have nothing else on the tab). The worker-filter row
  and the day-detail / Print / Start card are hidden on Dispatch. (4) **Jobs →
  Receipts & photos**: an X on each job photo (owner/manager, one confirm)
  removes it via `lib/job-write.ts removePhoto` through `patchBlob`, so it is
  written onto the server's blob and stays removed. The file itself stays in
  the bucket. (5) **Lead → Build quote no longer auto-runs the AI**: QuoteForge
  opens Quick Quote holding the prospect's request (`leadReview`: gold card,
  "Customer's request" label), the owner reads / edits it, and Generate builds
  from the edited text. The saved `leadDescription` keeps the customer's
  original words. Unchanged: a lead that already has a server AI draft
  (`leadDraft`, CTA "Review draft quote") still opens that draft, which was
  built from the original request.

- **Quote PDF photos (2026-11-10)**: the PDF downloads each photo at its stored
  size, so it now shows at most `MAX_PDF_PHOTOS` (12, before photos first;
  `export-pdf.ts pdfPhotos`), and the print page (`print-template.ts`) REMOVES
  any image still loading after 6 s before it prints (printing half-loaded left
  phones stuck on the preview, unable to save). Work mode shrinks library
  uploads to 1600px like the camera. NOT done: photos already stored at full
  size are still heavy (they'd need re-processing in storage), and deleting a
  photo from a quote does not delete its file from the bucket.

- **Notifications follow-ups**: the in-app feed shipped (see
  `docs/claude/shipped-systems.md`). Remaining: (a) flip `NOTIFY_SMS_ENABLED=1` on Vercel + verify a
  real text lands once a tech has a phone on file; (b) web push (PWA +
  VAPID) — **SHIPPED** (`2d56e34`); activate via the VAPID env vars + the
  push_subscriptions migration (iOS needs the PWA installed to home screen);
  (c) bell only lives on the dashboard — add to MoreHub /
  other topbars if wanted; (d) feed is poll-based (15s `loadAll`) — could
  move to Supabase realtime; (e) more event types (status changes, review
  landed, payment received).
- Dashboard fill-height `min-height: calc(100dvh - 150px)` is an estimate
  — nudge the `150px` if it scrolls or leaves a sliver.
- More hub role gate SHIPPED (9d8e9a1): techs don't see Customers, and
  their Operations tile reads "Time Off" (routes to Ops, which roots
  non-admins at HR).
- Jobs Phase-3 polish: before/after photo grid on the Receipts screen +
  work-order per-item camera / Add item.
- i18n: Inspector UI + the location suite are translated (418ecf1;
  Inspector imports `t as tr` — its type-chip loop binds `t`). The
  quick-select preset chips are DELIBERATELY English-only: they write
  into item notes that feed the AI parser and the customer quote.
  Marketing.tsx no longer exists (superseded by website/, English by
  choice). Remaining untranslated: MoreHub tile names/subs, Quests
  micro-labels, portal (customer-facing, English for now).
- ~~`customWorkOrder` drift~~ FIXED: work-order tasks carry `itemId` (their
  quote line's RoomItem.id, stamped by `makeGuide`, persisted in
  `rooms.workOrder`). `src/lib/work-order-sync.ts` `syncWorkOrder` (run by a
  QuoteForge effect + again in saveJob) is a three-way merge: a field the QUOTE
  changed flows into the task, a Guide-tab-only tweak is kept, a deleted line
  drops its task, a new line gets one, custom (`custom:true`) tasks and tasks
  removed on purpose (`woKnownIdsRef`) are left alone, legacy tasks re-link by
  text once. saveJob inherits `done` by itemId first, so renaming a line keeps
  its field checkmark. WorkVision pairs task ↔ quote line by itemId. Rules are
  covered by `src/__tests__/work-order-sync.test.ts`. Edits reach WorkVision /
  Jobs on SAVE (the work order lives in the saved blob).
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
