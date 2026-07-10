export interface Organization {
  id: string;
  name: string;
  phone: string;
  email: string;
  license_num: string;
  address: string;
  logo_url: string;
  /** Per-org brand color (hex). Threads through app accents (--color-primary),
   *  the digital business card, and PDF accents. Defaults to #2E75B6. */
  brand_color?: string;
  /** Optional second stop for a two-tone brand gradient. Null/absent = solid. */
  brand_color_2?: string;
  /** Quote-PDF terms (Ops → Settings → Quote terms) so the footer isn't
   *  one-size-fits-all. Deposit % (default 50; 0 = no deposit line), validity
   *  window in days (default 30), and free-text custom terms (one per line). */
  deposit_pct?: number;
  quote_valid_days?: number;
  quote_terms?: string;
  default_rate: number;
  markup_pct: number;
  tax_pct: number;
  /** Tax computation mode. "total" = tax (labor + materials − discount)
   *  — the pre-feature behavior; "materials" = tax materials only with
   *  discount allocated proportionally; "none" = tax-exempt. Resolved
   *  via `resolveTaxMode()` in src/lib/tax.ts which falls back to
   *  "total" when the column is missing (legacy rows pre-migration). */
  tax_mode?: "total" | "materials" | "none";
  trade_rates?: string; // JSON: { "Plumbing": 65, "Electrical": 70, ... }
  licensed_trades?: string; // JSON array: ["Electrical","Plumbing","HVAC","Roofing"]
  /** Primary trade id (handyman | plumber | electrician | hvac | painter |
   *  flooring | roofer | gc | landscaper). Tailors default rate, materials,
   *  inspection checklist, quote units, Grizz copy, and starter items. See
   *  src/lib/trades.ts. Absent/legacy rows resolve to 'handyman'. */
  primary_trade?: string;
  quest_config?: string;
  stripe_account_id?: string;
  stripe_connected?: boolean;
  trial_start?: string;
  subscription_status?: string; // trial | active | past_due | canceled
  stripe_customer_id?: string;
  stripe_subscription_id?: string;
  /** Canonical plan name written by the Stripe webhook on every
   *  subscription event. One of "solo" | "crew" | "pro". The legacy
   *  `plan` column is kept in sync for back-compat with older UI that
   *  still reads it; new code should prefer `subscription_plan`. */
  subscription_plan?: string;
  /** ISO timestamp of when the Stripe trial ends. Written by the
   *  webhook on subscription.created/updated. Null/absent when no
   *  Stripe subscription exists yet (e.g. owner is mid-onboarding). */
  trial_ends_at?: string;
  plan?: string; // legacy — mirrors subscription_plan; preserved for
                 // older Operations/Admin UIs that still read `plan`.
  billing_enforced?: boolean;
  site_content?: string;
  site_published?: boolean;
  site_slug?: string;
  trip_fee?: number;
  /** Org-wide minimum billable labor hours per quote. If the sum of all
   *  line-item hours falls below this, the quote bills at
   *  min_labor_hours × effective rate instead. Per-quote override lives
   *  on the rooms JSON blob as `data.minLaborHours`. Default 1. */
  min_labor_hours?: number;
  gallery_photos?: string; // JSON: [{url, caption}]
  site_theme?: string; // JSON: {primaryColor, showGallery, showReviews, showAbout, showServices, showWhyUs}
  // Auto Payroll — server-side scheduled processing. Cron hits
  // /api/payroll/auto-run; the endpoint reads these fields and fires
  // payroll for any org whose schedule matches "now".
  auto_payroll_enabled?: boolean;
  auto_payroll_day?: number;       // 0=Sun ... 6=Sat (default 5 = Fri)
  auto_payroll_hour?: number;      // 0-23 (default 17 = 5 PM)
  auto_payroll_cadence?: "weekly" | "biweekly";
  auto_payroll_last_run?: string;  // ISO timestamp
  // Review-Request automation. When a Stripe-paid job lands (verified
  // server-side in /api/verify-payment), we schedule a row in
  // review_requests for review_request_delay_hours later. Hourly cron
  // /api/reviews/dispatch picks pending rows up and sends them.
  review_request_enabled?: boolean;
  review_request_delay_hours?: number;        // default 24
  review_request_channel?: "sms" | "email" | "both"; // default "sms"
  /** Custom template. Supports {customer_name}, {business_name},
   *  {job_property}, {review_link}. Falls back to a default if null. */
  review_request_message?: string;
  /** Public Google review URL the message points the customer at. If
   *  unset, the template uses a generic "reply with a star rating 1-5"
   *  fallback. */
  google_review_url?: string;
  created_at?: string;
}

