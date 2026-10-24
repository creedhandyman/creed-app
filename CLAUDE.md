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
- **Money rollups**: revenue / net-profit math lives in ONE place —
  `src/lib/financials.ts` `profitSnapshot()` — consumed by the Financials
  screen AND the Ops hub KPIs (dashboard Revenue·mo mirrors its revenue
  rule). Rules: parseEntryDate (LOCAL) date filtering, job_date||created_at
  anchor, archived excluded, revenue = complete/invoiced/paid, labor = only
  entries on completed jobs at `amount || hrs×current rate`, materials =
  receipts else charged. Financials' "Month" pill = CALENDAR month-to-date
  (not rolling 30d) so hub → Financials shows the same number. Never
  re-implement a profit figure inline — extend the snapshot.

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
  fallback). SEO metadata does NOT follow this env var: `app/layout.tsx`'s
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
- (Stripe / Supabase keys per existing setup.)

## Schema migrations the user should run in Supabase

- AI usage logging (Phase 0 cost measurement — `/api/ai` writes one row per call):
  ```sql
  CREATE TABLE IF NOT EXISTS ai_usage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID,
    user_id UUID,
    call_type TEXT,                 -- parse | ping | voicewalk | assist | troubleshoot | other
    model TEXT,
    input_tokens INTEGER DEFAULT 0,
    output_tokens INTEGER DEFAULT 0,
    cache_creation_tokens INTEGER DEFAULT 0,
    cache_read_tokens INTEGER DEFAULT 0,
    est_cost NUMERIC DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS idx_ai_usage_org_time ON ai_usage(org_id, created_at DESC);
  ALTER TABLE ai_usage ENABLE ROW LEVEL SECURITY;  -- service-role writes/reads only
  ```
  Until this runs the logging insert fails silently (best-effort try/catch) and
  AI calls work normally. `cache_read_tokens > 0` on a repeat parse confirms the
  prompt-cache (Phase 1) is hitting.
- Web Push subscriptions (notifications push channel — `/api/push/subscribe`
  writes, `notify-server` sends; needs the VAPID env vars above):
  ```sql
  CREATE TABLE IF NOT EXISTS push_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    org_id UUID,
    endpoint TEXT NOT NULL UNIQUE,   -- upsert target (one row per device)
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS idx_push_subs_user ON push_subscriptions(user_id);
  ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;  -- service-role only
  ```
  Until this runs, enabling push toasts a "table does not exist" error (the
  subscribe write fails); the rest of the app is unaffected.
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
- Materials purchase tax (**ALREADY RUN in prod 2026-10-20**, migration
  `organizations_material_tax_pct`): `organizations.material_tax_pct NUMERIC
  DEFAULT 0` (0–25). The sales tax the BUSINESS pays buying materials — quote
  material prices (AI / learned receipt items / typed) are pre-tax shelf
  prices, so this is cost recovery, NOT the customer sales tax (tax_pct /
  tax_mode). `lib/pricing.ts billedMaterial(raw, {materialTaxPct, markupPct})`
  = raw × (1+tax) × (1+markup); QuoteForge (`all`, QuoteTab line totals) and
  export-pdf (every former markup site + summary/section material) use it.
  Set in Ops → Settings ("Sales tax you pay on materials %"); Creed Handyman
  LLC set to 7.5 (KS 6.5 + Sedgwick 1). Each quote stores the rate it was
  priced with (`rooms.materialTaxPct`); quote-pdf reads ONLY that (absent = 0)
  so quotes saved before keep matching their saved total; QuoteForge uses the
  stored rate, else the org's current one (new / legacy quotes re-saved).
  **By ZIP (2026-10-20, migration `organizations_material_tax_by_zip`,
  ALREADY RUN):** `organizations.material_tax_by_zip JSONB` = {zip: {rate,
  place, source: lookup|owner, at}}. The rate comes from the JOB's ZIP
  (`lib/material-tax.ts materialTaxFor`, tested); `material_tax_pct` is now
  only the default for addresses with no ZIP. An unknown ZIP is looked up
  once by QuoteForge → `/api/tax/material-rate` (any org member; Claude
  sonnet-5-5 + `web_search_20260209`, reply parsed by `parseRateReply`,
  0–15% sanity) and cached on the org server-side; until it lands (or if the
  lookup fails) the default prices the quote. Ops → Settings lists the ZIP
  rates (`components/ZipTaxRates.tsx`): edit = source "owner" (never
  replaced by a lookup), add, remove. Quotes store `materialTaxZip` with
  `materialTaxPct`; the stored rate is kept unless the address moved ZIPs.
- Timed promo codes (**ALREADY RUN in prod 2026-10-20**, migration
  `promo_redemptions`): table `promo_redemptions(promo_id, org_id, redeemed_at,
  UNIQUE(promo_id, org_id))`, RLS on, service-role only. `/api/promo/apply`
  falls through from the PROMO_CODES env list (= comp forever) to
  `lib/promo-timed.ts` TIMED_PROMOS (SHA-256 hash of the code, months,
  maxUses — the plain code is NOT in the repo): sets `trial_ends_at` to
  max(current free end, now + months) and counts the use. `orgTrialEnd()`
  (lib/trial.ts) = later of the signup trial and trial_ends_at; BillingGate's
  pre-Stripe branch and create-checkout-session use it, so subscribing early
  keeps the promo time as the Stripe trial. First code: `first-customer-3mo`
  (3 months, 1 business), given to the owner 2026-10-20.
- Mileage start times (**ALREADY RUN in prod 2026-10-17**, migration
  `mileage_start_time`): `ALTER TABLE mileage ADD COLUMN IF NOT EXISTS start_time TEXT;`
  ("8:05 AM", time-entry format). GPS / odometer / Work-mode tracker trips and
  manual entries with a time store it; older + Suggested-trip rows get an
  estimate ("~") from that day's clock-ins (`lib/mileage-days.ts`
  `legStartTimes`: leaving a job = its clock-out, leaving the shop = next
  arrival − drive time). The trip log groups by day with numbered legs and an
  inferred "from" (previous stop; first leg = org address).
- Pay stub paid-out status (**ALREADY RUN in prod 2026-10-19**, migration
  `pay_history_paid_status`, RLS rehearsed in a rolled-back txn: owner 1 row,
  tech 0): `pay_history.paid_at TIMESTAMPTZ` + `paid_method TEXT`
  (cash|check|deposit|app) and policy "Admins update pay_history" (owner/
  manager UPDATE — the table had NO update policy, so any patch silently hit 0
  rows). Payroll → Payment history: each stub has **Mark paid** (method sheet)
  / a Paid chip (tap to undo); crew see Paid / Not paid yet on their own stubs;
  the employee list shows "N to pay · $X" for unpaid stubs from the last 30
  days. Stubs from before this are unpaid in the data (not backfilled).
- `ALTER TABLE profiles ADD COLUMN photo_url TEXT;`
- `ALTER TABLE organizations ADD COLUMN trip_fee NUMERIC DEFAULT 0;`
- Primary trade (per-trade tailoring — picked in onboarding + Ops → Settings):
  `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS primary_trade TEXT DEFAULT 'handyman';`
  Drives defaults via `src/lib/trades.ts` `TRADE_CONFIG` (rate, materials,
  inspection checklist, quote units, Grizz copy, starter quote items). Reads
  coalesce through `resolvePrimaryTrade(org.primary_trade)` → `'handyman'`, so
  existing orgs are unchanged until they pick. Until this runs, saving a trade
  toasts a "column does not exist" error (best-effort) but nothing breaks.
  NOTE three trade namespaces stay separate: primary_trade ids (trades.ts keys)
  vs. the parser's `TRADE_CATEGORY_LIST` (quote buckets + `trade_rates` keys)
  vs. materials-db categories. `primaryTradeToRateCategory()` bridges ids→rate
  keys; only clean-match trades (plumber/electrician/hvac/painter/flooring) seed
  `trade_rates`, so the "General" catch-all is never polluted.
- Per-org brand color (threads through app accents, the digital business card,
  and every PDF):
  ```sql
  ALTER TABLE organizations ADD COLUMN brand_color TEXT DEFAULT '#2E75B6';
  ALTER TABLE organizations ADD COLUMN brand_color_2 TEXT;
  ```
  Picked in Ops → Settings → Brand color (`BrandingSettings`). `ThemeProvider`
  sets `--color-primary`/`--color-primary-soft`/`--brand-ink`/`--brand-grad`
  from `brand_color` at load (inline on `<html>`, so it survives the dark/light
  toggle); ROYGBIV statuses + success/danger use their own tokens and are NOT
  retinted. `print-template.ts` `printStyles({accent, accent2})` takes it per-PDF
  (passed at every `wrapPrint` call site + threaded through export-pdf /
  export-job-report / payroll-runner / quote-pdf, and the public /api/public/job
  + /api/portal/me selects). Color helpers (luminance → ink, shade/lighten/
  gradient) live in `src/lib/brand.ts`. Until the migration runs, saving a color
  toasts a "column does not exist" error (best-effort) but nothing breaks;
  existing orgs default to #2E75B6. **The 2nd (gradient) color now reaches the
  app UI (2026-10-07)**: ThemeProvider also sets `--color-primary-2` (= 2nd
  color, else lighten(c1,30)) and `--accent-glow` / `--accent-glow-2`
  ("r, g, b"; default 46,139,255 for orgs that never picked a color, so they
  look exactly as before). `.bb`, `.vnav button.act`, `.dhead` and the
  `.glow-blue` CTA ("Start a Quote") use them; the tokens' defaults live in a
  plain `:root` block (not `@theme`, which Tailwind may prune). The dashboard
  topbar is deliberately PLAIN (owner asked; a brand-color banner looked bad
  on the dark screen): greeting + name left · the logo centered with no
  tile/background · bell + settings right (`1fr auto 1fr` grid). Ask Grizz
  lives in More, not the topbar.
- Per-org quote-PDF terms (the "Notes & Exclusions" footer reacts to these
  instead of hardcoded 30-day / 50%-deposit text):
  ```sql
  ALTER TABLE organizations ADD COLUMN deposit_pct NUMERIC DEFAULT 50;
  ALTER TABLE organizations ADD COLUMN quote_valid_days NUMERIC DEFAULT 30;
  ALTER TABLE organizations ADD COLUMN quote_terms TEXT;
  ```
  Set in Ops → Settings → Quote terms (deposit %, validity days, free-text
  custom terms one-per-line). `export-pdf.ts` reads them (defaults 50 / 30 /
  none) and threads via `quote-pdf.ts` + the public `/api/public/job` +
  `/api/portal/me` selects so the customer's downloaded copy matches. Until the
  migration runs, saving toasts "column does not exist" (best-effort) but the
  PDF falls back to 50% / 30 days.
