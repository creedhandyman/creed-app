# Big systems shipped (reference)

Moved out of CLAUDE.md to keep it short. One entry per feature: how it works, where the code lives, and the rules to keep.

- **Quote-form spam protection (2026-11-23)**. Every public quote request
  (`/api/leads`: creedhm.com `/lead/[slug]` and the creedhandyman.com
  QuoteForm) runs, in order: (1) `lib/lead-spam.ts botCheck` — hidden
  honeypot (`hp`) filled, or sent < 3 s after the form appeared
  (`started_at`) → dropped silently, the bot is told "ok"; a missing timer is
  only a +1 signal (old cached forms / scripts). (2) Rate limits: the old
  per-address burst + `publicFormLimit`, plus per-email (3 / 10 min in memory;
  `EMAIL_LIMITS` 3/h, 6/day counted from `rooms.leadMail` hashes + held rows)
  and held rows per address (`lib/lead-guard.ts guardCounts`). (3) Optional
  Cloudflare Turnstile: ON only when `TURNSTILE_SECRET_KEY` is set (app form
  reads `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, website reads `LEADS.turnstileSiteKey`
  in site.ts — set all together). (4) `classifyLead` heuristics: links, pitch
  phrases ("we offer", SEO, Google ranking, marketing / web design / leads /
  backlinks / partnership / financing, cold-email openers, unsubscribe lines,
  monthly pricing), company-ish name or marketing email domain, no address;
  repair words count down (max −3). Score ≥ 5 = held, 2–4 = the AI decides
  (`aiSolicitationCheck`, call_type `lead_spam`; no answer = a lead), < 2 =
  lead. Held → `lead_review` row: no lead, no alert, no text, no AI draft, the
  sender sees the normal "got it". Owner view: Jobs list banner "N website
  requests held as possible spam" (`components/HeldLeads.tsx`, owners /
  managers) → sheet with reasons; "Make it a lead" (`/api/leads/review`
  restore: claims the row, then `lib/lead-intake.ts createLead` — the SAME
  path a fresh submission takes — with no alert, AI draft on) or "Spam"
  (dismissed, kept). Lead creation moved out of the route into
  `lib/lead-intake.ts` (unchanged behavior). Tests: `lead-spam.test.ts`.
  Not covered: the online booking form (`/api/public/booking`) and portal
  work orders.

- **Google Calendar two-way sync (2026-11-22)**. Ops → Settings → Google
  Calendar (`components/GoogleCalendarSync.tsx`; red "Reconnect" badge on the
  list row via `SettingsCategory.badgeTone`). Needs SQL
  `20261122_google_calendar_sync.sql` + env `GOOGLE_CLIENT_ID` /
  `GOOGLE_CLIENT_SECRET` (+ optional `GOOGLE_TOKEN_KEY`, else derived from
  `PORTAL_SESSION_SECRET`); redirect URI `https://www.creedhm.com/api/gcal/callback`.
  - **Scope** `calendar.app.created` (+ openid email): Creed makes its own
    "Creed jobs" calendar and only touches that. One connection per business
    (owner/manager connects; state HMAC-signed + nonce cookie).
  - **Rules** (`lib/gcal/core.ts`, pure): one event per schedule row, id =
    `eventIdFor(org, row)` (deterministic → a retried insert 409s and is
    patched, never duplicated). Timed single-day visit = timed event in the
    org's `booking_tz`; untimed or multi-day = all-day span (a timed multi-day
    visit puts the time in the title and keeps it when the span is moved).
    Only date / time / end day come back from Google (`applyVisit` keeps crew
    + free note); title/description edits in Google are not read. Pending
    online-booking requests and archived jobs are not on Google.
  - **Loop guard + conflicts**: `google_calendar_events` keeps the etag of our
    last write/read (same etag back = our own echo) and the hash of what Creed
    last rendered (same hash = nothing to push). Both changed → `decidePull`:
    later of Google's `updated` vs `schedule.updated_at` wins. Deleted in
    Google → visit deleted + job status back via `statusAfterUnschedule`
    (unless Creed edited it later, then the event is restored).
  - **Engine** (`lib/gcal/engine.ts`, injected Store/Api, tested with fakes in
    `gcal-sync.test.ts`): pull with the sync token (410 → full resync; token
    saved only after the pass handled it), then push today−30..+183, then
    remove events whose visit is gone / excluded. Calendar deleted in Google →
    a new one, maps cleared.
  - **Triggers**: app writes (`supabase.ts` fires `creed:db-write` →
    `lib/gcal-kick.ts`, 2.5 s debounce → `/api/gcal/kick`); Google push
    channel → `/api/gcal/webhook` (channel id + hashed token checked; renewed
    weekly by `ensureWatch`); cron `/api/gcal/cron` every 10 min (fallback +
    server-side writes); Settings "Sync now". One pass per org at a time
    (`sync_lock_until`); `syncSoon` retries a busy kick.
  - **Revoked / expired**: Google `invalid_grant` / 401 → `AuthError` → status
    `needs_reconnect`, ONE bell alert to owners/managers (type job_scheduled),
    red banner + Reconnect in Settings. Reconnecting with the same Google
    account keeps the calendar and links; another account starts fresh.
  - **.ics feed fix (same day)**: the subscribe feed wrote floating local
    times, which Google subscriptions read as UTC (jobs 5–6 h early); it now
    writes UTC instants from the org's zone (`lib/tz.ts`) + X-WR-TIMEZONE.
    Subscriptions still only refresh every few hours (Google's side).

- **Sign in with Creed — MCP OAuth 2.1 (2026-11-21)**. Lets claude.ai (and
  Claude Duet / any MCP client) add `https://www.creedhm.com/api/mcp` as a
  custom connector without pasting a key.
  - **Discovery**: `/api/mcp` 401s with `WWW-Authenticate: Bearer
    resource_metadata=".../.well-known/oauth-protected-resource/api/mcp"`
    (`error="invalid_token"` when a token was sent, so the client refreshes).
    `/.well-known/oauth-protected-resource[/…]` (RFC 9728),
    `/.well-known/oauth-authorization-server[/…]` (RFC 8414) and
    `/.well-known/openid-configuration` (same JSON). URLs follow the Host
    asked (www or apex) but only for our own hosts (`oauth/core.ts
    trustedOrigin`); everything else gets `siteOrigin()`.
  - **Flow** (`lib/oauth/core.ts` pure rules, `lib/oauth/server.ts` DB):
    `POST /api/oauth/register` (RFC 7591, open, 10/h per address; public
    clients by default, `client_secret_post|basic` allowed; redirect URIs https
    or http://localhost, no fragments) → browser to `/oauth/authorize`
    (`app/oauth/authorize/Consent.tsx`; signs in with a non-persisting
    Supabase client if this browser has no session; X-Frame-Options DENY) →
    `POST /api/oauth/authorize` (check / approve / deny; approve needs an
    owner/manager JWT of the chosen org; scopes ⊆ what the app asked, or any
    when it asked none; PKCE S256 required; `resource` must be our MCP URL) →
    redirect with `code`, `state`, `iss` (RFC 9207). A bad client or redirect
    URI never redirects. `POST /api/oauth/token`: authorization_code (single
    use; a replayed code revokes the connection it made; client, redirect,
    PKCE, expiry, resource checked) and refresh_token (rotated: the presented
    token is spent). `POST /api/oauth/revoke` (RFC 7009; a refresh token ends
    the connection). Tokens: `creed_at_` 1 h, `creed_rt_` 60 d; codes 10 min;
    all stored as SHA-256 only.
  - **Same as a key**: the exchange creates an `api_keys` row `kind='oauth'`
    (name = client name, the approved org + scopes, `created_by` = approver)
    and logs `oauth.connect`. `agent/server.ts authenticateKey` takes
    `creed_sk_` keys OR `creed_at_` tokens and ends at that row, so scopes,
    rate limits and `api_activity` are unchanged. The AI assistant connection
    page shows it as "Connected app" (Revoke only; Replace is refused — reconnect
    from the app). Revoking the row kills every token at once.
  - **Not done**: only one business per login is offered (profiles have one
    org); no refresh-token reuse detection beyond "spent = refused". SQL
    `20261121_mcp_oauth.sql`. Tests `mcp-oauth.test.ts`.

- **Agent API (2026-11-20)**. Lets an AI assistant work for ONE business.
  - **Read tools + update_job (2026-11-22)**, `lib/agent/tools-read.ts` (pure
    rules in `lib/agent/read.ts`, tested in `agent-read.test.ts`):
    business_summary (start here), list_schedule, list_jobs, get_job,
    list_customers, get_customer, list_quotes, get_quote, list_invoices,
    update_job. New scopes `jobs:read`, `jobs:write`, `billing:read` — an
    existing key / claude.ai connection must be reconnected or replaced to get
    them (list_schedule + list_customers / get_customer work on the old
    schedule:read / customers:read). Money amounts (balances, unpaid totals,
    quote values in the summary) only with billing:read. update_job: status to
    accepted / scheduled / active / complete only (never quoted — starts quote
    follow-ups; invoiced — starts invoice reminders; paid — that's a payment),
    never on invoiced / paid / archived jobs, guarded on the old status; notes
    are APPENDED to `rooms.jobNotes` with a stamp (blob re-read right before the
    write). Completing via the API does NOT run the app's completion learning /
    equipment stamp. get_open_slots now lists every day with a `why` (closed /
    minimum notice / all-day or untimed visit / fully booked) + the settings it
    used + a one-line `summary`; accepts from / to. Note: a visit with NO start
    time blocks its whole day for booking (the usual cause of "no slots").
  - **Keys**: Ops → Settings → AI assistant connection
    (`components/AgentConnectionSettings.tsx`, server `/api/agent/keys`,
    owner/manager via `requireOwner`, org from the profile). Name + scopes
    (`lib/agent/scopes.ts`: customers:read, work_orders:write, quotes:draft,
    schedule:read, schedule:write). The key (`creed_sk_` + 40 hex) is shown
    ONCE; only its SHA-256 is stored (`lib/agent/keys.ts`). **Replace key** =
    revoke old + new key with the same name/scopes, shown once, logged as
    `key.replace` (the recovery path for a lost key). Revoke logged too. Max 10
    active keys.
  - **Serving**: REST `POST /api/agent/v1/<tool>` (JSON args; `GET
    /api/agent/v1` lists the key's tools) and MCP `POST /api/mcp`
    (`lib/agent/mcp.ts`, hand-written JSON-RPC: initialize, ping, tools/list,
    tools/call; JSON responses, no SSE; tool errors come back as `isError`).
    Both auth with `Authorization: Bearer creed_sk_…` (or `x-api-key`) and go
    through `runTool`: scope check → 30/min per instance (`memoryLimit`) →
    600/h per key (count of `api_activity`) → handler → one `api_activity` row
    (also for refusals). The business ALWAYS comes from the key's org_id.
  - **Tools** (`lib/agent/server.ts`, pure rules in `lib/agent/plan.ts` and
    `customer-match.ts`):
    - `find_customer` — the ONE matcher: phone = last 10 digits, email =
      lower/trim, name = folded (name only when nothing else matched, and a
      name alone never links a new work order).
    - `add_work_order` — creates a LEAD (never scheduled): source
      appfolio|angi|buildium|email + external_id on `jobs.source` /
      `jobs.external_id` (and `leadSource` / `leadExternalId` on the blob);
      same source + id again returns the existing lead (unique index catches
      races); https photo links (≤12, no internal hosts) → `leadPhotos`; links
      the customer by phone/email or adds one; alerts managers (in-app, like a
      website lead).
    - `draft_quote` — leads only, never one with a saved quote. Runs
      `draftLeadQuote` (same AI engine as website leads, request labelled with
      the source) and waits; an existing `leadDraft` is returned without a
      second AI run. Cap: 25 AI drafts/business/day (activity rows "AI draft…"
      + draftLeadQuote's own lead count). Returns total, hours, est days,
      Good/Better/Best options (`lead-draft.ts draftSummary`, follows
      `tiered_quotes_default`), ≤15 lines (no per-line hours when flat
      pricing), `quote_link` = `/?job=<id>` (AppShell opens that job on the
      Jobs tab) and `pdf_link` = `/api/agent/draft-pdf?…` — the real quote PDF
      HTML (`quote-pdf.ts jobQuotePdfHtml`, now server-safe via
      `export-pdf.ts buildQuotePdfHtml`) marked DRAFT, from a 7-day HMAC link
      with its own purpose (`lib/agent/draft-link.ts`; never the approval
      token). Nothing is sent.
    - `get_open_slots` — booking settings read by org id (booking page need
      NOT be on) + `loadBusyVisits` + `openSlots`, same as /book.
    - `schedule_job` — by job_id only; one schedule row per day
      (`start_date`+`days` or `dates`, ≤14) with note `🕐 HH:MM · 👷 crew ·
      note` (crew must be real team names); a day the job already has is
      updated, not duplicated; job → scheduled from lead/quoted/accepted.
  - **Left out on purpose**: sending to customers, payments, deleting, bulk
    imports. SQL `20261120_agent_api_keys.sql`. Tests:
    `agent-api.test.ts`, `agent-keys-route.test.ts`.

- **Flat-price quotes (2026-11-19)**. The customer sees one price per line,
  never hours or an hourly rate; hours × rate still price every line and the
  totals don't change. Hours stay on the job (work order, scheduling, costing).
  - **Setting**: org default `organizations.flat_pricing` (Ops → Settings →
    Pricing & taxes, "Flat prices on quotes"; migration
    `20261119_flat_pricing.sql`). Per quote: the "Customer sees" switch in
    QuoteForge (`flatChoice`, null = org default). Every save writes the
    RESOLVED boolean as `blob.flatPricing` (`buildQuoteSave`), so a sent quote
    can't change when the org default does. Readers call `quote-blob.ts
    flatPricingFor(blob, org)` — quote's choice, else org's.
  - **Where it shows**: quote PDF (`export-pdf.ts` `flatPricing`: summary =
    Category · Items · Price, breakdown = Work · Price per line, no Man-Hrs
    column, labor equations, "Labor hours" tier row, rate / man-hour note,
    hours in the min-charge note or the completion estimate — days only);
    /status (lists each line with its price from `quoteSections(...).lines`);
    portal copy (same PDF; `portal/me` reads `flat_pricing` best-effort); the
    invoice (Jobs `generateInvoice`: Description · Total only). QuoteForge:
    lines show PRICE with hours / sqft / materials behind "Hours & materials";
    the totals card shows item count + total.
  - **Not hidden**: the public quote page's JSON still carries each line's
    `laborHrs` and the org's rates — the approval fingerprint
    (`approval.ts scopeFingerprint`) is computed on the hours, so they can't be
    stripped without breaking signed quotes. Display-only.
  - Tests: `flat-pricing.test.ts`.

- **Apply client spec: preview + tiers (2026-11-17)**. Fix for Grid 606 carpet
  job eb5985e2, where the Shaw tile spec item's one-word keyword "carpet"
  turned the Complete option's roll-carpet and pad allowances into Shaw tile.
  - **Matching** (`lib/material-spec.ts matchSpecItem`): a ONE-word keyword
    ("carpet", "base", "toilet") only counts when the spec item covers ≥80% of
    the material's describing words; multi-word keywords win over shorter
    ones. `specConflict` blocks any name/keyword/overlap match when the
    material names an accessory the item isn't (pad, adhesive, tape, wax,
    supply, tack…) or a different form (roll / broadloom vs tile / square /
    plank vs sheet). Model-number matches skip the guard.
  - **Alternates** (`isSpecAlternate`): a material named as an allowance, or a
    line written as a non-spec alternate ("close to Grid's tile spec",
    "non-spec", "budget option", "instead of spec") is left alone by
    `applySpec` (also the automatic pass after the AI) unless the owner ticks it.
  - **Preview**: the "Apply client spec" button now runs `planSpec` over EVERY
    line / option (no tier filter) and opens a sheet: per line (with its option
    chips), each material old → new (qty × price) + companions, ticked except
    alternates, and the materials cost change (`specPlanDelta`, before markup).
    Apply runs `applySpecPicked` with the ticked keys (`room:line:material`).
    Nothing changes until Apply. Tests: `spec-apply-tiers.test.ts`.

- **Quote line trades (2026-11-17)**. Which trade bucket a quote line sits in.
  - **One home**: `lib/trade-classify.ts` (`pickTrade`, `overrideTrade`,
    `scoreTrades`, `rescueTrade`), called by validateQuote for every line;
    tested in `trade-classify.test.ts` (Grid 606 water-damage job eabb353f +
    misses pulled from saved quotes). The old inline scorer in parser.ts is gone.
  - **Precedence**: owner's pick (`userClassified`) → deterministic overrides →
    keep the AI's / saved bucket unless the whole-line scorer has ≥8 points for
    another trade AND the bucket has 0 (or is out-scored by more than 2× + 6) →
    scorer → General.
  - **Scorer rules**: objects and materials decide. Damage context (water
    damage, moisture, leak, wet, flood, mold) scores no trade by itself; only a
    plumbing OBJECT (pipe, faucet, supply line, drain, valve, clean-out…) makes a
    line Plumbing, word-bounded (drainage / caulk tube / disposal bags / paint
    sprayer don't count). Drywall / flood cut / tape / mud / texture /
    insulation → Carpentry; slab / concrete / soil / rock / regrade → General;
    caulk or sealant on concrete / masonry → General (else Painting).
  - **Trade picker**: each line in the quote editor has a Trade dropdown
    (`QuoteForge moveItem`); picking one moves the line and stamps
    `userClassified`, so it sticks through save and reopen.
  - Reopening a saved quote re-runs validateQuote, so a line the rules now
    read differently moves bucket on reopen (the approval fingerprint ignores
    trades). Price only changes if the org's trade rates differ between the two
    trades.

- **Job summaries (2026-11-17)**. A one-sentence line on every collapsed job
  card (Jobs list) and a "What this job covers" paragraph on the job detail
  screen, so nobody has to open the quote to see the scope.
  - **Code**: `lib/job-summary.ts` (pure, tested in `job-summary.test.ts`);
    wired in `screens/Jobs.tsx` (card line, detail section, edit sheet).
  - **Auto text is computed on read** from the saved quote lines, so it is always
    current with the quote; nothing is stored or regenerated on save. Lines come
    from ONE option of a three-tier quote (accepted → sent as → recommended,
    `rowTier`); overhead ("Job setup … cleanup") and supplies-only lines are
    skipped; `detail` is split "Place — Task". Card line = up to 3 biggest tasks
    + "and N more" (≤150 chars, place named when the job is in 1-2 places).
    Paragraph = tasks grouped by place + item count and labor hours.
  - **No quote lines yet** (a lead) → the customer's own words
    (`leadDescription`): first sentence on the card, the full request card on
    the detail screen (the lead card's hint now just says "New lead").
  - **Owner / manager edits** save `rooms.summaryEdit {short?, long?, sig}` via
    `patchBlob`. Text equal to the auto text isn't stored; empty = back to
    automatic. An edit always wins; when the quote lines change after it (`sig`
    differs) the detail screen says so and offers "Use the new summary" —
    the owner's words are never silently overwritten.

- **Store purchase prices (2026-11-19)**. Import Home Depot / Lowe's purchases
  so quotes and customer specs use what the shop really paid.
  - **Where**: Ops → Settings → Pricing & taxes → "Store purchase prices"
    (`StorePricesCard` → `PurchasePriceImport`), and "Update prices from store
    purchases" on a customer's Material spec card.
  - **Reading** (`lib/purchase-import.ts`, pure, tested): HD Pro "Purchase
    Tracking" ITEM export is mapped directly — 6-row preamble, header found in
    the first 20 rows; per-unit price = **Extended Retail (before discount) ÷
    Quantity** (that column is really AFTER the discount; "Net Unit Price" is
    the line total before it; "Unit Price" is empty). Any other sheet with
    description + price headers maps too. ORDER-only exports (HD transaction
    list, the Lowe's Pro export — totals, no items) are recognized and noted,
    never guessed at. Everything else (receipt PDFs / photos, odd text) goes to
    `/api/prices/extract` (call_type `price_import`), chunked like the spec
    upload (`lib/file-read.ts`). Lines are classified: returns, fees,
    snacks/drinks skipped; tools (HD "TOOLS" depts, drill/saw/… words) off unless
    ticked; bits/blades/screws stay materials.
  - **Rules**: newest price per product (`productKey` = store + SKU, else
    model, else description); an older or undated line never replaces a dated
    price ("older"), same price = unchanged. Spec items match by SKU → model
    (column or a ≥4-char token in the description) → brand in the description
    + ≥2 name words covering ≥70%; a spec `store` naming another store blocks
    the match; returns never match. Unmatched spec items are never touched.
    History hashes the purchase, not the file (`lineHash` + per-file
    occurrence), so overlapping exports don't double up.
  - **Review**: every product change (old → new, store · SKU · date · job/PO)
    and every spec match (customer, how it matched) with a checkbox; spec
    matches older than the spec's price start unticked. Save writes history
    (lines of kept products), current prices, then spec items
    (`unit_price` + `price_updated_at` + `price_source`).
  - **Quotes**: `buildGrounding` gets `storePrices` (app: `loadLatestStorePrices`,
    lead drafts: service role filtered by org) and adds "Latest store prices"
    above the shop list (rankByRequest, 40% share, ≥2 shared words). Spec
    items already price spec materials.
  - **Receipt scans feed it (2026-11-20)**. `/api/ai/receipt` now returns, per
    line, `name` (as printed), `product` (plain name, "" when unsure) and `sku`
    (store item number). After a receipt saves, all three scan paths
    (`ReceiptScanSheet`, Work mode's `scanReceiptAndLearn`, the offline replay)
    call `receipt-scan.ts logReceiptItems` → `POST /api/receipts/log-items`
    (any org member; service role; org from the caller's profile, never the
    body). Rules in `lib/receipt-lines.ts` (pure, `receipt-lines.test.ts`):
    supply stores only (`isSupplyStore`: HD, Lowe's, Menards, Sherwin, Ace,
    names with supply / lumber / hardware / paint…; gas and lunch receipts log
    nothing); description = "plain name (AS PRINTED)"; unit price = line total ÷
    qty; materials AND tools go to `material_price_history` (tools marked
    department "TOOLS"), only materials to `material_prices` and only when new
    or newer (`planPriceChanges`); returns, discount lines, fees, snacks
    skipped. `job_ref` = the job's address. Same receipt scanned twice adds
    nothing (`line_hash`). Known limit: the same item, qty and price bought
    twice in one day for one job on two receipts logs once. A separate
    discount line (Pro Xtra) is not spread over the items.
  - **Receipts keep their item list (2026-11-21)**. `receipts.items` (JSONB:
    `[{name, product, sku, qty, price}]`, price = LINE total) + `receipts.vendor`
    (`20261124_receipt_items.sql`). Written by all three scan paths as a
    SEPARATE quiet update after the receipt row saves, so a missing column
    never blocks a receipt. `receipt-lines.ts storedItems` is the one way to
    write AND read the column (never throws; keeps returns / discount lines).
    Jobs → Receipts: tapping a receipt's text opens `ReceiptItemsSheet`
    (store, date, every item with item number and each-price, total, View
    photo); tapping the thumbnail still opens the photo. A receipt with no
    list offers "Read the items from the photo" (re-scans, fills only items +
    vendor, never note / amount, logs nothing to the material log). The
    customer portal strips `items`, `vendor`, `pages` (`/api/portal/me`).
    Same day: the Jobs tab's receipt "Take photo" + the sheet's "Add page" use
    `CameraModal` (rear lens; the phone's camera app via capture=environment
    opened the selfie lens on the owner's Samsung); CameraModal asks for a
    4K-ideal stream when `maxSize > 1600`.
    `learnFromReceipt` (price_corrections) now learns materials only, per
    unit, in all three paths; Work mode used to teach the LINE total and tools.

- **Per-customer material specs (2026-11-17)**. A customer can require exact
  products (brand / model / store). Plan + SQL: `customer-material-specs.md`;
  tables `material_specs` + `material_spec_items` (migrations.md).
  - **Where**: Customers → a customer → "Material spec" card
    (`components/MaterialSpecCard.tsx`, owner/manager only): list of specs with
    an On/Off switch, Import, and an editor (rename, search, edit / delete items,
    companions as text lines "1 Shaw 4151 adhesive per 400").
  - **Import** (`components/MaterialSpecImport.tsx`): CSV / tab paste and
    `.xlsx` map straight to fields when a header row is recognized
    (`lib/spec-import.ts rowsToDrafts`, `lib/xlsx-read.ts` = our own zip reader,
    no npm dependency); anything else (PDF, free text, sheets with odd headers) goes
    to `/api/specs/extract` (owner-only, `callClaude` call_type `spec_import`).
    Everything lands on a review screen first; `cleanDrafts` never invents a price
    ("call", "N/A" → no price = "price needed").
  - **Quoting**: `lib/material-spec.ts` (pure, tested). QuoteForge loads the
    customer's ACTIVE specs (`material-spec-client.ts loadCustomerSpec`, never
    throws, [] when the tables are missing) and passes `{spec, customerName}` to
    `aiParsePdf` / `aiParseInspection` (`ParseOptions`); the lead draft does the
    same server-side (`lead-draft.ts loadSpecForCustomer`, service role filtered by
    org). The parser adds `specPromptBlock` to the system prompt and, after
    calibration, runs `applySpec`: each material is matched (model # → name →
    owner keywords → ≥2 shared words AND ≥70% of the item's words; ONE shared word
    never matches), renamed to brand + name + model (+ pack), priced from the spec,
    its quantity rounded UP to whole selling units (`toSellingUnits`: ft / sqft via
    pack size or coverage), and companions added per line (`per` measure units,
    rounded up; computed companions replace AI-written ones). Idempotent. No spec
    price → AI price kept and `spec.priceNeeded` set.
  - **Shows**: a "Spec" chip under each quote line, a banner with "m of n materials
    use spec products" + "Apply client spec" (runs `applySpec` on hand-built
    lines), spec items suggested first in the Materials sheet (typing over the name
    drops the tag), and a "client spec" badge on the quote PDF materials table.
  - **Upload (2026-11-18)**: several files at once + a Take photo button.
    PDFs: text PDFs over ~40k chars and big ones are read page by page in chunks
    (`readPdfPages` → `chunkPages`, `part: "pages 9-16 of 40"`); small ones go
    whole, and if that answer runs out of room the text is re-read in chunks;
    big scanned PDFs are rendered (`renderPdfPages` quality option, ≤60 pages)
    and sent ≤4 images per call. Workbooks: EVERY sheet (`readXlsxSheets` →
    `planSheets`; a real tab name fills an empty category). Photos: shrunk to
    2000px, ≤4 per call (`imageBlocks` validates on the server). All parts are
    merged + de-duplicated (`mergeDrafts`); a part that fails is listed in the
    notes, the rest still load. Review table: every field editable (incl. trade,
    SKU, keywords, notes), Add row, remove row. NOTHING is written until Save;
    then the items, then the originals go to the private `spec-files` bucket
    (`material-spec-client.ts storeSpecFiles`, `{org}/{spec}/{time}-{name}`) and
    are listed on the spec (open via a 5-minute signed link, remove, deleted with
    the spec). Migration `20261118_material_spec_files.sql`.
  - **Rules**: saved quotes keep their spec tag + price on each material
    (`Material.spec: MaterialSpecTag`), so editing / turning off a spec never
    changes a saved quote. Customers with no active spec see no change at all.
    Tests: `material-spec.test.ts`, `spec-import.test.ts`, `xlsx-read.test.ts`.

- **Sign-up alerts for Creed itself (2026-11-13, branch `signup-notify`)**. Hourly
  cron `/api/admin/signups` (vercel.json, minute 5) emails the platform owner when a
  new business signs up. A sign-up = a new `organizations` row (someone finished
  "Create a business"); crew joining a team is not one. Each run covers everything
  created since the last successful run stopped (`result.until` in `cron_log`,
  endpoint `signups`), one email per run; a failed send does not move the marker, so
  the next run tries again. The first run covers the last hour only and a run never
  reaches back more than 48 hours. Window + email text are pure in
  `lib/signup-notify.ts` (tested). Read-only: onboarding is untouched, no migration.
  Recipient = `SIGNUP_NOTIFY_EMAIL` env, default `bernard@creedhm.com`; needs
  `RESEND_API_KEY`. `?dry=1` previews without sending. Why it exists: the Creed HQ
  agent team reads that inbox to count sign-ups against its goals.

- **Email campaigns + customer referrals (2026-11-12, branch
  `feature/campaigns-and-referrals`, both OFF by default)**. Switches live in
  Ops → Business settings → Customer messages (`components/MarketingSettings.tsx`).
  *Campaigns*: Ops → Campaigns tile appears only while `campaigns_enabled`
  (`screens/Campaigns.tsx`). Audiences, recipient rules, merge fields and the
  footer are pure in `lib/campaigns.ts` (tested): unsubscribed and invalid
  emails are always skipped, each address once; "lapsed" = finished work but
  no job in 365 days; "members" = active/past-due plan. Server:
  `lib/campaigns-server.ts`; `/api/campaigns` (list/save draft),
  `/count`, `/draft` (AI, rate-limited), `/send` (test → the owner's own
  email only; real → queues `campaign_sends`), `/cancel`, and the cron
  `/api/campaigns/dispatch` (every 15 min) that claims queued rows, re-checks
  unsubscribes, sends ~2/s with List-Unsubscribe + one-click POST headers and
  Reply-To the business email, and pauses (keeps the queue) if the business
  turns campaigns off or loses its address. Every email needs the business
  mailing address (CAN-SPAM). Unsubscribe: signed per-customer token
  (`lib/unsubscribe-token.ts`, PORTAL_SESSION_SECRET with an "unsub:" purpose)
  → `/u/[token]` (one tap) or the one-click POST to `/api/unsubscribe`.
  Resend webhook `/api/resend/webhook` (Svix signature, `lib/resend-webhook.ts`,
  fails closed) stamps delivered/opened/clicked/bounced/complained; a spam
  complaint unsubscribes the customer. Rows stuck in `sending` are never
  retried, so nobody is emailed twice.
  *Referrals*: each customer's link is `/lead/{site_slug}?ref={referral_code}`
  (needs a published site). `/api/leads` records a `pending` referral only
  when the lead CREATED a new customer (never yourself, one referrer per new
  customer) and adds "referred by" to the new-lead alert. The friend's first
  recorded payment (`fulfillJobPayment` → `lib/referrals-server.ts`) turns it
  `earned` with the business's reward. The credit shows on the customer page
  (`components/CustomerMarketingCard.tsx`, also "Don't email") and in the
  portal (Refer a friend card); QuoteForge offers "Use $X referral credit",
  a fixed discount labeled "Referral credit", and marks the credit `applied`
  after the save (`/api/referrals/apply`).
- **Text consent per customer (2026-11-12, branch `text-consent`)**: Creed's
  AUTOMATIC Twilio texts go only to people who said yes. ONE rule:
  `lib/sms-consent.ts autoTextConsent(customer, ...jobRooms)` — the newest of
  the customer row's answer (`customers.sms_consent`, yes or no; ignored if
  it was for a different phone number) and any "yes" on the job blob
  (`smsConsent`; an unchecked box is never a "no"). Residents on PM jobs need
  their OWN yes (`residentSmsConsent` on the job blob, Jobs → resident
  section checkbox, owner/manager; tied to that number) —
  `sms-recipient.ts recipientConsent(role, phone, job, customer)` picks the
  right one. Gated senders: visit reminders (`/api/sms/reminders` — had NO
  check before; no consent = owner bell "remind them yourself"), invoice
  reminders, quote follow-ups, review requests. NOT gated, on purpose:
  portal login links the customer asks for (`/api/portal/request-link`),
  the Texts screen reply box (replies in a conversation the customer
  started), crew/owner alerts (`notify-server`), and every hand-sent text
  (phone's Messages app). Writers (`lib/sms-consent-server.ts`):
  `recordCustomerSmsConsent` — the quote form (`/api/leads`), approval page
  (`/api/jobs/approve`, yes only) and booking page also write onto the
  customer ("form" mode: a "no" only when nothing is on file);
  `stampConsentFromReply` — STOP sets every customer with that number to no
  ("replied STOP"); START restores only those whose answer is that STOP. The
  customer page's **Automatic texts** card (`components/TextConsentCard.tsx`)
  shows status, how/when/who, history, and lets owner/manager record a yes
  (in person / phone call / in writing / by text) or turn texts off.
  `loadCustomersWithConsent` falls back to the old columns before the
  migration. `/api/portal/me` drops `sms_consent` (IP + staff names are
  internal). Tests: `text-consent.test.ts`, `text-consent-card.test.ts`.

- **Follow-ups (2026-11-11)**: (1) A lead that opens on its automatic draft
  (`leadDraft`) shows an "Automatic draft" card in the quote editor with
  **Edit request & rebuild** (QuoteForge `leadDraftSeed`, only while the job
  is still a lead): one confirm, then the Quick Quote review step with the
  customer's text + photos; Generate replaces the draft's lines. (2) The X on
  a job photo now also deletes the stored file: after the blob write lands,
  Jobs POSTs `/api/jobs/photo-file` (owner/manager). It deletes only a
  job-photo file (`lib/photo-file.ts jobPhotoPath`: gallery/, quickquote/,
  leads/, portal-leads/, inspections/, ai-renders/ in the public bucket;
  never logos, avatars, card, equipment or sms/) that NO job's `rooms` text
  still mentions (any business), so a photo shared with another job, a lead
  or a render's source stays. Any doubt = the file is kept.

- **Jobs that got lost (2026-11-11)**: four holes where a job dropped out of
  every list. (1) **Paid up front**: `recordJobPayment` flips a job to "paid"
  only when the money covers the total AND the work is done (status complete /
  invoiced / paid) or the owner chose Paid by hand (`forcePaid`; the Jobs Paid
  choice and bulk Paid send `markPaid` to `/api/payments/record`). Otherwise it
  is a prepayment: `amount_paid` is recorded, status and `paid_at` are left,
  no review request (`result.settled` false, `fullyPaid` true). The job closes
  when it's completed: `transitionJob` writes "paid" + `paid_at` instead of
  complete / invoiced for a job that `isPaidUp` (lib/job-send), and calls
  `onSettled`; the Jobs single-job status change then POSTs
  `/api/reviews/queue` (any org member, job must be "paid") so the automatic
  review text still goes out. Bulk changes and Work mode don't queue it (Work
  mode already shows the review prompt). Job detail shows "Paid in full ·
  closes when the job is completed"; /status shows Paid. (2) **Recurring
  jobs**: `/api/recurring/fire` now also inserts the schedule row (visit day =
  `recurringVisitDay`, note `recurringVisitNote`), and fires everything due by
  the end of today Central (`recurringDueCutoff`), not just what's due by the
  3 AM run. Membership visits still get no calendar row (no promised day).
  (3) **"scheduled" with nothing on the calendar** now shows in every
  needs-scheduling list (`day-plan readyToBook`: Schedule day + Dispatch
  lists, Home "to schedule", the Dispatch planner pool), and Unschedule on a
  job's LAST visit moves it back (`statusAfterUnschedule`: approved or never
  sent → accepted, sent but unapproved → quoted). (4) **Reminders**: a second
  cron, `/api/sms/reminders/today` (14:00 UTC; calls the same route with `when=today`), texts "today" for visits
  the evening run missed (booked after it, or moved); it skips visits booked
  that same morning or already started. Moving a visit to another day clears
  `schedule.reminder_sent_at`. Tests: `lost-jobs.test.ts` + additions to
  `payment-fulfillment.test.ts` / `job-transition.test.ts`.

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
- **Tier builder + one-tier send (2026-11-14)**: (1) Why a small quote showed
  three identical prices: the AI tags small jobs all must-fix (prompt: don't
  pad), and 0adebeb turned tiers on for any 2+ line quote anyway (the
  tiered_quotes_default migration was irrelevant — a missing column reads ON).
  Now an AI-built quote with 2+ lines and no split runs the TIER BUILDER
  (`lib/tier-build.ts` prompt + `parseTierBuild`, `tier-build-client.ts`
  `aiBuildTiers`, ai_usage call_type "tiers"): it proposes up to 3 recommended
  (Complete) + 3 upgrade (Premium, priced as the extra only) add-on lines,
  merged with `applyAssistOps` (existing lines untouched; AI Assist's Undo
  reverts it), or answers "too small" → tiers off + a one-line "Too small to
  tier — reason" note. A tiered quote with no split shows that notice + Build
  tiers with AI / Use one price instead of three equal cards. Typed / template
  quotes don't call the AI on their own (button only). (2) The send menu
  (`SendSheet` `tierOptions` / `tierStart`, choices from `lib/tiers.ts
  sendTierChoices`) offers All tiers / Essential only / Complete only / Premium
  only on an open tiered quote, in QuoteForge and on the job screen (client
  recipient only; Follow up doesn't ask). The pick is written as
  `rooms.sentTier` (null = all) via `patchBlob`; `quote-blob.ts readSentTier`
  reads it (tiered + that tier priced). /status then shows that tier as a plain
  one-price quote (no picker), the PDF (`quote-pdf.ts`) prints only that tier
  until signed, `approve-job.ts applyApproval` locks an ONLINE approval to it
  (owner-recorded approvals may pick any tier), and /api/jobs/approve refuses a
  stale page that offered a different tier. Tests: `tier-build.test.ts`.
- **One send menu (2026-11-14)**: the job screen's Send quote / Follow up /
  Message customer / Send invoice open the SAME `components/SendSheet.tsx` as
  QuoteForge's Send (Text · Email · Copy · Share, editable message) instead of
  the old inline Messages/Copy strip. SendSheet takes optional `recipients`
  (client + tenant chips, each with its own number / email / message) and
  `onSent(via, to)`; Jobs only stamps quote_sent_at / complete→invoiced when
  the recipient's `pick` is the client (Copy = quiet). Change the menu there,
  never re-inline it. Work mode's Complete & invoice step still has its own
  strip.
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
- **Three tiers are the default (2026-11-14)**: a NEW quote with 2+ lines
  starts as Essential / Complete (recommended, headline) / Premium, however the
  lines arrived (AI parse, lead draft, template, typed by hand) — the
  QuoteForge effect next to `tieredQuote` + `lib/tiers.ts shouldOfferTiers`
  (count only; it no longer needs an AI "recommended/upgrade" tag). Single-item
  jobs stay one price. Off switch per business: Ops → Settings → Pricing &
  taxes "Three tiers by default" (`organizations.tiered_quotes_default`, read
  via `tiersDefaultOn`, ON unless false). Per quote: the existing On / One
  price button; once the owner, AI Assist or a restored draft decides, the
  auto-default stops (`tierChoiceRef`). Saved quotes (editingId) are never
  changed — they load with what they saved. An all-must-fix tiered quote still
  reads as one price to the customer (status picker / PDF need a split).
  Stored tierNames (old "Better/Best") are ignored everywhere: `readTierNames`
  returns Complete / Premium.
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
  still 0; queue meta carries property/trade for the learning rows). **Refunds (2026-10-26)**: a refund/return receipt scans as a NEGATIVE total (prompt rule) and saves as a negative amount, so it subtracts from job materials; the sheet labels it "Save refund" and prefixes the note "Refund —". Learning skips non-positive lines. **One receipt flow (2026-10-26)**: Jobs → Receipts now opens the same `ReceiptScanSheet` (Take photo / Upload / pencil = type it in); its old inline scan form + item learning were removed. **Guide shopping list is editable**: the
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
  **One component (2026-10-26)**: the Shopping + Tools cards are
  `components/GuideShopTools.tsx`, used by BOTH WorkVision → Guide and
  QuoteForge → Guide (the quote editor used to have a cruder inline
  name/$ editor). Add/edit = `ShopItemSheet` (type-ahead, −/+ qty, each,
  total), "$ left" counter. Parent owns the state and gets one patch via
  `onChange` — WorkVision persists it to the job at once, QuoteForge keeps
  it until Save. Quote-editor adds use trade "Added" (sorts last, like
  "Added on site").
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
  **Accuracy pass (2026-11-10)** — an audit of real data found the AI's own
  hours ran ~19% OVER the clock on 18 raw-basis jobs (129h vs 105h), yet the
  factor could only raise. Changes:
  - **Calibration works both ways, and is shrunk.** Raw basis: `overall = 1 +
    trust(n) × (actual/ai − 1)`, a trade = `overall + trust(n_trade) ×
    (ratio − overall)`, `trust(n) = n / (n + RAW_PRIOR_JOBS)` (10) — a handful
    of jobs moves it part of the way only. `calibrationFactor(cal, bucket)`
    clamps raw to `RAW_FACTOR_MIN` 0.85 … `RAW_FACTOR_MAX` 1.5 and legacy to
    1 … `LEGACY_FACTOR_MAX` 1.15 (legacy still never trims). `calibratedHours`
    applies it: ±5% dead band; a raise scales every line; a TRIM touches only
    lines ≥ 1h (owner edits cut big lines and RAISE small ones), never T&M
    lines, never below the flooring per-sqft minimum (`flooringFloorHrs`).
    Creed's factor on 2026-11-10 ≈ 0.95 overall (General 0.85, Carpentry
    0.94; the other trades sit inside the dead band). Trims show as a note. Tested in
    `labor-calibration.test.ts` (incl. the real 18-job snapshot).
  - **Grounding replaces the old "learned pricing" lessons**
    (`lib/quote-grounding.ts`, pure, tested). The old block keyed on a line's
    whole text, so it mostly echoed one quote's own edit chain. Now each
    parse gets only what MATCHES THE REQUEST (matched per sentence/line of the
    request, IDF-weighted word overlap ≥ 0.7, ≥ 2 shared words): YOUR PAST
    WORK (`pastWorkFrom`: an edit chain collapses to where the owner left it,
    the room prefix is dropped so a task learned in one room applies in
    another, clocked hours shown only when within 0.5–2x of the quote, median
    across jobs), REPAIR KNOWLEDGE BASE (`price_book` rows, scope H/HP, hour
    ranges — was loaded 2026-10-29 but never read by the quoter), and SHOP
    MATERIAL COSTS (materials-db items named in the request + median receipt
    prices, same ZIP first — the shop list had not been sent since July).
    It is its own uncached system block after the corrections block.
    `ParserDeps.getPriceBook` feeds the server-side lead draft.
  - **A cut-off reply no longer loses the quote**: `lib/json-salvage.ts`
    `salvageJson` keeps every complete line of a reply that hit max_tokens
    (was: "invalid JSON", whole parse thrown away) and a note says the quote
    may be missing its last items. Report text cap raised 30k → 60k chars
    (`INPUT_TEXT_CAP`), with a note when a report is still cut.
  - **AI notes are shown** (they never were): QuoteForge `aiNotes` → a
    dismissible "Check before you send" card above Scope check (sub-trade
    flags, hour adjustments, cut-off warnings); lead drafts carry
    `leadDraft.notes`.
  - learning.ts writes `__job__:` rows for every finished job (it skipped
    jobs within 0.5h of the quote, biasing the legacy ratio up); lead-draft
    reads corrections newest-first.
  NOT changed, on purpose: the prompt's "hours historically run LOW" nudge and
  the PAST JOB DURATIONS block (dropping them together with a downward factor
  would compound) — revisit once the factor settles. 
  **Reopened jobs don't teach** (`lib/learning-rows.ts`, tested): clients
  can't delete price_corrections rows, so on READ the quoter drops the
  `job_completion` rows (line hours + `__job__`/`__jobraw__`) of any job whose
  current status is back before complete (`ParserDeps.getJobStatuses`; the
  app asks Supabase for those job ids' statuses each parse). Unknown status
  (deleted job, failed lookup) keeps the rows; finishing the job again
  writes fresh ones.
  **Output cap 16000 → 32000 for the quote parse** (`PARSE_MAX_TOKENS`;
  `/api/ai` MAX_TOKENS_CEILING 32000). A reply that long can outlast the
  route's 300s limit, which would lose the whole quote, so `callClaude`
  STREAMS any call with `max_tokens` > `STREAM_ABOVE_TOKENS` (16000) and
  rebuilds the normal message object (`lib/anthropic-stream.ts`
  `readMessageStream`, tested). At `STREAM_DEADLINE_MS` (255s; lead draft
  230s) it cancels the stream and returns what was written with
  `stop_reason: "max_tokens"` + `cut: "deadline"` — the parser's salvage then
  keeps every complete line. Calls at ≤ 16000 are unchanged (not streamed).
  Don't raise `maxDuration` past 300 without checking the Vercel plan/Fluid
  setting (a rejected value fails the build). Not measured: how fast Sonnet
  5.5 actually writes — if cut-off notes show up on big quotes with
  `cut: "deadline"`, time is the limit, not tokens. The grounding's
  effect on live quotes has not been measured — compare `aiHrs` vs clocked on
  jobs quoted after this date.
- **Models**: quote parse, ping, voice walk, AI Assist, lead draft and the tax
  lookup are `claude-sonnet-5-5`. **Receipt scan (`/api/ai/receipt`, effort
  medium) and Troubleshoot (effort low) moved to `claude-haiku-5-5` on
  2026-10-28** — Haiku 5.5 DOES exist ($0.10/$0.50 per MTok ≤100K prompt; the
  old "no Haiku 5" note was wrong). Haiku: adaptive thinking is on by default
  and counts toward `max_tokens` (caps were raised); `between_tools` and
  `temperature` 400; no server-side refusal fallback. Spot-check refunds and
  multi-page receipts after any change to the receipt model.
  Sonnet thinking off = `thinking: {type:"between_tools"}` + `effort:"high"`
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