export interface Profile {
  id: string;
  email: string;
  name: string;
  role: "owner" | "manager" | "tech" | "apprentice";
  rate: number;
  photo_url?: string;
  start_date: string;
  emp_num: string;
  org_id: string;
  /** Mobile number for SMS notifications (E.164 or loose US — the send
   *  path normalizes). Optional; SMS notifications skip users without one. */
  phone?: string;
  /** Notification prefs. Default TRUE (opt-out model) — the columns are
   *  created with DEFAULT TRUE so existing rows read as opted-in. The
   *  in-app feed respects the per-event toggles; `notify_sms` is the
   *  master "also text me" switch, gating the SMS channel only. */
  notify_sms?: boolean;
  notify_assigned?: boolean;
  notify_leads?: boolean;
  /** PTO balance — unused by the app today but kept on the type because
   *  the underlying DB column still exists for a possible future return. */
  pto_balance_hrs?: number;
  /** Sick balance — unused by the app today, kept for the same reason. */
  sick_balance_hrs?: number;
  created_at?: string;
}

/** In-app notification feed row. Source of truth for the dashboard bell.
 *  Created server-side (service-role) by /api/leads (new lead) and
 *  /api/notify (job assigned); read + marked-read client-side, scoped by
 *  `user_id`. SMS is a delivery side-effect at creation time, gated by the
 *  recipient's prefs — the row is always written so the feed is complete.
 *  Named AppNotification to avoid colliding with the DOM `Notification`. */
export type NotificationType = "job_assigned" | "new_lead";

export interface AppNotification {
  id: string;
  org_id: string;
  user_id: string;        // recipient profile id
  type: NotificationType;
  title: string;
  body: string;
  job_id?: string;        // deep-link target (nullable)
  read_at?: string | null; // null = unread
  created_at?: string;
}

/** Customer = first-class CRM entity. Replaces the retired legacy
 *  `clients` table. The free-text `client` and `property` strings on
 *  Job rows are preserved as display fallbacks (rendered in Jobs lists,
 *  PDFs, etc.) but the structured contact info — phone, email — comes
 *  from the linked Customer entity via Job.customer_id. */
export type CustomerType = "individual" | "business" | "property_manager";

export interface Customer {
  id: string;
  org_id: string;
  name: string;
  type: CustomerType;
  /** For business / property_manager rows: the human point of contact
   *  (e.g. "Sarah at Key Renter"). Optional for individuals. */
  primary_contact?: string;
  phone?: string;
  email?: string;
  notes?: string;
  created_at?: string;
  updated_at?: string;
}

export interface Address {
  id: string;
  org_id: string;
  customer_id: string;
  /** Short human label — "Main", "Beach house", "2415 W Lotus". Falls
   *  back to the street line in the UI when not set. */
  label?: string;
  street?: string;
  city?: string;
  state?: string;
  zip?: string;
  is_primary?: boolean;
  /** Freeform JSONB for property-manager-specific fields (unit_count,
   *  owner, occupancy_status). Supabase auto-parses jsonb to an object;
   *  treat as untyped until we lock down the schema. */
  metadata?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
}