- Schedule ↔ job link (**ALREADY RUN in prod 2026-10-02**, migration
  `schedule_job_id`, backfilled to the latest job at that address created on/
  before the entry's date): `ALTER TABLE schedule ADD COLUMN job_id uuid;`.
  Schedule.tsx used to match entries to jobs by the address TEXT, so a new job
  at an address that had ever been scheduled (repeat / property-manager work)
  never showed as Unscheduled. Now `isScheduled(job)` = a linked entry for that
  job, or a legacy unlinked entry at that address NOT older than the job;
  `jobForEntry(e)` resolves the linked job. Jobs → Schedule passes the job id
  (`preSelectJobId`), quickAdd writes `job_id`, AppFolio imports link it too.
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
- Cron observability — `cron_log` (every cron invocation, incl. rejected ones,
  writes a row, so a scheduled run that never reaches the endpoint is visible):
  ```sql
  CREATE TABLE IF NOT EXISTS cron_log (
    id uuid primary key default gen_random_uuid(),
    endpoint text,                 -- 'auto-run'
    invoked_at timestamptz default now(),
    authorized boolean,
    auth_via text,                 -- cron_secret | x-vercel-cron | admin_token | owner_session | rejected
    is_vercel_cron boolean,
    user_agent text,
    force boolean,
    enabled_orgs int,
    total_paid int,
    total_skipped int,
    result jsonb
  );
  ALTER TABLE cron_log ENABLE ROW LEVEL SECURITY;  -- service-role only
  ```
  `/api/payroll/auto-run` writes a row on reject (`auth_via='rejected'`), on
  success, and on error — all best-effort (a missing table never blocks payroll).
  **Also set `CRON_SECRET`** (any long random string) in Vercel + redeploy:
  Vercel then sends `Authorization: Bearer <CRON_SECRET>` on cron calls, which
  `isAuthorized()` validates — the reliable auth path (vs. the flaky
  `x-vercel-cron` header). Diagnose: `select invoked_at, authorized, auth_via,
  is_vercel_cron, total_paid from cron_log where endpoint='auto-run' order by
  invoked_at desc limit 20;` — a `cron_secret` row with `total_paid>0` = working;
  a `rejected` row (or no row at all) = the cron isn't reaching/authing.
- `ALTER TABLE jobs ADD COLUMN archived BOOLEAN DEFAULT FALSE;`
- `ALTER TABLE jobs ADD COLUMN archived_at TIMESTAMPTZ;`
- `ALTER TABLE jobs ADD COLUMN review_requested_at TIMESTAMPTZ;`
- `ALTER TABLE time_entries ADD COLUMN paid_at TIMESTAMPTZ;`
  (Payroll now sets this instead of deleting the row, so Team Stats
  can compute lifetime hours/earnings. Existing rows have it NULL =
  unpaid, which is the correct state for any pre-migration entries
  the org has already paid out by hand. To retroactively flag those
  as paid: `UPDATE time_entries SET paid_at = NOW();`)
- GPS clock stamps (**ALREADY RUN in prod 2026-09-14** via the Supabase MCP,
  migration `time_entries_gps_stamps` — listed for other environments):
  ```sql
  ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS start_lat DOUBLE PRECISION;
  ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS start_lng DOUBLE PRECISION;
  ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS start_acc NUMERIC;
  ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS end_lat DOUBLE PRECISION;
  ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS end_lng DOUBLE PRECISION;
  ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS end_acc NUMERIC;
  ```
  Clock-in/out (Timer + WorkVision) fire-and-forget a one-shot `getFix` and
  patch the stamp onto the entry — never blocks payroll actions; ONE-SHOT
  fixes only, on the clock only, no background tracking (impossible in a PWA
  on iOS anyway). Between stamps, the live crew-location heartbeat (next
  entry) fills in while the app is open. Consumers: Crew Activity 📍in/📍out
  map links, `ClosestTechHint` (Jobs detail dispatch: crew ranked by distance
  from where they are now — dispatch-week `crewNow`, live fix when newer,
  else the last stamp TODAY — to the job, ETA via `driveMinutes`), Schedule day-view
  `RouteOptimizer` (nearest-neighbor + 2-opt stop order, display-only), and
  Mileage `SuggestedTrips` (day chain from clocked jobs, one-tap logging).
  Geocoding: `geocodeAddress`/`hasGeocodeCache` in `src/lib/geo.ts` —
  OpenStreetMap Nominatim, no API key, cached forever per address in
  localStorage; throttle uncached lookups ~1/s per their policy.
- Live crew locations (**ALREADY RUN in prod 2026-10-19** via the Supabase
  MCP, migration `crew_locations` — the owner approved it; tracking location is
  their privacy call. RLS rehearsed first in a rolled-back txn: tech on
  the clock writes own row + server-stamped `at`, off-clock tech/manager
  insert refused, can't write for another user or move to another org, tech
  sees 1 row (own), owner/manager see the org's, other org sees only its own,
  anon denied):
  ```sql
  CREATE TABLE IF NOT EXISTS crew_locations (
    user_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
    org_id UUID NOT NULL,
    lat DOUBLE PRECISION NOT NULL CHECK (lat BETWEEN -90 AND 90),
    lng DOUBLE PRECISION NOT NULL CHECK (lng BETWEEN -180 AND 180),
    acc NUMERIC CHECK (acc >= 0),
    at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS idx_crew_locations_org ON crew_locations(org_id);
  CREATE OR REPLACE FUNCTION crew_locations_stamp() RETURNS trigger
    LANGUAGE plpgsql SET search_path = pg_catalog AS $$
  BEGIN NEW.at := now(); RETURN NEW; END $$;
  DROP TRIGGER IF EXISTS crew_locations_stamp ON crew_locations;
  CREATE TRIGGER crew_locations_stamp BEFORE INSERT OR UPDATE ON crew_locations
    FOR EACH ROW EXECUTE FUNCTION crew_locations_stamp();
  ALTER TABLE crew_locations ENABLE ROW LEVEL SECURITY;
  REVOKE ALL ON crew_locations FROM anon;
  CREATE POLICY crew_locations_select ON crew_locations FOR SELECT TO authenticated
    USING (org_id = auth_org_id() AND (user_id = auth.uid() OR auth_role() IN ('owner','manager')));
  CREATE POLICY crew_locations_insert ON crew_locations FOR INSERT TO authenticated
    WITH CHECK (user_id = auth.uid() AND org_id = auth_org_id()
      AND EXISTS (SELECT 1 FROM time_entries te WHERE te.user_id = auth.uid()::text
        AND te.org_id = auth_org_id() AND te.end_time IS NULL AND coalesce(te.start_time, '') <> ''));
  CREATE POLICY crew_locations_update ON crew_locations FOR UPDATE TO authenticated
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid() AND org_id = auth_org_id()
      AND EXISTS (SELECT 1 FROM time_entries te WHERE te.user_id = auth.uid()::text
        AND te.org_id = auth_org_id() AND te.end_time IS NULL AND coalesce(te.start_time, '') <> ''));
  ```
  One row per user, overwritten (no location history). Writer =
  `src/lib/crew-heartbeat.ts` (started by AppShell `useCrewHeartbeat`): while
  THIS phone is on the clock (c_t_on + c_t_active_id) AND the app is visible,
  a one-shot `getFix` every ~4 min (`HEARTBEAT_MS`; the clock-in's own stamp
  counts as the first) and on each return to the app (`visibilitychange` /
  `pageshow`, unless the last try was <60 s ago) → upsert `{user_id, org_id,
  lat, lng, acc}` (server stamps `at`). Fixes worse than 100 m are dropped;
  the clock + user are re-checked after the fix lands (clock-out / sign-out /
  switching away mid-fix → nothing sent). Only uses a location permission
  already GRANTED (Permissions API "prompt"/"denied" → off; clock-in is what
  asks) — it never pops a prompt. Silent by design: Supabase is called
  directly (no db.* toasts); a missing table (PGRST205/42P01) is probed once,
  remembered for an hour (`c_crewloc_missing_until`) and nothing — not even a
  GPS fix — happens until it exists. RLS refuses a row from anyone without an
  open shift (stale months-old open rows would still pass — the client gate is
  the real one). Rules + knobs are PURE in `src/lib/crew-location.ts`
  (`heartbeatDue`, `usableFix`, `liveFixFor`, `LIVE_FRESH_MIN` = 15; tested in
  `crew-location.test.ts`). Readers: `store.crewLocations` (owner/manager only,
  fetched beside the main batch, strict + settle like flip_projects — a missing
  table never blocks sync; deliberately NOT in the offline snapshot, and
  `crew_locations` is in supabase.ts `NO_CREATED_AT`); dispatch-week `crewNow`
  prefers a fix from TODAY newer than the last clock stamp (a stamp in the same
  minute wins) and returns `kind:"live"` + `ageMin`; Dispatch "Crew right now"
  tags each on-the-clock tech "live · 3 min ago" (green while ≤15 min, else
  "location from 2:14 PM") vs "last stamp 9:30 AM"; Crew Map (today) puts the
  avatar on the live fix with a green ring (faded once stale) at the end of the
  dashed path; Jobs `ClosestTechHint` uses `crewNow` too. Techs see
  `components/LocationSharingNote.tsx` "Sharing location while on the clock"
  in Time (on-the-clock card) and Work mode (under the job row) whenever the
  heartbeat can share (hidden off the clock, without permission, or while the
  table is missing). Deliberately NOT in preflight `DB_CHECKS` (optional).
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
- Memberships / service plans (recurring revenue + auto-visits):
  ```sql
  CREATE TABLE IF NOT EXISTS membership_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL,
    name TEXT NOT NULL,
    price NUMERIC NOT NULL,
    interval TEXT NOT NULL CHECK (interval IN ('monthly','quarterly','annual')),
    included JSONB,                 -- { description } (+ optional rooms template)
    visits_per_year INTEGER NOT NULL DEFAULT 12,
    is_active BOOLEAN DEFAULT TRUE,
    stripe_price_id TEXT,           -- created lazily on first enroll; cleared on price/interval edit
    created_at TIMESTAMPTZ DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS idx_membership_plans_org ON membership_plans(org_id);
  CREATE TABLE IF NOT EXISTS customer_memberships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL,
    customer_id UUID NOT NULL,
    plan_id UUID NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','past_due','paused','cancelled')),
    stripe_subscription_id TEXT,
    started_at TIMESTAMPTZ DEFAULT now(),
    next_bill_at TIMESTAMPTZ,       -- synced from Stripe by the webhook
    next_visit_at TIMESTAMPTZ,      -- advanced by the recurring cron
    created_at TIMESTAMPTZ DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS idx_customer_memberships_org ON customer_memberships(org_id);
  CREATE INDEX IF NOT EXISTS idx_customer_memberships_sub ON customer_memberships(stripe_subscription_id);
  CREATE INDEX IF NOT EXISTS idx_customer_memberships_visit ON customer_memberships(next_visit_at) WHERE status = 'active';
  ALTER TABLE membership_plans ENABLE ROW LEVEL SECURITY;       -- service-role only
  ALTER TABLE customer_memberships ENABLE ROW LEVEL SECURITY;   -- service-role only
  ```
  Billing reuses Stripe Connect: enroll (owner-initiated, `/api/memberships/checkout`)
  opens a HOSTED Checkout (`mode:'subscription'`) — never card data in-app. The
  sub is a DESTINATION charge (lives on the platform, `subscription_data.transfer_data`
  → the org's connected account, `application_fee_percent` = 0.5% / 0% Pro via
  `membershipFeePercent()`). The webhook (`/api/stripe/webhook`) distinguishes
  membership subs from the ORG's own plan-billing sub by `metadata.membership==='1'`
  (else `syncMembership` would corrupt org status) and handles checkout.session.completed
  / subscription.* / invoice.paid / invoice.payment_failed. Visits auto-spawn from
  the SAME daily `/api/recurring/fire` cron (a second loop over `customer_memberships`
  where `next_visit_at <= now`), creating a `jobs` row from the plan's `included`
  and advancing `next_visit_at` via `computeNextFire()` (cadence from
  `visitCadence(visits_per_year)` in `src/lib/memberships.ts`). Manage (pause/resume/
  cancel) via `/api/memberships/manage` (owner). UI: Ops → **Recurring & Plans**
  → "Memberships" toggle (`MembershipsPanel`, plan CRUD, sharing the tab with
  Recurring via `RecurringMemberships`) + CustomerDetail (enroll + active-plan card).
  Customers SELF-MANAGE from the portal (`/portal` → "Your membership" card):
  Cancel (`/api/portal/membership-cancel`, one-tap link + confirm —
  click-to-cancel compliant), Pause/Resume (`/api/portal/membership-pause`,
  Stripe `pause_collection: void` + status flip; paused already stops the
  visit cron), Update card (`/api/portal/membership-card` → Stripe Billing
  Portal session on the platform account; auto-creates a minimal portal
  configuration if none is saved). No plan → a "Join" upsell card enrolls
  self-serve via `/api/portal/membership-checkout` (same destination-charge
  sub + metadata as the owner flow so the existing webhook creates the row;
  `customer_id` from the portal session, never the body). All four are
  portal-cookie authed + scoped to the session's customer_id/org_id.
  `/api/portal/me` returns memberships (+ plan name/price/included/
  visits_per_year), the org's active `plans` when the customer has none
  (upsell data), and `stripe_connected` (boolean only — the account id is
  stripped server-side). Requires the org's Stripe to be connected. Until the migration runs, saving a plan / loadAll toast a "table
  does not exist" error; nothing else breaks. No new env (reuses STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET, CRON_SECRET).
- Equipment / asset history (per-customer serviced units — no Stripe, one table):
  ```sql
  CREATE TABLE IF NOT EXISTS equipment (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID,
    customer_id UUID,
    address_id UUID,
    property TEXT,
    kind TEXT NOT NULL,             -- hvac | furnace | water_heater | panel | other (free-text ok)
    make TEXT,
    model TEXT,
    serial TEXT,
    installed_at DATE,
    warranty_until DATE,
    notes TEXT,
    photos JSONB,                   -- [{ url, label? }]
    last_service_at TIMESTAMPTZ,    -- auto-stamped when a linked job completes
    created_at TIMESTAMPTZ DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS idx_equipment_org ON equipment(org_id);
  CREATE INDEX IF NOT EXISTS idx_equipment_customer ON equipment(customer_id);
  ALTER TABLE jobs ADD COLUMN IF NOT EXISTS equipment_id UUID;
  ```
  CRUD lives in `EquipmentSection.tsx` (rendered in CustomerDetail, above
  Memberships); `store.ts` `upsertEquipment`/`deleteEquipment` + `equipment[]`
  loaded in `loadAll`. Photos go to the PUBLIC `receipts` bucket
  (`equipment/…`), like logos/renders (not the private receipts path). A job is
  linked to a unit via the **Serviced unit** picker on the Jobs detail screen
  (only shown when the job's customer/property already has equipment on file);
  it sets the top-level `jobs.equipment_id` column directly (no rooms blob).
  When that job completes — BOTH the Jobs status-flip AND WorkVision's Complete
  Job — `equipment.last_service_at` is stamped (best-effort). Until the migration
  runs, saving a unit / linking a job toasts a "table/column does not exist"
  error (best-effort) but nothing else breaks; existing orgs see no Equipment
  card until they add one.
- Flip Mode (the org's own buy → renovate → resell deals; plan in
  `.claude/plans/flip-mode.md`) (**ALREADY RUN in prod 2026-10-17** via the
  Supabase MCP, migration `flip_projects` — RLS rehearsed in a rolled-back txn:
  owner writes, cross-org insert blocked, tech sees 0 rows / can't write):
  ```sql
  CREATE TABLE IF NOT EXISTS flip_projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL,
    address TEXT NOT NULL,
    beds NUMERIC, baths NUMERIC, sqft NUMERIC,
    status TEXT NOT NULL DEFAULT 'analyzing'
      CHECK (status IN ('analyzing','acquired','active','listed','sold','dead')),
    purchase_price NUMERIC DEFAULT 0,
    rehab_budget NUMERIC DEFAULT 0,
    arv NUMERIC DEFAULT 0,               -- after-repair value
    down_pct NUMERIC DEFAULT 15,
    holding_monthly NUMERIC DEFAULT 0,   -- taxes + ins + utilities + interest / month
    holding_months NUMERIC DEFAULT 5,
    financing_cost NUMERIC DEFAULT 0,    -- points / origination
    selling_pct NUMERIC DEFAULT 6,       -- agent + closing, % of ARV
    contingency NUMERIC DEFAULT 0,
    comps JSONB,                         -- [{address, price, sqft, sold_at, note}] (Phase 2)
    acquired_at TIMESTAMPTZ,             -- starts the holding-cost clock (Phase 2)
    sold_at TIMESTAMPTZ,
    sold_price NUMERIC,
    created_at TIMESTAMPTZ DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS idx_flip_projects_org ON flip_projects(org_id);
  ALTER TABLE flip_projects ENABLE ROW LEVEL SECURITY;
  CREATE POLICY flip_projects_admin ON flip_projects FOR ALL TO authenticated
    USING (org_id = auth_org_id() AND auth_role() IN ('owner','manager'))
    WITH CHECK (org_id = auth_org_id() AND auth_role() IN ('owner','manager'));
  ALTER TABLE jobs ADD COLUMN IF NOT EXISTS flip_project_id UUID;  -- Phase 2 job linking
  ```
  Owner/manager only (investor money) — same posture as `recurring_jobs`
  writes; crew get no rows. The client writes it directly (db.post/patch), so
  RLS needs the policy above, NOT service-role-only (RLS on + no policy =
  nothing ever saves). Until this runs, starting a flip toasts a "table does
  not exist" error; nothing else breaks — `loadAll` fetches flip_projects
  OUTSIDE the main batch (strict + settle → silent null, not counted toward
  `fullSyncAt` / the snapshot gate), so a missing table can't toast every 15s
  or block the offline snapshot. Deliberately NOT in preflight `DB_CHECKS`
  (optional feature, like brand_color).
  Phase 3 adds one column (subcontractor bids + permits, JSONB; **ALREADY
  RUN in prod 2026-10-17** via the Supabase MCP, migration `flip_projects_subs`):
  `ALTER TABLE flip_projects ADD COLUMN IF NOT EXISTS subs JSONB;`
  Lender draws add one more (lender + draw schedule, JSONB; **ALREADY RUN in
  prod 2026-10-19**, migration `flip_projects_loan`):
  `ALTER TABLE flip_projects ADD COLUMN IF NOT EXISTS loan JSONB;`
  In an environment missing either column, editing that part of a flip
  toasts "column does not exist" — and because the analyzer batches edits
  into one patch, other edits made in the same ~0.7s are lost with it.
- Payments ledger / partial payments (deposits). Before this, `/api/verify-payment`
  set `status:'paid'` on ANY completed Stripe session — a 50% deposit marked the
  whole job paid, and nothing recorded how much was paid, so the balance could
  never be invoiced.
  ```sql
  CREATE TABLE IF NOT EXISTS payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL,
    job_id UUID NOT NULL,
    amount NUMERIC NOT NULL,              -- dollars; NEGATIVE for refunds
    kind TEXT NOT NULL DEFAULT 'payment', -- deposit | balance | payment | refund
    stripe_session_id TEXT UNIQUE,        -- idempotency key (NULL-able; refunds use 'refund_<pi>')
    stripe_payment_intent_id TEXT,
    platform_fee_cents INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS idx_payments_job ON payments(job_id);
  CREATE INDEX IF NOT EXISTS idx_payments_org ON payments(org_id);
  ALTER TABLE payments ENABLE ROW LEVEL SECURITY;  -- service-role only
  ALTER TABLE jobs ADD COLUMN IF NOT EXISTS amount_paid NUMERIC DEFAULT 0;
  ```
  A job's paid-to-date is `SUM(payments.amount)`, cached on `jobs.amount_paid`.
  `stripe_session_id UNIQUE` is what makes `/api/verify-payment` idempotent — a
  refreshed `/payment/success` can't double-count a deposit. `/api/checkout`
  clamps every charge to the OUTSTANDING BALANCE (`total - amount_paid`), so a
  deposit followed by a balance payment can never over-collect, and the owner's
  Send-link / Collect-now buttons bill the balance (not `job.total`).
  `status` flips to `'paid'` **only** when `amount_paid >= total`; the review
  request is scheduled only then (never after a deposit). The `charge.refunded`
  webhook writes a negative row (one per PaymentIntent, carrying the cumulative
  `amount_refunded`, upserted so retries are idempotent) and reverts a `paid`
  job to `invoiced` when it no longer covers the total. Until the migration
  runs, the code degrades to a single-payment check (a lone deposit still won't
  mark the job paid) instead of erroring on a real customer payment.
  **Getting paid UX (2026-10-02)**: "Mark paid" is gone — owners log cash /
  check / own-terminal card via **Record payment** (`/api/payments/record`,
  owner-only, service role) which goes through the same `recordJobPayment`
  (ledger row `stripe_session_id = manual_<client uuid>` = idempotency key;
  kind = cash|check|card|other; never overwrites a card payment's
  stripe_payment_intent_id) → paid only when covered, review request then
  scheduled. `scheduleReviewRequest` skips jobs with `review_requested_at`
  (already asked by hand). Jobs: Complete → **Send invoice** (send strip
  `kind:"invoice"`; Open Messages/Copy is what flips complete→invoiced —
  printing the PDF no longer does); invoice PDF + text show paid-to-date and
  the BALANCE. /status: complete/invoiced jobs get "Pay your balance" even
  without an online signature; deposit default = org.deposit_pct (0 → pay in
  full only). /api/checkout refuses orgs with no stripe_account_id (the charge
  would have landed on the platform) and returns plain errors; cancel returns
  to the referring /status page. /payment/success uses verify-payment's
  fullyPaid/balance + the org's logo + a signed /status link.
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
- Payment-received notifications — widen the notifications type CHECK so a
  `payment_received` row (owner/manager money-in alert) can be inserted:
  ```sql
  ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
  ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
    CHECK (type IN ('job_assigned','new_lead','payment_received'));
  ```
  (`notifications_type_check` is Postgres's default name for the inline column
  CHECK the table was created with, so the DROP matches.) `notifyJobPaid` in
  `lib/notify-server.ts` fires from BOTH the Stripe webhook and
  `/api/verify-payment` after a charge is recorded — gated on
  `!result.alreadyRecorded` so a charge alerts exactly once across the two
  fulfillment paths. It notifies the org's owners+managers on ANY recorded
  customer charge (deposit or balance; copy says "Payment received" with the
  running balance, or "Paid in full"). In-app feed always writes; SMS/push ride
  the existing `NOTIFY_SMS_ENABLED` / VAPID gates. Best-effort/try-caught, so a
  notification failure never affects payment recording. **Until this migration
  runs the in-app insert fails the CHECK and the alert is a logged no-op — the
  payment itself still records fine.** There's no per-event opt-out column for
  payments yet (recipients are hardcoded owner/manager, always opted in).
- Payday alert — widen the notifications CHECK again for `payroll_alert`
  (**ALREADY RUN in prod 2026-09-14** via the Supabase MCP, migration
  `notifications_payroll_alert_type` — listed here for other environments):
  ```sql
  ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
  ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
    CHECK (type IN ('job_assigned','new_lead','payment_received','payroll_alert'));
  ```
  Every SCHEDULED (non-force) auto-payroll run that attempts an org's payday
  now notifies owners+managers with the outcome via `notifyPayrollAlert`
  (`lib/notify-server.ts`): "Auto payroll ran — paid N · $X", "nothing to
  pay", or "had problems: <first error>" — so a skipped/failed payday is a
  same-evening alert instead of silence (the week-of-9/12 failure mode:
  Vercel never invoked the cron on payday, then the retry died on a
  Supabase Gateway Timeout; also mitigated by the second daily cron
  invocation at 21:00 UTC in vercel.json — safe to double-invoke because
  the day check + cadence debounce + paid_at stamps make the endpoint
  idempotent). Manual Run-now/Process-all runs don't alert (the tapper
  already gets the toast). Same-day dedupe on (org,title,body) suppresses
  the 21:00 duplicate on no-op paydays. In-app always; SMS/push ride the
  existing gates. No per-event opt-out yet.
  `ALTER TABLE referrals ADD COLUMN referred_by_user_id UUID;`
  Stamped on creation from Quests → Referrals (the logged-in tech). The
  quest engine (`lib/quests.ts`) + the Quests screen now count only
  converted referrals where `referred_by_user_id = <user>`. Legacy rows +
  public/website submissions have a NULL referrer and credit no individual
  tech; backfill with `UPDATE referrals SET referred_by_user_id = '<uid>'
  WHERE …` to make old ones count. Until the column exists, adding a
  referral from the Quests tab toasts a "column does not exist" error.

(The app handles missing columns gracefully — db helpers toast the
"column does not exist" error so the user notices.)

## Big systems shipped recently (for context)

- **AI draft quotes for website leads (2026-10-24)**: `/api/leads` (public
  intake: the creedhandyman.com form + the app's /lead/<slug> page) now runs
  `lib/lead-draft.ts draftLeadQuote` in Next's `after()` (route maxDuration
  300) once the lead is saved + the "New lead" alert sent. It's the SAME
  engine as Quick Quote — `aiParsePdf` gained an optional `ParserDeps`
  {getCorrections, callAi} so it can run server-side with the org's own
  price_corrections (service role, filtered by org_id) and `callClaude`
  (`lib/anthropic-server.ts`, now shared with /api/ai: key, Sonnet 5.5
  refusal fallback, ai_usage logging; call_type `lead_draft`). Result is
  validateQuote'd and stored on the lead blob as `leadDraft {v, rooms,
  estDays, total, at}` (status stays "lead"; written only while the job is
  still an unquoted lead). `draftTotal` (tested) = QuoteForge's default
  pricing (per-room rate, materials + ZIP purchase tax + markup, min-labor /
  trip fee / tax cascade). Owners/managers then get "Draft quote ready · $X"
  (type new_lead, notify_leads). Guards: needs ≥8 chars of description or a
  photo; max `DRAFTS_PER_DAY` = 25 per org per 24h. App: Jobs lead card hint
  "AI draft ready · $X" + CTA "Review draft quote · $X"
  (`lib/lead-draft-info.ts leadDraftTotal`, client-safe); QuoteForge opening
  a lead with a `leadDraft` loads those rooms straight into the editor
  (customer photos as "before" photos, estDays) instead of re-running the
  AI; Save/Send turns it into the quote as before. Any failure = the old
  behavior (Build Quote runs the AI on the phone). Flow tested end-to-end
  with a fake db + AI (`lead-draft-flow.test.ts`). NOTE the website form
  sends no photos (it asks people to text them), so website drafts are
  text-only; the /lead/<slug> page does send photos.

- **Quick Quote Voice Walk (2026-10-23)**: Quick Quote has a green (cGreen,
  same as Full Inspection) **VOICE WALK** card above the description. Tap →
  a skippable how-to sheet (Skip / Start recording, "Don't show this again" =
  localStorage `c_qq_vw_tip_off_<uid>`) → the Inspection's own `VoiceWalk`
  screen (single "Walk & talk" area, empty checklist) with new props
  `autoStart` (camera + mic turn on at once), `doneLabel` / `doneHint`. Done
  → photos join `quickPhotos`, the audio is Whisper-transcribed
  (`/api/transcribe`, live-preview text as fallback) and appended to
  `quickDesc`; the user reviews, then Generate. Phone back closes the walk
  (layer re-armed). The separate "Talk it through" DictateButton was removed
  (owner: redundant next to Voice Walk) and its component deleted.
  **Quote sub-screen headers unified (2026-10-23)**: every QuoteForge
  sub-screen (Quick Quote, From Template, Upload Report, Manual / New
  Service, Building Quote, the editor) + Inspector (areas / room / review) +
  VoiceWalk use `<TopBar onBack>`; the icon-tile colour = the hub card that
  opens it (`QF_HUE` in QuoteForge: Quick Quote gold, inspection + Voice Walk
  green #3ee08f, Upload Report blue, templates violet).

- **Schedule alerts + phone-calendar feed (2026-10-23)**: (1) **Alerts** —
  every client schedule write (Schedule quick-add/edit/delete, Dispatch
  Apply plan, Jobs delete-job) builds notices with
  `lib/schedule-notify-client.ts noticesFor(before, after)` → pure
  `lib/schedule-notify.ts scheduleNotices` (tested): crew = note 👷 list +
  the job's requested tech; added → "You're scheduled", moved/re-timed →
  "Visit changed (was …)", dropped/deleted → "Taken off a visit"; note-only
  edits and visits entirely in the past tell nobody. POST
  `/api/notify/schedule` (any org member) resolves names → active profiles
  in the org, skips the person who made the change, writes the text itself
  (`messagesFor`: 3+ for one person in one batch = one "Your schedule was
  updated" summary), notification type `job_scheduled` (migration
  `notifications_job_scheduled_type`, ALREADY RUN 2026-10-23), honoring
  `notify_assigned` (label now "When I'm assigned or scheduled on a job").
  AppFolio imports don't alert. (2) **Calendar subscribe link** — Settings →
  "Schedule in your phone calendar" (`components/CalendarSubscribe.tsx`):
  iPhone (webcal:) / Google (calendar.google.com/r?cid=) / Copy / Reset;
  owners+managers can also take the "Whole crew" feed. `/api/calendar/link`
  mints a random token per (user, scope) in `calendar_feeds` (migration
  `calendar_feeds`, ALREADY RUN; RLS on, service-role only — the token is
  the credential, so it's NOT on profiles where coworkers could read it);
  reset = new token. `/api/calendar/feed/<token>.ics` (no login; NOT rate
  limited — Google/Apple fetch from shared IPs) serves visits from 30 days
  back to 6 months ahead via pure `lib/calendar-feed.ts buildCalendar`
  (tested): floating local times, untimed = all-day (multi-day spans), timed
  multi-day = one event per day, length = job hrs ÷ crew ÷ days (1–10 h,
  2 h unknown), archived jobs dropped, person must still be an active member
  of that org. Google/Apple refresh subscriptions every few hours — the
  in-app alert is the instant channel. Not done: a morning "your day" alert.

- **Desktop side menu (2026-10-21)**: the nav pick is ONE store field,
  `navMode` = auto | left | right | bottom (localStorage `c_navmode`; the old
  `c_navb`/`c_navl` flags migrate: bottom → auto). `lib/nav-layout.ts`
  `navLayout(mode, wide)` (wide = ≥1024px) decides the real layout: **auto =
  labeled side menu on a computer, bottom bar on a phone** (the default);
  left/right = side menu on a computer, the 56px icon rail on a phone;
  bottom = bottom bar everywhere. ThemeProvider sets `html.nav-side`
  (+ `nav-side-r`) / `nav-bottom` / `nav-left` from it; use
  `useNavLayout()` (not the raw mode) for layout checks (Jobs' sticky bulk
  bar does). The side menu = `SideNav` in VerticalNav.tsx (styles `.snav` /
  `.sn-*` in globals.css): Creed badge → Home · Quote · Jobs · Schedule ·
  Time, then Business (owner/manager: Customers / Payroll / Financials =
  `openOps(tab)` deep links, Operations), then Tools (Quests, crew's Time
  Off, Mileage, Crew Map + Flip Mode for admins, Fix-it, More), user card →
  Settings. Active row is tinted in the screen's TAB_COLOR. The page is
  centered in the space beside the menu; short screens (≤820px tall) get
  tighter rows. Phones are unchanged.

- **Dispatch Assistant — week route planner (2026-10-19)**: lives INSIDE
  Schedule → **Dispatch** tab (owner/manager): Schedule renders
  `screens/DispatchAssistant.tsx` above the manual "Needs scheduling" (Assign
  one job by hand) and "This week by tech" lists; crew see only those lists.
  No route / TopBar / More tile of its own any more. In the Dispatch view
  Schedule's topbar arrows step by WEEK and pass that week's Monday as `week`;
  once Mon–Fri have passed it offers "Next week" (`onNextWeek`). **Crew right
  now** (where each tech is — their live location from the on-the-clock
  heartbeat when newer, tagged "live · N min ago", else their last
  clock-in/out GPS stamp today, tagged "last stamp"; see "Live crew
  locations" in the migrations list — the job they're on, "Jordan is ~8 min
  from <next stop>") + **Plan the week** (days Mon–Sat,
  who's working — approved time off removes that tech's day — working hours,
  "also book quotes", "re-plan booked visits"). Engine = `lib/route-plan.ts`
  `planWeek` (PURE, tested): one route per (day, tech) from/to the shop;
  booked visits pinned to their day + crew (a promised 🕐 is a soft window,
  15 min grace; the planner never ADDS a late/overtime violation, an
  overbooked day is reported, not fixed); then phase by phase (booked →
  approved → quotes) the hard jobs first. A CREW job (the quote's Crew pick,
  `rooms.crewSize`; Auto = job-duration `planningCrew` — 2 for >8 h — capped
  at the people being planned) is ONE synchronized visit (2026-10-19): same
  day(s) + same start on `crew` techs' routes, wall time = hours ÷ crew; the
  start is the later arrival (the others wait, `crewWaitCost`/min) and is
  HARD on every member route (nothing inserted later may make one of them
  late; `syncCrews` re-derives it after local search); crew pieces never
  move on their own. A BOOKED crew visit (same entry on 2+ techs' routes
  that day) with no promised time gets the same crew start (planWeek step
  1b), unless lining it up would make someone late / run over — then it
  stays as booked and each stop says "with Jordan from 2:15 PM"; planWrites
  writes the latest start either way. Jobs over a day — or with the
  quote's AI `estDays` > 1 (`minDays`, cure waits) — take consecutive
  whole days, same crew each day.
  No fit → one more day with the full crew (a 9 h wall day doesn't fit
  around the drive) → one person fewer … → `plan.shortCrew` (screen: "a crew
  of 2 isn't free on the same days, so it's booked for 1 person over 2
  days") or unplaced. The rest by regret insertion (cost =
  detour minutes + `dayPenaltyMin`/day + `routeCostMin` to open an empty
  tech-day), then 2-opt/or-opt + relocate + swap. Distances = haversine ×
  ROAD_FACTOR at 28 mph + 10 min between stops, from a precomputed matrix
  (40 jobs × 4 techs × 5 days ≈ 30 ms). Glue = `lib/dispatch-week.ts`
  (tested): `collectWeek` (booked visits per day via day-plan `stopsForDay`;
  a job's hours split over all its calendar visit-days and its crew; done
  stops skipped; visits naming only people not in the plan — subs, techs
  toggled off — are left untouched; pool jobs carry `crew` + `minDays` from
  `quotePlanning(job)`), `toPlanInput`, `planWrites` (new job → ONE schedule
  row `🕐 quarter-hour · 👷 everyone on it`, + `end_date` for multi-day, job →
  scheduled; booked visits keep their promised time + named crew, get a time
  /tech only when they had none, move days only when re-planned),
  `crewNow`. Nothing writes until **Apply plan** (confirm). Route cards have
  Google Maps directions (shop → stops → shop) and a "Text" sms: link with the
  tech's day; crew stops say "with <name>". `components/RouteMap.tsx` =
  Leaflet route map (refits on resize). Limits: a booked crew visit that
  can't be lined up isn't moved to make room; a one-person job of ~8.5–9 h
  (with 8–5 hours) still reports no-room instead of splitting (only joint
  jobs get the extra-day retry); live
  location only while a tech is on the clock WITH THE APP OPEN (iOS can't run
  a backgrounded PWA's GPS; between those it's the last fix or stamp),
  straight-line drive estimates (no routing API).

- **Flip Mode — Phase 1 Deal Analyzer (2026-10-17)**: "should I buy this
  house?" for owners who flip their own properties. More hub → **Flip Mode**
  tile (owner/manager only; AppShell route `flip` is admin-gated too) →
  `screens/FlipAnalyzer.tsx`. ALL deal math is `src/lib/flip.ts`
  `analyzeFlip()` (pure, tested in `src/__tests__/flip.test.ts`): all-in =
  purchase + rehab + holding(×months) + loan fees + contingency; net sale =
  ARV − selling %; profit; cash-in = down % of purchase + everything else;
  ROI = profit ÷ cash-in; 70% rule max offer = ARV × 0.70 − rehab; verdict
  good / warn (profit < $20k OR over the 70% max) / bad (≤ $0). `RULE_70` /
  `THIN_PROFIT` are the knobs. Derived numbers are NEVER stored — only the
  inputs on `flip_projects` (`store.flipProjects`, `upsertFlipProject` /
  `deleteFlipProject`, in the offline snapshot). A new analysis is a
  phone-only draft (`c_flip_draft_<uid>`) until **Start this flip project**;
  saved projects autosave (700ms debounce, serialized writes, flushed on
  leave/switch). Rehab can be seeded from a saved quote's total ("Fill rehab
  from a quote…", quotes at that address listed first). Gold is Flip Mode's
  hue: `--flip-gold` (#ffcc00 dark / #a37800 light) + `.ipill` / `.track` /
  `.fill` / `.over` / `.bgold` in globals.css. The `Creed_Flip_Mode.html`
  mockup was not in the repo when this was built — the layout follows the
  plan doc + the app's section/drow style. **Phase 2 — project dashboard
  (2026-10-17)**: a saved flip gets a Deal / Dashboard switch (owned statuses
  open on Dashboard; `screens/FlipDashboard.tsx`). Jobs join a flip via
  `jobs.flip_project_id` — the Jobs detail **Flip project** picker
  (owner/manager, only once a flip exists; mirrors Serviced unit) or the
  dashboard's "Link a job…" select. All math is pure in `lib/flip.ts`
  (tested): `flipActuals` = per linked job, budget = its quote total vs
  actual = receipts + time entries (`makeEntryPay` from financials.ts:
  recorded amount, else hrs × CURRENT rate; rate ≤ 0 = $0 and surfaced as
  "N h with no pay rate", never a fallback rate; legacy no-job_id entries go
  to the OLDEST job at the address, same as Jobs' hours card). Lines are
  named by the job's work-order areas (every flip job shares one address).
  Receipts/time entries carry no trade, so budget-vs-actual is per JOB, not
  per trade. `holdingClock` = days (acquired_at → sold_at|now) × monthly ÷ 30.
  `analyzeFlipActuals` = analyzeFlip with spend swapped in: rehab = actual
  only once every linked job is complete (until then max(budget, spent) — no
  banking unfinished savings), holding = max(planned, to date) until sold,
  sold_price replaces ARV. Status changes stamp `acquired_at` (owned) and
  `sold_at` (sold; cleared when moved off sold); both dates + sold price are
  editable in the Project section. **Comps** (Deal view, `FlipComps`): 3 rows
  on `flip_projects.comps` (address, price, sqft, `status` sold|pending —
  JSONB, no migration), avg $/sq ft × the house's sq ft → "Use as ARV".
  **Phase 3 — subs, permits + resale package (2026-10-17)**: Dashboard view
  gets **Subcontractors & permits** (`screens/FlipSubs.tsx`, stored on
  `flip_projects.subs`): per trade a permit (none / needed / applied / issued /
  final + permit #) and up to 3 bids (company, amount, phone); **Hire** picks
  one (one per trade). `subsSummary` (lib/flip.ts, tested): sub budget = the
  hired bids; spend = what's been paid to ANY bid (money paid to a sub you
  later replaced is still spent). The dashboard adds sub payments to the
  rehab spend (so projected profit sees them), and "rehab done" also needs
  every hired sub paid in full. **Resale package** (Sell it → sheet →
  Create PDF; `lib/export-flip-resale.ts` over `resaleData`): facts,
  "What Was Done" = linked jobs' FINISHED work only (ticked work-order
  tasks, every task of a complete/invoiced/paid job, or a done job's quote
  lines when it has no work order; grouped by area, deduped), permits,
  before/after photos (job `rooms.photos` type before/after), nearby sales
  + avg $/sq ft. Off by default: AI renders (printed as "Design Concepts —
  not photographs") and the amount invested (buyers negotiate against it).
  **Lender draws (2026-10-17)**: Dashboard → **Lender & draws**
  (`screens/FlipDraws.tsx`, stored on `flip_projects.loan` = {lender,
  loan_no, contact, holdback, rate, draw_fee, draws[]}). Each draw: milestone,
  amount, status planned → requested → inspected → funded (`setDrawStatus`
  stamps requested_at/funded_at as YYYY-MM-DD, clears them moving back), fee
  override, note. Schedule seeds: one draw per linked job, or the holdback
  split into 4 standard milestones. `drawSummary` (tested): funded / waiting /
  left to draw, fees (on draws sent to the lender), interest on funded draws,
  "floating" (your cash covering rehab the lender hasn't paid back = min(spent,
  holdback) − funded) and "ready to draw" (spent not yet funded or
  requested). Money rules: `analyzeFlip` cash-in subtracts the financed rehab
  (min(holdback, rehab)) so ROI is on your own cash — the Deal view has a
  **Rehab financed** pill bound to `loan.holdback`; draw fees charged count as
  financing in `analyzeFlipActuals` (`drawFees`). **Draw request PDF**
  (`lib/export-flip-draw.ts`, per draw; printing a planned draw marks it
  requested): loan facts, holdback / funded to date / other unfunded requests
  / this request / fee / remaining, progress per linked job, finished work,
  recent after + in-progress photos, borrower + inspector signature lines.
  Still to do: compare two flips.

- **Day-rhythm Home + calm polish pass (2026-10-12)**: owner goal = "a
  reusable flow every day; using the app should relieve stress". Home keeps
  its layout (CTAs → day card → Needs you → money row → business card); only
  the DAY CARD changes: "Today" (stops in clock order, crew, "{done} of
  {total} done", amber row for a shift left open) → after 17:00 (or 15:00 with
  no stops left) "Wrap up the day" (crew off · tomorrow booked · payday) →
  "All caught up — enjoy your evening". Techs get "Your day" (own stops
  first) and "Done for today". **All day logic lives in `src/lib/day-plan.ts`**
  (pure, tested in `day-plan.test.ts`: stopsForDay, crewStatus, needMatch =
  the 2x2 predicates, dayPhase; WRAP_HOUR/LATE_HOUR are the knobs);
  `components/DayCards.tsx` only renders it. "Caught up" never shows before
  the first successful sync (`dataReady`). **Deep links** use the
  `c_nav_intent` sessionStorage contract (`src/lib/nav-intent.ts`: `{page,
  tab?, filter?, jobId?, at}`, 15s TTL, read once on mount) — readers: Jobs
  (tab + quick filter lead/toSend/waiting/toInvoice/unpaid, or jobId → detail),
  Schedule (day/week/month/dispatch), Timer (crew tab); several writers inline
  the same snippet (packages were built in parallel). The 2x2 tiles now open
  exactly the jobs they count; zero tiles dim. Other parts of the pass: Work
  mode resolves the job from the clock-in address first (a stale pinned id
  from a Time-tab clock-in used to show/complete the WRONG job); one calm
  Complete-Job question instead of up to four dialogs; clock-out confirms;
  `showConfirm(title, msg, {confirmLabel, cancelLabel, danger})` (danger =
  title only now — "cancel" in a message no longer paints a red DELETE);
  toasts can't be buried by "Syncing…" or a success right after an error;
  Timer uses LOCAL dates (after ~7 PM Central the UTC date showed tomorrow);
  Jobs: one next-step CTA per status, Follow up for sent quotes, tiered
  quotes text "Options from $X", pay-at-truck QR flips to "Payment received".
  **Owner decisions**: picking Paid on a job that still owes money asks
  "$X still owed" → Record payment / Just mark Paid / Cancel (admins; techs
  unchanged); bulk "Paid" records each job's remaining balance via
  `/api/payments/record` with one method pick; **approving a join request
  requires a pay rate** (TeamStats — one patch {status, rate}); techs keep
  Dispatch/Assign. Deferred (see the plan's list): server-checked clock state
  for force clock-out, back-button work in QuoteForge/Home deep links, shared
  TopBar, portal native dialogs. Local preview recipe used for this: a
  worktree `.env.local` with a placeholder Supabase URL (127.0.0.1) + a fake
  local session + an IndexedDB offline snapshot of demo data — loadAll's
  failed-fetch guard then serves the snapshot, so every screen renders.

- **creedhm.com SEO (2026-10-08)**: Google used to get only "Loading Creed..."
  from `/` (the page was one client component behind a `mounted` gate), with no
  robots/sitemap/canonical. Now `app/page.tsx` is a SERVER page (home metadata +
  canonical + JSON-LD @graph: Organization, WebSite, SoftwareApplication w/ an
  AggregateOffer of the 3 plans, FAQPage — NO aggregateRating until there are
  real on-page reviews) rendering `components/HomeGate.tsx` (the old client
  gate). Before mount HomeGate emits BOTH `.home-landing` (the landing) and a
  hidden `.home-boot` loading screen; an inline head script in `layout.tsx`
  sets `html[data-session]` when localStorage `c_user` has an id, and
  globals.css swaps which one shows — so crawlers/visitors get the landing in
  the first HTML and signed-in users never see it flash. Post-mount both
  branches return a fragment with `.home-landing` first so React keeps its DOM;
  an effect drops the flag once there's no user (stale cache / sign-out).
  MarketingShell's signed-in redirect skips `/`. `app/robots.ts` (blocks /api/
  /admin /portal /status /payment /onboarding /reset-password) + `app/sitemap.ts`
  (6 marketing pages — add new public pages there AND give them
  `alternates.canonical`). Marketing headlines are real `<h1>`/`<h2>` now
  (`.mkt .h1/.h2` classes kept, so the look didn't change). Home FAQ copy lives
  in `components/marketing/home-content.ts` (feeds the visible FAQ + FAQPage;
  plan prices there mirror pricing/page.tsx TIERS). creedhandyman.com's footer
  links back ("Runs on Creed Handy Manager"). Owner to-dos: 308 apex→www in
  Vercel Domains (check the Stripe webhook host first — Stripe won't follow a
  redirect) + verify creedhm.com in Search Console and submit the sitemap.
  Verified locally with placeholder Supabase env (a worktree `.env.local`, then
  deleted): crawler HTML, no hydration warnings, flag on/off paths, mobile.
  GOTCHA when running `next dev` locally: `/` registers `public/sw.js`, which
  caches `/_next/static/*` cache-FIRST — fine in prod (hashed chunk names), but
  dev chunk names don't change, so after an edit the page runs STALE client JS
  (old UI + bogus hydration mismatches). Unregister the SW + clear caches
  (`navigator.serviceWorker.getRegistrations()` → unregister, `caches.keys()` →
  delete) after each edit, or test in a fresh tab. The marketing brand mark is
  the real badge `public/creed-logo-badge.png` (`.blogo-img`, nav/footer +
  sign-in panel) — the old placeholder "C" tile (`.blogo`) is unused now.

- **Signup / onboarding = ONE flow (2026-10-02)**: every account goes through
  the Grizz `Onboarding.tsx` (Create a business / Join a team). The email-
  confirm link lands on `/`; `initAuth`/`login` turn a session with NO profile
  row into a stub user (`org_id ""`) → onboarding. `/onboarding` (the old
  5-step wizard) never creates an org any more (it auto-made invited crew the
  OWNER of an empty business) — it redirects profile-less users to `/` and
  now only serves owners picking a plan (Ops → Billing, Stripe cancel_url).
  Invite = share link `/signin?mode=signup&join=<orgId>` (`inviteLink()` in
  `lib/signup-helpers.ts`; the code is stashed in localStorage
  `c_join_code`); joiners start at pay rate 0 ("No rate" until the owner sets
  it). Onboarding asks the labor rate + auto-generates `site_slug`.
  **Trial**: `src/lib/trial.ts` `TRIAL_DAYS = 14`, no card; Stripe Checkout
  gets only the REMAINING trial (`trial_end`, none once it's over).
  **Paywall ON for new signups since 2026-10-02** (migration
  `enforce_billing_for_new_orgs`: `billing_enforced` column default TRUE,
  copied onto every app-created org by organizations_guard — clients can't
  opt out). The 6 orgs that existed before (incl. Creed Handyman LLC) stay
  `billing_enforced = false` = free/grandfathered; flip one by SQL if needed.
  STRIPE_PRICE_SOLO/CREW/PRO are set (owner-confirmed). **Platform operator**:
  `lib/platform-admin.ts` (email allowlist) gates the Beta preflight panel and
  keeps raw Postgres detail in db toasts; customers get plain-language errors.

- **PWA / offline (installable + offline reads)**: three layers.
  **P1** — `public/sw.js` (web push + lifecycle) is registered in
  `app/page.tsx`; `InstallPrompt.tsx` captures `beforeinstallprompt` for an
  add-to-home-screen banner. **P2 — offline app SHELL** (`public/sw.js` fetch
  handler, `CACHE_NAME="creed-cache-v2"`): navigations network-first (offline →
  this route's cached copy, else the `/` shell for a ROOT nav only, else an
  inline offline card); `/_next/static/*` cache-first; RSC flight fetches +
  `/_next/data` + `/_next/image` pass STRAIGHT THROUGH (never cached — a deploy
  must never be masked by a stale copy); stale-while-revalidate limited to an
  explicit static allowlist (icons/manifest/fonts/images); `/api`, non-GET,
  cross-origin untouched; FIFO cap 200; every cache path degrades to plain
  `fetch()` on error. Drafted then adversarially reviewed (5 lenses) for
  bricking bugs. **P2.5 — offline DATA reads** (`src/lib/offline-cache.ts` +
  `store.ts`): the SW deliberately never caches Supabase/`/api` data, so offline
  reads come from an **IndexedDB snapshot** at the app layer. `loadAll` now (a)
  short-circuits to the snapshot when `navigator.onLine === false` (previously
  every `db.get` resolved to `[]` and WIPED the store — the "airplane mode = all
  data gone" bug); (b) guards flaky-online with "profiles came back empty ⇒ the
  fetch failed, don't overwrite"; (c) writes a throttled snapshot on each
  success; (d) tracks `usingOfflineData` + `lastSyncedAt`. The snapshot is
  **owner-stamped** (userId/orgId) and `loadSnapshot` refuses cross-user reads;
  cleared on logout. `OfflineBanner.tsx` (mounted in AppShell) shows an honest
  "Offline — showing saved data · last synced Xm ago" strip. `online`/`offline`
  window listeners refetch/snapshot immediately. **P3 — offline WRITE queue**
  (`src/lib/offline-queue.ts`, time entries only so far): fixes "offline
  clock-out doesn't close the entry / still shows active in Crew Activity" —
  offline, `db.post` returned null and `db.patch/del` swallowed the error, so
  the write was lost. Every new time-entry row now gets a CLIENT stable UUID
  (`newRowId`) so a queued insert + later update/delete share one id — no
  temp→real remapping, and replay is idempotent (post=upsert, patch=update,
  del=delete by id). `store.saveTimeEntry`/`dropTimeEntry` are the single funnel
  for ALL clock in/out/auto-stop/force-out/manual/edit/delete in Timer +
  WorkVision: enqueue → optimistic store update → (online) flush+reconcile /
  (offline) persist + replay on the `online` event. `loadAll` materializes
  pending writes over server/snapshot so a poll can't clobber an unsynced
  clock-out; queue cleared on logout; `pendingWrites` drives the banner's
  "· N change(s) will sync when you reconnect". A non-network (RLS/constraint)
  replay error drops just that item so it can't wedge the queue. **Work-order
  ticks (2026-10-16)**: `src/lib/wo-queue.ts` — a tick lives in the job's rooms
  blob, so it gets its own localStorage queue ({jobId, key=room|||detail, done},
  latest tap per task wins) replayed as read-current-blob → set done by key →
  write (other blob edits kept; a task/job that's gone drops its ticks).
  `applyWoPending` overlays unsynced ticks in loadAll + the offline snapshot;
  flushed on tap, at start, every 15s poll that has some, and on `online`;
  counted in the banner. WorkVision toggleWO + the Jobs work-order screen both
  use it. **P3 image
  uploads** (`src/lib/offline-uploads.ts`): photos/receipts snapped offline are
  no longer lost. Binary can't live in localStorage, so the pending File is
  stashed in an **IndexedDB** queue (`creed-uploads` DB) and replayed on
  reconnect. Two kinds, both from WorkVision: `"job-photo"` (public `receipts`
  bucket → append to `rooms.photos`) and `"receipt"` (`uploadReceiptPrivate` →
  upsert the receipt row). Idempotent: a job-photo carries a PRE-COMPUTED
  storage path (upsert-upload + URL-dedupe) and a receipt a STABLE row id
  (upsert), so a retried replay can't duplicate. `WorkVision.uploadWorkPhoto`/
  `uploadReceipt` queue when `navigator.onLine === false` (or on a transport
  error) with a "saved — uploads when you reconnect" toast; `store.flushUploads`
  runs on reconnect (after the row queue) + on `startAutoRefresh`;
  `pendingUploads` folds into the banner count; cleared on logout. **NOT done**:
  offline PREVIEW (queued images don't show in the grid until they upload); other upload sites (QuoteForge, Inspector,
  equipment, renders) are still online-only. Background Sync API not used (the
  `online` listener covers reconnect while the app is open). SW + offline
  behaviour can't be tested locally (no dev env) — verify on-device.

- **Navigation (2026-10-02)**: `lib/back-layer.ts` `useBackLayer(open, close)`
  gives an in-screen level its own history entry so Android back closes it
  (Jobs detail + sub-screen, Ops area + customer, Dashboard notifications).
  In-app close consumes the entry; unmount (navigating away) leaves it; the
  close/unmount/StrictMode-remount decision is deferred a tick. Deep links
  (2026-10-16): a Jobs detail opened straight onto a job (bell, Home row,
  Schedule "Open job") and an Ops area opened straight in (More → Customers /
  Business settings, Home rows) get NO layer — the page entry is their back
  step, and their in-app ← calls history.back() — so back returns to where you
  came from, not to a list/hub you never saw. QuoteForge
  (2026-10-16): one layer while any mode is open = that screen's ← (exitQuick /
  exitEditor / exitBuilding; Inspector registers `leaveWalkthrough` via
  `exitRef`); back is swallowed + re-armed mid AI build and inside a Voice
  Walk (its Cancel discards the recording); Inspector adds room/review/picker
  layers armed a tick after mount (parent effects run after child ones).
  Browser-tested
  (10-step harness, incl. StrictMode). GOTCHA found doing it: Next's app
  router HARD-RELOADS on popstate to an entry without its `__NA` state —
  AppShell's seed replaceState used to wipe it (back to the dashboard reloaded
  the app); it now merges into Next's state a tick later. Any custom
  pushState/replaceState must keep `...history.state`. Re-tapping the current
  tab remounts the screen at its top level (`resetKey`; not for `qf`).
  Work mode shows as Time in the More slot; crew see "Time Off" in the More slot; unread
  bell dot on Home; Crew Map is owner/manager only; managers can't touch owner
  rows or grant owner (UI + profiles_guard); promotions confirm. Delete account
  = `/api/account/delete` (deletes profile + auth user; refused for owners).
  `getLang()` falls back to the phone language; onboarding has EN/ES.
- **Shop (custom) quests (2026-10-08)**: owners/managers make their own
  quests from Quests → Quests tab → **Shop quests** (`ShopQuestsManager.tsx`;
  renders nothing for crew). Stored in `organizations.quest_config._custom`
  (no schema change — `parseQuestConfig()` in `lib/quests.ts` splits it from
  the built-in toggles; Settings → Quest Bonuses spreads the same JSON so it
  keeps `_custom`). Each quest = name/desc + a metric from
  `CUSTOM_QUEST_METRICS` (jobs completed, hours, 5★/good reviews, booked
  referrals, upsells, 24h+ jobs, requested-by-name, no-callback streak) or
  `manual` (owner taps who earned it; marks are `${userId}@${cycleKey}` so
  they only count in that 6-month cycle) + goal + bonus. `computeQuests` adds
  a "SHOP QUESTS" tier with keys `custom_<id>`, so the Quests screen, the
  confetti and Payroll's earned/approve/paid-this-cycle flow all work
  unchanged. Not counted toward HandyKing. Engine tested 12/12.
- **Vacant-turn inspections (2026-10-08, 87be489)**: the Move Out type
  ("Move Out / Turn") IS the make-ready checklist — `ROOM_PRESETS` in
  Inspector.tsx splits appliances out, adds fans / bedroom smoke detectors /
  GFCIs / per-room Cleaning / exterior doors, hose bibs, mailbox, trash, and a
  **Whole Unit** area (utilities, deep clean, trash-out, odor/pests, paint,
  blinds, bulbs, covers, door stops, re-key, keys). Items default OK, so length
  is cheap. New item names need a `getPresets` chip rule (above the yard rules
  — `/pest/`, `/ceiling/` collide) + a VoiceWalk `ITEM_KEYWORD_OVERRIDES`
  entry. `compileInspectionText` now sends a move-out brief too (quote flagged
  items only). Inspection blobs store `type`, `inspected_by/at`, sqft/W/L.
  Report (`printInspection`): walk date, type, severity counts, worst-first
  Work Needed punch list with checkboxes, then the full condition record.
- **Fence inspection (2026-10-22, c2f0ec0)**: inspection type `fence`
  (Inspector `FENCE_AREAS` / `fenceItems`): Front/Back/Left/Right fence runs,
  Gate 1/2, Whole Fence (facts that price the job). Statuses keep the S/F/P/D
  codes but READ Good / Worn / Repair / Replace (`insp.fenceCond*` keys,
  parser condLabel, `FENCE_VOICE_STATUS` appended to the Voice Walk prompt,
  printInspection `isFence`). Size card = height × length: `room.width` is the
  HEIGHT, `room.length` the run length (ft), sqft = fence face; the parser
  prints "Fence Run: N linear feet, H ft tall" instead of Room Size. Fence chip
  rules sit at the TOP of getPresets ("Pickets/Panels" would hit /panel/).
- **Crew size + estimated days (2026-10-08)**: QuoteForge's pricing row has a
  **Crew** picker (Auto · 1–4; rooms blob `data.crewSize`, null = Auto). It
  NEVER changes price — labor hours are TOTAL work hours — only the PDF's per-
  section "Xh × N crew" split (Auto keeps the old >8h→2 rule) and the days.
  The AI parse's `estDays` (counts dry/cure waits) is now kept too
  (`data.estDays`, was dropped). ONE helper, `src/lib/job-duration.ts`
  `estimateDays(totalHrs, crew, aiEstDays)` = max(ceil(hrs ÷ crew ÷ 8),
  aiEstDays), drives both the editor's "≈ N days on site" hint and the quote
  PDF's "Estimated completion: about N working days" box under the summary
  (threaded through `quote-pdf.ts` for the customer/Jobs copies).
- **Sending quotes (2026-10-02)**: QuoteForge **Send** saves first
  (`saveJob({stay:true})` keeps the editor open on the saved job and returns
  its id — no more "save once, then send" dead end) and opens `SendSheet`
  (Text / Email / Copy / Share; editable message with the status link, quote
  validity from org settings, "Options from $X" for tiered quotes). Any send
  action stamps `jobs.quote_sent_at` (`lib/quote-send.ts markQuoteSent`; also
  from the Jobs send strip on a quoted job). Job cards show "Sent 3d ago" /
  "Not sent yet"; dashboard Needs-attention is 2x2: To send (quoted, unsent) ·
  Waiting on customer (quoted, sent) · To invoice · Unpaid (now rendered by
  DayCards from day-plan `needMatch`; each tile deep-links to exactly those
  jobs — see "Day-rhythm Home" above). `/api/jobs/approve`
  fires `notifyQuoteApproved` (bell `quote_approved`, deep-links the job) on
  the FIRST approval only. Editing a saved quote no longer resets `job_date`.
- **Good-Better-Best tiered quotes**: present 3 cumulative options on a quote so
  techs upsell and the customer picks one. **No schema change — all on the rooms
  JSON blob.** Per-item `RoomItem.tier` (`base`/`better`/`best`, absent = base);
  quote-level `data.tieredQuote` + `data.tierNames` ({better,best}, renameable) +
  `data.tierTotals` ({base,better,best}, computed by QuoteForge's authoritative
  pricing cascade and stored so the approval page + approve API read prices
  without re-deriving the math). Tiers are CUMULATIVE: Better = base+better,
  Best = base+better+best. **QuoteForge**: an "Options" toggle (next to the
  total card) → per-line Base/Better/Best selector in QuoteTab + 3 live totals.
  **PDF** (`export-pdf.ts`, threaded via `quote-pdf.ts`): a "Choose Your Option"
  3-column block (only when items are tagged). **Status page** (`/status`): 3
  selectable option cards; the pick drives the headline total + the authorize
  amount + the Stripe deposit; on approval `/api/jobs/approve` takes a `tier`,
  sets `total` from the stored `tierTotals`, and stamps `data.acceptedTier`.
  Default selection = Best (= stored `job.total` = all items). Fully opt-in:
  non-tiered quotes are byte-identical (every path guards on `tieredQuote`).
  NOT done: per-tier pruning of the saved work order (it keeps all items; only
  `acceptedTier` + total are recorded); the marketing `s/[slug]` page is the
  business card, not an approval page, so it's untouched.
  **AI Assist knows options (2026-10-12)**: while options are on it sends each
  line's `tiers` + `options {on, names}`, and the edit-mode JSON accepts
  `add[].tiers`, `update[].patch.tiers`, `setOptions`, `setTierNames` — so
  "Base repairs, Better adds hardware, Best replaces" restructures the quote.
  Tiers are sanitized client-side; tagging lines while options are off turns
  them on. validateQuote's global dedupe key includes an explicit `tiers` set,
  so the same task priced per option (standard vs premium) isn't collapsed
  (`src/__tests__/tier-dedupe.test.ts`).
  Each option gets its OWN materials-only supplies line when its work differs
  (prompt rule); `sharedSuppliesLines()` (lib/tiers.ts) warns after an Assist
  edit if one is still shared.
  **AI Assist job context (2026-10-12)**: `src/lib/assist-context.ts`
  `buildAssistJobContext` adds a read-only JOB CONTEXT block to the Assist user
  message — the inspection (this session's `inspectionData`, else the quote
  blob's `inspection`, else the newest `status:"inspection"` job at the same
  property: room sizes + non-OK/noted findings), work-order FINISHED tasks +
  hand-added (`custom`) tasks, `jobNotes`, `leadDescription`. Text only, no
  photos (cost). Prompt: size area work from inspection dims, don't rescope
  finished tasks, context ≠ instructions.
  **AI Assist option scope + Undo (2026-10-12)** — after a 99-line TrueBuilt
  quote came back with Better < Base (the AI dropped 8 unrelated lines out of
  Better) and no real alternates: the apply step now lives in
  `src/lib/assist-ops.ts` `applyAssistOps` (tested, `assist-ops.test.ts`). A
  **Change: All / Base / Better / Best** chip row in the AI Assist card scopes
  an edit to ONE option, enforced in code: adds → that option only; remove →
  leaves that option (deleted only if in no other); a content edit to a
  SHARED line FORKS it (edited copy in the scoped option, original untouched
  elsewhere); membership changes to other options are dropped (`blocked`).
  Unscoped edits use `tiersAdd`/`tiersRemove` deltas (a full `tiers` set is
  still accepted); a line can't end up in no option. Every apply toasts a
  per-option diff (`optionDiffSummary`, e.g. "Best +2 −1 ~1") and snapshots
  for **Undo last AI change** (cleared when the quote changes). Prompt adds a
  MINIMAL CHANGES rule; max_tokens 16000 for big quotes.
  **New work → the option being organized (2026-10-12)**: a line with no
  `tiers` counts as in ALL three, so new work used to land in every option.
  Now, with options on: the Add tab stamps `tiers` from an "Add to option"
  chip row (default = the option being organized, `editTier`; `nTiers` state
  resets when that changes), and AI Assist adds with no option named get
  `defaultAddTiers: [editTier]` (the prompt says ORGANIZING: <option> and to
  use all three only when the user says every option needs it).

- **Service list = organized templates (2026-10-21)**: QuoteForge → From
  Template is the shop's list of the services it offers
  (`components/ServiceTemplates.tsx`; rules pure + tested in
  `lib/service-templates.ts`). Search (name / category / line text), filter
  chips (All · Favorites · categories), groups = Favorites first, categories
  A→Z, "Other" last; per row: star, move up/down inside its category, edit
  (rename, category with one-tap chips — `canonCategory` folds case, Edit
  lines, Duplicate, Delete). **New service** opens the empty editor in
  service mode (`templateEdit` state: banner, no customer picker, the
  job PDF/Send/Save bar hidden, "Save service" patches/creates the row and
  returns to the list; kept in the c_qf_draft). In any quote, **Add a
  service** appends a service's lines (`appendTemplateRooms`: joins same-named
  areas, FRESH line ids so work-order links never collide; with options on
  they go into the option being organized). Migration
  `service_templates_organize` (**ALREADY RUN in prod 2026-10-21**):
  `category TEXT, sort_order INTEGER DEFAULT 0, favorite BOOLEAN DEFAULT
  FALSE` on `service_templates` (RLS = own-org FOR ALL, any member).

- **Drive tracking = Start drive + map (2026-10-19)**: "No movement detected"
  bug — the old Work Mode tracker only counted miles from watchPosition while
  the app was on screen and never saved its start point, so Start → Maps
  (PWA backgrounded, iOS stops web GPS) → Stop measured nothing. Now ONE
  module-level tracker, `src/lib/drive-tracker.ts` (state in localStorage
  `c_mileage_trip` + `useSyncExternalStore`), used by Work Mode's
  `MileageQuickTrack` AND the Mileage screen's GPS trip: start point seeded
  from a warm fix (`warmUpLocation()` on mount, ≤10 min old) and persisted at
  once; fixes from watchPosition + a 20s poll + a fix on every return
  (visibilitychange/pageshow/focus) so a missed first check is retried; a
  sharper fix inside the last one's error circle refines it; a jump after a
  >45s gap counts straight-line × ROAD_FACTOR; Stop takes a final fix and logs
  max(tracked, start→end × ROAD_FACTOR). Pure `applyFix`/`finalMiles` are
  tested (`drive-tracker.test.ts`). Still 0 → asks for miles or odometer
  instead of logging nothing. **Start drive opens directions** (it's an
  `<a target=_blank>` whose onClick starts the drive synchronously, before
  the app is backgrounded); the separate Map chip is gone, and the clock-in
  picker's per-job map buttons start a drive too (shown via
  `<MileageQuickTrack hideIdle />`). Mileage screen: the GPS review lets you
  type miles + start/end odometer; Suggested trips has per-leg **Odo**
  readings and **Add a trip that's not listed** (from/to, optional start time,
  miles or odometer, for the picked date — the old Manual Entry card is gone); Trip Log rows have an edit pencil to add odometer
  readings later. Suggested legs already in the log are shown as
  logged ("N mi in your log") by `mileage-days.ts matchLoggedLegs`: same day +
  same destination, ANY miles (a Work Mode GPS drive counts; exact-miles rows
  claim first; one trip covers one leg) — so Add all can't double-log a drive. A save that fails offline `holdDrive`s the trip (`stopped`,
  never resumes GPS) so the miles survive closing the app and the next
  Stop/End saves them. `WaypointTracker` (geo.ts) was removed.

- **Edit-draft autosave for SAVED quotes (2026-10-12)**: the new-quote draft
  (`c_qf_draft_<uid>`) never covered editing an existing job — edits lived
  only on screen until Update/Send. Now each saved quote gets a phone-only
  draft `c_qf_edit_<uid>_<jobId>` (`{v, savedAt, base, state}`), written
  600ms after an edit and on background/pagehide, only while the screen
  differs from `editBaselineRef` (the snapshot captured on the first render
  after load or set right after a save; `editSnapshot()` drops the work
  order's session-only `src`). Reopening the quote shows a Resume / Discard
  card (writes pause until you choose); `stale` = the job's saved blob hash
  (`hashText`) changed since the draft was made. A successful save drops the
  draft; drafts expire after 14 days. Deliberately NOT a server auto-save —
  half-done edits would reach the customer's /status page + PDF and a signed
  quote would read as revised.

- **Quote PDF summary per option (2026-10-12)**: on a tiered quote the
  Estimate Summary used to total EVERY line ("ALL QUOTED WORK (reference)"),
  matching no option. `export-pdf.ts` now renders "Estimate Summary by
  Option": category rows × one column per option (`optCat` — same per-trade
  rate + marked-up materials as `tierTotalOf`), a labor-hours row, an
  adjustments row (= option total − sections: min charge / trip fee /
  discount / tax) and OPTION TOTAL = the option price, so every column adds
  up. Each trade's section bar adds per-option totals ("not included" when
  absent) and "Estimated completion" lists days per option. Non-tiered quotes
  are unchanged.
  **Breakdown = shared once + per-option additions**: after the overview,
  `buildBreakdown(cats, perOption)` runs on "Work in Every Option" (lines whose
  `itemTiers` has all 3), then per option on the lines it has that aren't in
  all three ("<Option> — What This Option Adds", page break before each, a
  math line: shared $ + option work $ + charges/discount/tax = option total).
  Lines in two options show under both. Section materials are marked up like
  `tierTotalOf` (`lineCost`) so it all adds up. An approved quote prints only
  the picked option's complete breakdown.

- **Record an offline approval (2026-10-12)**: for homeowners who won't use
  the /status link. Jobs detail (quoted/accepted, unsigned) → **Record
  approval (in person / phone)** → `RecordApprovalSheet.tsx`: pick the option
  (tiered quotes, prices from `tierTotals`), how (in person / phone / signed
  paper), the homeowner's name (defaults to the client) and, in person, an
  optional on-screen signature pad (dark-ink PNG). POSTs owner/manager-only
  `/api/jobs/record-approval` (org-scoped, refuses signed/lead jobs, tiered
  needs a tier). The approval logic now lives in ONE helper,
  `src/lib/approve-job.ts` `applyApproval` — used by BOTH this route and the
  customer `/api/jobs/approve` (which keeps its token/portal auth, stale-page
  check, SMS consent and owner notification): status quoted→accepted, option
  price + tierBreakdown totals, work order pruned via itemInTier,
  `acceptedTier`, and the `approval` record — now with optional `via`
  (in_person|phone|paper; absent = online), `by` (recorder) and `signer`.
  The PDF uses `approvalPhrase()` ("Approved in person — Jane Doe … —
  recorded by Bernard") instead of always "Approved electronically".
  Tested in `approve-job.test.ts`.

- **Signed quotes print the customer's signature**: the /status "Approve &
  Sign" signature (typed name, or the pad's PNG — dark ink since this change;
  older pad signatures were white ink, so the PDF applies `brightness(0)`)
  prints in the quote PDF's Client Approval slot with the sign date, and the
  closing block reads "✓ Estimate Approved" (+ the picked option for GBB).
  `/api/jobs/approve` stamps `rooms.approval = {v,fp,total,at,tier?}` —
  `fp` = `scopeFingerprint(rooms)` (`src/lib/approval.ts`: order-insensitive
  hash of each line's canonical detail/hours/priced materials/tiers). The PDF
  (`approvalState`) prints the signature only while the printed items still
  match `fp`; revised since → unsigned + "earlier version was approved" note;
  a post-2026-09-28 approval whose record got erased (stale-store blob writes)
  → unsigned + neutral "on file" note; pre-record approvals print signed.
  Reopening in QuoteForge must NOT read as revised: validateQuote's detail
  rewrite + supplies-hours zeroing live in `src/lib/line-canon.ts`, shared by
  parser.ts and the fingerprint — change them there only. The route also
  refuses stale pages (409 `stale` when the page's `scopeFp`/`shownTotal`
  don't match the server), leads, and malformed signatures (typed ≤100 chars;
  canvas = PNG data URL ≤400KB). Once signed a quote can't be re-approved
  online (pre-existing 409 lock) — a revised signed quote needs the owner.
- **Security hardening (`SECURITY-AUDIT.md` — local, untracked)**: a multi-pass
  audit + remediation. API routes now require a Supabase JWT (`lib/api-auth.ts`
  `requireAuth`/`requireOwner`/`serviceClient`); service-role routes fail closed
  (no `||anon`); billing/payment/promo enforced server-side; IP rate-limit
  middleware (`src/middleware.ts`, Upstash). **Receipts are PRIVATE**: they live
  in a non-public `receipts-private` Storage bucket, uploaded via one-time signed
  upload URLs (`/api/storage/upload-url`) and read via short-lived signed URLs
  (`/api/storage/sign`); `receipts.photo_url` stores the object PATH, and
  `lib/receipt-storage.ts` `isPrivatePath()` splits new paths from legacy public
  URLs so both render. Don't revert receipt uploads to the public `receipts`
  bucket. Logos/renders/job-photos stay public (customer-facing). Owner-confirmed
  live: RLS on; `ADMIN_PASSWORD`/`PROMO_CODES`/Upstash set.
  **profiles/organizations lockdown (2026-10-02, migration
  `lock_down_profiles_and_organizations`, rehearsed 37/37 in a rolled-back
  txn)**: profiles had an `open` FOR ALL true policy (anyone could edit/delete
  any profile, self-promote to owner) and both tables had FOR ALL
  `org_isolation` (any tech could edit the org incl. its Stripe payout
  account). Now: profiles read = self + own org (anon: column grant id/name/
  org_id/photo_url/role only — `/review` selects `id, name`); insert = own
  row, owner only into an EMPTY org, joiners tech/apprentice at rate 0;
  update = self or owner/manager of the org, with trigger `profiles_guard`
  letting only owner/manager change role/rate/start_date/emp_num/PTO and
  only an owner touch the owner role; delete = self or admin (manager can't
  remove an owner). organizations: writes = "Owners update org" only;
  trigger `organizations_guard` (replaced `protect_org_entitlement`, which
  rejected EVERY app insert — signup was broken) resets billing/payout
  fields on client inserts and blocks client changes to billing_enforced /
  subscription_* / stripe_* / trial_*. Guards check `current_user` in
  (anon, authenticated) — keep them INVOKER security. So the app must never
  write those columns: `/api/stripe/connect` saves stripe_account_id
  server-side; the app writes `plan`, never `subscription_plan` (sets the fee).
  Follow-up migration `org_scoped_inserts`: jobs / mileage / pay_history /
  price_corrections / quest_payouts / receipts / schedule / time_entries had
  INSERT WITH CHECK (true) for every role (anon could add a fake time entry to
  any org); now `to authenticated with check (org_id = auth_org_id())`.
  referrals + reviews keep public insert ON PURPOSE (public site/review forms).
  **Join approval** (migration `join_approval_and_notification_access`):
  `profiles.status` ('active'|'pending'). A client insert into an org that
  already has members is forced to 'pending' (trigger `profiles_on_insert`);
  `auth_org_id()`/`auth_role()` only count ACTIVE profiles, so a pending
  joiner reads nothing org-scoped (customers/service_templates/org policies
  were moved onto the helpers for this). Trigger `profiles_notify_join` drops
  a `join_request` bell row for owners/managers; only they can flip status
  (profiles_guard). App: store splits `pendingMembers` out of `profiles`;
  root page shows `PendingApproval` (re-checks every 15s); Ops → Team lists
  requests with Approve/Decline (decline = delete profile → they fall back to
  onboarding); Team tile badge; `getAuthedProfile` returns no org for pending.
  Same migration gave `notifications` select/update-own policies — it had RLS
  on with NO policies, so the bell was ALWAYS empty (193 unseen rows; ones
  older than 3 days were marked read). Migration `feature_table_policies`
  fixed the rest that were RLS-on/no-policy (time off, equipment, recurring,
  memberships never saved; review-request cancel failed; inspection_usage
  always read 0): time_off_requests = own rows + admins see/decide the crew's,
  file own only as 'pending'; equipment = crew-wide; recurring_jobs +
  membership_plans = crew reads, owner/manager writes; customer_memberships =
  read-only (server writes); review_requests = read + cancel a scheduled one;
  inspection_usage = org read/insert/update (soft cap, toast only). Still
  service-role-only BY DESIGN: payments, portal_tokens, push_subscriptions,
  ai_usage, cron_log, waitlist; team_messages is unused.

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
  them). The personal **Settings gear** screen SHIPPED too (9d8e9a1,
  `Creed_Settings_Full` screen 1): one scrolling screen, no tabs — profile
  head w/ avatar upload (receipts/avatars → profiles.photo_url), Profile
  (inline name edit), Notifications, Appearance, Security (tap-to-reveal
  password), owner-only Quest Bonuses, Sign out + version. Handlers
  preserved verbatim; sections use .section/.seclabel/.drow.

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
  **Live ticks (3447b5f)**: a Whisper pass every 3s on only the NEW audio
  (recorder's chunk[0] = header + chunks since the last pass − 2s overlap,
  merged by `mergeOverlap`); a recorder whose windows 400 falls back to
  cumulative. Live passes send `hint` (room checklist) → `/api/transcribe`
  appends it to the prompt and blanks prompt-echo output (silence
  hallucination). Rate limit for /api/transcribe is 30/min — don't lower it.
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
  `uploadReceipt`, `openRenderModal`). **Receipts (2026-10-19)**: Work Mode's Scan receipt now
  opens `ReceiptScanSheet.tsx` (multi-page upload → one combined scan → review
  vendor/items/TOTAL → Save, incl. price_corrections) — the old path saved $0
  and back-filled the amount from the item sum only, silently doing nothing
  when the scan returned no items. `uploadReceipt` is now the OFFLINE path only.
  Scan helpers live in `lib/receipt-scan.ts` (scanReceipt / receiptNote /
  learnFromReceipt — total = grand total, item sum only as fallback). Offline
  receipts are now scanned on replay too (`offline-uploads.ts replayReceipt`:
  best-effort after the row upsert; note+amount patched only while amount is
  still 0; queue meta carries property/trade for the learning rows). **Guide shopping list is editable**: the
  checkbox alone toggles bought-state; tapping an item's name/price opens an
  inline editor (rename / change cost / delete). Custom items edit their
  `customShop` entry in place; quote-derived items are "adopted" into
  `customShop` with their original key recorded in a new `removedGuideShop`
  array on the rooms blob (so the auto list hides the original). Checked
  state migrates when a rename changes the `shopKey`.
  List order (both Guides) = `lib/guide-shop.ts` `orderShopList`: an
  edited copy carries `replaces` (the original's key) and takes its exact
  spot; other custom items join their trade's section; general / "Added on
  site" / no-trade items go last. Materials list renders above Tools.
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
  default-TRUE opt-out. Web push (PWA/VAPID) is now SHIPPED (`2d56e34`):
  `public/sw.js` + `lib/push.ts` + `/api/push/*` + a VAPID-gated send in
  `notify-server`; activate with the VAPID env vars + the push_subscriptions
  migration. Still not done: a bell outside the dashboard, realtime (feed
  refreshes via the 15s `loadAll`).
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
  (Quote · Jobs · Home · Time · More) in `VerticalNav.tsx` — **since
  2026-10-19 Schedule replaced Time in the bar (Quote · Jobs · Home ·
  Schedule · More); Time is the first More-hub tile and Time / Work mode
  morph the More slot into a green "Time"** — Home is a
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
  **Labor calibration (2026-09-29)**: parser.ts scales each trade bucket's AI
  hours by `min(1.5, max(1, actual/estimate))` (`laborCalibrationFrom`). The
  legacy basis (`__job__:` rows = FINAL quoted vs clocked) is pinned at the cap
  by a few huge pre-Aug-6 jobs (~2x over) and can't self-correct — jobs quoted
  since (prompt nudge + x1.5) land at ~1.0x actual. So every parsed line now
  carries `aiHrs` (the model's own hours before scaling), learning.ts writes
  `__jobraw__:{trade}` rows (Σ aiHrs vs the lines' pro-rata share of clocked
  hours; always written; sold scope only — the picked GBB option; T&M lines,
  recurring/membership-spawned jobs and jobs with crew still clocked in are
  skipped), and once ≥8 completed jobs AND ≥40 AI hours have them the factor
  comes from those alone (newest 25 jobs, a job's rows = its newest batch,
  rows clamped 0.4–3x, a trade's own ratio needs ≥3 jobs). On the raw basis
  the overhead regime is always "included" (no SCALE OVERHEAD uplift, overhead
  line dropped) so aiHrs doesn't depend on the factor. Keep the prompt nudge:
  removing it with the factor capped would under-quote. aiHrs is stripped from
  templates, recurring copies and customer payloads (`src/lib/ai-hours.ts`),
  and an AI Assist rewrite of a line's detail drops it. AI Assist adds stay
  uncalibrated on purpose (owners type hours).
  **Legacy cap lowered to 1.15x (0de85c7, 2026-10-08)** after "quotes slightly
  high": big quotes were 1.45–1.9x aiHrs. Raw basis still caps at 1.5x. The
  learned-durations prompt no longer says "actuals consistently exceed quotes".
- **Models**: every AI call is `claude-sonnet-5-5` (parse, ping, voice walk,
  AI Assist, Troubleshoot — Haiku retired 2026-09-29; there is no Haiku 5).
  Thinking off = `thinking: {type:"between_tools"}` + `effort:"high"`
  (`{type:"disabled"}` and `temperature` 400 on Sonnet 5.5). `/api/ai` adds
  server-side refusal fallback (`fallbacks:"default"` + beta
  `server-side-fallback-2026-07-01`, retried once without it if rejected).
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
