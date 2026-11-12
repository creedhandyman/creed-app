# Schema migrations (reference)

Moved out of CLAUDE.md to keep it short. Newest first. Each entry says whether it has been run in prod.

- Per-customer text consent (**NOT yet run in prod**): run
  `supabase/migrations/20261112_customer_text_consent.sql` in the SQL editor
  (safe to re-run). Adds `customers.sms_consent JSONB` (current answer + up to
  20 earlier ones; shape in `lib/sms-consent.ts` CustomerSmsConsent) and
  backfills each customer's newest job-blob "yes". Ends with a count query.
  Before it runs: automatic texts still work off the per-job opt-in only, and
  the customer page's Automatic texts buttons show a save error. In preflight
  `DB_CHECKS` as `customers.sms_consent`.

- Automatic customer texts (**RUN in prod**: tables/columns present 2026-11-10): run
  `supabase/migrations/20261109_automatic_texts.sql` in the SQL editor. Adds the
  three OFF-by-default switches `organizations.auto_sms_enroute /
  auto_sms_reminder / auto_sms_invoice` (Operations → Settings → Automatic
  Texts), `jobs.invoice_sent_at / invoice_reminder_count / invoice_reminder_at`
  (+ a trigger that stamps `invoice_sent_at` whenever a job moves into
  `invoiced`), `schedule.reminder_sent_at`, the `sms_messages` log and
  `sms_opt_outs` (service-role only), and the `text_reply` / `invoice_reminder`
  / `visit_reminder` notification types. Routing lives in
  `lib/sms-recipient.ts` (visit texts on a property-manager job go to the
  resident, never the PM; no resident number = nothing sent; invoices go to
  whoever pays). Crons: `/api/sms/reminders` (23:00 UTC) and
  `/api/invoices/reminders` (16:00 UTC), both `?dry=1`-able. Twilio webhooks
  to set on the Messaging Service: incoming → `/api/sms/inbound`, status
  callbacks are requested per message → `/api/sms/status` (both check
  X-Twilio-Signature against `TWILIO_AUTH_TOKEN` and the `siteOrigin()` URL).
  **HAND-SENT TEXTS NEVER USE TWILIO (owner rule, 2026-11-10).** Twilio sends
  only Creed's automatic texts (review requests, visit / invoice reminders,
  quote follow-ups, portal login links the customer asks for, crew alerts,
  STOP / HELP replies). Anything a business sends a customer by hand opens
  the phone's own Messages app with the number + text filled in
  (`lib/job-send.ts smsHref`, an `sms:` link): Send quote / Follow up / Send
  invoice / Send reminder / Text chip / Message customer (Jobs send strip),
  the quote editor's `SendSheet`, On the way / Running late / Job done
  (`SmsNotifyButtons`), the customer page's portal-link text, the share-card
  text, and Work mode's **"Complete & invoice"** step (after Complete Job,
  owner/manager, while a balance is owed: prefilled invoice text → Open
  Messages / Copy / Not now; Open Messages or Copy flips complete→invoiced,
  same as the Jobs strip). `quote_sent_at` / invoiced are stamped on the tap
  (nothing can confirm a send from the phone's own app). `/api/sms` POST is a
  410 stub now (it used to send these, incl. a `{to, body}` shape any
  signed-in account could aim anywhere). `organizations.job_text_via` is NO
  LONGER READ and its Ops radio is gone (column left in place; no migration);
  `20261111_texts_default_business.sql` is moot, don't run it.
  `auto_sms_enroute` no longer sends anything: it only turns on the Texts
  screen + inbound reply routing (Ops label: "show replies to the business
  number in Texts"). EXCEPTION, owner's decision (2026-11-10): the Texts
  screen's reply box (`/api/sms/reply`) KEEPS sending from the business
  number; don't move it to Messages. It changes later, in the update that
  moves texting fully over to Twilio. Planned, not built: each business gets
  its own Twilio number for its automatic texts instead of all sharing one.

- Customer text replies, build 1 (**RUN in prod** 2026-11-10, columns + functions checked): run
  `supabase/migrations/20261110_text_replies.sql` in the SQL editor (safe to
  re-run). Adds to `sms_messages`: `direction` ('out' default | 'in'),
  `from_phone`, `contact_phone` (the customer's number on both sides = the
  conversation key), `customer_id`, `match_status`, `read_at`, `media`; a
  UNIQUE index on `twilio_sid` (Twilio retries saved once); the
  `sms_customers_by_phone(last10)` lookup (expression index, no new customers
  column) and `sms_add_job_photos(job, org, urls[])` (atomic append to the
  job blob's photos). Both functions are service-role only.
  `/api/sms/inbound` now saves every incoming text (`lib/sms-inbound.ts`
  `pickMatch`, tested: thread we texted in 60 days → one customer's newest
  open job → one resident on a 180-day job → several (newest job, flagged) →
  unknown (only if exactly ONE org has `auto_sms_enroute` on) → held (no org,
  shown to no one); every org shares the sending number, so a text only goes
  to an org that texted it or has it on file). After the TwiML reply
  (`after()`), photos are copied from Twilio (basic auth) into
  `receipts/sms/{org}/…` and onto the job; owners, managers and the job's crew
  (schedule-note names + requested_tech) get a bell + app push, never a text
  (`dispatchNotifications` `channels`), one per 5-minute burst. STOP = bell
  note, no push. "Yes" is START only from an opted-out number. `sendLoggedSms`
  writes `direction`/`contact_phone` and falls back to the old row shape if
  the migration hasn't run. Before it runs, replies still alert as before.
  Build 3 (job/customer Texts tabs, Link to customer) is in the plan doc
  "Creed: receiving Twilio replies (plan)".

- Texts screen, build 2 (RUN 2026-11-10): ran
  `supabase/migrations/20261111_texts_default_business.sql` once (data only:
  businesses with `auto_sms_enroute` on and `job_text_via = 'phone'` switch to
  `'business'`, Bernard's "switch the buttons to the business number once
  replies work"; re-running flips anyone who switched back). The screen
  itself needs no schema change. `screens/Texts.tsx` (page id `texts`; More
  hub tile, side menu row and More-slot badge only when `auto_sms_enroute` is
  on): one row per `contact_phone`, conversation view, reply box. Rules in
  `lib/sms-threads.ts` (tested: `summarizeThreads`, `crewJobIds`,
  `canSeeThread`, `replyRole`, `checkReply`); loads in
  `lib/sms-threads-server.ts` (`openThread` = org + phone + crew check, used
  by every route). Routes: `GET /api/sms/threads` (list, `?count=1` = unread
  for the badge, polled every 60s by `lib/texts-client.ts`), `GET|POST
  /api/sms/thread` (read / mark read), `POST /api/sms/reply` (always the
  business number via `sendLoggedSms`: STOP check + log, only to a number
  that's already a conversation), `POST /api/sms/lead` (Make a lead on an
  unknown number, owners/managers: new customer with that phone + lead job,
  conversation moved onto them). Owners/managers see every conversation; crew
  only those touching a job they're on (👷 schedule names from 30 days ago on,
  or requested tech). A reply push opens `/?texts=<phone>` (AppShell reads it);
  a `text_reply` bell row opens its job's conversation.
- Texts, build 3 (no database change): `components/TextsCard.tsx` lists a
  job's or customer's conversations (`GET /api/sms/threads?forJob=` /
  `?forCustomer=`, `threadsFor` in `lib/sms-threads-server.ts`) on the job
  detail (section before Work) and CustomerDetail (card before Related work);
  tapping opens the conversation, from a job filtered to that job's texts
  (`/api/sms/thread?job=`, replies logged on that job) and closing returns to
  the job. `POST /api/sms/assign` (owners/managers; only unknown, `several`
  or just-`linked` conversations, `canAssign`): Link to customer (their
  newest open job; saves the number on a customer with none) or Move to job.
  Re-files the texts with no job or on the guessed job (`rowsToAssign`),
  marks received ones `match_status = 'linked'`, copies their photos onto the
  new job (they stay on the old one). `matchInbound` rule 1 also follows the
  newest `linked` received text, so later texts land where the owner put them.

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
  (3 months, 1 business), given to the owner 2026-10-20. **FOUNDING25** (`founding-25`, 2026-10-31): 25 uses, STACKS
  `addDays: 76` on top of the business's current free end (14-day trial + 76
  = ~3 months; an expired trial restarts from today) via `promoEndFor`. The
  route recounts after inserting and backs out if a simultaneous redemption
  pushed it past maxUses.
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
- Online booking (**NOT yet run in prod**, file
  `supabase/migrations/20261109190000_online_booking.sql`, idempotent): org
  `booking_enabled` (default FALSE) + `booking_hours` jsonb (weekday "0"–"6" →
  [["HH:MM","HH:MM"]…], default Mon–Fri 9:30–12 + 1:30–6) + `booking_slot_min`
  120 / `booking_buffer_min` 30 / `booking_min_notice_hours` 24 /
  `booking_days_ahead` 21 / `booking_tz` America/Chicago; schedule
  `start_time` TEXT, `duration_min` INT, `booking_status`
  ('requested'|'confirmed'|NULL) + a partial unique index (org, day, start)
  on booking rows. Public page `/book/[slug]` → `/api/public/booking`
  (GET open times, POST a request: holds the slot as a `requested` schedule
  row FIRST, then customer/address/job with status **lead** — same shape as
  /api/leads, `rooms.booking` records the ask — plus the owner alert and a
  "request received" email). Owner answers on the Schedule
  (`components/BookingRequests.tsx` → `/api/booking/respond`, owner/manager):
  Confirm keeps the time + emails a Google Calendar link, Decline deletes the
  hold; the job stays a lead either way. Slot math lives ONLY in
  `lib/booking.ts` (tested): one crew per business, a visit must fit inside one
  work window (lunch never booked), untimed or multi-day visits block the whole
  day, times fall back to the note's 🕐 when `start_time` is empty (no
  backfill). Settings card: `components/BookingSettings.tsx` (Ops → Settings).
  Texting / deposit hooks are marked `HOOK(texting)` / `HOOK(payments)`.
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
  `lib/cron-auth.ts` `cronAuth()` validates (shared by all 3 cron routes:
  CRON_SECRET bearer or x-admin-token ONLY — the bare `x-vercel-cron` header
  is NOT accepted since 2026-10-28: anyone can send it, and with `?force=1` it
  ran payroll on demand; cron_log showed every scheduled run used the secret). Diagnose: `select invoked_at, authorized, auth_via,
  is_vercel_cron, total_paid from cron_log where endpoint='auto-run' order by
  invoked_at desc limit 20;` — a `cron_secret` row with `total_paid>0` = working;
  a `rejected` row (or no row at all) = the cron isn't reaching/authing.
- `ALTER TABLE jobs ADD COLUMN archived BOOLEAN DEFAULT FALSE;`
- `ALTER TABLE jobs ADD COLUMN archived_at TIMESTAMPTZ;`
- `ALTER TABLE jobs ADD COLUMN review_requested_at TIMESTAMPTZ;` — **RUN in prod 2026-11-10**
  (file `supabase/migrations/20261110_review_requested_at.sql`, column checked); before
  that `scheduleReviewRequest` errored silently and no review request was ever queued.
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
- Contact info from the quote description (2026-11-10): `lib/contact-extract.ts`
  (pure, tested) reads names/phones/emails typed into Quick Quote text or a
  lead's `leadDescription` ("Tenant: Mary 316-555-0142", "Customer: Joe …",
  or unlabeled). `components/ContactFound.tsx` shows them on the quote editor
  under the customer card; one tap links/creates/fills the customer (never a
  property manager's record, never overwrites a filled field; the org's and
  team's own numbers are skipped) and hands the resident to QuoteForge, which
  saves it on the blob via `buildQuoteSave` identity.resident →
  residentName/Phone/Email (non-empty only). Job detail also edits resident email.
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
- Quote "opened" alerts + automatic follow-up (**ALREADY RUN in prod 2026-10-29** via the
  Supabase MCP, migration `quote_viewed_and_followup`; columns + widened CHECK
  verified. Listed for other environments):
  ```sql
  ALTER TABLE jobs ADD COLUMN IF NOT EXISTS quote_viewed_at TIMESTAMPTZ;        -- last open of the /status link
  ALTER TABLE jobs ADD COLUMN IF NOT EXISTS quote_view_count INTEGER DEFAULT 0;
  ALTER TABLE jobs ADD COLUMN IF NOT EXISTS quote_followup_count INTEGER DEFAULT 0;  -- auto follow-ups handled (0-2)
  ALTER TABLE jobs ADD COLUMN IF NOT EXISTS quote_followup_at TIMESTAMPTZ;
  ALTER TABLE organizations ADD COLUMN IF NOT EXISTS quote_followup_enabled BOOLEAN DEFAULT FALSE;  -- opt-in
  ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
  ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
    CHECK (type IN ('job_assigned','new_lead','payment_received','payroll_alert','join_request','quote_approved','job_scheduled','quote_viewed','quote_followup'));
  ```
  **Opened**: `/status` POSTs `/api/jobs/viewed` once per browser session for a
  `quoted` job (needs the signed `t` token — only a link we sent counts; link
  bots and a signed-in member of the job's own org are not counted). First open
  alerts owners/managers ("Quote opened"); a re-open alerts only after 4 quiet
  hours ("opened again, 3rd time"). Jobs list shows "Sent 3d ago · opened 2x".
  **Follow-up**: cron `/api/quotes/followup` (daily 17:15 UTC, so ~10-12 local
  across US zones; `?dry=1` + admin token previews without sending). Opt-in per
  org (Ops → Settings → Quote Follow-up). Rules are PURE in
  `lib/quote-followup.ts` (tested): #1 two days after last contact, #2 three days
  after that; last contact = later of `quote_sent_at` (a manual follow-up
  re-stamps it) and `quote_followup_at`; stops on approval/archive/status change.
  Channel: text ONLY with the customer's recorded opt-in (`smsConsentGranted`) +
  phone, else email, else the OWNER gets a "Follow-up needed" alert to reach out
  themselves. The step is claimed with a conditional update BEFORE sending, so
  a double-fired cron can't send twice. Owner is told what happened via
  `quote_followup` notifications. Recipient is the customer, never a resident.
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

- Bank transfer (ACH) and tips at checkout
  (`supabase/migrations/20261109120000_bank_transfer_and_tips.sql`):
  ```sql
  ALTER TABLE organizations ADD COLUMN IF NOT EXISTS ach_enabled BOOLEAN NOT NULL DEFAULT false;
  ALTER TABLE organizations ADD COLUMN IF NOT EXISTS tips_enabled BOOLEAN NOT NULL DEFAULT false;
  ALTER TABLE payments ADD COLUMN IF NOT EXISTS tip_cents INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE payments ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'stripe';
  ```
  Both switches live in Ops → Billing & Payments → Checkout options (owner or
  manager, once Stripe is connected) and default OFF. Until this runs the
  switches can't save and checkout behaves exactly as before (card only, no
  tip): every read of the new columns is a separate best-effort query. Money
  rules: lib/tips.ts (who may tip, server works out the cents),
  lib/payments/stripe-checkout.ts (the Stripe adapter of the payment layer;
  a second processor such as Banccard would add its own builder and record
  payments.provider). A tip is its own line item, never pays down the
  balance, and carries no platform fee; `payments.amount` stays the job part
  only. A bank payment finishes checkout "unpaid": the owner gets a "Bank
  payment on its way" alert (lib/bank-payment-notify.ts), the customer sees
  "Bank payment started", and the ledger row lands on
  async_payment_succeeded (a failure alerts "Bank payment failed").

- Card on file (`supabase/migrations/20261109130000_card_on_file.sql`):
  ```sql
  ALTER TABLE organizations ADD COLUMN IF NOT EXISTS card_on_file_enabled BOOLEAN NOT NULL DEFAULT false;
  ALTER TABLE customers ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;
  ALTER TABLE customers ADD COLUMN IF NOT EXISTS card_payment_method_id TEXT;
  ALTER TABLE customers ADD COLUMN IF NOT EXISTS card_brand TEXT;
  ALTER TABLE customers ADD COLUMN IF NOT EXISTS card_last4 TEXT;
  ALTER TABLE customers ADD COLUMN IF NOT EXISTS card_exp TEXT;
  ALTER TABLE customers ADD COLUMN IF NOT EXISTS card_saved_at TIMESTAMPTZ;
  ALTER TABLE customers ADD COLUMN IF NOT EXISTS card_consent JSONB;
  ```
  Run the whole file: it also adds the `customers_protect_saved_card`
  trigger, which keeps browser (anon / authenticated) writes from changing
  the saved-card columns, so only server routes can point a customer at a
  Stripe card.
  Switch: Ops → Billing & Payments → Checkout options ("Let customers save a
  card for later"), default OFF. With it on, a job linked to a customer record
  shows an unticked "save my card" box on the /status pay card; ticking it adds
  `setup_future_usage: off_session` on the CARD option only (never a bank
  account) and a platform-account Stripe Customer. The webhook's
  checkout.session.completed stores brand / last 4 / expiry + the consent
  text (lib/payments/saved-card.ts `saveCardFromCheckout`). The job screen then
  shows "Charge Visa ••4242" (owner/manager, confirm dialog) →
  `/api/payments/charge-saved`: off-session destination charge for the live
  balance, platform fee with the monthly cap (lib/payments/fee-cap.ts, shared
  with /api/checkout), idempotency key per (job, amount, paid-to-date),
  recorded through fulfillJobPayment with the PaymentIntent id as the ledger
  session id. A decline / authentication_required returns a plain message
  pointing to a pay link; nothing retries on its own. Removal: the job screen
  (`DELETE /api/payments/saved-card`) or the customer portal
  (`DELETE /api/portal/saved-card`), both detach the card in Stripe. No
  automatic charging on completion yet.

(The app handles missing columns gracefully — db helpers toast the
"column does not exist" error so the user notices.)