export interface Job {
  id: string;
  property: string;
  client: string;
  job_date: string;
  rooms: string;
  total: number;
  total_labor: number;
  total_mat: number;
  total_hrs: number;
  status: "lead" | "quoted" | "accepted" | "scheduled" | "active" | "complete" | "invoiced" | "paid" | "inspection";
  created_by: string;
  created_at: string;
  trade: string;
  callback: boolean;
  is_upsell: boolean;
  requested_tech: string;
  client_signature?: string;
  signature_date?: string;
  /** Server-stamped audit trail for the public /status approval flow.
   *  approved_at is set on the first signature/typed-name submission;
   *  approved_ip captures the client's request IP at that moment. */
  approved_at?: string;
  approved_ip?: string;
  org_id?: string;
  /** Optional FK into the new Customer entity. When set, the job is
   *  linked to a structured customer record; otherwise the legacy
   *  free-text `client` field is the source of truth. Both can be
   *  populated simultaneously during the migration. */
  customer_id?: string;
  /** Optional FK into the new Address entity. Same coexistence story
   *  as `customer_id` — the legacy `property` string remains
   *  authoritative until both are linked. */
  address_id?: string;
  is_recurring?: boolean;
  recurrence_rule?: string; // weekly | biweekly | monthly | quarterly
  next_due?: string;
  parent_job_id?: string;
  // Archive flag for jobs the client never accepted (or never moved on).
  // Status field is preserved (typically "quoted") so a restore brings the
  // job back to its original state without losing context.
  archived?: boolean;
  archived_at?: string;
  // Set when the user has triggered a review-request prompt for this job
  // (via SMS / email / copy). Stops the auto-prompt from re-firing every
  // time the row re-renders after completion.
  review_requested_at?: string;
  /** Profile.id of the technician whose QR code / share-link the lead
   *  came in through. Set by /api/leads when the lead-intake URL had
   *  ?tech=<id>. Powers Network Scout / referral credit so a tech who
   *  shares the business card and wins a job gets attribution. */
  referrer_tech_id?: string;
  /** Timestamp when the Stripe payment was server-confirmed by
   *  /api/verify-payment. Used to scope the platform-fee cap query to
   *  the current calendar month. Null until the job reaches "paid". */
  paid_at?: string;
  /** Creed platform fee collected on this job's payment (integer cents).
   *  0 for Pro-tier orgs or when the monthly $100 cap was already hit.
   *  Set by /api/verify-payment; adjusted down by the charge.refunded
   *  webhook if the customer later refunds (restores cap headroom). */
  platform_fee_cents?: number;
  /** Stripe PaymentIntent id for the customer payment on this job.
   *  Stored by /api/verify-payment so the charge.refunded webhook can
   *  look up the job and adjust platform_fee_cents on refund. */
  stripe_payment_intent_id?: string;
  /** Paid-to-date (dollars), recomputed from the `payments` ledger by
   *  /api/verify-payment and the refund webhook. A deposit records here
   *  WITHOUT flipping status to "paid" — that only happens once
   *  amount_paid covers `total`. Balance due = total - amount_paid. */
  amount_paid?: number;
  /** Optional FK into the `equipment` table — the unit this job services.
   *  Set from the Jobs detail; completing the job stamps that unit's
   *  `last_service_at`. Absent = no linked equipment. */
  equipment_id?: string | null;
}

/** One row per Stripe charge (or refund) against a job — the payment ledger.
 *  `stripe_session_id` is UNIQUE, which makes /api/verify-payment idempotent:
 *  a refreshed /payment/success can't double-count a deposit. `amount` is in
 *  dollars and is NEGATIVE for refunds. A job's paid-to-date is the sum of
 *  its rows, cached onto `jobs.amount_paid`. */
export type PaymentKind = "deposit" | "balance" | "payment" | "refund";

export interface Payment {
  id: string;
  org_id: string;
  job_id: string;
  /** Dollars. Positive for a charge, negative for a refund. */
  amount: number;
  kind: PaymentKind;
  /** Stripe Checkout session id. UNIQUE — the idempotency key. Null for
   *  refunds (Postgres allows multiple NULLs under a unique constraint). */
  stripe_session_id?: string | null;
  stripe_payment_intent_id?: string | null;
  /** Creed platform fee attributable to this charge (integer cents). */
  platform_fee_cents?: number;
  created_at?: string;
}

export interface TimeEntry {
  id: string;
  /** Address text snapshot of the job at the time of clock-in. Kept for
   *  display + back-compat; rollups should prefer job_id when present. */
  job: string;
  /** Foreign key to jobs.id — added 2026-04. Disambiguates multiple jobs
   *  at the same property (e.g. a callback job at an address that's
   *  already had a prior job). Optional because legacy rows pre-migration
   *  don't have it; rollups fall back to address-match for those, but
   *  only attribute legacy entries to the OLDEST job at that address so
   *  they don't double-roll into a newer job. */
  job_id?: string;
  entry_date: string;
  hours: number;
  amount: number;
  user_id: string;
  user_name: string;
  start_time?: string;
  end_time?: string;
  /** ISO timestamp when this entry was rolled into a payroll run.
   *  Null/undefined = unpaid (will appear in the next pay cycle).
   *  Set = already paid; kept in the table forever so Team Stats
   *  can compute lifetime hours/earnings without losing history. */
  paid_at?: string;
}

export interface Review {
  id: string;
  client_name: string;
  review_text: string;
  rating: number;
  created_at?: string;
  employee_names?: string;
}

/** Scheduled review-request automation row. One row per (org, job)
 *  pair — created when a job's status flips to "paid" via the Stripe
 *  verify-payment route, picked up later by the hourly dispatch cron.
 *  Manual review requests cancel any pending row for the same job. */
export type ReviewRequestChannel = "sms" | "email" | "both";
export type ReviewRequestStatus = "scheduled" | "sent" | "failed" | "cancelled";

export interface ReviewRequest {
  id: string;
  org_id: string;
  job_id: string;
  customer_id?: string;
  scheduled_for: string;   // ISO timestamp
  channel: ReviewRequestChannel;
  status: ReviewRequestStatus;
  sent_at?: string;
  error?: string;
  created_at?: string;
}

export interface Referral {
  id: string;
  name: string;
  source: string;
  status: "pending" | "contacted" | "converted";
  ref_date: string;
  created_at?: string;
  /** The tech who brought in this referral — scopes the Network Scout quest
   *  per-user. Stamped on creation from the Quests → Referrals tab. Absent on
   *  legacy rows and public/website submissions (those credit no individual
   *  tech). Requires the `referred_by_user_id` column migration. */
  referred_by_user_id?: string;
}

export interface ScheduleEntry {
  id: string;
  sched_date: string;       // start day (YYYY-MM-DD)
  end_date?: string;        // last day for multi-day jobs; absent = single day
  job: string;
  note: string;
  created_at?: string;
}

export interface PayHistory {
  id: string;
  user_id: string;
  name: string;
  pay_date: string;
  hours: number;
  amount: number;
  entries: number;
  created_at?: string;
  details?: string;
}

export interface Receipt {
  id: string;
  job_id: string;
  note: string;
  amount: number;
  receipt_date: string;
  photo_url: string;
  /** Multi-page receipt: object-paths for ALL pages (page 1 === photo_url).
   *  Optional/migration-safe — needs `ALTER TABLE receipts ADD COLUMN pages JSONB`. */
  pages?: string[];
}

export interface QuestPayout {
  id: string;
  org_id: string;
  user_id: string;
  quest_key: string;
  bonus_amount: number;
  paid_date: string;
  created_at?: string;
}

/**
 * Memberships / service plans. A `membership_plans` row is a plan the org
 * sells (e.g. "$19/mo HVAC tune-up"); a `customer_memberships` row is a
 * customer enrolled in one. Billing runs through a Stripe SUBSCRIPTION on
 * the org's connected account (destination charge + the Creed application
 * fee, same model as one-time job payments). Service visits auto-spawn via
 * the recurring-jobs cron (/api/recurring/fire) from the plan's `included`
 * template. See src/lib/memberships.ts + /api/memberships/*.
 */
export type MembershipInterval = "monthly" | "quarterly" | "annual";

export interface MembershipPlan {
  id: string;
  org_id: string;
  name: string;
  /** Recurring price in DOLLARS, billed every `interval`. */
  price: number;
  interval: MembershipInterval;
  /** Visit template — the rooms/data blob copied into each spawned service
   *  job (same shape as recurring_jobs.template_rooms / a saved quote). */
  included?: unknown;
  /** Service visits per year — drives the auto-visit cadence. */
  visits_per_year: number;
  is_active: boolean;
  /** Stripe Price id, created lazily on first enroll (on the platform
   *  account; funds route to the org via transfer_data). Cached + reused. */
  stripe_price_id?: string | null;
  created_at?: string;
}

export type MembershipStatus = "active" | "past_due" | "paused" | "cancelled";

export interface CustomerMembership {
  id: string;
  org_id: string;
  customer_id: string;
  plan_id: string;
  status: MembershipStatus;
  /** Stripe Subscription id (destination-charge sub routed to the org). */
  stripe_subscription_id?: string | null;
  started_at?: string;
  /** Next billing date — synced from Stripe current_period_end by the webhook. */
  next_bill_at?: string | null;
  /** Next auto-created service visit — advanced by the recurring cron. */
  next_visit_at?: string | null;
  created_at?: string;
}

/**
 * Property equipment / asset history. A unit installed at a customer's
 * property (HVAC, water heater, electrical panel…) tracked across service
 * visits. `jobs.equipment_id` links a job to the unit it serviced; completing
 * that job stamps `last_service_at`. See EquipmentSection + CLAUDE.md migration.
 */
export type EquipmentKind = "hvac" | "furnace" | "water_heater" | "panel" | "other";

export interface Equipment {
  id: string;
  org_id: string;
  customer_id?: string | null;
  address_id?: string | null;
  /** Denormalized property label — used when there's no address_id, or for display. */
  property?: string | null;
  kind: string;                    // one of EquipmentKind; tolerant of free text
  make?: string;
  model?: string;
  serial?: string;
  installed_at?: string | null;    // DATE (YYYY-MM-DD)
  warranty_until?: string | null;  // DATE
  notes?: string;
  photos?: { url: string; label?: string }[];
  last_service_at?: string | null; // TIMESTAMPTZ — stamped when a linked job completes
  created_at?: string;
}

/**
 * Recurring job template. One row = one cadence-driven schedule that
 * spawns a new `jobs` row each time the cron fires. The `template_rooms`
 * blob is copied verbatim into the new job's `rooms` field, so any
 * line-items, work order, and totals on the source quote travel forward
 * to every recurrence. Server-side cron in /api/recurring/fire.
 */
export type RecurringCadence =
  | "weekly"
  | "biweekly"
  | "monthly"
  | "quarterly"
  | "semiannual"
  | "annual";

export interface RecurringJob {
  id: string;
  org_id: string;
  customer_id?: string | null;
  address_id?: string | null;
  /** Denormalized — kept on the row so list rendering doesn't have to
   *  resolve customer_id/address_id joins on every refresh. */
  property?: string | null;
  client?: string | null;
  /** The full rooms/data/workOrder blob copied to each spawned job.
   *  Stored as JSONB in Supabase, so the client receives a parsed object;
   *  the cron re-stringifies it before insert (jobs.rooms is TEXT). */
  template_rooms: unknown;
  title?: string | null;
  cadence: RecurringCadence;
  /** 0=Sun..6=Sat — only used for weekly/biweekly. */
  day_of_week?: number | null;
  /** 1..28 — used for monthly+. Clamped to 28 so Feb is safe. */
  day_of_month?: number | null;
  /** Hour-of-day (0..23). Cron is daily so this is advisory until the
   *  Vercel plan supports hourly. */
  hour?: number | null;
  is_active: boolean;
  last_fired_at?: string | null;
  next_fire_at?: string | null;
  created_at?: string;
  updated_at?: string;
}

/**
 * Time-off request submitted by an employee (or admin self-service).
 * Approve/deny is a status flip — no balance tracking; we just log
 * what was asked for and what the admin decided.
 */
export type TimeOffKind = "vacation" | "sick" | "personal" | "unpaid";
export type TimeOffStatus = "pending" | "approved" | "denied";

export interface TimeOffRequest {
  id: string;
  user_id: string;
  user_name: string;
  org_id?: string;
  start_date: string;    // YYYY-MM-DD
  end_date: string;      // YYYY-MM-DD
  hours: number;         // total requested hours (default 8 × business days)
  kind: TimeOffKind;
  reason?: string;
  status: TimeOffStatus;
  /** Who flipped status to approved/denied. Null while still pending. */
  decided_by?: string;
  decided_at?: string;
  created_at?: string;
}

export interface PortalToken {
  id: string;
  org_id: string;
  customer_id: string;
  token: string;
  expires_at: string;
  used_at?: string | null;
  created_at?: string;
}

export interface Material {
  n: string;
  c: number;          // line total (= qty × unitPrice when both are set)
  qty?: number;       // quantity, defaults to 1 if absent
  unitPrice?: number; // per-unit price, defaults to c (lump sum) if absent
}

/** Inspection findings (Inspector + Voice Walk both produce these). */
export interface InspectionItem {
  name: string;       // e.g. "Sink/Faucet"
  condition: string;  // "S" | "F" | "P" | "D"
  notes: string;
  photos: string[];   // public URLs
}

export interface InspectionRoom {
  name: string;
  sqft: number;
  // Optional dimensions captured by the per-room W×L calculator in
  // Inspector.tsx. sqft is the source of truth (used by the AI quote and
  // the report); width/length are stored only so the inputs round-trip if
  // the inspector navigates back to the room.
  width?: number;
  length?: number;
  items: InspectionItem[];
}

export interface RoomItem {
  id: string;
  detail: string;
  condition: string;
  comment: string;
  laborHrs: number;
  materials: Material[];
  /** Optional sqft soft-field surfaced in the QuoteTab's SQFT column.
   *  Captured by the manual Add Item form and editable per-row. */
  sqft?: number;
  /** Stamped by the manual Add Item form. When true, validateQuote's
   *  classifier and deterministic-override pass MUST leave the item's
   *  parent trade bucket alone — the user picked it deliberately. The
   *  classifier exists to rescue AI miscategorizations; manual entries
   *  are sacred and should never get rebucketed by either pass. */
  userClassified?: boolean;
  /** Upsell / recommended add-on, not part of the base quote. The AI
   *  emits this for inspector rows that flag an item as "not present /
   *  could not test / recommended" rather than required maintenance
   *  (e.g. "Install doorbell — currently no doorbell present"). The
   *  QuoteForge editor excludes optional items from the headline
   *  subtotal and shows them as a separate "Optional add-ons" line so
   *  the base quote reflects required work only. */
  optional?: boolean;
  /** Time-and-materials / assessment-first scope. The AI emits this
   *  for inspector comments with evaluate / investigate / assess /
   *  "may need" / "further damage" / "underlying" language — work
   *  whose real scope can't be known without a hands-on look.
   *  The line carries a small assessment fee (typical 0.5-1h on-site
   *  inspect time) and a clear T&M caveat in the comment; actual
   *  repair pricing happens after the visit. QuoteForge surfaces a
   *  "T&M (N)" stat tile so the owner sees how much of the quote is
   *  inspect-first vs fixed-bid. The fee DOES roll into base subtotal
   *  (the visit itself is billable). */
  tnm?: boolean;
  /** LEGACY Good-Better-Best tag (single, cumulative). Superseded by `tiers`
   *  below; kept for back-compat. When `tiers` is absent, this is interpreted
   *  cumulatively (base ∈ all options, better ∈ better+best, best ∈ best only)
   *  via `src/lib/tiers.ts` so pre-membership quotes render identically. */
  tier?: "base" | "better" | "best";
  /** Good-Better-Best MEMBERSHIP — the explicit set of options this line
   *  appears in. Lets options be mutually exclusive (e.g. gravel pad in
   *  Good/Better vs. concrete slab in Best only). Absent = fall back to the
   *  cumulative reading of `tier`. Only meaningful when `data.tieredQuote`. */
  tiers?: ("base" | "better" | "best")[];
}

export interface Room {
  name: string;
  items: RoomItem[];
}

/** Per-quote price adjustment stored on the rooms JSON blob as
 *  `data.discount`. Applied to (subtotal + trip fee) BEFORE tax. A
 *  null/undefined value on the blob means no discount.
 *  Lives in the blob — no schema change required. */
export interface JobDiscount {
  type: "percent" | "fixed";
  value: number;
  label?: string;
}
